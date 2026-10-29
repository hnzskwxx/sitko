import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DEMO_EMAIL, DEMO_PASSWORD } from '../server/demo-account.js';
import { newId, now } from '../server/db/index.js';
import { hashPassword } from '../server/lib/security.js';
import { DemoProvider } from '../server/services/ai/demo.js';
import { AiError } from '../server/services/ai/provider.js';
import { AD, FakeProvider, H, makeTestApp, registerAgent, sample, SAMPLES } from './helpers.js';

type T = ReturnType<typeof makeTestApp>;

async function createActiveJob(agent: request.Agent) {
  const job = await agent.post('/api/v1/jobs').set(H).send({ title: 'Obchodní referent', adText: AD });
  expect(job.status).toBe(201);
  const id = job.body.data.id as string;
  const sug = await agent.post(`/api/v1/jobs/${id}/requirements/suggest`).set(H).send({});
  expect(sug.status).toBe(200);
  const reqs = sug.body.data.requirements as Array<Record<string, unknown>>;
  const put = await agent.put(`/api/v1/jobs/${id}/requirements`).set(H).send({ requirements: reqs });
  expect(put.status).toBe(200);
  expect(put.body.data.status).toBe('active');
  return id;
}

describe('API', () => {
  let t: T;
  beforeEach(() => { t = makeTestApp(); });
  afterEach(() => t.cleanup());

  it('health a neexistující endpoint', async () => {
    expect((await request(t.app).get('/api/v1/health')).status).toBe(200);
    const r = await request(t.app).get('/api/v1/neexistuje');
    expect(r.status).toBe(401); // za přihlášením nic neprozradí
    expect((await request(t.app).get('/api/nic')).status).toBe(404);
  });

  it('bez přihlášení vrací 401 a bez CSRF hlavičky 403', async () => {
    expect((await request(t.app).get('/api/v1/jobs')).status).toBe(401);
    const r = await request(t.app).post('/api/v1/auth/login').send({ email: 'a@b.cz', password: 'x' });
    expect(r.status).toBe(403);
    expect(r.body.error.code).toBe('csrf');
    const r2 = await request(t.app).post('/api/v1/auth/login').set(H).set('Origin', 'https://evil.example').send({ email: 'a@b.cz', password: 'x' });
    expect(r2.status).toBe(403);
  });

  it('registrace, přihlášení, odhlášení, validace', async () => {
    const bad = await request(t.app).post('/api/v1/auth/register').set(H).send({ organizationName: 'F', name: '', email: 'x', password: 'kratke' });
    expect(bad.status).toBe(400);
    expect(Object.keys(bad.body.error.fields)).toEqual(expect.arrayContaining(['organizationName', 'name', 'email', 'password']));

    const agent = await registerAgent(t.app, 'Jana@Firma.cz');
    const me = await agent.get('/api/v1/auth/me');
    expect(me.body.data.user.email).toBe('jana@firma.cz');
    expect(me.body.data.role).toBe('owner');
    expect(me.headers['cache-control']).toBe('no-store');

    const dup = await request(t.app).post('/api/v1/auth/register').set(H).send({ organizationName: 'Jiná', name: 'X', email: 'jana@firma.cz', password: 'dostatecne-dlouhe-heslo' });
    expect(dup.status).toBe(409);

    await agent.post('/api/v1/auth/logout').set(H);
    expect((await agent.get('/api/v1/auth/me')).body.data).toBeNull();
    expect((await agent.get('/api/v1/jobs')).status).toBe(401);

    const wrong = await request(t.app).post('/api/v1/auth/login').set(H).send({ email: 'jana@firma.cz', password: 'spatne-heslo-123' });
    expect(wrong.status).toBe(401);
    const ok = await request.agent(t.app).post('/api/v1/auth/login').set(H).send({ email: 'JANA@firma.cz', password: 'dostatecne-dlouhe-heslo' });
    expect(ok.status).toBe(200);
    expect(ok.headers['set-cookie'][0]).toMatch(/HttpOnly/);
    expect(ok.headers['set-cookie'][0]).toMatch(/SameSite=Lax/);
  });

  it('registrační kód a vypnutá registrace', async () => {
    const reg = (app: typeof t.app, extra: Record<string, string> = {}) => request(app).post('/api/v1/auth/register').set(H)
      .send({ organizationName: 'Firma s kódem', name: 'Eva', email: `eva${Math.random()}@firma.cz`, password: 'dostatecne-dlouhe-heslo', ...extra });

    expect((await request(t.app).get('/api/v1/auth/registration')).body.data).toEqual({ open: true, codeRequired: false });

    const withCode = makeTestApp(new FakeProvider(), { REGISTRATION_CODE: 'tajny-kod-42' });
    try {
      expect((await request(withCode.app).get('/api/v1/auth/registration')).body.data).toEqual({ open: true, codeRequired: true });
      const none = await reg(withCode.app);
      expect(none.status).toBe(403);
      expect(none.body.error.fields.code).toBeTruthy();
      expect((await reg(withCode.app, { code: 'spatny' })).status).toBe(403);
      expect((await reg(withCode.app, { code: ' tajny-kod-42 ' })).status).toBe(201);
    } finally { withCode.cleanup(); }

    const closed = makeTestApp(new FakeProvider(), { ALLOW_REGISTRATION: 'false' });
    try {
      expect((await request(closed.app).get('/api/v1/auth/registration')).body.data).toEqual({ open: false, codeRequired: false });
      expect((await reg(closed.app)).body.error.code).toBe('registration_closed');
    } finally { closed.cleanup(); }
  });

  it('veřejné demo: vstup z přihlášení a nahrávání jen ukázkových CV', async () => {
    const d = makeTestApp(new DemoProvider(SAMPLES), { SEED_DEMO_ON_START: 'true' });
    try {
      expect((await request(d.app).get('/api/v1/auth/demo')).body.data).toBeNull(); // ukázka ještě neexistuje
      const orgId = newId(); const userId = newId(); const t0 = now();
      const hash = await hashPassword(DEMO_PASSWORD);
      d.ctx.db.prepare('INSERT INTO organizations (id, name, is_demo, created_at) VALUES (?, ?, 1, ?)').run(orgId, 'Ukázka', t0);
      d.ctx.db.prepare('INSERT INTO users (id, email, name, password_hash, created_at) VALUES (?, ?, ?, ?, ?)').run(userId, DEMO_EMAIL, 'Demo', hash, t0);
      d.ctx.db.prepare(`INSERT INTO memberships (org_id, user_id, role, created_at) VALUES (?, ?, 'owner', ?)`).run(orgId, userId, t0);

      const creds = (await request(d.app).get('/api/v1/auth/demo')).body.data;
      expect(creds).toEqual({ email: DEMO_EMAIL, password: DEMO_PASSWORD });
      const agent = request.agent(d.app);
      expect((await agent.post('/api/v1/auth/login').set(H).send(creds)).status).toBe(200);

      const jobId = await createActiveJob(agent);
      const up = await agent.post(`/api/v1/jobs/${jobId}/applications`).set(H)
        .attach('files', sample('Anna_Sykorova.txt'), 'Anna_Sykorova.txt')
        .attach('files', Buffer.from('Jan Skutečný\nSkutečný životopis, který do sdílené ukázky nepatří.'), 'muj-zivotopis.txt');
      expect(up.status).toBe(201);
      expect(up.body.data.map((x: { outcome: string }) => x.outcome)).toEqual(['queued', 'rejected']);
      expect(up.body.data[1].message).toMatch(/jen ukázkové životopisy/);
      // odmítnutý soubor se vůbec neuložil
      expect((d.ctx.db.prepare('SELECT COUNT(*) AS n FROM documents WHERE org_id = ?').get(orgId) as { n: number }).n).toBe(1);
    } finally { d.cleanup(); }

    // Bez SEED_DEMO_ON_START přihlašovací stránka ukázku nenabízí
    expect((await request(t.app).get('/api/v1/auth/demo')).body.data).toBeNull();
  });

  it('rate limit přihlášení', async () => {
    let last = 0;
    for (let i = 0; i < 12; i++) {
      last = (await request(t.app).post('/api/v1/auth/login').set(H).send({ email: 'nikdo@firma.cz', password: 'cokoli-dlouheho' })).status;
    }
    expect(last).toBe(429);
  });

  it('pozice: návrh požadavků neprojde povinným požadavkem bez zdroje v inzerátu', async () => {
    const agent = await registerAgent(t.app, 'a@firma.cz');
    const job = await agent.post('/api/v1/jobs').set(H).send({ title: 'Referent', adText: AD });
    const sug = await agent.post(`/api/v1/jobs/${job.body.data.id}/requirements/suggest`).set(H).send({});
    const vs = sug.body.data.requirements.find((r: { name: string }) => r.name === 'Vysoká škola');
    expect(vs.sourceFound).toBe(false);
    expect(vs.mustHave).toBe(false);
    const praxe = sug.body.data.requirements.find((r: { name: string }) => r.name === 'Praxe 2+ roky');
    expect(praxe.sourceFound).toBe(true);
    expect(praxe.mustHave).toBe(true);
  });

  it('pozice: stavy, přechody, filtr, historie', async () => {
    const agent = await registerAgent(t.app, 'b@firma.cz');
    const job = await agent.post('/api/v1/jobs').set(H).send({ title: 'Skladník', adText: AD });
    const id = job.body.data.id;
    expect(job.body.data.status).toBe('draft');
    const direct = await agent.patch(`/api/v1/jobs/${id}`).set(H).send({ status: 'active' });
    expect(direct.status).toBe(409);
    const up = await agent.post(`/api/v1/jobs/${id}/applications`).set(H).attach('files', sample('Anna_Sykorova.txt'), 'Anna_Sykorova.txt');
    expect(up.status).toBe(409); // koncept nepřijímá CV
    await agent.patch(`/api/v1/jobs/${id}`).set(H).send({ status: 'archived' });
    expect((await agent.get('/api/v1/jobs?status=open')).body.meta.total).toBe(0);
    expect((await agent.get('/api/v1/jobs?status=archived')).body.data[0].id).toBe(id);
    expect((await agent.get('/api/v1/jobs?status=all&q=sklad')).body.meta.total).toBe(1);
    const act = await agent.get(`/api/v1/jobs/${id}/activity`);
    expect(act.body.data.map((a: { action: string }) => a.action)).toEqual(expect.arrayContaining(['job.created', 'job.status_changed']));
  });

  it('nahrání, zpracování, výsledky, ověření citací, oprava verdiktu, rozhodnutí, poznámky', async () => {
    const agent = await registerAgent(t.app, 'c@firma.cz');
    const jobId = await createActiveJob(agent);
    const up = await agent.post(`/api/v1/jobs/${jobId}/applications`).set(H)
      .attach('files', sample('Kristyna_Vlckova_CV.pdf'), 'Kristyna_Vlckova_CV.pdf')
      .attach('files', sample('Michal_Dolezal_CV.docx'), 'Michal_Dolezal_CV.docx')
      .attach('files', sample('Anna_Sykorova.txt'), 'Anna_Sykorova.txt')
      .attach('files', sample('Kristyna_Vlckova_CV.pdf'), 'kopie.pdf')
      .attach('files', Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 1, 2, 3, 4]), 'stary.doc')
      .attach('files', Buffer.from('MZ fake exe'), 'virus.pdf');
    expect(up.status).toBe(201);
    const outcomes = up.body.data.map((r: { outcome: string }) => r.outcome);
    expect(outcomes).toEqual(['queued', 'queued', 'queued', 'duplicate', 'rejected', 'rejected']);
    expect(up.body.data[4].message).toMatch(/\.doc/);

    await t.queue.drain();
    const list = await agent.get(`/api/v1/jobs/${jobId}/applications`);
    expect(list.body.meta.total).toBe(3);
    expect(list.body.data.every((r: { status: string }) => r.status === 'done')).toBe(true);
    const row = list.body.data.find((r: { fileName: string }) => r.fileName === 'Kristyna_Vlckova_CV.pdf');
    expect(row.score).toBeGreaterThan(0);
    expect(row.unverifiedCount).toBeGreaterThan(0); // vymyšlená citace se počítá jako neověřená

    const detail = await agent.get(`/api/v1/applications/${row.id}`);
    const items = detail.body.data.evaluation.items;
    expect(items[0].quoteStatus).toBe('exact');
    expect(items[0].quotePage).toBe(1);
    expect(items[1].quoteStatus).toBe('not_found');
    expect(detail.body.data.document.pageCount).toBeGreaterThan(0);
    const before = detail.body.data.evaluation.score;

    // Oprava verdiktu vyžaduje důvod, přepočítá skóre a zachová verdikt AI
    const noNote = await agent.patch(`/api/v1/evaluation-items/${items[1].id}`).set(H).send({ verdict: 'nesplnuje' });
    expect(noNote.status).toBe(400);
    const ov = await agent.patch(`/api/v1/evaluation-items/${items[1].id}`).set(H).send({ verdict: 'nesplnuje', note: 'Citace v CV není.' });
    expect(ov.status).toBe(200);
    const ovItem = ov.body.data.evaluation.items[1];
    expect(ovItem.verdict).toBe('nesplnuje');
    expect(ovItem.aiVerdict).toBe('castecne');
    expect(ov.body.data.evaluation.score).toBeLessThan(before);
    expect(ov.body.data.evaluation.aiScore).toBe(before);

    // Rozhodnutí a poznámka přetrvají
    await agent.patch(`/api/v1/applications/${row.id}`).set(H).send({ decision: 'pozvat' });
    await agent.post(`/api/v1/applications/${row.id}/notes`).set(H).send({ body: 'Volat v pondělí.' });
    const again = await agent.get(`/api/v1/applications/${row.id}`);
    expect(again.body.data.decision).toBe('pozvat');
    expect(again.body.data.notes[0].body).toBe('Volat v pondělí.');

    // Filtry a řazení
    expect((await agent.get(`/api/v1/jobs/${jobId}/applications?decision=pozvat`)).body.meta.total).toBe(1);
    expect((await agent.get(`/api/v1/jobs/${jobId}/applications?decision=none`)).body.meta.total).toBe(2);
    const byName = await agent.get(`/api/v1/jobs/${jobId}/applications?sort=name&dir=asc`);
    const names = byName.body.data.map((r: { candidateName: string }) => r.candidateName);
    expect(names).toEqual([...names].sort((a: string, b: string) => a.localeCompare(b)));
    expect((await agent.get(`/api/v1/jobs/${jobId}/applications?pageSize=2&page=2`)).body.data.length).toBe(1);
    expect((await agent.get(`/api/v1/jobs/${jobId}/applications?sort=bad`)).status).toBe(400);

    // Stažení originálu a text
    const file = await agent.get(`/api/v1/documents/${detail.body.data.document.id}/file`);
    expect(file.status).toBe(200);
    expect(file.headers['content-disposition']).toMatch(/^attachment/);
    expect((await agent.get(`/api/v1/documents/${detail.body.data.document.id}/text`)).body.data.pages.length).toBeGreaterThan(0);

    // Export CSV s ochranou proti vzorcům
    const csv = await agent.get(`/api/v1/jobs/${jobId}/export.csv`);
    expect(csv.headers['content-type']).toMatch(/text\/csv/);
    expect(csv.text.split('\r\n').length).toBe(4);
  });

  it('změna požadavků označí hodnocení jako zastaralá a nové hodnocení vytvoří verzi 2', async () => {
    const agent = await registerAgent(t.app, 'd@firma.cz');
    const jobId = await createActiveJob(agent);
    await agent.post(`/api/v1/jobs/${jobId}/applications`).set(H).attach('files', sample('Anna_Sykorova.txt'), 'Anna_Sykorova.txt');
    await t.queue.drain();
    const job = await agent.get(`/api/v1/jobs/${jobId}`);
    const reqs = job.body.data.requirements.map((r: Record<string, unknown>) => ({ ...r, weight: 1 }));
    await agent.put(`/api/v1/jobs/${jobId}/requirements`).set(H).send({ requirements: reqs });
    const list = await agent.get(`/api/v1/jobs/${jobId}/applications`);
    expect(list.body.data[0].stale).toBe(true);
    const re = await agent.post(`/api/v1/jobs/${jobId}/applications/reevaluate`).set(H).send({ staleOnly: true });
    expect(re.body.data.queued).toBe(1);
    await t.queue.drain();
    const d = await agent.get(`/api/v1/applications/${list.body.data[0].id}`);
    expect(d.body.data.evaluation.version).toBe(2);
    expect(d.body.data.evaluation.stale).toBe(false);
    expect(d.body.data.history).toHaveLength(2);
  });

  it('dočasná chyba AI se opakuje, trvalá skončí chybou a jde zopakovat ručně', async () => {
    const provider = new FakeProvider();
    t.cleanup();
    t = makeTestApp(provider);
    const agent = await registerAgent(t.app, 'e@firma.cz');
    const jobId = await createActiveJob(agent);

    provider.failNext = new AiError('transient', 'ai_rate_limited', 'Přetíženo.');
    await agent.post(`/api/v1/jobs/${jobId}/applications`).set(H).attach('files', sample('Anna_Sykorova.txt'), 'Anna_Sykorova.txt');
    await t.queue.drain();
    let row = (await agent.get(`/api/v1/jobs/${jobId}/applications`)).body.data[0];
    expect(row.status).toBe('queued');
    expect(row.errorMessage).toMatch(/Další pokus/);
    t.ctx.db.prepare('UPDATE applications SET next_attempt_at = NULL').run();
    await t.queue.drain();
    row = (await agent.get(`/api/v1/jobs/${jobId}/applications`)).body.data[0];
    expect(row.status).toBe('done');

    provider.failNext = new AiError('permanent', 'ai_bad_request', 'AI dokument nepřijala.');
    await agent.post(`/api/v1/jobs/${jobId}/applications`).set(H).attach('files', sample('Michal_Dolezal_CV.docx'), 'Michal_Dolezal_CV.docx');
    await t.queue.drain();
    const failed = (await agent.get(`/api/v1/jobs/${jobId}/applications?status=failed`)).body.data[0];
    expect(failed.errorMessage).toBe('AI dokument nepřijala.');
    expect(failed.canRetry).toBe(true);
    expect((await agent.post(`/api/v1/applications/${failed.id}/retry`).set(H).send({})).status).toBe(200);
    await t.queue.drain();
    expect((await agent.get(`/api/v1/applications/${failed.id}`)).body.data.status).toBe('done');
  });

  it('bez AI klíče: návrh vrátí 503 a zpracování skončí srozumitelnou chybou', async () => {
    t.cleanup();
    t = makeTestApp(null);
    const agent = await registerAgent(t.app, 'f@firma.cz');
    const job = await agent.post('/api/v1/jobs').set(H).send({ title: 'Referent', adText: AD });
    const id = job.body.data.id;
    expect((await agent.post(`/api/v1/jobs/${id}/requirements/suggest`).set(H).send({})).status).toBe(503);
    await agent.put(`/api/v1/jobs/${id}/requirements`).set(H).send({ requirements: [
      { name: 'Excel', description: '', category: 'dovednosti', weight: 2, mustHave: false, origin: 'user' },
    ] });
    await agent.post(`/api/v1/jobs/${id}/applications`).set(H).attach('files', sample('Anna_Sykorova.txt'), 'Anna_Sykorova.txt');
    await t.queue.drain();
    const row = (await agent.get(`/api/v1/jobs/${id}/applications`)).body.data[0];
    expect(row.status).toBe('failed');
    expect(row.errorMessage).toMatch(/ANTHROPIC_API_KEY/);
  });

  it('izolace organizací: cizí ID vrací 404 a nic nezmění', async () => {
    const a = await registerAgent(t.app, 'owner@a.cz', 'Firma A');
    const b = await registerAgent(t.app, 'owner@b.cz', 'Firma B');
    const jobId = await createActiveJob(a);
    await a.post(`/api/v1/jobs/${jobId}/applications`).set(H).attach('files', sample('Anna_Sykorova.txt'), 'Anna_Sykorova.txt');
    await t.queue.drain();
    const appRow = (await a.get(`/api/v1/jobs/${jobId}/applications`)).body.data[0];
    const det = (await a.get(`/api/v1/applications/${appRow.id}`)).body.data;
    const itemId = det.evaluation.items[0].id;

    const checks = [
      b.get(`/api/v1/jobs/${jobId}`),
      b.get(`/api/v1/jobs/${jobId}/applications`),
      b.get(`/api/v1/jobs/${jobId}/activity`),
      b.get(`/api/v1/jobs/${jobId}/export.csv`),
      b.patch(`/api/v1/jobs/${jobId}`).set(H).send({ title: 'Ukradeno' }),
      b.put(`/api/v1/jobs/${jobId}/requirements`).set(H).send({ requirements: [{ name: 'Cizí požadavek', description: '', category: 'ostatni', weight: 1, mustHave: false, origin: 'user' }] }),
      b.post(`/api/v1/jobs/${jobId}/applications`).set(H).attach('files', sample('Michal_Dolezal_CV.docx'), 'm.docx'),
      b.get(`/api/v1/applications/${appRow.id}`),
      b.patch(`/api/v1/applications/${appRow.id}`).set(H).send({ decision: 'odmitnout' }),
      b.post(`/api/v1/applications/${appRow.id}/notes`).set(H).send({ body: 'x' }),
      b.delete(`/api/v1/applications/${appRow.id}`).set(H),
      b.patch(`/api/v1/evaluation-items/${itemId}`).set(H).send({ verdict: 'nesplnuje', note: 'x' }),
      b.get(`/api/v1/documents/${det.document.id}/file`),
      b.get(`/api/v1/documents/${det.document.id}/text`),
      b.patch(`/api/v1/candidates/${det.candidate.id}`).set(H).send({ name: 'X', email: '', phone: '' }),
      b.delete(`/api/v1/candidates/${det.candidate.id}`).set(H),
      b.delete(`/api/v1/jobs/${jobId}`).set(H),
    ];
    for (const res of await Promise.all(checks)) expect(res.status, `${res.req.method} ${res.req.path}`).toBe(404);

    const still = await a.get(`/api/v1/applications/${appRow.id}`);
    expect(still.body.data.decision).toBeNull();
    expect(still.body.data.job.title).toBe('Obchodní referent');
  });

  it('výmaz kandidáta smaže přihlášky i soubory z disku', async () => {
    const agent = await registerAgent(t.app, 'g@firma.cz');
    const jobId = await createActiveJob(agent);
    await agent.post(`/api/v1/jobs/${jobId}/applications`).set(H).attach('files', sample('Anna_Sykorova.txt'), 'Anna_Sykorova.txt');
    await t.queue.drain();
    const row = (await agent.get(`/api/v1/jobs/${jobId}/applications`)).body.data[0];
    const key = (t.ctx.db.prepare('SELECT storage_key FROM documents').get() as { storage_key: string }).storage_key;
    expect(t.ctx.storage.exists(key)).toBe(true);
    expect((await agent.delete(`/api/v1/candidates/${row.candidateId}`).set(H)).status).toBe(200);
    expect(t.ctx.storage.exists(key)).toBe(false);
    expect((t.ctx.db.prepare('SELECT COUNT(*) AS n FROM documents').get() as { n: number }).n).toBe(0);
    expect((await agent.get(`/api/v1/jobs/${jobId}/applications`)).body.meta.total).toBe(0);
    const log = t.ctx.db.prepare(`SELECT meta FROM audit_logs WHERE action = 'candidate.deleted'`).get() as { meta: string };
    expect(log.meta).not.toMatch(/Anna|sykorova/i); // v auditu nejsou osobní údaje
  });

  it('tým: pozvánka, přijetí, role, oprávnění vlastníka', async () => {
    const owner = await registerAgent(t.app, 'boss@firma.cz');
    const inv = await owner.post('/api/v1/organization/invites').set(H).send({ role: 'recruiter' });
    expect(inv.status).toBe(201);
    const token = inv.body.data.url.split('/pozvanka/')[1];
    const info = await request(t.app).get(`/api/v1/invites/${token}`);
    expect(info.body.data.organizationName).toBe('Firma');
    const member = request.agent(t.app);
    const acc = await member.post(`/api/v1/invites/${token}/accept`).set(H).send({ name: 'Nový', email: 'novy@firma.cz', password: 'dostatecne-dlouhe-heslo' });
    expect(acc.status).toBe(201);
    expect((await member.get('/api/v1/auth/me')).body.data.role).toBe('recruiter');
    expect((await request(t.app).post(`/api/v1/invites/${token}/accept`).set(H).send({ name: 'X', email: 'x@firma.cz', password: 'dostatecne-dlouhe-heslo' })).status).toBe(404);

    // Personalista nesmí spravovat tým ani mazat pozice
    expect((await member.post('/api/v1/organization/invites').set(H).send({ role: 'owner' })).status).toBe(403);
    expect((await member.patch('/api/v1/organization').set(H).send({ retentionDays: 30 })).status).toBe(403);

    const members = (await owner.get('/api/v1/organization/members')).body.data;
    expect(members).toHaveLength(2);
    const me = members.find((m: { isYou: boolean }) => m.isYou);
    expect((await owner.patch(`/api/v1/organization/members/${me.userId}`).set(H).send({ role: 'recruiter' })).status).toBe(409); // poslední vlastník
    const other = members.find((m: { isYou: boolean }) => !m.isYou);
    expect((await owner.delete(`/api/v1/organization/members/${other.userId}`).set(H)).status).toBe(200);
    expect((await member.get('/api/v1/auth/me')).body.data).toBeNull(); // session odebraného člena zanikla
    expect((await member.get('/api/v1/jobs')).status).toBe(401);
  });

  it('změna hesla zruší ostatní přihlášení', async () => {
    const a1 = await registerAgent(t.app, 'h@firma.cz');
    const a2 = request.agent(t.app);
    await a2.post('/api/v1/auth/login').set(H).send({ email: 'h@firma.cz', password: 'dostatecne-dlouhe-heslo' });
    const ch = await a1.post('/api/v1/me/password').set(H).send({ currentPassword: 'dostatecne-dlouhe-heslo', newPassword: 'nove-dlouhe-heslo-123' });
    expect(ch.status).toBe(200);
    expect((await a2.get('/api/v1/auth/me')).body.data).toBeNull();
    expect((await a1.get('/api/v1/auth/me')).body.data.user.email).toBe('h@firma.cz');
  });

  it('přehled vrací pozice, upozornění a využití', async () => {
    const agent = await registerAgent(t.app, 'i@firma.cz');
    await agent.post('/api/v1/jobs').set(H).send({ title: 'Koncept', adText: AD });
    const d = await agent.get('/api/v1/dashboard');
    expect(d.status).toBe(200);
    expect(d.body.data.attention[0].kind).toBe('unconfirmed');
    expect(d.body.data.usage.aiConfigured).toBe(true);
    expect(d.body.data.activity.length).toBeGreaterThan(0);
  });
});
