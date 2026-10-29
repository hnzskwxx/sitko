import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft, ChevronRight, Copy, Download, Ellipsis, FileText, FlaskConical, Mail, Pencil, Phone, RefreshCw, ShieldAlert, Trash2, UserX,
} from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import type { ApplicationDetail, Decision, DocumentText, EvaluationItem, Me, Note, Verdict } from '@shared/types';
import { DECISION_LABEL, DECISIONS, MUST_LABEL, VERDICT_LABEL, VERDICTS, WEIGHT_LABEL } from '@shared/types';
import { api, ApiFailure, errorMessage } from '../api';
import { Evidence, highlightQuotes } from '../components/Evidence';
import { ConfirmDialog, Dialog, Menu } from '../components/overlay';
import { useToast } from '../components/toast';
import {
  Avatar, Badge, Button, EmptyState, ErrorState, Field, IconButton, Input, MustBadge, Notice, Skeleton, Spinner, Textarea, Tooltip, VerdictBadge,
} from '../components/ui';
import { fmtDateTime, lastListSearch, plural, useDocumentTitle } from '../hooks';
import { NotFoundPage } from './NotFound';

const DECISION_SHORT: Record<Decision, string> = { pozvat: 'Pozvat', mozna: 'Možná', odmitnout: 'Odmítnout' };
const isProcessing = (s: ApplicationDetail['status']) => s === 'queued' || s === 'extracting' || s === 'evaluating';

