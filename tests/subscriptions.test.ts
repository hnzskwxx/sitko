import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadConfig } from '../server/config.js';
import { computeSubscription, todayLocal, type SubscriptionRow } from '../server/services/subscription.js';
import { AD, FakeProvider, H, makeTestApp, registerAgent, sample } from './helpers.js';

type T = ReturnType<typeof makeTestApp>;
const ADMIN = 'provozovatel@sitko.cz';
const ENV = { SUBSCRIPTIONS: 'true', ADMIN_EMAILS: ` ${ADMIN.toUpperCase()} , druhy@sitko.cz`, BILLING_CONTACT: 'honza@example.cz' };

const shiftDays = (days: number): string => {
  const d = new Date(`${todayLocal()}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};

/** Pozice s ručně zadanými požadavky (bez AI, takže jde i bez předplatného). */
async function createManualJob(agent: request.Agent) {
  const job = await agent.post('/api/v1/jobs').set(H).send({ title: 'Obchodní referent', adText: AD });
  expect(job.status).toBe(201);
  const id = job.body.data.id as string;
  const put = await agent.put(`/api/v1/jobs/${id}/requirements`).set(H).send({ requirements: [
    { name: 'Praxe v obchodě', description: 'Aspoň 2 roky', category: 'zkusenosti', weight: 3, mustHave: true, origin: 'user' },
    { name: 'Excel', description: '', category: 'dovednosti', weight: 2, mustHave: false, origin: 'user' },
  ] });
  expect(put.status).toBe(200);
  return id;
}

const BILLING = { name: 'Zahradnictví Kvítek s.r.o.', ico: '123 456 78', dic: 'CZ12345678', address: 'Hlavní 1, 288 02 Nymburk', email: 'Faktury@Kvitek.cz' };

describe('computeSubscription', () => {
  const cfg = loadConfig({ SUBSCRIPTIONS: 'true', MONTHLY_EVALUATION_LIMIT: '999' });
  const row = (over: Partial<SubscriptionRow>): SubscriptionRow => ({
    is_demo: 0, plan_id: 'p', plan_name: 'Start', plan_limit: 100, paid_until: null,
    requested_plan_id: null, requested_plan_name: null, requested_at: null, ...over,
  });

  it('stavy podle data a tarifu', () => {
    const today = '2026-11-15';
    expect(computeSubscription(row({ paid_until: '2026-11-15' }), cfg, today)).toMatchObject({ status: 'active', canEvaluate: true, monthlyLimit: 100, daysLeft: 0 });
    expect(computeSubscription(row({ paid_until: '2026-12-15' }), cfg, today)).toMatchObject({ status: 'active', daysLeft: 30 });
    expect(computeSubscription(row({ paid_until: '2026-11-14' }), cfg, today)).toMatchObject({ status: 'expired', canEvaluate: false });
    expect(computeSubscription(row({}), cfg, today)).toMatchObject({ status: 'pending', canEvaluate: false });
    expect(computeSubscription(row({ plan_id: null, plan_name: null, paid_until: '2027-01-01' }), cfg, today)).toMatchObject({ status: 'expired', canEvaluate: false });
    expect(computeSubscription(row({ is_demo: 1 }), cfg, today)).toMatchObject({ status: 'demo', canEvaluate: true, monthlyLimit: 999 });
  });

  it('bez placeného členství platí globální limit', () => {
    const off = loadConfig({ MONTHLY_EVALUATION_LIMIT: '50' });
    expect(computeSubscription(row({}), off)).toMatchObject({ enabled: false, status: 'unlimited', canEvaluate: true, monthlyLimit: 50 });
  });

  it('dnešní datum je v českém čase', () => {
    expect(todayLocal(new Date('2026-12-31T23:30:00Z'))).toBe('2027-01-01');
    expect(todayLocal(new Date('2026-07-01T21:59:00Z'))).toBe('2026-07-01');
  });
});

describe('Placené členství', () => {
  let t: T;
  beforeEach(() => { t = makeTestApp(new FakeProvider(), ENV); });
  afterEach(() => t.cleanup());

  it('nová firma nemůže používat AI, dokud provozovatel neaktivuje tarif', async () => {
    const firm = await registerAgent(t.app, 'majitel@kvitek.cz', 'Kvítek');
    const me = (await firm.get('/api/v1/auth/me')).body.data;
    expect(me.isPlatformAdmin).toBe(false);
    expect(me.organization.subscription).toMatchObject({ enabled: true, status: 'pending', canEvaluate: false, plan: null });

    // Připravit pozici ručně jde, AI ne
    const jobId = await createManualJob(firm);
    const sug = await firm.post(`/api/v1/jobs/${jobId}/requirements/suggest`).set(H).send({});
    expect(sug.status).toBe(402);
    expect(sug.body.error.code).toBe('subscription_inactive');
    expect(sug.body.error.message).toContain('honza@example.cz');
    const up = await firm.post(`/api/v1/jobs/${jobId}/applications`).set(H).attach('files', sample('Anna_Sykorova.txt'), 'a.txt');
    expect(up.status).toBe(402);
    expect((t.ctx.db.prepare('SELECT COUNT(*) AS n FROM documents').get() as { n: number }).n).toBe(0);

    // Objednávka vyžaduje fakturační údaje
    const ov = (await firm.get('/api/v1/organization/subscription')).body.data;
    expect(ov.plans.map((p: { name: string }) => p.name)).toEqual(['Start', 'Firma']);
    expect(ov.contact).toBe('honza@example.cz');
    const noBilling = await firm.post('/api/v1/organization/subscription/order').set(H).send({ planId: 'plan_start' });
    expect(noBilling.status).toBe(400);
    expect(Object.keys(noBilling.body.error.fields)).toEqual(expect.arrayContaining(['name', 'address', 'email']));
    const badIco = await firm.put('/api/v1/organization/billing').set(H).send({ ...BILLING, ico: '123' });
    expect(badIco.body.error.fields.ico).toBeTruthy();
    const billing = await firm.put('/api/v1/organization/billing').set(H).send(BILLING);
    expect(billing.body.data.billing).toMatchObject({ ico: '12345678', email: 'faktury@kvitek.cz' });
    const order = await firm.post('/api/v1/organization/subscription/order').set(H).send({ planId: 'plan_start' });
    expect(order.status).toBe(201);
    expect(order.body.data.subscription.requestedPlan).toEqual({ id: 'plan_start', name: 'Start' });

    // Správa je pro firmu neviditelná
    expect((await firm.get('/api/v1/admin/organizations')).status).toBe(404);
    expect((await firm.patch(`/api/v1/admin/organizations/${me.organization.id}`).set(H).send({ planId: 'plan_firma', paidUntil: shiftDays(365) })).status).toBe(404);
    expect((await firm.post('/api/v1/admin/plans').set(H).send({ name: 'Zdarma', monthlyCvLimit: 99999, priceCzk: 0, isPublic: true })).status).toBe(404);

    // Provozovatel: objednávka nahoře, fakturační údaje, žádná data kandidátů
    const admin = await registerAgent(t.app, ADMIN, 'Sítko');
    expect((await admin.get('/api/v1/auth/me')).body.data.isPlatformAdmin).toBe(true);
    const list = (await admin.get('/api/v1/admin/organizations')).body.data;
    expect(list[0]).toMatchObject({ name: 'Kvítek', owner: { email: 'majitel@kvitek.cz' }, subscription: { requestedPlan: { id: 'plan_start' } } });
    const det = (await admin.get(`/api/v1/admin/organizations/${me.organization.id}`)).body.data;
    expect(det.billing).toMatchObject({ name: BILLING.name, ico: '12345678' });
    expect(det.jobs).toBe(1);
    expect(Object.keys(det)).not.toEqual(expect.arrayContaining(['applications']));
    // Provozovatel nevidí pozice firmy (izolace organizací platí i pro něj)
    expect((await admin.get(`/api/v1/jobs/${jobId}`)).status).toBe(404);

    const noPlan = await admin.patch(`/api/v1/admin/organizations/${me.organization.id}`).set(H).send({ paidUntil: shiftDays(30) });
    expect(noPlan.status).toBe(400);
    const activate = await admin.patch(`/api/v1/admin/organizations/${me.organization.id}`).set(H)
      .send({ planId: 'plan_start', paidUntil: shiftDays(30), adminNote: 'Faktura 2026001 zaplacena' });
    expect(activate.status).toBe(200);
    expect(activate.body.data.subscription).toMatchObject({ status: 'active', canEvaluate: true, monthlyLimit: 100, daysLeft: 30, requestedPlan: null });
    expect(activate.body.data.adminNote).toBe('Faktura 2026001 zaplacena');

    // Firma teď hodnotí
    expect((await firm.get('/api/v1/auth/me')).body.data.organization.subscription.status).toBe('active');
    const ok = await firm.post(`/api/v1/jobs/${jobId}/applications`).set(H).attach('files', sample('Anna_Sykorova.txt'), 'a.txt');
    expect(ok.status).toBe(201);
    await t.queue.drain();
    const rows = (await firm.get(`/api/v1/jobs/${jobId}/applications`)).body.data;
    expect(rows[0].status).toBe('done');
    expect((await firm.get('/api/v1/organization/usage')).body.data).toMatchObject({ monthEvaluations: 1, monthlyLimit: 100 });
  });

  it('limit tarifu a vypršení předplatného zastaví frontu', async () => {
    const firm = await registerAgent(t.app, 'majitel@kvitek.cz', 'Kvítek');
    const orgId = (await firm.get('/api/v1/auth/me')).body.data.organization.id;
    const admin = await registerAgent(t.app, ADMIN, 'Sítko');
    const plans = (await admin.post('/api/v1/admin/plans').set(H).send({ name: 'Mini', monthlyCvLimit: 1, priceCzk: 290, isPublic: false })).body.data;
    const mini = plans.find((p: { name: string }) => p.name === 'Mini');
    expect(mini).toMatchObject({ monthlyCvLimit: 1, priceCzk: 290, isPublic: false, organizations: 0 });
    // Neveřejný tarif si firma objednat nemůže
    await firm.put('/api/v1/organization/billing').set(H).send(BILLING);
    expect((await firm.post('/api/v1/organization/subscription/order').set(H).send({ planId: mini.id })).status).toBe(404);

    await admin.patch(`/api/v1/admin/organizations/${orgId}`).set(H).send({ planId: mini.id, paidUntil: shiftDays(10) });
    const jobId = await createManualJob(firm);
    await firm.post(`/api/v1/jobs/${jobId}/applications`).set(H)
      .attach('files', sample('Anna_Sykorova.txt'), 'a.txt')
      .attach('files', sample('Michal_Dolezal_CV.docx'), 'm.docx');
    await t.queue.drain();
    const rows = (await firm.get(`/api/v1/jobs/${jobId}/applications`)).body.data as Array<{ status: string; errorCode?: string; error?: { code: string } }>;
    expect(rows.map((r) => r.status).sort()).toEqual(['done', 'failed']);

    const failed = t.ctx.db.prepare(`SELECT error_code, error_message FROM applications WHERE status = 'failed'`).get() as { error_code: string; error_message: string };
    expect(failed.error_code).toBe('limit_reached');
    expect(failed.error_message).toContain('limit 1');

    // Předplatné vyprší: nové nahrávání 402, čekající položky skončí srozumitelnou chybou
    await admin.patch(`/api/v1/admin/organizations/${orgId}`).set(H).send({ planId: 'plan_firma', paidUntil: shiftDays(5) });
    await firm.post(`/api/v1/jobs/${jobId}/applications`).set(H).attach('files', sample('Radek_Polak_zivotopis.pdf'), 'r.pdf');
    await admin.patch(`/api/v1/admin/organizations/${orgId}`).set(H).send({ paidUntil: shiftDays(-1) });
    await t.queue.drain();
    const last = t.ctx.db.prepare(`SELECT status, error_code FROM applications ORDER BY created_at DESC, rowid DESC LIMIT 1`).get() as { status: string; error_code: string };
    expect(last).toEqual({ status: 'failed', error_code: 'subscription_inactive' });
    const me = (await firm.get('/api/v1/auth/me')).body.data;
    expect(me.organization.subscription).toMatchObject({ status: 'expired', canEvaluate: false, plan: { id: 'plan_firma' } });
    const retry = await firm.post(`/api/v1/jobs/${jobId}/applications`).set(H).attach('files', sample('Kristyna_Vlckova_CV.pdf'), 'k.pdf');
    expect(retry.status).toBe(402);

    // Tarif, který někdo má, nejde smazat; nepoužitý ano
    expect((await admin.delete(`/api/v1/admin/plans/plan_firma`).set(H)).status).toBe(409);
    const del = await admin.delete(`/api/v1/admin/plans/${mini.id}`).set(H);
    expect(del.status).toBe(200);
    expect(del.body.data.map((p: { name: string }) => p.name)).toEqual(['Start', 'Firma']);
  });

  it('bez SUBSCRIPTIONS se nic neomezuje a Správa neexistuje', async () => {
    const off = makeTestApp(new FakeProvider(), { ADMIN_EMAILS: ADMIN });
    try {
      const a = await registerAgent(off.app, 'x@firma.cz');
      expect((await a.get('/api/v1/auth/me')).body.data.organization.subscription).toMatchObject({ enabled: false, status: 'unlimited', canEvaluate: true });
      const order = await a.put('/api/v1/organization/billing').set(H).send(BILLING)
        .then(() => a.post('/api/v1/organization/subscription/order').set(H).send({ planId: 'plan_start' }));
      expect(order.status).toBe(409);
      // Správa je vázaná na ADMIN_EMAILS, ne na SUBSCRIPTIONS
      const admin = await registerAgent(off.app, ADMIN, 'Sítko');
      expect((await admin.get('/api/v1/admin/plans')).status).toBe(200);
    } finally { off.cleanup(); }
  });
});
