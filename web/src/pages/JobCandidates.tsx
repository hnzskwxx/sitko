import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowDown, ArrowUp, ArrowUpDown, CircleAlert, Copy, Download, Ellipsis, FileText, Info, LoaderCircle, RefreshCw, ShieldAlert, Trash2, Upload, Users,
} from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import type { ApplicationRow, JobDetail } from '@shared/types';
import { DECISION_STATE_LABEL, PROCESSING_LABEL } from '@shared/types';
import { api, errorMessage, qs } from '../api';
import { ConfirmDialog, Menu } from '../components/overlay';
import { useToast } from '../components/toast';
import {
  Badge, Button, EmptyState, ErrorState, IconButton, MustBadge, Notice, Pagination, ScoreBar, SearchInput, Select, SkeletonRows, Tooltip,
} from '../components/ui';
import { fmtDate, lastListSearch, plural, useHotkey } from '../hooks';

type SortKey = 'match' | 'name' | 'created';
const PAGE_SIZE = 25;

function SortHeader({ label, k, sort, dir, onSort }: { label: string; k: SortKey; sort: SortKey; dir: 'asc' | 'desc'; onSort: (k: SortKey) => void }) {
  const active = sort === k;
  return (
    <button type="button" className="th-sort" onClick={() => onSort(k)}>
      {label}{active ? (dir === 'asc' ? <ArrowUp aria-hidden /> : <ArrowDown aria-hidden />) : <ArrowUpDown aria-hidden style={{ opacity: 0.4 }} />}
    </button>
  );
}