export function CandidatePage({ me }: { me: Me }) {
  const { jobId = '', appId = '' } = useParams();
  const qc = useQueryClient();
  const toast = useToast();
  const navigate = useNavigate();
  const [overrideItem, setOverrideItem] = useState<EvaluationItem | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  const [textOpen, setTextOpen] = useState(false);
  const [removeOpen, setRemoveOpen] = useState(false);
  const [eraseOpen, setEraseOpen] = useState(false);

  const q = useQuery({
    queryKey: ['application', appId],
    queryFn: () => api.get<ApplicationDetail>(`/applications/${appId}`),
    refetchInterval: (qq) => (qq.state.data && isProcessing(qq.state.data.status) ? 2000 : false),
  });
  const d = q.data;
  useDocumentTitle(d?.candidate?.name ?? d?.document.fileName);

  const set = (data: ApplicationDetail) => {
    qc.setQueryData(['application', appId], data);
    void qc.invalidateQueries({ queryKey: ['applications', jobId] });
    void qc.invalidateQueries({ queryKey: ['job', jobId] });
  };
  const decide = useMutation({
    mutationFn: (decision: Decision | null) => api.patch<ApplicationDetail>(`/applications/${appId}`, { decision }),
    onSuccess: (data) => { set(data); toast(data.decision ? `Uloženo: ${DECISION_LABEL[data.decision].toLowerCase()}.` : 'Rozhodnutí zrušeno.'); },
    onError: (e) => toast(errorMessage(e), 'error'),
  });
  const reevaluate = useMutation({
    mutationFn: () => api.post(`/applications/${appId}/reevaluate`),
    onSuccess: () => { toast('Hodnocení se spustilo znovu.'); void q.refetch(); void qc.invalidateQueries({ queryKey: ['applications', jobId] }); },
    onError: (e) => toast(errorMessage(e), 'error'),
  });
  const retry = useMutation({
    mutationFn: () => api.post(`/applications/${appId}/retry`),
    onSuccess: () => { toast('Zpracování se spustilo znovu.'); void q.refetch(); },
    onError: (e) => toast(errorMessage(e), 'error'),
  });

  const backSearch = lastListSearch.get(jobId);
  const backTo = `/pozice/${jobId}${backSearch ? `?${backSearch}` : ''}`;

  if (q.isPending) return <div className="page"><Skeleton w={280} h={24} /><div style={{ height: 20 }} /><Spinner /></div>;
  if (q.isError) {
    if (q.error instanceof ApiFailure && q.error.status === 404) return <NotFoundPage what="Kandidát" />;
    return <div className="page"><ErrorState error={q.error} onRetry={() => q.refetch()} /></div>;
  }
  if (!d) return null;

  const ev = d.evaluation;
  const name = d.candidate?.name ?? d.document.fileName;
  const fileUrl = `/api/v1/documents/${d.document.id}/file`;

  return (
    <div className="page">
      <div className="page-head">
        <div className="page-head-text">
          <nav className="crumbs" aria-label="Drobečková navigace">
            <Link to="/pozice">Pozice</Link><ChevronRight aria-hidden />
            <Link to={backTo}>{d.job.title}</Link><ChevronRight aria-hidden />
          </nav>
          <div className="row" style={{ gap: 12 }}>
            <Avatar name={name} size="lg" />
            <div className="page-head-text">
              <h1 className="page-title">{name}</h1>
              {ev?.currentRole && <p className="page-sub">{ev.currentRole}</p>}
            </div>
          </div>
        </div>
        <div className="row">
          <Link to={backTo} className="btn btn-ghost"><ArrowLeft aria-hidden />Zpět na kandidáty</Link>
          <Menu
            trigger={<IconButton label="Další akce" variant="secondary"><Ellipsis /></IconButton>}
            actions={[
              { label: 'Opravit jméno a kontakt', icon: <Pencil />, disabled: !d.candidate, onSelect: () => setEditOpen(true) },
              { label: 'Vyhodnotit znovu', icon: <RefreshCw />, disabled: d.status !== 'done', onSelect: () => reevaluate.mutate() },
              { label: 'Zobrazit text životopisu', icon: <FileText />, disabled: !d.document.pageCount, onSelect: () => setTextOpen(true) },
              { label: 'Stáhnout originál', icon: <Download />, onSelect: () => { window.location.href = fileUrl; } },
              { label: 'Odebrat z pozice', icon: <Trash2 />, danger: true, separatorBefore: true, disabled: isProcessing(d.status), onSelect: () => setRemoveOpen(true) },
              { label: 'Smazat kandidáta a jeho data', icon: <UserX />, danger: true, disabled: !d.candidate, onSelect: () => setEraseOpen(true) },
            ]}
          />
        </div>
      </div>

      {isProcessing(d.status) && (
        <div className="panel panel-pad"><Spinner label={d.status === 'queued' ? `Životopis čeká na zpracování.${d.errorMessage ? ` ${d.errorMessage}` : ''}` : d.status === 'extracting' ? 'Čtu text životopisu…' : 'Hodnotím požadavky…'} /></div>
      )}
      {d.status === 'failed' && (
        <ErrorState error={new Error(d.errorMessage ?? 'Zpracování selhalo.')} onRetry={d.canRetry ? () => retry.mutate() : undefined} />
      )}

      {ev && (
        <div className="detail">
          <div className="stack" style={{ gap: 20 }}>
            {ev.source === 'demo' && (
              <Notice tone="warning" icon={<FlaskConical />}>Ukázková data: hodnocení je předpřipravené, nejde o analýzu AI. Citace jsou ale opravdu ověřené proti textu dokumentu.</Notice>
            )}
            {ev.stale && (
              <Notice tone="warning" icon={<RefreshCw />} action={<Button size="sm" loading={reevaluate.isPending} onClick={() => reevaluate.mutate()}>Vyhodnotit znovu</Button>}>
                Hodnocení vychází ze starší verze požadavků (verze {ev.requirementsVersion}, aktuální {d.job.requirementsVersion}).
              </Notice>
            )}
            {(d.injectionFlag || ev.injectionDetected) && (
              <Notice tone="warning" icon={<ShieldAlert />}>
                Životopis obsahuje text, který se snaží ovlivnit hodnocení AI (například skrytý pokyn). Hodnocení ho ignorovalo, přesto životopis projděte ručně.
              </Notice>
            )}
            {d.possibleDuplicate && <Notice tone="info" icon={<Copy />}>Tento kandidát má u pozice i jiný životopis (podle e-mailu). Může jít o duplicitní přihlášku.</Notice>}

            <p className="summary-text">{ev.summary}</p>

            <section aria-labelledby="sec-req">
              <div className="section-head"><h2 className="section-title" id="sec-req">Požadavky a důkazy</h2></div>
              <div className="panel results">
                {ev.items.map((it) => (
                  <div className="result" key={it.id}>
                    <div>
                      <div className="result-name">{it.name}</div>
                      <div className="result-weight">{WEIGHT_LABEL[it.weight]}{it.mustHave ? ', povinný' : ''}</div>
                    </div>
                    <div className="stack-sm" style={{ justifyItems: 'start' }}>
                      <VerdictBadge verdict={it.verdict} />
                      {it.override && <Badge tone="info">Upraveno</Badge>}
                    </div>
                    <div>
                      <Evidence item={it} />
                      {it.explanation && <p className="result-expl">{it.explanation}</p>}
                      {it.limitations && <p className="result-limit">Omezení: {it.limitations}</p>}
                      {it.override && (
                        <div className="result-override">
                          Opraveno z „{VERDICT_LABEL[it.aiVerdict]}“ ({it.override.by ?? 'neznámý uživatel'}, {fmtDateTime(it.override.at)}): {it.override.note}
                        </div>
                      )}
                    </div>
                    <div>
                      <Button size="sm" variant="ghost" onClick={() => setOverrideItem(it)}>Opravit</Button>
                    </div>
                  </div>
                ))}
              </div>
            </section>

            <section aria-labelledby="sec-prof">
              <div className="section-head">
                <h2 className="section-title" id="sec-prof">Údaje z životopisu</h2>
                <span className="xs muted">Vytaženo automaticky, ověřte v originálu</span>
              </div>
              <div className="panel profile">
                {ev.profile.experience.length > 0 && (
                  <div>
                    <h4>Pracovní zkušenosti</h4>
                    <div className="exp">
                      {ev.profile.experience.map((x, i) => (
                        <div className="exp-item" key={i}>
                          <span className="exp-period">{x.period || '–'}</span>
                          <div><strong style={{ fontWeight: 500 }}>{x.title}</strong>{x.employer && <span className="muted">, {x.employer}</span>}{x.summary && <p className="small muted">{x.summary}</p>}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                {ev.profile.education.length > 0 && (
                  <div>
                    <h4>Vzdělání</h4>
                    <div className="exp">
                      {ev.profile.education.map((x, i) => (
                        <div className="exp-item" key={i}><span className="exp-period">{x.period || '–'}</span><div>{x.institution}{x.degree && <span className="muted">, {x.degree}</span>}</div></div>
                      ))}
                    </div>
                  </div>
                )}
                {ev.profile.skills.length > 0 && (
                  <div><h4>Dovednosti</h4><div className="chips">{ev.profile.skills.map((s) => <span className="chip" key={s}>{s}</span>)}</div></div>
                )}
                {(ev.profile.languages.length > 0 || ev.profile.certifications.length > 0) && (
                  <div className="two-col">
                    {ev.profile.languages.length > 0 && <div><h4>Jazyky</h4><ul className="list-plain">{ev.profile.languages.map((l) => <li key={l.language}>{l.language}{l.level && <span className="muted">, {l.level}</span>}</li>)}</ul></div>}
                    {ev.profile.certifications.length > 0 && <div><h4>Certifikace</h4><ul className="list-plain">{ev.profile.certifications.map((c) => <li key={c}>{c}</li>)}</ul></div>}
                  </div>
                )}
                {!ev.profile.experience.length && !ev.profile.education.length && !ev.profile.skills.length && <p className="muted small">Z životopisu se nepodařilo vytáhnout strukturované údaje.</p>}
              </div>
            </section>

            <section className="two-col" aria-label="Shrnutí pro pohovor">
              <div className="panel panel-pad stack-sm">
                <h3 className="section-title">Silné stránky</h3>
                {ev.strengths.length ? <ul className="list-plain">{ev.strengths.map((s) => <li key={s}>{s}</li>)}</ul> : <p className="muted small">Nic zvláštního.</p>}
              </div>
              <div className="panel panel-pad stack-sm">
                <h3 className="section-title">Ověřit na pohovoru</h3>
                {ev.concerns.length ? <ul className="list-plain">{ev.concerns.map((s) => <li key={s}>{s}</li>)}</ul> : <p className="muted small">Nic zvláštního.</p>}
              </div>
            </section>
            {ev.interviewQuestions.length > 0 && (
              <section className="panel panel-pad stack-sm" aria-labelledby="sec-q">
                <h3 className="section-title" id="sec-q">Otázky na pohovor</h3>
                <ol className="list-plain">{ev.interviewQuestions.map((s) => <li key={s}>{s}</li>)}</ol>
              </section>
            )}
          </div>

          <aside className="detail-aside" aria-label="Rozhodnutí a údaje">
            <section className="panel panel-pad stack-sm aside-top" aria-labelledby="sec-score">
              <div className="row" style={{ justifyContent: 'space-between' }}>
                <h2 className="label" id="sec-score">Doložená shoda</h2>
                <MustBadge status={ev.mustStatus} />
              </div>
              <div className="score-big">
                <span className="score-big-num">{ev.score}<small>%</small></span>
                <span className="score-track" aria-hidden><span className="score-fill" style={{ width: `${ev.score}%` }} /></span>
              </div>
              <p className="small muted">
                Úplnost hodnocení {ev.coverage} %. {ev.mustStatus !== 'none' && <>Povinné požadavky: {MUST_LABEL[ev.mustStatus].toLowerCase()}.</>}
                {ev.score !== ev.aiScore && <> Podle AI původně {ev.aiScore} %, upraveno opravou verdiktu.</>}
              </p>
              <Tooltip content="Splňuje = 1 bod, částečně = 0,5, nesplňuje a nelze ověřit = 0. Body se násobí vahou (klíčové 3, důležité 2, výhoda 1) a dělí součtem vah. Úplnost říká, pro jakou část vah životopis vůbec obsahoval informaci.">
                <button type="button" className="link small" style={{ border: 0, background: 'none', padding: 0, justifySelf: 'start' }}>Jak se shoda počítá?</button>
              </Tooltip>
            </section>

            <section className="panel panel-pad stack-sm aside-top" aria-labelledby="sec-dec">
              <h2 className="label" id="sec-dec">Vaše rozhodnutí</h2>
              <div className="decision" role="group" aria-labelledby="sec-dec">
                {DECISIONS.map((x) => (
                  <button key={x} type="button" aria-pressed={d.decision === x} disabled={decide.isPending}
                    onClick={() => decide.mutate(d.decision === x ? null : x)} title={DECISION_LABEL[x]}>{DECISION_SHORT[x]}</button>
                ))}
              </div>
              <p className="xs muted">Sítko nikoho automaticky nezamítá. Rozhodnutí se zapíše do historie.</p>
            </section>

            {d.candidate && (
              <section className="panel panel-pad stack-sm" aria-labelledby="sec-contact">
                <div className="row" style={{ justifyContent: 'space-between' }}>
                  <h2 className="label" id="sec-contact">Kontakt</h2>
                  <IconButton label="Opravit jméno a kontakt" size="sm" onClick={() => setEditOpen(true)}><Pencil /></IconButton>
                </div>
                <dl className="kv">
                  <dt><Mail width={14} height={14} aria-label="E-mail" /></dt><dd>{d.candidate.email ?? <span className="muted">neuvedeno</span>}</dd>
                  <dt><Phone width={14} height={14} aria-label="Telefon" /></dt><dd>{d.candidate.phone ?? <span className="muted">neuvedeno</span>}</dd>
                </dl>
              </section>
            )}

            <section className="panel panel-pad stack-sm" aria-labelledby="sec-doc">
              <h2 className="label" id="sec-doc">Dokument</h2>
              <p className="small ellipsis" title={d.document.fileName}>{d.document.fileName}</p>
              <p className="xs muted">
                {(d.document.sizeBytes / 1024).toFixed(0)} kB
                {d.document.pageCount > 0 && <>, {plural(d.document.pageCount, 'strana', 'strany', 'stran')}</>}
                {d.document.textSource === 'ocr' && <>, text přepsaný ze skenu</>}
                , nahráno {fmtDateTime(d.createdAt)}
              </p>
              <div className="row-wrap">
                <a className="btn btn-secondary btn-sm" href={fileUrl}><Download aria-hidden />Originál</a>
                {d.document.pageCount > 0 && <Button size="sm" icon={<FileText />} onClick={() => setTextOpen(true)}>Text s citacemi</Button>}
              </div>
            </section>

            <Notes app={d} onChange={set} />

            {d.history.length > 0 && (
              <section className="panel panel-pad" aria-labelledby="sec-hist">
                <h2 className="label" id="sec-hist" style={{ marginBottom: 4 }}>Historie hodnocení</h2>
                {d.history.map((h) => (
                  <div className="history-item" key={h.id}>
                    <span>Verze {h.version} <span className="muted">· požadavky v{h.requirementsVersion}</span></span>
                    <span className="num">{h.score} % <span className="muted xs">{fmtDateTime(h.createdAt)}</span></span>
                  </div>
                ))}
              </section>
            )}
          </aside>
        </div>
      )}

      {!ev && d.status === 'done' && <EmptyState title="Hodnocení chybí" />}

      {overrideItem && <OverrideDialog item={overrideItem} onClose={() => setOverrideItem(null)} onSaved={set} />}
      {d.candidate && editOpen && <EditCandidateDialog app={d} onClose={() => setEditOpen(false)} onSaved={() => { void q.refetch(); void qc.invalidateQueries({ queryKey: ['applications', jobId] }); }} />}
      {textOpen && <DocumentTextDialog app={d} onClose={() => setTextOpen(false)} />}

      <ConfirmDialog open={removeOpen} onOpenChange={setRemoveOpen} danger title={`Odebrat ${name} z pozice?`} confirmLabel="Odebrat z pozice"
        onConfirm={async () => {
          await api.del(`/applications/${appId}`);
          void qc.invalidateQueries({ queryKey: ['applications', jobId] });
          void qc.invalidateQueries({ queryKey: ['job', jobId] });
          toast('Kandidát odebrán z pozice.');
          navigate(backTo);
        }}>
        Smaže se hodnocení, rozhodnutí a poznámky k této pozici. Pokud životopis nepatří k jiné pozici, smaže se i soubor.
      </ConfirmDialog>
      <ConfirmDialog open={eraseOpen} onOpenChange={setEraseOpen} danger title={`Smazat kandidáta ${name} a všechna jeho data?`} confirmLabel="Smazat natrvalo"
        onConfirm={async () => {
          await api.del(`/candidates/${d.candidate?.id}`);
          void qc.invalidateQueries({ queryKey: ['applications'] });
          void qc.invalidateQueries({ queryKey: ['job', jobId] });
          toast('Kandidát a jeho data smazány.');
          navigate(backTo);
        }}>
        Smažou se všechny jeho životopisy, hodnocení, poznámky a rozhodnutí ve všech pozicích {me.organization.name}. Použijte při žádosti o výmaz podle GDPR. Akci nejde vrátit.
      </ConfirmDialog>
    </div>
  );
}

function Notes({ app, onChange }: { app: ApplicationDetail; onChange: (d: ApplicationDetail) => void }) {
  const [body, setBody] = useState('');
  const qc = useQueryClient();
  const toast = useToast();
  const add = useMutation({
    mutationFn: () => api.post<Note[]>(`/applications/${app.id}/notes`, { body }),
    onSuccess: (notes) => { setBody(''); onChange({ ...app, notes }); toast('Poznámka přidána.'); },
    onError: (e) => toast(errorMessage(e), 'error'),
  });
  const del = useMutation({
    mutationFn: (id: string) => api.del(`/notes/${id}`),
    onSuccess: (_r, id) => { onChange({ ...app, notes: app.notes.filter((n) => n.id !== id) }); void qc.invalidateQueries({ queryKey: ['application', app.id] }); toast('Poznámka smazána.'); },
    onError: (e) => toast(errorMessage(e), 'error'),
  });
  return (
    <section className="panel panel-pad stack-sm" aria-labelledby="sec-notes">
      <h2 className="label" id="sec-notes">Poznámky</h2>
      <form className="stack-sm" onSubmit={(e: FormEvent) => { e.preventDefault(); if (body.trim()) add.mutate(); }}>
        <Textarea aria-label="Nová poznámka" rows={3} style={{ minHeight: 72 }} value={body} onChange={(e) => setBody(e.target.value)} placeholder="Například: volat v pondělí, chce home office" />
        <div><Button type="submit" size="sm" loading={add.isPending} disabled={!body.trim()}>Přidat poznámku</Button></div>
      </form>
      {app.notes.map((n) => (
        <div className="note" key={n.id}>
          <div className="note-body">{n.body}</div>
          <div className="row xs muted">
            <span>{n.authorName ?? 'Bývalý člen týmu'}, {fmtDateTime(n.createdAt)}</span>
            {n.isMine && <button type="button" className="link xs" style={{ border: 0, background: 'none', padding: 0, marginLeft: 'auto' }} onClick={() => del.mutate(n.id)}>Smazat</button>}
          </div>
        </div>
      ))}
    </section>
  );
}

function OverrideDialog({ item, onClose, onSaved }: { item: EvaluationItem; onClose: () => void; onSaved: (d: ApplicationDetail) => void }) {
  const [verdict, setVerdict] = useState<Verdict>(item.verdict);
  const [note, setNote] = useState(item.override?.note ?? '');
  const [error, setError] = useState<string | null>(null);
  const toast = useToast();
  const save = useMutation({
    mutationFn: (v: Verdict | null) => api.patch<ApplicationDetail>(`/evaluation-items/${item.id}`, { verdict: v, note }),
    onSuccess: (d, v) => { onSaved(d); toast(v === null || v === item.aiVerdict ? 'Oprava zrušena, platí verdikt AI.' : 'Verdikt opraven, shoda přepočítána.'); onClose(); },
    onError: (e) => setError(errorMessage(e)),
  });
  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }} title={`Opravit verdikt: ${item.name}`}
      description={`AI vyhodnotila „${VERDICT_LABEL[item.aiVerdict]}“. Oprava přepočítá doloženou shodu a zapíše se do historie.`}
      footer={<>
        {item.override && <Button variant="ghost" onClick={() => save.mutate(null)} disabled={save.isPending}>Vrátit verdikt AI</Button>}
        <span className="spacer" />
        <Button onClick={onClose}>Zrušit</Button>
        <Button variant="primary" loading={save.isPending} onClick={() => save.mutate(verdict)}>Uložit opravu</Button>
      </>}
    >
      <div className="stack">
        <fieldset style={{ border: 0, padding: 0, margin: 0 }} className="stack-sm">
          <legend className="label" style={{ marginBottom: 6 }}>Správný verdikt</legend>
          {VERDICTS.map((v) => (
            <label key={v} className="check-label" style={{ fontSize: 14 }}>
              <input type="radio" name="verdict" className="checkbox" checked={verdict === v} onChange={() => setVerdict(v)} />
              <VerdictBadge verdict={v} />
            </label>
          ))}
        </fieldset>
        <Field label="Důvod opravy" hint="Například: praxi doložil na pohovoru, citace v CV není.">
          {(id, d) => <Textarea id={id} aria-describedby={d} rows={3} style={{ minHeight: 72 }} value={note} onChange={(e) => setNote(e.target.value)} />}
        </Field>
        {error && <p className="form-error" role="alert">{error}</p>}
      </div>
    </Dialog>
  );
}

function EditCandidateDialog({ app, onClose, onSaved }: { app: ApplicationDetail; onClose: () => void; onSaved: () => void }) {
  const c = app.candidate!;
  const [v, setV] = useState({ name: c.name, email: c.email ?? '', phone: c.phone ?? '' });
  const [fields, setFields] = useState<Record<string, string>>({});
  const toast = useToast();
  const save = useMutation({
    mutationFn: () => api.patch(`/candidates/${c.id}`, v),
    onSuccess: () => { toast('Údaje kandidáta uloženy.'); onSaved(); onClose(); },
    onError: (e) => { if (e instanceof ApiFailure) setFields(e.fields); toast(errorMessage(e), 'error'); },
  });
  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }} title="Opravit jméno a kontakt"
      description="Oprava platí pro kandidáta ve všech pozicích a další hodnocení ji nepřepíše."
      footer={<><Button onClick={onClose}>Zrušit</Button><Button variant="primary" loading={save.isPending} onClick={() => save.mutate()}>Uložit</Button></>}>
      <div className="stack">
        <Field label="Jméno" error={fields.name}>{(id) => <Input id={id} value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} />}</Field>
        <Field label="E-mail" error={fields.email}>{(id) => <Input id={id} type="email" value={v.email} onChange={(e) => setV({ ...v, email: e.target.value })} />}</Field>
        <Field label="Telefon" error={fields.phone}>{(id) => <Input id={id} value={v.phone} onChange={(e) => setV({ ...v, phone: e.target.value })} />}</Field>
      </div>
    </Dialog>
  );
}

