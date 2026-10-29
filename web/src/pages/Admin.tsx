import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Copy, Pencil, Plus, ShieldCheck, Trash2 } from 'lucide-react';
import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { NavLink, Route, Routes } from 'react-router';
import type { AdminOrgDetail, AdminOrgRow, Plan } from '@shared/types';
import { SUBSCRIPTION_STATUS_LABEL } from '@shared/types';
import { api, ApiFailure, errorMessage } from '../api';
import { ConfirmDialog, Dialog } from '../components/overlay';
import { useToast } from '../components/toast';
import {
  Badge, Button, EmptyState, ErrorState, Field, IconButton, Input, Notice, SearchInput, Select, SkeletonRows, Spinner, Textarea,
} from '../components/ui';
import { fmtCzk, fmtDate, fmtDay, fmtRelative, useDocumentTitle } from '../hooks';
import { NotFoundPage } from './NotFound';
import { planPrice, STATUS_TONE } from './Subscription';

// Správa Sítka pro provozovatele: firmy, jejich předplatné a tarify.
// Server ji pouští jen e-mailům z ADMIN_EMAILS. Kandidáty firem odsud vidět nejde.

export function AdminPage() {
  useDocumentTitle('Správa');
  return (
    <div className="page">
      <div className="page-head">
        <div className="page-head-text">
          <h1 className="page-title">Správa Sítka</h1>
          <p className="page-sub">Firmy, předplatné a tarify. Pozice, kandidáty a životopisy firem odsud nevidíte.</p>
        </div>
      </div>
      <nav className="tabs" aria-label="Části správy">
        <NavLink to="/sprava" end className="tab">Firmy</NavLink>
        <NavLink to="/sprava/tarify" className="tab">Tarify</NavLink>
      </nav>
      <Routes>
        <Route index element={<Organizations />} />
        <Route path="tarify" element={<Plans />} />
        <Route path="*" element={<NotFoundPage />} />
      </Routes>
    </div>
  );
}

// ---------- Firmy ----------

type Filter = 'all' | 'orders' | 'active' | 'inactive';
const FILTERS: Array<[Filter, string]> = [['all', 'Všechny'], ['orders', 'Objednávky'], ['active', 'Aktivní'], ['inactive', 'Bez předplatného']];

