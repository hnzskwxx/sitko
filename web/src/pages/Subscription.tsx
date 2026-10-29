import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check } from 'lucide-react';
import { useEffect, useState, type FormEvent } from 'react';
import type { BillingInfo, Me, Plan, SubscriptionOverview, SubscriptionStatus } from '@shared/types';
import { SUBSCRIPTION_STATUS_LABEL } from '@shared/types';
import { api, ApiFailure, errorMessage } from '../api';
import { useToast } from '../components/toast';
import { Badge, Button, ErrorState, Field, Input, Notice, Spinner, Textarea, type Tone } from '../components/ui';
import { fmtCzk, fmtDate, fmtDay, plural } from '../hooks';

export const STATUS_TONE: Record<SubscriptionStatus, Tone> = {
  active: 'success', pending: 'warning', expired: 'error', demo: 'neutral', unlimited: 'neutral',
};

export function planPrice(p: Plan): string {
  return p.priceCzk === null ? 'Cena na dotaz' : `${fmtCzk(p.priceCzk)} / měsíc`;
}

const EMPTY: BillingInfo = { name: '', ico: '', dic: '', address: '', email: '' };

export function SubscriptionSettings({ me }: { me: Me }) {
  const qc = useQueryClient();
  const toast = useToast();
  const owner = me.role === 'owner';
  const q = useQuery({ queryKey: ['subscription'], queryFn: () => api.get<SubscriptionOverview>('/organization/subscription') });
  const [billing, setBilling] = useState<BillingInfo>(EMPTY);
  const [fields, setFields] = useState<Record<string, string>>({});

  useEffect(() => { if (q.data) setBilling(q.data.billing); }, [q.data]);

  // Stav předplatného je i v /auth/me (banner), po změně ho obnovíme
  const refresh = (data: SubscriptionOverview) => {
    qc.setQueryData(['subscription'], data);
    qc.setQueryData<Me>(['me'], (m) => (m ? { ...m, organization: { ...m.organization, subscription: data.subscription } } : m));
  };

  const saveBilling = useMutation({
    mutationFn: () => api.put<SubscriptionOverview>('/organization/billing', billing),
    onSuccess: (d) => { refresh(d); setFields({}); toast('Fakturační údaje uloženy.'); },
    onError: (e) => { if (e instanceof ApiFailure) setFields(e.fields); toast(errorMessage(e), 'error'); },
  });
  const order = useMutation({
    mutationFn: (planId: string) => api.post<SubscriptionOverview>('/organization/subscription/order', { planId }),
    onSuccess: (d) => { refresh(d); toast('Objednávka odeslána. Fakturu dostanete e-mailem.'); },
    onError: (e) => {
      if (e instanceof ApiFailure) {
        setFields(e.fields);
        if (e.code === 'billing_incomplete') document.getElementById('fakturacni-udaje')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
      toast(errorMessage(e), 'error');
    },
  });
  const cancel = useMutation({
    mutationFn: () => api.del<SubscriptionOverview>('/organization/subscription/order'),
    onSuccess: (d) => { refresh(d); toast('Objednávka zrušena.'); },
    onError: (e) => toast(errorMessage(e), 'error'),
  });

  if (q.isPending) return <div className="settings-section"><Spinner /></div>;
  if (q.isError) return <div className="settings-section"><ErrorState error={q.error} onRetry={() => q.refetch()} /></div>;
  const { subscription: s, plans, contact, monthEvaluations } = q.data;
  const dirty = JSON.stringify(billing) !== JSON.stringify(q.data.billing);

  return (
    <div className="settings-section" style={{ maxWidth: 820 }}>
      <section className="panel panel-pad stack">
        <h2 className="section-title">Předplatné</h2>
        <dl className="kv">
          <dt>Stav</dt><dd><Badge tone={STATUS_TONE[s.status]}>{SUBSCRIPTION_STATUS_LABEL[s.status]}</Badge></dd>
          <dt>Tarif</dt><dd>{s.plan?.name ?? 'Zatím žádný'}</dd>
          {s.paidUntil && (
            <>
              <dt>{s.status === 'expired' ? 'Skončilo' : 'Platí do'}</dt>
              <dd>{fmtDay(s.paidUntil)}{s.status === 'active' && s.daysLeft !== null && <span className="muted"> ({s.daysLeft === 0 ? 'končí dnes' : `zbývá ${plural(s.daysLeft, 'den', 'dny', 'dní')}`})</span>}</dd>
            </>
          )}
          <dt>Tento měsíc</dt>
          <dd className="num">{s.monthlyLimit ? `${monthEvaluations} z ${s.monthlyLimit} životopisů` : `${monthEvaluations} životopisů`}</dd>
        </dl>
        {s.requestedPlan && (
          <Notice tone="info" action={owner ? <Button size="sm" variant="ghost" loading={cancel.isPending} onClick={() => cancel.mutate()}>Zrušit objednávku</Button> : undefined}>
            Objednáno: tarif <strong>{s.requestedPlan.name}</strong>{s.requestedAt && ` (${fmtDate(s.requestedAt)})`}. Fakturu vám pošleme na {q.data.billing.email || 'fakturační e-mail'}, po zaplacení se předplatné aktivuje.
          </Notice>
        )}
        {!s.canEvaluate && !s.requestedPlan && (
          <Notice tone="warning">Bez aktivního předplatného si můžete připravit pozice a požadavky. Hodnocení životopisů a návrhy požadavků z inzerátu se zapnou po aktivaci tarifu.</Notice>
        )}
      </section>

      <section className="panel panel-pad stack">
        <div>
          <h2 className="section-title">Tarify</h2>
          <p className="small muted">Platí se měsíčně fakturou převodem. Limit se počítá za kalendářní měsíc. Každý nahraný životopis, který Sítko vyhodnotí, se počítá jednou, i nové hodnocení po změně požadavků.</p>
        </div>
        <div className="plan-grid">
          {plans.map((p) => {
            const current = s.plan?.id === p.id && s.status === 'active';
            const requested = s.requestedPlan?.id === p.id;
            return (
              <div key={p.id} className={`plan-card${current ? ' plan-card-current' : ''}`}>
                <div className="row" style={{ justifyContent: 'space-between' }}>
                  <h3 className="plan-name">{p.name}</h3>
                  {current && <Badge tone="success" icon={<Check />}>Váš tarif</Badge>}
                  {requested && !current && <Badge tone="info">Objednáno</Badge>}
                </div>
                <p className="plan-limit">{p.monthlyCvLimit.toLocaleString('cs-CZ')} životopisů měsíčně</p>
                <p className="plan-price">{planPrice(p)}</p>
                {owner && (
                  <Button variant={current || requested ? 'secondary' : 'primary'} block disabled={requested}
                    loading={order.isPending && order.variables === p.id} onClick={() => order.mutate(p.id)}>
                    {requested ? 'Objednáno' : current ? 'Prodloužit' : 'Objednat'}
                  </Button>
                )}
              </div>
            );
          })}
        </div>
        {!owner && <p className="small muted">Tarif objednává vlastník organizace.</p>}
        {contact && <p className="small muted">Dotazy k předplatnému a fakturám: <strong>{contact}</strong></p>}
      </section>

      <form id="fakturacni-udaje" className="panel panel-pad stack" onSubmit={(e: FormEvent) => { e.preventDefault(); saveBilling.mutate(); }}>
        <div>
          <h2 className="section-title">Fakturační údaje</h2>
          <p className="small muted">Na tyto údaje vystavíme fakturu.</p>
        </div>
        <Field label="Název firmy nebo jméno" error={fields.name}>{(id) => <Input id={id} value={billing.name} disabled={!owner} autoComplete="organization" onChange={(e) => setBilling({ ...billing, name: e.target.value })} />}</Field>
        <div className="two-col">
          <Field label="IČO" error={fields.ico}>{(id) => <Input id={id} value={billing.ico} disabled={!owner} inputMode="numeric" onChange={(e) => setBilling({ ...billing, ico: e.target.value })} />}</Field>
          <Field label="DIČ (nepovinné)" error={fields.dic}>{(id) => <Input id={id} value={billing.dic} disabled={!owner} onChange={(e) => setBilling({ ...billing, dic: e.target.value })} />}</Field>
        </div>
        <Field label="Adresa" error={fields.address}>{(id) => <Textarea id={id} rows={2} value={billing.address} disabled={!owner} autoComplete="street-address" onChange={(e) => setBilling({ ...billing, address: e.target.value })} />}</Field>
        <Field label="E-mail pro faktury" error={fields.email}>{(id) => <Input id={id} type="email" value={billing.email} disabled={!owner} onChange={(e) => setBilling({ ...billing, email: e.target.value })} />}</Field>
        {owner ? <div className="form-actions"><Button type="submit" variant="primary" loading={saveBilling.isPending} disabled={!dirty}>Uložit údaje</Button></div>
          : <Notice>Fakturační údaje může měnit jen vlastník.</Notice>}
      </form>
    </div>
  );
}
