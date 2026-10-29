import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Copy, Trash2 } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { NavLink, Route, Routes } from 'react-router';
import type { Invite, Me, Member, Role, Usage } from '@shared/types';
import { ROLE_LABEL, ROLES } from '@shared/types';
import { api, ApiFailure, errorMessage } from '../api';
import { ConfirmDialog } from '../components/overlay';
import { useToast } from '../components/toast';
import { Badge, Button, ErrorState, Field, IconButton, Input, Notice, Select, Spinner } from '../components/ui';
import { fmtDate, useDocumentTitle } from '../hooks';
import { NotFoundPage } from './NotFound';

export function SettingsPage({ me }: { me: Me }) {
  useDocumentTitle('Nastavení');
  return (
    <div className="page">
      <div className="page-head"><div className="page-head-text"><h1 className="page-title">Nastavení</h1></div></div>
      <div className="settings">
        <nav className="settings-nav" aria-label="Nastavení">
          <NavLink to="/nastaveni" end className="nav-item">Profil</NavLink>
          <NavLink to="/nastaveni/organizace" className="nav-item">Organizace</NavLink>
          <NavLink to="/nastaveni/tym" className="nav-item">Tým</NavLink>
          <NavLink to="/nastaveni/zpracovani" className="nav-item">Zpracování a data</NavLink>
        </nav>
        <Routes>
          <Route index element={<Profile me={me} />} />
          <Route path="organizace" element={<Organization me={me} />} />
          <Route path="tym" element={<Team me={me} />} />
          <Route path="zpracovani" element={<Processing me={me} />} />
          <Route path="*" element={<NotFoundPage />} />
        </Routes>
      </div>
    </div>
  );
}