function Organizations() {
  const orgs = useQuery({ queryKey: ['admin', 'orgs'], queryFn: () => api.get<AdminOrgRow[]>('/admin/organizations') });
  const [filter, setFilter] = useState<Filter>('all');
  const [q, setQ] = useState('');
  const [openId, setOpenId] = useState<string | null>(null);

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return (orgs.data ?? []).filter((o) => {
      const s = o.subscription;
      if (filter === 'orders' && !s.requestedPlan) return false;
      if (filter === 'active' && s.status !== 'active') return false;
      if (filter === 'inactive' && s.status === 'active') return false;
      return !needle || o.name.toLowerCase().includes(needle) || (o.owner?.email ?? '').includes(needle);
    });
  }, [orgs.data, filter, q]);
  const orderCount = (orgs.data ?? []).filter((o) => o.subscription.requestedPlan).length;

  return (
    <div className="stack">
      <section className="panel">
      <div className="toolbar">
        <SearchInput placeholder="Hledat firmu nebo e-mail" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Hledat firmu" />
        <div className="segmented" role="group" aria-label="Filtr firem">
          {FILTERS.map(([k, label]) => (
            <button key={k} type="button" aria-pressed={filter === k} onClick={() => setFilter(k)}>
              {label}{k === 'orders' && orderCount > 0 && <span className="segmented-count">{orderCount}</span>}
            </button>
          ))}
        </div>
      </div>
        {orgs.isError ? <div style={{ padding: 16 }}><ErrorState error={orgs.error} onRetry={() => orgs.refetch()} /></div>
          : orgs.isPending ? <SkeletonRows rows={4} cols={5} />
          : !rows.length ? <EmptyState icon={<ShieldCheck />} title={orgs.data.length ? 'Nic neodpovídá filtru' : 'Zatím se nezaregistrovala žádná firma'}>
              {orgs.data.length ? null : 'Firmy se registrují na stránce /registrace. Tady pak uvidíte jejich objednávky.'}
            </EmptyState>
          : (
            <div className="table-wrap">
              <table className="table">
                <thead><tr><th>Firma</th><th>Tarif</th><th>Stav</th><th>Platí do</th><th className="num">Tento měsíc</th><th>Registrace</th></tr></thead>
                <tbody>
                  {rows.map((o) => {
                    const s = o.subscription;
                    return (
                      <tr key={o.id} className="is-clickable" tabIndex={0} onClick={() => setOpenId(o.id)} onKeyDown={(e) => { if (e.key === 'Enter') setOpenId(o.id); }}>
                        <td><div className="cell-main"><span className="cell-title">{o.name}</span><span className="cell-sub">{o.owner?.email ?? 'bez vlastníka'}</span></div></td>
                        <td>{s.plan?.name ?? <span className="muted">–</span>}</td>
                        <td>
                          <div className="row-wrap" style={{ gap: 4 }}>
                            <Badge tone={STATUS_TONE[s.status]}>{SUBSCRIPTION_STATUS_LABEL[s.status]}</Badge>
                            {s.requestedPlan && <Badge tone="info">Objednává {s.requestedPlan.name}</Badge>}
                          </div>
                        </td>
                        <td className="small">{s.paidUntil ? fmtDay(s.paidUntil) : <span className="muted">–</span>}</td>
                        <td className="num small">{o.monthEvaluations}{s.plan ? ` / ${s.monthlyLimit}` : ''}</td>
                        <td className="small muted">{fmtDate(o.createdAt)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
      </section>
      <OrgDialog id={openId} onClose={() => setOpenId(null)} />
    </div>
  );
}

/** Přičte měsíce k datu RRRR-MM-DD (31. 1. + 1 měsíc = 28./29. 2.). */
function addMonths(ymd: string, months: number): string {
  const [y, m, d] = ymd.split('-').map(Number);
  const target = new Date(Date.UTC(y, m - 1 + months, 1));
  const last = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(d, last));
  return target.toISOString().slice(0, 10);
}
const today = (): string => new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Prague' });
function addDays(ymd: string, days: number): string {
  const d = new Date(`${ymd}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function billingText(o: AdminOrgDetail): string {
  const b = o.billing;
  return [b.name, b.address, b.ico && `IČO: ${b.ico}`, b.dic && `DIČ: ${b.dic}`, b.email && `E-mail: ${b.email}`].filter(Boolean).join('\n');
}

function OrgDialog({ id, onClose }: { id: string | null; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const detail = useQuery({ queryKey: ['admin', 'org', id], queryFn: () => api.get<AdminOrgDetail>(`/admin/organizations/${id}`), enabled: Boolean(id) });
  const plans = useQuery({ queryKey: ['admin', 'plans'], queryFn: () => api.get<Plan[]>('/admin/plans'), enabled: Boolean(id) });
  const [planId, setPlanId] = useState('');
  const [paidUntil, setPaidUntil] = useState('');
  const [note, setNote] = useState('');
  const [fields, setFields] = useState<Record<string, string>>({});

  const o = detail.data;
  useEffect(() => {
    if (!o) return;
    // Předvyplnit objednaný tarif, ať aktivace po zaplacení je na dva kliky
    setPlanId(o.subscription.requestedPlan?.id ?? o.subscription.plan?.id ?? '');
    setPaidUntil(o.subscription.paidUntil ?? '');
    setNote(o.adminNote);
    setFields({});
  }, [o]);

  const save = useMutation({
    mutationFn: () => api.patch<AdminOrgDetail>(`/admin/organizations/${id}`, { planId: planId || null, paidUntil: paidUntil || null, adminNote: note }),
    onSuccess: (d) => {
      qc.setQueryData(['admin', 'org', id], d);
      void qc.invalidateQueries({ queryKey: ['admin', 'orgs'] });
      void qc.invalidateQueries({ queryKey: ['admin', 'plans'] });
      toast(d.subscription.status === 'active' ? `Předplatné ${d.name} platí do ${fmtDay(d.subscription.paidUntil!)}.` : 'Uloženo.');
      onClose();
    },
    onError: (e) => { if (e instanceof ApiFailure) setFields(e.fields); toast(errorMessage(e), 'error'); },
  });

  const extend = (months: number) => {
    const base = paidUntil && paidUntil >= today() ? paidUntil : today();
    setPaidUntil(addMonths(base, months));
  };
  const copy = async (text: string) => {
    try { await navigator.clipboard.writeText(text); toast('Fakturační údaje zkopírovány.'); } catch { toast('Nepodařilo se zkopírovat, označte text ručně.', 'error'); }
  };

  return (
    <Dialog open={Boolean(id)} onOpenChange={(open) => { if (!open) onClose(); }} size="lg"
      title={o?.name ?? 'Firma'}
      description={o ? `Vlastník ${o.owner ? `${o.owner.name} (${o.owner.email})` : 'neuveden'} · registrace ${fmtDate(o.createdAt)}` : undefined}
      footer={o && (
        <>
          <Button variant="ghost" onClick={onClose}>Zavřít</Button>
          <Button variant="primary" loading={save.isPending} onClick={() => save.mutate()}>Uložit</Button>
        </>
      )}>
      {detail.isError ? <ErrorState error={detail.error} /> : !o ? <Spinner /> : (
        <div className="stack">
          {o.subscription.requestedPlan && (
            <Notice tone="info">
              Objednávka tarifu <strong>{o.subscription.requestedPlan.name}</strong>{o.subscription.requestedAt && ` z ${fmtDate(o.subscription.requestedAt)}`}.
              Pošlete fakturu, po zaplacení nastavte datum a uložte.
            </Notice>
          )}
          <div className="two-col">
            <div className="stack-sm">
              <div className="row" style={{ justifyContent: 'space-between' }}>
                <h3 className="label">Fakturační údaje</h3>
                {billingText(o) && <Button size="sm" variant="ghost" icon={<Copy />} onClick={() => copy(billingText(o))}>Kopírovat</Button>}
              </div>
              {billingText(o) ? <p className="small" style={{ whiteSpace: 'pre-line' }}>{billingText(o)}</p>
                : <p className="small muted">Firma je zatím nevyplnila.</p>}
            </div>
            <dl className="kv" style={{ alignContent: 'start' }}>
              <dt>Stav</dt><dd><Badge tone={STATUS_TONE[o.subscription.status]}>{SUBSCRIPTION_STATUS_LABEL[o.subscription.status]}</Badge></dd>
              <dt>Tento měsíc</dt><dd className="num">{o.monthEvaluations}{o.subscription.plan ? ` z ${o.subscription.monthlyLimit}` : ''} CV</dd>
              <dt>Tým</dt><dd>{o.members} · pozic {o.jobs} · kandidátů {o.candidates}</dd>
              <dt>Aktivita</dt><dd>{o.lastActivityAt ? fmtRelative(o.lastActivityAt) : 'zatím žádná'}</dd>
            </dl>
          </div>

          <div className="panel panel-pad stack" style={{ background: 'var(--surface-2)' }}>
            <div className="two-col">
              <Field label="Tarif" error={fields.planId}>
                {(fid) => (
                  <Select id={fid} value={planId} onChange={(e) => setPlanId(e.target.value)}>
                    <option value="">Bez tarifu</option>
                    {(plans.data ?? []).map((p) => <option key={p.id} value={p.id}>{p.name} · {p.monthlyCvLimit} CV{p.priceCzk !== null ? ` · ${fmtCzk(p.priceCzk)}` : ''}{p.isPublic ? '' : ' (nenabízí se)'}</option>)}
                  </Select>
                )}
              </Field>
              <Field label="Zaplaceno do (včetně)" error={fields.paidUntil}>
                {(fid) => <Input id={fid} type="date" value={paidUntil} onChange={(e) => setPaidUntil(e.target.value)} />}
              </Field>
            </div>
            <div className="row-wrap">
              <span className="small muted">Prodloužit o</span>
              <Button size="sm" onClick={() => extend(1)}>1 měsíc</Button>
              <Button size="sm" onClick={() => extend(3)}>3 měsíce</Button>
              <Button size="sm" onClick={() => extend(12)}>12 měsíců</Button>
              <span className="spacer" />
              <Button size="sm" variant="ghost" onClick={() => setPaidUntil(addDays(today(), -1))}
                disabled={!paidUntil || paidUntil < today()}>Ukončit ke včerejšku</Button>
            </div>
            <Field label="Interní poznámka" hint="Vidíte jen vy. Třeba číslo faktury nebo domluva s firmou.">
              {(fid, d) => <Textarea id={fid} aria-describedby={d} rows={2} value={note} onChange={(e) => setNote(e.target.value)} />}
            </Field>
          </div>
        </div>
      )}
    </Dialog>
  );
}

// ---------- Tarify ----------

interface PlanDraft { name: string; monthlyCvLimit: string; priceCzk: string; isPublic: boolean }
const toDraft = (p?: Plan): PlanDraft => ({
  name: p?.name ?? '', monthlyCvLimit: p ? String(p.monthlyCvLimit) : '', priceCzk: p?.priceCzk != null ? String(p.priceCzk) : '', isPublic: p?.isPublic ?? true,
});

function Plans() {
  const qc = useQueryClient();
  const toast = useToast();
  const plans = useQuery({ queryKey: ['admin', 'plans'], queryFn: () => api.get<Plan[]>('/admin/plans') });
  const [editing, setEditing] = useState<Plan | 'new' | null>(null);
  const [removing, setRemoving] = useState<Plan | null>(null);

  return (
    <div className="stack" style={{ maxWidth: 860 }}>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <p className="small muted">Firmy vidí tarify, které se nabízejí, v Nastavení → Předplatné. Ceny jsou za měsíc.</p>
        <Button variant="primary" icon={<Plus />} onClick={() => setEditing('new')}>Přidat tarif</Button>
      </div>
      <section className="panel">
        {plans.isError ? <div style={{ padding: 16 }}><ErrorState error={plans.error} /></div> : plans.isPending ? <SkeletonRows rows={2} cols={5} /> : (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Tarif</th><th className="num">CV / měsíc</th><th>Cena</th><th>Nabízí se</th><th className="num">Firem</th><th className="col-actions"><span className="sr-only">Akce</span></th></tr></thead>
              <tbody>
                {plans.data.map((p) => (
                  <tr key={p.id}>
                    <td className="cell-title">{p.name}</td>
                    <td className="num">{p.monthlyCvLimit.toLocaleString('cs-CZ')}</td>
                    <td>{p.priceCzk === null ? <Badge tone="warning">Doplňte cenu</Badge> : planPrice(p)}</td>
                    <td>{p.isPublic ? <Badge tone="success">Ano</Badge> : <Badge>Ne</Badge>}</td>
                    <td className="num">{p.organizations ?? 0}</td>
                    <td className="col-actions">
                      <div className="row" style={{ gap: 2, justifyContent: 'flex-end' }}>
                        <IconButton size="sm" label={`Upravit ${p.name}`} onClick={() => setEditing(p)}><Pencil /></IconButton>
                        <IconButton size="sm" label={`Smazat ${p.name}`} onClick={() => setRemoving(p)}><Trash2 /></IconButton>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      <PlanDialog plan={editing} onClose={() => setEditing(null)} />
      <ConfirmDialog open={Boolean(removing)} onOpenChange={(o) => { if (!o) setRemoving(null); }} danger
        title={`Smazat tarif ${removing?.name ?? ''}?`} confirmLabel="Smazat"
        onConfirm={async () => {
          try {
            qc.setQueryData(['admin', 'plans'], await api.del<Plan[]>(`/admin/plans/${removing?.id}`));
            toast('Tarif smazán.');
          } catch (e) { toast(errorMessage(e), 'error'); }
        }}>
        Tarif, který má nebo objednává některá firma, smazat nejde. Ten jen přestaňte nabízet.
      </ConfirmDialog>
    </div>
  );
}

function PlanDialog({ plan, onClose }: { plan: Plan | 'new' | null; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const isNew = plan === 'new';
  const [d, setD] = useState<PlanDraft>(toDraft());
  const [fields, setFields] = useState<Record<string, string>>({});
  useEffect(() => { if (plan) { setD(toDraft(plan === 'new' ? undefined : plan)); setFields({}); } }, [plan]);

  const save = useMutation({
    mutationFn: () => {
      const body = {
        name: d.name,
        monthlyCvLimit: Number(d.monthlyCvLimit),
        priceCzk: d.priceCzk.trim() === '' ? null : Number(d.priceCzk.replace(/\s/g, '')),
        isPublic: d.isPublic,
      };
      return isNew ? api.post<Plan[]>('/admin/plans', body) : api.patch<Plan[]>(`/admin/plans/${(plan as Plan).id}`, body);
    },
    onSuccess: (list) => { qc.setQueryData(['admin', 'plans'], list); toast(isNew ? 'Tarif přidán.' : 'Tarif uložen.'); onClose(); },
    onError: (e) => { if (e instanceof ApiFailure) setFields(e.fields); toast(errorMessage(e), 'error'); },
  });

  return (
    <Dialog open={Boolean(plan)} onOpenChange={(o) => { if (!o) onClose(); }} title={isNew ? 'Nový tarif' : `Upravit tarif ${(plan as Plan | null)?.name ?? ''}`}
      footer={<><Button variant="ghost" onClick={onClose}>Zrušit</Button><Button variant="primary" type="submit" form="plan-form" loading={save.isPending}>Uložit</Button></>}>
      <form id="plan-form" className="stack" onSubmit={(e: FormEvent) => { e.preventDefault(); save.mutate(); }}>
        <Field label="Název" error={fields.name}>{(id) => <Input id={id} value={d.name} onChange={(e) => setD({ ...d, name: e.target.value })} autoFocus />}</Field>
        <div className="two-col">
          <Field label="Životopisů za měsíc" error={fields.monthlyCvLimit}>{(id) => <Input id={id} type="number" min={1} value={d.monthlyCvLimit} onChange={(e) => setD({ ...d, monthlyCvLimit: e.target.value })} />}</Field>
          <Field label="Cena Kč / měsíc" hint="Prázdné = cena na dotaz." error={fields.priceCzk}>{(id, h) => <Input id={id} aria-describedby={h} type="number" min={0} value={d.priceCzk} onChange={(e) => setD({ ...d, priceCzk: e.target.value })} />}</Field>
        </div>
        <label className="check-label">
          <input type="checkbox" className="checkbox" checked={d.isPublic} onChange={(e) => setD({ ...d, isPublic: e.target.checked })} />
          <span>Nabízet firmám v Nastavení → Předplatné</span>
        </label>
        <p className="xs muted">Neveřejný tarif můžete přidělit ručně, třeba na míru jedné firmě. Změna limitu platí hned pro všechny firmy s tímto tarifem.</p>
      </form>
    </Dialog>
  );
}