export function JobCandidates({ job, onUpload }: { job: JobDetail; onUpload: () => void }) {
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const toast = useToast();
  const [q, setQ] = useState(params.get('q') ?? '');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [toRemove, setToRemove] = useState<ApplicationRow | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const tableRef = useRef<HTMLTableSectionElement>(null);

  const sort = (params.get('sort') as SortKey) ?? 'match';
  const dir = (params.get('dir') as 'asc' | 'desc') ?? (sort === 'name' ? 'asc' : 'desc');
  const page = Number(params.get('page') ?? '1') || 1;
  const filters = { decision: params.get('decision') ?? '', must: params.get('must') ?? '', status: params.get('status') ?? '' };
  const query = qs({ q: params.get('q'), ...filters, sort: sort === 'match' ? undefined : sort, dir: params.get('dir'), page, pageSize: PAGE_SIZE });

  useEffect(() => { lastListSearch.set(job.id, params.toString()); }, [job.id, params]);
  useHotkey('/', useCallback(() => searchRef.current?.focus(), []));

  useEffect(() => {
    const t = setTimeout(() => {
      if ((params.get('q') ?? '') !== q) {
        const n = new URLSearchParams(params);
        if (q) n.set('q', q); else n.delete('q');
        n.delete('page');
        setParams(n, { replace: true });
      }
    }, 250);
    return () => clearTimeout(t);
  }, [q, params, setParams]);

  const list = useQuery({
    queryKey: ['applications', job.id, query],
    queryFn: () => api.list<ApplicationRow>(`/jobs/${job.id}/applications${query}`),
    placeholderData: keepPreviousData,
    refetchInterval: (qq) => (qq.state.data?.data.some((r) => r.status !== 'done' && r.status !== 'failed') || job.counts.processing ? 2000 : false),
  });

  // Po dokončení zpracování obnovit i počty v hlavičce pozice
  const processingNow = list.data?.data.filter((r) => r.status !== 'done' && r.status !== 'failed').length ?? 0;
  const prevProcessing = useRef(processingNow);
  useEffect(() => {
    if (prevProcessing.current > 0 && processingNow === 0) void qc.invalidateQueries({ queryKey: ['job', job.id] });
    prevProcessing.current = processingNow;
  }, [processingNow, qc, job.id]);

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['applications', job.id] });
    void qc.invalidateQueries({ queryKey: ['job', job.id] });
    void qc.invalidateQueries({ queryKey: ['dashboard'] });
  };

  const reevaluate = useMutation({
    mutationFn: (body: { ids?: string[]; staleOnly?: boolean }) => api.post<{ queued: number }>(`/jobs/${job.id}/applications/reevaluate`, body),
    onSuccess: (r) => { toast(r.queued ? `${plural(r.queued, 'kandidát se hodnotí', 'kandidáti se hodnotí', 'kandidátů se hodnotí')} znovu.` : 'Nebylo co přehodnotit.'); setSelected(new Set()); refresh(); },
    onError: (e) => toast(errorMessage(e), 'error'),
  });
  const retry = useMutation({
    mutationFn: (id: string) => api.post(`/applications/${id}/retry`),
    onSuccess: () => { toast('Zpracování spuštěno znovu.'); refresh(); },
    onError: (e) => toast(errorMessage(e), 'error'),
  });

  const setParam = (key: string, value: string | null) => {
    const n = new URLSearchParams(params);
    if (value) n.set(key, value); else n.delete(key);
    if (key !== 'page') n.delete('page');
    setParams(n);
  };
  const onSort = (k: SortKey) => {
    const n = new URLSearchParams(params);
    const nextDir = sort === k ? (dir === 'asc' ? 'desc' : 'asc') : k === 'name' ? 'asc' : 'desc';
    if (k === 'match' && nextDir === 'desc') { n.delete('sort'); n.delete('dir'); } else { n.set('sort', k); n.set('dir', nextDir); }
    n.delete('page');
    setParams(n);
  };

  const rows = list.data?.data ?? [];
  const open = (r: ApplicationRow) => navigate(`/pozice/${job.id}/kandidati/${r.id}`);
  const onRowKey = (e: React.KeyboardEvent<HTMLTableRowElement>, r: ApplicationRow, i: number) => {
    if (e.target !== e.currentTarget) return;
    if (e.key === 'Enter') { e.preventDefault(); open(r); }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const next = tableRef.current?.querySelectorAll<HTMLTableRowElement>('tr')[i + (e.key === 'ArrowDown' ? 1 : -1)];
      next?.focus();
    }
  };
  const anyFilter = Boolean(params.get('q') || filters.decision || filters.must || filters.status);
  const selectable = rows.filter((r) => r.status === 'done');
  const allSelected = selectable.length > 0 && selectable.every((r) => selected.has(r.id));

  if (!job.counts.total && !list.isPending && !anyFilter) {
    return (
      <section className="panel">
        <EmptyState icon={<Users />} title="Zatím tu nejsou žádní kandidáti"
          actions={job.status === 'active' ? <Button variant="primary" icon={<Upload />} onClick={onUpload}>Nahrát životopisy</Button> : undefined}>
          {job.status === 'active'
            ? 'Nahrajte životopisy uchazečů. Sítko u každého vyhodnotí potvrzené požadavky a ukáže, z čeho hodnocení vychází.'
            : 'Pozice není aktivní, proto nejde nahrávat životopisy.'}
        </EmptyState>
      </section>
    );
  }

  return (
    <div className="stack">
      {job.counts.stale > 0 && (
        <Notice tone="warning" icon={<RefreshCw />}
          action={job.status === 'active' ? <Button size="sm" loading={reevaluate.isPending} onClick={() => reevaluate.mutate({ staleOnly: true })}>Vyhodnotit znovu</Button> : undefined}>
          {plural(job.counts.stale, 'hodnocení vychází', 'hodnocení vycházejí', 'hodnocení vychází')} ze starší verze požadavků.
        </Notice>
      )}

      <section className="panel">
        <div className="toolbar">
          <SearchInput ref={searchRef} placeholder="Hledat kandidáta" aria-label="Hledat kandidáta" value={q} onChange={(e) => setQ(e.target.value)} shortcut="/" />
          <Select compact aria-label="Rozhodnutí" value={filters.decision} onChange={(e) => setParam('decision', e.target.value || null)} style={{ width: 'auto' }}>
            <option value="">Všechna rozhodnutí</option>
            <option value="none">Nerozhodnuto</option>
            <option value="pozvat">Pozván(a)</option>
            <option value="mozna">Možná</option>
            <option value="odmitnout">Odmítnut(a)</option>
          </Select>
          <Select compact aria-label="Povinné požadavky" value={filters.must} onChange={(e) => setParam('must', e.target.value || null)} style={{ width: 'auto' }}>
            <option value="">Povinné: vše</option>
            <option value="met">Povinné splněny</option>
            <option value="unknown">Povinné k ověření</option>
            <option value="unmet">Povinné nesplněny</option>
          </Select>
          <Select compact aria-label="Zpracování" value={filters.status} onChange={(e) => setParam('status', e.target.value || null)} style={{ width: 'auto' }}>
            <option value="">Zpracování: vše</option>
            <option value="done">Vyhodnoceno</option>
            <option value="processing">Zpracovává se</option>
            <option value="failed">Chyba</option>
          </Select>
          {anyFilter && <Button variant="ghost" size="sm" onClick={() => { setQ(''); setParams({}); }}>Zrušit filtry</Button>}
        </div>

        {selected.size > 0 && (
          <div className="bulkbar" role="region" aria-label="Hromadné akce">
            <strong>{plural(selected.size, 'vybraný kandidát', 'vybraní kandidáti', 'vybraných kandidátů')}</strong>
            <Button size="sm" icon={<RefreshCw />} loading={reevaluate.isPending} disabled={job.status !== 'active'}
              onClick={() => reevaluate.mutate({ ids: [...selected] })}>Vyhodnotit znovu</Button>
            <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>Zrušit výběr</Button>
          </div>
        )}

        {list.isError ? <div style={{ padding: 16 }}><ErrorState error={list.error} onRetry={() => list.refetch()} /></div>
          : list.isPending ? <SkeletonRows rows={6} cols={6} />
            : rows.length === 0 ? (
              <EmptyState title="Žádný kandidát neodpovídá filtrům" actions={<Button onClick={() => { setQ(''); setParams({}); }}>Zrušit filtry</Button>} />
            ) : (
              <>
                <div className="table-wrap">
                  <table className="table" aria-label="Kandidáti">
                    <thead>
                      <tr>
                        <th className="col-check">
                          <input type="checkbox" className="checkbox" aria-label="Vybrat všechny vyhodnocené na stránce" checked={allSelected}
                            onChange={(e) => setSelected(e.target.checked ? new Set(selectable.map((r) => r.id)) : new Set())} disabled={!selectable.length} />
                        </th>
                        <th aria-sort={sort === 'name' ? (dir === 'asc' ? 'ascending' : 'descending') : undefined}><SortHeader label="Kandidát" k="name" sort={sort} dir={dir} onSort={onSort} /></th>
                        <th aria-sort={sort === 'match' ? (dir === 'asc' ? 'ascending' : 'descending') : undefined}>
                          <span className="row" style={{ gap: 4 }}>
                            <SortHeader label="Doložená shoda" k="match" sort={sort} dir={dir} onSort={onSort} />
                            <Tooltip content="Vážený podíl potvrzených požadavků, které životopis prokazatelně doložil (splňuje = 1, částečně = 0,5). Nejde o hodnocení člověka. Kandidáti s nesplněným povinným požadavkem jsou řazeni níž, ale nikdy se nevyřazují.">
                              <button type="button" className="th-sort" aria-label="Co znamená doložená shoda"><Info aria-hidden /></button>
                            </Tooltip>
                          </span>
                        </th>
                        <th>Povinné</th>
                        <th className="col-num">Splněno</th>
                        <th className="col-num"><Tooltip content="Požadavky, které z CV nejde ověřit, nebo jejichž citaci jsme v dokumentu nenašli."><span>Neověřeno</span></Tooltip></th>
                        <th>Rozhodnutí</th>
                        <th aria-sort={sort === 'created' ? (dir === 'asc' ? 'ascending' : 'descending') : undefined}><SortHeader label="Přidáno" k="created" sort={sort} dir={dir} onSort={onSort} /></th>
                        <th className="col-actions"><span className="sr-only">Akce</span></th>
                      </tr>
                    </thead>
                    <tbody ref={tableRef}>
                      {rows.map((r, i) => {
                        const done = r.status === 'done';
                        return (
                          <tr key={r.id} tabIndex={0} className={`is-clickable${selected.has(r.id) ? ' is-selected' : ''}`}
                            onClick={() => open(r)} onKeyDown={(e) => onRowKey(e, r, i)} aria-label={r.candidateName ?? r.fileName}>
                            <td className="col-check" onClick={(e) => e.stopPropagation()}>
                              {done && (
                                <input type="checkbox" className="checkbox" aria-label={`Vybrat ${r.candidateName ?? r.fileName}`} checked={selected.has(r.id)}
                                  onChange={(e) => setSelected((s) => { const n = new Set(s); if (e.target.checked) n.add(r.id); else n.delete(r.id); return n; })} />
                              )}
                            </td>
                            <td style={{ maxWidth: 320 }}>
                              <div className="cell-main">
                                <Link to={`/pozice/${job.id}/kandidati/${r.id}`} className="cell-title link-quiet ellipsis" onClick={(e) => e.stopPropagation()}>
                                  {r.candidateName ?? r.fileName}
                                </Link>
                                {done ? <span className="cell-sub ellipsis">{r.currentRole ?? r.fileName}</span>
                                  : r.candidateName ? <span className="cell-sub ellipsis">{r.fileName}</span> : null}
                                {(r.injectionFlag || r.possibleDuplicate || r.stale) && (
                                  <span className="row-wrap" style={{ gap: 4, marginTop: 2 }}>
                                    {r.injectionFlag && <Badge tone="warning" icon={<ShieldAlert />}>Podezřelý text</Badge>}
                                    {r.possibleDuplicate && <Badge tone="info" icon={<Copy />}>Možný duplikát</Badge>}
                                    {r.stale && <Badge tone="warning" icon={<RefreshCw />}>Zastaralé</Badge>}
                                  </span>
                                )}
                              </div>
                            </td>
                            {done ? (
                              <>
                                <td><ScoreBar score={r.score ?? 0} coverage={r.coverage} muted={r.mustStatus === 'unmet'} /></td>
                                <td><MustBadge status={r.mustStatus} /></td>
                                <td className="col-num num">{r.metCount}/{r.requirementCount}</td>
                                <td className="col-num num">{r.unverifiedCount ? r.unverifiedCount : <span className="muted">0</span>}</td>
                                <td>{r.decision ? <Badge tone={r.decision === 'pozvat' ? 'success' : r.decision === 'odmitnout' ? 'outline' : 'neutral'}>{DECISION_STATE_LABEL[r.decision]}</Badge> : <span className="muted small">Nerozhodnuto</span>}</td>
                              </>
                            ) : r.status === 'failed' ? (
                              <td colSpan={5}>
                                <span className="row-wrap" style={{ color: 'var(--error)' }}>
                                  <CircleAlert width={16} height={16} aria-hidden />
                                  <span className="small">{r.errorMessage ?? 'Zpracování selhalo.'}</span>
                                  {r.canRetry && (
                                    <Button size="sm" onClick={(e) => { e.stopPropagation(); retry.mutate(r.id); }} loading={retry.isPending && retry.variables === r.id}>Zkusit znovu</Button>
                                  )}
                                </span>
                              </td>
                            ) : (
                              <td colSpan={5}>
                                <span className="row small muted" role="status">
                                  <LoaderCircle className="spin" width={16} height={16} aria-hidden />
                                  {PROCESSING_LABEL[r.status]}…{r.errorMessage && <span> {r.errorMessage}</span>}
                                </span>
                              </td>
                            )}
                            <td className="small muted num">{fmtDate(r.createdAt)}</td>
                            <td className="col-actions" onClick={(e) => e.stopPropagation()}>
                              <Menu
                                trigger={<IconButton label={`Akce pro ${r.candidateName ?? r.fileName}`} size="sm"><Ellipsis /></IconButton>}
                                actions={[
                                  { label: 'Otevřít detail', icon: <FileText />, onSelect: () => open(r) },
                                  { label: 'Vyhodnotit znovu', icon: <RefreshCw />, disabled: !done || job.status !== 'active', onSelect: () => reevaluate.mutate({ ids: [r.id] }) },
                                  { label: 'Odebrat z pozice', icon: <Trash2 />, danger: true, separatorBefore: true, disabled: r.status === 'extracting' || r.status === 'evaluating', onSelect: () => setToRemove(r) },
                                ]}
                              />
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                <Pagination page={list.data.meta.page} pageSize={list.data.meta.pageSize} total={list.data.meta.total} onPage={(p) => setParam('page', String(p))} />
              </>
            )}
      </section>

      <p className="xs muted">
        Sítko seřadí kandidáty podle doložené shody s potvrzenými požadavky. Nikoho nevyřazuje a o pozvání rozhodujete vy.
        {job.counts.done > 0 && <> <a className="link" href={`/api/v1/jobs/${job.id}/export.csv`}><Download width={12} height={12} style={{ verticalAlign: '-2px' }} aria-hidden /> Stáhnout výsledky (CSV)</a></>}
      </p>

      <ConfirmDialog
        open={Boolean(toRemove)} onOpenChange={(o) => { if (!o) setToRemove(null); }} danger
        title={`Odebrat ${toRemove?.candidateName ?? toRemove?.fileName ?? ''} z pozice?`} confirmLabel="Odebrat"
        onConfirm={async () => {
          if (!toRemove) return;
          await api.del(`/applications/${toRemove.id}`);
          toast('Kandidát odebrán z pozice.');
          setToRemove(null);
          refresh();
        }}
      >
        Smaže se hodnocení, rozhodnutí a poznámky k této pozici. Pokud životopis nepatří k jiné pozici, smaže se i soubor.
      </ConfirmDialog>
    </div>
  );
}