function DocumentTextDialog({ app, onClose }: { app: ApplicationDetail; onClose: () => void }) {
  const q = useQuery({ queryKey: ['doc-text', app.document.id], queryFn: () => api.get<DocumentText>(`/documents/${app.document.id}/text`) });
  const quotes = (app.evaluation?.items ?? []).filter((i) => i.quoteStatus === 'exact' || i.quoteStatus === 'approximate').map((i) => i.quote);
  return (
    <Dialog open size="lg" onOpenChange={(o) => { if (!o) onClose(); }} title="Text životopisu"
      description={`Text tak, jak ho Sítko přečetlo${q.data?.source === 'ocr' ? ' (přepis ze skenu)' : ''}. Žlutě jsou citace použité v hodnocení.`}>
      {q.isPending ? <Spinner /> : q.isError ? <ErrorState error={q.error} /> : q.data.pages.map((p, i) => (
        <div className="doc-page" key={i}>
          <p className="xs muted" style={{ marginBottom: 6 }}>Strana {i + 1}</p>
          <p className="doc-page-text">{highlightQuotes(p, quotes).map((part, j) => (part.mark ? <mark key={j}>{part.text}</mark> : <span key={j}>{part.text}</span>))}</p>
        </div>
      ))}
    </Dialog>
  );
}
