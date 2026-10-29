import { Router } from 'express';
import { z } from 'zod';
import { createSession, destroySession } from '../auth.js';
import type { Ctx } from '../context.js';
import { newId, now } from '../db/index.js';
import { AppError, parse } from '../lib/errors.js';
import { RateLimiter, rateLimit } from '../lib/ratelimit.js';
import { burnPasswordCheck, hashPassword, safeEqual, sha256, verifyPassword } from '../lib/security.js';
import { DEMO_EMAIL, DEMO_PASSWORD } from '../demo-account.js';
import { audit } from '../services/audit.js';

export const passwordSchema = z.string().min(10, 'Heslo musí mít aspoň 10 znaků.').max(200, 'Heslo je příliš dlouhé.');
const emailSchema = z.string().trim().toLowerCase().pipe(z.email('Zadejte platný e-mail.')).pipe(z.string().max(200));
const nameSchema = z.string().trim().min(1, 'Vyplňte jméno.').max(120);

export function authRoutes(ctx: Ctx): Router {
  const r = Router();
  const { db, config } = ctx;
  const loginLimiter = new RateLimiter(10, 15 * 60_000);
  const signupLimiter = new RateLimiter(10, 60 * 60_000);
  const tooMany = 'Příliš mnoho pokusů. Zkuste to znovu za několik minut.';

  /** Veřejné demo: přihlašovací stránka nabídne vstup do ukázky (jen když ji server připravuje při startu). */
  r.get('/auth/demo', (_req, res) => {
    const exists = config.demoOnStart && db.prepare(`
      SELECT 1 FROM users u JOIN memberships m ON m.user_id = u.id JOIN organizations o ON o.id = m.org_id
       WHERE u.email = ? AND o.is_demo = 1`).get(DEMO_EMAIL);
    res.json({ data: exists ? { email: DEMO_EMAIL, password: DEMO_PASSWORD } : null });
  });

  r.get('/auth/registration', (_req, res) => {
    res.json({ data: { open: config.allowRegistration, codeRequired: config.allowRegistration && Boolean(config.registrationCode) } });
  });

  r.post('/auth/register', rateLimit(signupLimiter, (req) => `reg:${req.ip}`, tooMany), async (req, res) => {
    if (!config.allowRegistration) throw new AppError(403, 'registration_closed', 'Registrace nových firem je vypnutá.');
    const body = parse(z.object({
      organizationName: z.string().trim().min(2, 'Vyplňte název firmy.').max(120),
      name: nameSchema,
      email: emailSchema,
      password: passwordSchema,
      code: z.string().trim().max(200).optional(),
    }), req.body);
    if (config.registrationCode && !safeEqual(body.code ?? '', config.registrationCode)) {
      throw new AppError(403, 'registration_code', 'Registrační kód nesedí. Kód vám dá provozovatel Sítka.', { code: 'Neplatný registrační kód.' });
    }
    if (db.prepare('SELECT 1 FROM users WHERE email = ?').get(body.email)) {
      throw new AppError(409, 'email_taken', 'Účet s tímto e-mailem už existuje. Přihlaste se.', { email: 'E-mail je už registrovaný.' });
    }
    const hash = await hashPassword(body.password);
    const userId = newId();
    const orgId = newId();
    const t = now();
    db.transaction(() => {
      db.prepare('INSERT INTO organizations (id, name, created_at) VALUES (?, ?, ?)').run(orgId, body.organizationName, t);
      db.prepare('INSERT INTO users (id, email, name, password_hash, created_at) VALUES (?, ?, ?, ?, ?)').run(userId, body.email, body.name, hash, t);
      db.prepare(`INSERT INTO memberships (org_id, user_id, role, created_at) VALUES (?, ?, 'owner', ?)`).run(orgId, userId, t);
    })();
    createSession(db, config, res, userId, orgId);
    res.status(201).json({ data: { ok: true } });
  });

  r.post('/auth/login', async (req, res) => {
    const body = parse(z.object({ email: emailSchema, password: z.string().min(1, 'Zadejte heslo.').max(200) }), req.body);
    const key = `login:${req.ip}:${body.email}`;
    if (!loginLimiter.take(key)) throw new AppError(429, 'rate_limited', tooMany);
    const user = db.prepare('SELECT id, password_hash FROM users WHERE email = ?').get(body.email) as { id: string; password_hash: string } | undefined;
    if (!user) {
      await burnPasswordCheck(body.password);
      throw new AppError(401, 'bad_credentials', 'E-mail nebo heslo nesedí.');
    }
    if (!(await verifyPassword(body.password, user.password_hash))) {
      throw new AppError(401, 'bad_credentials', 'E-mail nebo heslo nesedí.');
    }
    const m = db.prepare('SELECT org_id FROM memberships WHERE user_id = ? ORDER BY created_at DESC LIMIT 1').get(user.id) as { org_id: string } | undefined;
    if (!m) throw new AppError(403, 'no_organization', 'Účet už nepatří do žádné organizace.');
    loginLimiter.reset(key);
    createSession(db, config, res, user.id, m.org_id);
    res.json({ data: { ok: true } });
  });

  r.post('/auth/logout', (req, res) => {
    destroySession(db, config, req, res);
    res.json({ data: { ok: true } });
  });

  r.get('/auth/me', (req, res) => {
    res.json({ data: req.auth?.me ?? null });
  });

  // ---------- Pozvánky (veřejné) ----------

  const findInvite = (token: string) => {
    const inv = db.prepare(
      `SELECT i.id, i.org_id, i.role, i.email, o.name AS org_name FROM invites i JOIN organizations o ON o.id = i.org_id
       WHERE i.token_hash = ? AND i.used_at IS NULL AND i.expires_at > ?`,
    ).get(sha256(token), now()) as { id: string; org_id: string; role: 'owner' | 'recruiter'; email: string | null; org_name: string } | undefined;
    if (!inv) throw new AppError(404, 'invite_invalid', 'Pozvánka neexistuje, už byla použita, nebo vypršela.');
    return inv;
  };

  r.get('/invites/:token', rateLimit(signupLimiter, (req) => `inv:${req.ip}`, tooMany), (req, res) => {
    const inv = findInvite(String(req.params.token));
    res.json({ data: { organizationName: inv.org_name, role: inv.role, email: inv.email } });
  });

  r.post('/invites/:token/accept', rateLimit(signupLimiter, (req) => `inv:${req.ip}`, tooMany), async (req, res) => {
    const inv = findInvite(String(req.params.token));
    const body = parse(z.object({ name: nameSchema, email: emailSchema, password: passwordSchema }), req.body);
    if (inv.email && inv.email !== body.email) {
      throw new AppError(400, 'invite_email', 'Pozvánka je určená pro jiný e-mail.', { email: 'Použijte e-mail, na který pozvánka zní.' });
    }
    if (db.prepare('SELECT 1 FROM users WHERE email = ?').get(body.email)) {
      throw new AppError(409, 'email_taken', 'Účet s tímto e-mailem už existuje. Jeden účet může být zatím jen v jedné organizaci.',
        { email: 'E-mail je už registrovaný.' });
    }
    const hash = await hashPassword(body.password);
    const userId = newId();
    const t = now();
    db.transaction(() => {
      const used = db.prepare('UPDATE invites SET used_at = ? WHERE id = ? AND used_at IS NULL').run(t, inv.id);
      if (used.changes !== 1) throw new AppError(409, 'invite_used', 'Pozvánka už byla použita.');
      db.prepare('INSERT INTO users (id, email, name, password_hash, created_at) VALUES (?, ?, ?, ?, ?)').run(userId, body.email, body.name, hash, t);
      db.prepare('INSERT INTO memberships (org_id, user_id, role, created_at) VALUES (?, ?, ?, ?)').run(inv.org_id, userId, inv.role, t);
      audit(db, { orgId: inv.org_id, actorId: userId, action: 'member.joined', entityType: 'member', entityId: userId });
    })();
    createSession(db, config, res, userId, inv.org_id);
    res.status(201).json({ data: { ok: true } });
  });

  return r;
}
