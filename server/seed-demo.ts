// Vytvoří (nebo obnoví) ukázkovou organizaci s fiktivními daty.
// Spuštění: npm run seed:demo
// Používá stejnou pipeline jako ostrý provoz (extrakce textu, ověření citací, skóre),
// jen místo AI vrací DemoProvider předpřipravené výsledky. V UI jsou označené.

import fs from 'node:fs';
import path from 'node:path';
import { loadConfig } from './config.js';
import { newId, now, openDb } from './db/index.js';
import { hashPassword } from './lib/security.js';
import { ingestFiles } from './services/applications.js';
import { replaceRequirements } from './services/jobs.js';
import { DemoProvider } from './services/ai/demo.js';
import { ProcessingQueue } from './services/queue.js';
import { FileStorage } from './services/storage.js';

try { process.loadEnvFile(); } catch { /* volitelné */ }

import { DEMO_EMAIL, DEMO_PASSWORD } from './demo-account.js';

export { DEMO_EMAIL, DEMO_PASSWORD };

const SECOND_AD = `Skladník / skladnice – ranní směna

Místo: Nymburk, plný úvazek, ranní směny 6:00–14:30

Náplň práce:
- příjem a výdej zboží, kontrola dodávek
- vychystávání objednávek podle skenerů
- práce s vysokozdvižným vozíkem

Požadujeme:
- platný průkaz na VZV (podmínka)
- zkušenost ze skladu výhodou
- základní práce s PC

Nabízíme: 32 000 Kč + příplatky, stravenky, dopravu z Nymburka.`;

export async function seedDemo(opts: { dbPath?: string; uploadDir?: string; root?: string } = {}): Promise<void> {
  const cfg = loadConfig();
  const root = opts.root ?? process.cwd();
  const samples = path.join(root, 'ukazka');
  const db = openDb(opts.dbPath ?? cfg.dbPath);
  const storage = new FileStorage(opts.uploadDir ?? cfg.uploadDir);

  // Smazat předchozí ukázku včetně souborů
  const old = db.prepare('SELECT o.id FROM organizations o WHERE o.is_demo = 1').all() as Array<{ id: string }>;
  for (const o of old) {
    const keys = (db.prepare('SELECT storage_key FROM documents WHERE org_id = ?').all(o.id) as Array<{ storage_key: string }>).map((r) => r.storage_key);
    const users = (db.prepare('SELECT user_id FROM memberships WHERE org_id = ?').all(o.id) as Array<{ user_id: string }>).map((r) => r.user_id);
    db.transaction(() => {
      db.prepare('DELETE FROM applications WHERE org_id = ?').run(o.id);
      db.prepare('DELETE FROM organizations WHERE id = ?').run(o.id);
      for (const u of users) db.prepare('DELETE FROM users WHERE id = ? AND NOT EXISTS (SELECT 1 FROM memberships WHERE user_id = ?)').run(u, u);
    })();
    keys.forEach((k) => storage.remove(k));
  }
  db.prepare('DELETE FROM users WHERE email = ?').run(DEMO_EMAIL);

  const t = now();
  const orgId = newId();
  const userId = newId();
  const hash = await hashPassword(DEMO_PASSWORD);
  db.transaction(() => {
    db.prepare('INSERT INTO organizations (id, name, is_demo, created_at) VALUES (?, ?, 1, ?)').run(orgId, 'Zahradní technika Polabí (ukázka)', t);
    db.prepare('INSERT INTO users (id, email, name, password_hash, created_at) VALUES (?, ?, ?, ?, ?)').run(userId, DEMO_EMAIL, 'Petra Ukázková', hash, t);
    db.prepare(`INSERT INTO memberships (org_id, user_id, role, created_at) VALUES (?, ?, 'owner', ?)`).run(orgId, userId, t);
  })();

  // Pozice 1: aktivní, s potvrzenými požadavky a vyhodnocenými kandidáty
  const ad = fs.readFileSync(path.join(samples, 'inzerat.txt'), 'utf8').trim();
  const jobId = newId();
  db.prepare(`INSERT INTO jobs (id, org_id, title, ad_text, status, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, 'draft', ?, ?, ?)`)
    .run(jobId, orgId, 'Obchodní referent/ka – velkoobchod', ad, userId, t, t);
  const demo = new DemoProvider(samples);
  const { result } = await demo.suggestRequirements(ad);
  replaceRequirements(db, orgId, userId, jobId, result.requirements.map((r) => ({
    name: r.name, description: r.description, category: r.category, weight: r.weight, mustHave: r.must_have, origin: 'ai', adQuote: r.ad_quote,
  })));
  const files = fs.readdirSync(samples)
    .filter((f) => /\.(pdf|docx|txt)$/i.test(f) && f !== 'inzerat.txt')
    .map((f) => ({ originalname: Buffer.from(f, 'utf8').toString('latin1'), buffer: fs.readFileSync(path.join(samples, f)) }));
  ingestFiles(db, storage, orgId, userId, jobId, files);

  const queue = new ProcessingQueue(db, storage, { forOrg: () => demo }, { concurrency: 3, monthlyLimit: 1000 });
  await queue.drain();

  // Pozice 2: koncept, čeká na potvrzení požadavků
  db.prepare(`INSERT INTO jobs (id, org_id, title, ad_text, status, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, 'draft', ?, ?, ?)`)
    .run(newId(), orgId, 'Skladník / skladnice – ranní směna', SECOND_AD, userId, t, t);

  const done = (db.prepare(`SELECT COUNT(*) AS n FROM applications WHERE org_id = ? AND status = 'done'`).get(orgId) as { n: number }).n;
  db.close();
  console.log(`Ukázková organizace připravena (${done} vyhodnocených životopisů).`);
  console.log(`Přihlášení: ${DEMO_EMAIL} / ${DEMO_PASSWORD}`);
}

if (process.argv[1] && /seed-demo\.(ts|js)$/.test(process.argv[1])) {
  seedDemo().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
