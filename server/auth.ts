import type { NextFunction, Request, Response } from 'express';
import type { Me, Role } from '../shared/types.js';
import type { Config } from './config.js';
import { bool, now, type DB } from './db/index.js';
import { AppError, forbidden } from './lib/errors.js';
import { newToken, sha256 } from './lib/security.js';
import { computeSubscription, SUBSCRIPTION_JOIN, SUBSCRIPTION_SELECT, type SubscriptionRow } from './services/subscription.js';

export const SESSION_COOKIE = 'sitko_session';
export const CSRF_HEADER = 'x-sitko-request';

export interface AuthContext {
  sessionId: string;
  userId: string;
  orgId: string;
  role: Role;
  me: Me;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request { auth?: AuthContext }
  }
}

function readCookie(req: Request, name: string): string | null {
  const header = req.headers.cookie;
  if (!header) return null;
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return null;
}

export function createSession(db: DB, cfg: Config, res: Response, userId: string, orgId: string): void {
  const { token, hash } = newToken();
  const expires = new Date(Date.now() + cfg.sessionDays * 86_400_000);
  db.prepare('INSERT INTO sessions (id, user_id, org_id, created_at, expires_at) VALUES (?, ?, ?, ?, ?)')
    .run(hash, userId, orgId, now(), expires.toISOString());
  setCookie(cfg, res, token, expires);
}

function setCookie(cfg: Config, res: Response, token: string, expires: Date): void {
  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true, sameSite: 'lax', secure: cfg.cookieSecure, path: '/', expires,
  });
}

export function destroySession(db: DB, cfg: Config, req: Request, res: Response): void {
  if (req.auth) db.prepare('DELETE FROM sessions WHERE id = ?').run(req.auth.sessionId);
  res.clearCookie(SESSION_COOKIE, { httpOnly: true, sameSite: 'lax', secure: cfg.cookieSecure, path: '/' });
}

/** Načte session z cookie (pokud je platná) a prodlouží ji. */
export function sessionLoader(db: DB, cfg: Config) {
  const lookup = db.prepare(`
    SELECT s.id AS sid, s.expires_at, u.id AS uid, u.email, u.name AS uname,
           o.id AS oid, o.name AS oname, o.retention_days, m.role, ${SUBSCRIPTION_SELECT}
      FROM sessions s
      JOIN users u ON u.id = s.user_id
      JOIN organizations o ON o.id = s.org_id
      JOIN memberships m ON m.org_id = s.org_id AND m.user_id = s.user_id
      ${SUBSCRIPTION_JOIN}
     WHERE s.id = ? AND s.expires_at > ?`);

  return (req: Request, res: Response, next: NextFunction): void => {
    const token = readCookie(req, SESSION_COOKIE);
    if (token && token.length < 200) {
      const r = lookup.get(sha256(token), now()) as Record<string, unknown> | undefined;
      if (r) {
        req.auth = {
          sessionId: r.sid as string,
          userId: r.uid as string,
          orgId: r.oid as string,
          role: r.role as Role,
          me: {
            user: { id: r.uid as string, email: r.email as string, name: r.uname as string },
            organization: {
              id: r.oid as string, name: r.oname as string, isDemo: bool(r.is_demo), retentionDays: r.retention_days as number,
              subscription: computeSubscription(r as unknown as SubscriptionRow, cfg),
            },
            role: r.role as Role,
            isPlatformAdmin: isPlatformAdmin(cfg, r.email as string),
          },
        };
        // Klouzavá expirace: prodloužit, když zbývá méně než polovina
        const remaining = new Date(r.expires_at as string).getTime() - Date.now();
        if (remaining < (cfg.sessionDays * 86_400_000) / 2) {
          const expires = new Date(Date.now() + cfg.sessionDays * 86_400_000);
          db.prepare('UPDATE sessions SET expires_at = ? WHERE id = ?').run(expires.toISOString(), r.sid as string);
          setCookie(cfg, res, token, expires);
        }
      }
    }
    next();
  };
}

/**
 * Ochrana proti CSRF: zápisové požadavky musí nést vlastní hlavičku (cizí web ji
 * bez CORS poslat nemůže) a případný Origin musí odpovídat hostu.
 */
export function csrfGuard(cfg: Config) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
    if (req.get(CSRF_HEADER) !== '1') return next(new AppError(403, 'csrf', 'Požadavek byl odmítnut. Obnovte stránku a zkuste to znovu.'));
    const origin = req.get('origin');
    if (origin) {
      const allowed = cfg.publicUrl ?? `${req.protocol}://${req.get('host')}`;
      if (origin !== allowed && origin !== `http://${req.get('host')}` && origin !== `https://${req.get('host')}`) {
        return next(new AppError(403, 'csrf', 'Požadavek z cizího webu byl odmítnut.'));
      }
    }
    next();
  };
}

export function requireAuth(req: Request, _res: Response, next: NextFunction): void {
  if (!req.auth) return next(new AppError(401, 'unauthenticated', 'Přihlaste se prosím.'));
  next();
}

/** Provozovatel Sítka: e-mail je v ADMIN_EMAILS. Ověřuje se při každém požadavku na serveru. */
export function isPlatformAdmin(cfg: Config, email: string): boolean {
  return cfg.adminEmails.includes(email.toLowerCase());
}

/** Správa je pro ostatní neviditelná (404, ne 403). */
export function requirePlatformAdmin(cfg: Config) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.auth || !isPlatformAdmin(cfg, req.auth.me.user.email)) return next(new AppError(404, 'not_found', 'Tento endpoint neexistuje.'));
    next();
  };
}

export function requireOwner(req: Request, _res: Response, next: NextFunction): void {
  if (req.auth?.role !== 'owner') return next(forbidden('Tuto akci může provést jen vlastník organizace.'));
  next();
}

/** Bezpečné získání kontextu v handleru za requireAuth. */
export function auth(req: Request): AuthContext {
  if (!req.auth) throw new AppError(401, 'unauthenticated', 'Přihlaste se prosím.');
  return req.auth;
}
