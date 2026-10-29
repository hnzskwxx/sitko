import express from 'express';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp, finalize } from './app.js';
import { loadConfig } from './config.js';
import type { Ctx } from './context.js';
import { openDb } from './db/index.js';
import { log } from './lib/logger.js';
import { Providers } from './providers.js';
import { retentionSweep } from './services/applications.js';
import { ProcessingQueue } from './services/queue.js';
import { FileStorage } from './services/storage.js';
import { quotaFor } from './services/subscription.js';

try { process.loadEnvFile(); } catch { /* .env je volitelný */ }

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = findRoot(HERE);
// Sestavená verze (dist/) běží v produkčním režimu i bez NODE_ENV (funguje i na Windows)
if (!process.env.NODE_ENV && HERE.split(path.sep).includes('dist')) process.env.NODE_ENV = 'production';

function findRoot(dir: string): string {
  let d = dir;
  for (let i = 0; i < 5; i++) {
    if (fs.existsSync(path.join(d, 'package.json'))) return d;
    d = path.dirname(d);
  }
  return process.cwd();
}

async function main(): Promise<void> {
  const config = loadConfig();
  if (process.env.SEED_DEMO_ON_START === 'true') {
    // Ukázková organizace při každém startu (např. demo na hostingu bez trvalého disku)
    const { seedDemo } = await import('./seed-demo.js');
    await seedDemo({ root: ROOT });
  }
  const db = openDb(config.dbPath);
  const storage = new FileStorage(config.uploadDir);
  const providers = Providers.fromConfig(config, path.join(ROOT, 'ukazka'));
  const queue = new ProcessingQueue(db, storage, providers, {
    concurrency: config.ai.concurrency,
    monthlyLimit: config.ai.monthlyLimit,
    quota: (orgId) => quotaFor(db, config, orgId),
  });
  const ctx: Ctx = { db, config, storage, queue, providers };

  const app = createApp(ctx, { csp: config.isProd });
  const server = http.createServer(app);

  if (config.isProd) {
    const dist = path.join(ROOT, 'dist', 'web');
    app.use(express.static(dist, {
      index: false,
      setHeaders: (res, file) => {
        // Soubory s hashem v názvu se nemění, ostatní (index, manifest, sw.js) vždy ověřit
        res.setHeader('Cache-Control', file.includes(`${path.sep}assets${path.sep}`) ? 'public, max-age=31536000, immutable' : 'no-cache');
      },
    }));
    app.get(/^(?!\/api\/).*/, (_req, res) => {
      res.setHeader('Cache-Control', 'no-cache');
      res.sendFile(path.join(dist, 'index.html'));
    });
  } else {
    const { createServer } = await import('vite');
    const vite = await createServer({
      configFile: path.join(ROOT, 'vite.config.ts'),
      server: { middlewareMode: true, hmr: { port: config.port + 20000 } },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  }
  finalize(app);

  queue.start();
  const sweep = () => {
    try {
      const n = retentionSweep(db, storage);
      if (n) log.info('retention_sweep', { deleted: n });
      db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(new Date().toISOString());
    } catch (err) {
      log.error('retention_failed', { err: (err as Error).message });
    }
  };
  sweep();
  setInterval(sweep, 6 * 3600_000).unref();

  server.listen(config.port, () => {
    log.info('server_started', {
      url: `http://localhost:${config.port}`, mode: config.isProd ? 'production' : 'development',
      ai: config.ai.apiKey ? config.ai.model : 'nenastaveno (chybí ANTHROPIC_API_KEY)',
    });
    if (config.isProd && config.ai.apiKey && config.allowRegistration && !config.registrationCode && !config.subscriptions) {
      log.warn('registration_open_without_code', {
        hint: 'Kdokoli se může zaregistrovat a hodnotit na váš API klíč. Nastavte SUBSCRIPTIONS=true, REGISTRATION_CODE nebo ALLOW_REGISTRATION=false.',
      });
    }
    if (config.subscriptions && !config.adminEmails.length) {
      log.warn('subscriptions_without_admin', { hint: 'Placené členství je zapnuté, ale chybí ADMIN_EMAILS: nikdo nemůže firmy aktivovat.' });
    }
  });

  const shutdown = () => {
    log.info('server_stopping');
    queue.stop();
    server.close(() => { db.close(); process.exit(0); });
    setTimeout(() => process.exit(0), 10_000).unref();
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  log.error('startup_failed', { err: err instanceof Error ? err.stack : String(err) });
  process.exit(1);
});