function Profile({ me }: { me: Me }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [name, setName] = useState(me.user.name);
  const [pw, setPw] = useState({ currentPassword: '', newPassword: '' });
  const [pwFields, setPwFields] = useState<Record<string, string>>({});
  const saveName = useMutation({
    mutationFn: () => api.patch<Me>('/me', { name }),
    onSuccess: (m) => { qc.setQueryData(['me'], m); toast('Jméno uloženo.'); },
    onError: (e) => toast(errorMessage(e), 'error'),
  });
  const savePw = useMutation({
    mutationFn: () => api.post('/me/password', pw),
    onSuccess: () => { setPw({ currentPassword: '', newPassword: '' }); setPwFields({}); toast('Heslo změněno. Ostatní přihlášení byla ukončena.'); },
    onError: (e) => { if (e instanceof ApiFailure) setPwFields(e.fields); toast(errorMessage(e), 'error'); },
  });
  return (
    <div className="settings-section">
      <form className="panel panel-pad stack" onSubmit={(e: FormEvent) => { e.preventDefault(); saveName.mutate(); }}>
        <h2 className="section-title">Profil</h2>
        <Field label="Jméno">{(id) => <Input id={id} value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" />}</Field>
        <Field label="E-mail" hint="E-mail slouží k přihlášení a zatím ho nejde změnit.">{(id, d) => <Input id={id} aria-describedby={d} value={me.user.email} readOnly />}</Field>
        <div className="form-actions"><Button type="submit" variant="primary" loading={saveName.isPending} disabled={name.trim() === me.user.name}>Uložit jméno</Button></div>
      </form>
      <form className="panel panel-pad stack" onSubmit={(e: FormEvent) => { e.preventDefault(); savePw.mutate(); }}>
        <h2 className="section-title">Změna hesla</h2>
        <Field label="Současné heslo" error={pwFields.currentPassword}>{(id) => <Input id={id} type="password" autoComplete="current-password" value={pw.currentPassword} onChange={(e) => setPw({ ...pw, currentPassword: e.target.value })} />}</Field>
        <Field label="Nové heslo" hint="Aspoň 10 znaků." error={pwFields.newPassword}>{(id, d) => <Input id={id} aria-describedby={d} type="password" autoComplete="new-password" value={pw.newPassword} onChange={(e) => setPw({ ...pw, newPassword: e.target.value })} />}</Field>
        <div className="form-actions"><Button type="submit" loading={savePw.isPending} disabled={!pw.currentPassword || !pw.newPassword}>Změnit heslo</Button></div>
      </form>
    </div>
  );
}

function Organization({ me }: { me: Me }) {
  const qc = useQueryClient();
  const toast = useToast();
  const owner = me.role === 'owner';
  const [name, setName] = useState(me.organization.name);
  const [retention, setRetention] = useState(String(me.organization.retentionDays));
  const [fields, setFields] = useState<Record<string, string>>({});
  const save = useMutation({
    mutationFn: () => api.patch<Me['organization']>('/organization', { name, retentionDays: Number(retention) }),
    onSuccess: (org) => { qc.setQueryData<Me>(['me'], (m) => (m ? { ...m, organization: org } : m)); setFields({}); toast('Nastavení organizace uloženo.'); },
    onError: (e) => { if (e instanceof ApiFailure) setFields(e.fields); toast(errorMessage(e), 'error'); },
  });
  return (
    <form className="settings-section" onSubmit={(e: FormEvent) => { e.preventDefault(); save.mutate(); }}>
      <div className="panel panel-pad stack">
        <h2 className="section-title">Organizace</h2>
        {!owner && <Notice>Nastavení organizace může měnit jen vlastník.</Notice>}
        <Field label="Název firmy" error={fields.name}>{(id) => <Input id={id} value={name} onChange={(e) => setName(e.target.value)} disabled={!owner} />}</Field>
        <Field label="Doba uchování dat (dny)" error={fields.retentionDays}
          hint="Přihlášky v uzavřených a archivovaných pozicích se po této době automaticky smažou i se soubory. Nejméně 30, nejvýš 3650 dní.">
          {(id, d) => <Input id={id} aria-describedby={d} type="number" min={30} max={3650} value={retention} onChange={(e) => setRetention(e.target.value)} disabled={!owner} style={{ width: 140 }} />}
        </Field>
        {owner && <div className="form-actions"><Button type="submit" variant="primary" loading={save.isPending}>Uložit</Button></div>}
      </div>
    </form>
  );
}

function Team({ me }: { me: Me }) {
  const qc = useQueryClient();
  const toast = useToast();
  const owner = me.role === 'owner';
  const members = useQuery({ queryKey: ['members'], queryFn: () => api.get<Member[]>('/organization/members') });
  const invites = useQuery({ queryKey: ['invites'], queryFn: () => api.get<Invite[]>('/organization/invites'), enabled: owner });
  const [role, setRole] = useState<Role>('recruiter');
  const [email, setEmail] = useState('');
  const [created, setCreated] = useState<Invite | null>(null);
  const [removing, setRemoving] = useState<Member | null>(null);

  const invite = useMutation({
    mutationFn: () => api.post<Invite>('/organization/invites', { role, email }),
    onSuccess: (inv) => { setCreated(inv); setEmail(''); void qc.invalidateQueries({ queryKey: ['invites'] }); },
    onError: (e) => toast(errorMessage(e), 'error'),
  });
  const changeRole = useMutation({
    mutationFn: ({ userId, role: r }: { userId: string; role: Role }) => api.patch(`/organization/members/${userId}`, { role: r }),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['members'] }); toast('Role změněna.'); },
    onError: (e) => { toast(errorMessage(e), 'error'); void qc.invalidateQueries({ queryKey: ['members'] }); },
  });
  const revoke = useMutation({
    mutationFn: (id: string) => api.del(`/organization/invites/${id}`),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['invites'] }); toast('Pozvánka zrušena.'); },
    onError: (e) => toast(errorMessage(e), 'error'),
  });

  const copy = async (text: string) => {
    try { await navigator.clipboard.writeText(text); toast('Odkaz zkopírován.'); } catch { toast('Odkaz se nepodařilo zkopírovat, označte ho ručně.', 'error'); }
  };

  return (
    <div className="settings-section" style={{ maxWidth: 760 }}>
      <section className="panel">
        <div className="panel-head"><h2 className="section-title">Členové týmu</h2></div>
        {members.isError ? <div style={{ padding: 16 }}><ErrorState error={members.error} /></div> : members.isPending ? <div style={{ padding: 16 }}><Spinner /></div> : (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Jméno</th><th>Role</th><th>Od</th>{owner && <th className="col-actions"><span className="sr-only">Akce</span></th>}</tr></thead>
              <tbody>
                {members.data.map((m) => (
                  <tr key={m.userId}>
                    <td><div className="cell-main"><span className="cell-title">{m.name}{m.isYou && <span className="muted"> (vy)</span>}</span><span className="cell-sub">{m.email}</span></div></td>
                    <td>
                      {owner ? (
                        <Select compact aria-label={`Role ${m.name}`} value={m.role} style={{ width: 'auto' }}
                          onChange={(e) => changeRole.mutate({ userId: m.userId, role: e.target.value as Role })}>
                          {ROLES.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
                        </Select>
                      ) : <Badge>{ROLE_LABEL[m.role]}</Badge>}
                    </td>
                    <td className="small muted">{fmtDate(m.joinedAt)}</td>
                    {owner && <td className="col-actions">{!m.isYou && <IconButton label={`Odebrat ${m.name}`} size="sm" onClick={() => setRemoving(m)}><Trash2 /></IconButton>}</td>}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {owner ? (
        <section className="panel panel-pad stack">
          <div>
            <h2 className="section-title">Pozvat člena</h2>
            <p className="small muted">Vytvoří se odkaz platný 7 dní. Pošlete ho kolegovi sami, Sítko zatím e-maily neposílá.</p>
          </div>
          <form className="row-wrap" style={{ alignItems: 'flex-end' }} onSubmit={(e: FormEvent) => { e.preventDefault(); invite.mutate(); }}>
            <div style={{ flex: '1 1 220px' }}>
              <Field label="E-mail (nepovinné)" hint="Pozvánku pak půjde použít jen s tímto e-mailem.">
                {(id, d) => <Input id={id} aria-describedby={d} type="email" value={email} onChange={(e) => setEmail(e.target.value)} />}
              </Field>
            </div>
            <div>
              <Field label="Role">
                {(id) => <Select id={id} value={role} onChange={(e) => setRole(e.target.value as Role)} style={{ width: 'auto' }}>{ROLES.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}</Select>}
              </Field>
            </div>
            <Button type="submit" variant="primary" size="lg" loading={invite.isPending} style={{ marginBottom: email ? 26 : 26 }}>Vytvořit odkaz</Button>
          </form>
          {created?.url && (
            <Notice tone="info" action={<Button size="sm" icon={<Copy />} onClick={() => copy(created.url!)}>Kopírovat</Button>}>
              <span style={{ wordBreak: 'break-all' }}>{created.url}</span>
              <br /><span className="xs">Odkaz se zobrazí jen teď. Platí do {fmtDate(created.expiresAt)}.</span>
            </Notice>
          )}
          {invites.data && invites.data.length > 0 && (
            <div>
              <h3 className="label" style={{ marginBottom: 6 }}>Čekající pozvánky</h3>
              {invites.data.map((i) => (
                <div className="history-item" key={i.id}>
                  <span>{i.email ?? 'Bez e-mailu'} <span className="muted">· {ROLE_LABEL[i.role]} · platí do {fmtDate(i.expiresAt)}</span></span>
                  <Button size="sm" variant="ghost" onClick={() => revoke.mutate(i.id)}>Zrušit</Button>
                </div>
              ))}
            </div>
          )}
          <p className="xs muted">Vlastník spravuje tým, nastavení organizace a může mazat pozice. Personalista pracuje s pozicemi a kandidáty.</p>
        </section>
      ) : <Notice>Členy týmu může zvát jen vlastník organizace.</Notice>}

      <ConfirmDialog open={Boolean(removing)} onOpenChange={(o) => { if (!o) setRemoving(null); }} danger
        title={`Odebrat ${removing?.name ?? ''} z týmu?`} confirmLabel="Odebrat"
        onConfirm={async () => { await api.del(`/organization/members/${removing?.userId}`); void qc.invalidateQueries({ queryKey: ['members'] }); toast('Člen odebrán.'); }}>
        Účet se smaže a odhlásí. Jeho poznámky a rozhodnutí v historii zůstanou.
      </ConfirmDialog>
    </div>
  );
}

function Processing({ me }: { me: Me }) {
  const usage = useQuery({ queryKey: ['usage'], queryFn: () => api.get<Usage>('/organization/usage') });
  const u = usage.data;
  return (
    <div className="settings-section">
      <section className="panel panel-pad stack">
        <h2 className="section-title">Zpracování životopisů</h2>
        {usage.isPending ? <Spinner /> : usage.isError ? <ErrorState error={usage.error} /> : u && (
          <>
            {me.organization.isDemo ? <Notice tone="warning">Ukázková organizace používá předpřipravené výsledky, AI se nevolá.</Notice>
              : !u.aiConfigured ? <Notice tone="warning">AI není nastavená. Správce serveru musí doplnit proměnnou ANTHROPIC_API_KEY.</Notice> : null}
            <dl className="kv">
              <dt>Stav AI</dt><dd>{u.aiConfigured ? <Badge tone="success">Připraveno</Badge> : <Badge tone="warning">Nenastaveno</Badge>}</dd>
              {u.model && <><dt>Model</dt><dd>{u.model}</dd></>}
              <dt>Tento měsíc</dt><dd className="num">{u.monthEvaluations} z {u.monthlyLimit} hodnocení</dd>
              <dt>Tokeny tento měsíc</dt><dd className="num">{u.monthInputTokens.toLocaleString('cs-CZ')} vstup, {u.monthOutputTokens.toLocaleString('cs-CZ')} výstup</dd>
              <dt>Formáty</dt><dd>{u.supportedFormats.join(', ')}</dd>
              <dt>Max. velikost</dt><dd>{u.maxFileMb} MB na soubor</dd>
            </dl>
            <p className="small muted">Text se z PDF a DOCX čte přímo. Model AI se použije jen na hodnocení a u naskenovaných dokumentů nebo fotek i na přepis textu. Model, limit a klíč nastavuje správce serveru v proměnných prostředí.</p>
          </>
        )}
      </section>
      <section className="panel panel-pad stack-sm">
        <h2 className="section-title">Data a soukromí</h2>
        <ul className="list-plain small">
          <li>Přihlášky v uzavřených a archivovaných pozicích se mažou po {me.organization.retentionDays} dnech (nastavení v části Organizace).</li>
          <li>Kandidáta a všechna jeho data smažete v jeho detailu volbou „Smazat kandidáta a jeho data“ (žádost o výmaz podle GDPR).</li>
          <li>Do historie se nezapisuje obsah životopisů, jen kdo co kdy změnil.</li>
          <li>Hodnocení slouží jako podklad. O každém kandidátovi rozhoduje člověk a Sítko nikoho automaticky nezamítá.</li>
          <li>Uchazeče informujte, že k třídění používáte AI. Konkrétní povinnosti podle GDPR a AI Actu posuďte s právníkem.</li>
        </ul>
      </section>
    </div>
  );
}
