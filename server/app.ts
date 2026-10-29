import express, { type Express, Router } from 'express';
import { csrfGuard, requireAuth, sessionLoader } from './auth.js';
import type { Ctx } from './context.js';
import { AppError, errorHandler } from './lib/errors.js';
import { adminRoutes } from './routes/admin.js';
import { applicationRoutes } from './routes/applications.js';
import { authRoutes } from './routes/auth.js';
import { billingRoutes } from './routes/billing.js';
import { jobRoutes } from './routes/jobs.js';
import { orgRoutes } from './routes/org.js';

/** Sestaví Express aplikaci s API. Statické soubory / Vite přidává index.ts. */
export function createApp(ctx: Ctx, opts: { csp?: boolean } = {}): Express {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', ctx.config.isProd ? 1 : false);

  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'same-origin');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    if (opts.csp !== false) {
      res.setHeader('Content-Security-Policy', [
        "default-src 'self'", "script-src 'self'", "style-src 'self' 'unsafe-inline'", "img-src 'self' data:",
        "font-src 'self'", "connect-src 'self'", "frame-ancestors 'none'", "base-uri 'self'", "form-action 'self'", "object-src 'none'",
      ].join('; '));
    }
    if (ctx.config.cookieSecure) res.setHeader('Strict-Transport-Security', 'max-age=15552000');
    next();
  });

  const api = Router();
  api.use(express.json({ limit: '1mb' }));
  api.use((_req, res, next) => { res.setHeader('Cache-Control', 'no-store'); next(); });
  api.use(csrfGuard(ctx.config));
  api.use(sessionLoader(ctx.db, ctx.config));
  api.get('/health', (_req, res) => { res.json({ data: { ok: true } }); });
  api.use(authRoutes(ctx));
  api.use(requireAuth);
  api.use(orgRoutes(ctx));
  api.use(billingRoutes(ctx));
  api.use(adminRoutes(ctx));
  api.use(jobRoutes(ctx));
  api.use(applicationRoutes(ctx));
  api.use((_req, _res, next) => next(new AppError(404, 'not_found', 'Tento endpoint neexistuje.')));

  app.use('/api/v1', api);
  app.use('/api', (_req, res) => { res.status(404).json({ error: { code: 'not_found', message: 'Tento endpoint neexistuje.' } }); });
  return app;
}

export function finalize(app: Express): void {
  app.use(errorHandler);
}
