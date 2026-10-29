import { Router } from 'express';
import { z } from 'zod';
import type { Invite, Member, Usage } from '../../shared/types.js';
import { ROLES } from '../../shared/types.js';
import { auth, requireOwner } from '../auth.js';
import type { Ctx } from '../context.js';
import { newId, now, type DB } from '../db/index.js';
import { AppError, notFound, parse } from '../lib/errors.js';
import { hashPassword, newToken, verifyPassword } from '../lib/security.js';
import { audit } from '../services/audit.js';
import { SUPPORTED_FORMATS } from '../services/filetype.js';
import { passwordSchema } from './auth.js';

export function usageFor(ctx: Ctx, orgId: string, isDemo: boolean): Usage {
  const monthStart = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1)).toISOString();
  const u = ctx.db.prepare(
    `SELECT COUNT(*) AS n, COALESCE(SUM(e.input_tokens), 0) AS inp, COALESCE(SUM(e.output_tokens), 0) AS outp
     FROM evaluations e JOIN applications a ON a.id = e.application_id
     WHERE a.org_id = ? AND e.source = 'ai' AND e.created_at >= ?`,
  ).get(orgId, monthStart) as { n: number; inp: number; outp: number };
  const provider = ctx.providers.forOrg(isDemo);
  return {
    aiConfigured: Boolean(provider),
    model: provider?.model ?? null,
    monthEvaluations: u.n,
    monthlyLimit: ctx.config.ai.monthlyLimit,
    monthInputTokens: u.inp,
    monthOutputTokens: u.outp,
    maxFileMb: ctx.config.upload.maxFileMb,
    supportedFormats: SUPPORTED_FORMATS,
  };
}

const ownerCount = (db: DB, orgId: string): number =>
  (db.prepare(`SELECT COUNT(*) AS n FROM memberships WHERE org_id = ? AND role = 'owner'`).get(orgId) as { n: number }).n;

export function orgRoutes(ctx: Ctx): Router {
  const r = Router();
  const { db, config } = ctx;

  r.patch('/me', (req, res) => {
    const a = auth(req);
    const body = parse(z.object({ name: z.string().trim().min(1, 'Vyplňte jméno.').max(120) }), req.body);
    db.prepare('UPDATE users SET name = ? WHERE id = ?').run(body.name, a.userId);
    res.json({ data: { ...a.me, user: { ...a.me.user, name: body.name } } });
  });

  r.post('/me/password', async (req, res) => {
    const a = auth(req);
    const body = parse(z.object({ currentPassword: z.string().min(1, 'Zadejte současné heslo.'), newPassword: passwordSchema }), req.body);
    const u = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(a.userId) as { password_hash: string };
    if (!(await verifyPassword(body.currentPassword, u.password_hash))) {
      throw new AppError(400, 'bad_password', 'Současné heslo nesedí.', { currentPassword: 'Současné heslo nesedí.' });
    }
    const hash = await hashPassword(body.newPassword);
    db.transaction(() => {
      db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hash, a.userId);
      db.prepare('DELETE FROM sessions WHERE user_id = ? AND id != ?').run(a.userId, a.sessionId);
    })();
    res.json({ data: { ok: true } });
  });

  r.patch('/organization', requireOwner, (req, res) => {
    const a = auth(req);
    const body = parse(z.object({
      name: z.string().trim().min(2, 'Vyplňte název.').max(120).optional(),
      retentionDays: z.number().int().min(30, 'Nejméně 30 dní.').max(3650, 'Nejvýš 3650 dní.').optional(),
    }), req.body);
    if (body.name !== undefined) db.prepare('UPDATE organizations SET name = ? WHERE id = ?').run(body.name, a.orgId);
    if (body.retentionDays !== undefined) db.prepare('UPDATE organizations SET retention_days = ? WHERE id = ?').run(body.retentionDays, a.orgId);
    audit(db, { orgId: a.orgId, actorId: a.userId, action: 'organization.updated', entityType: 'organization', entityId: a.orgId,
      meta: { fields: Object.keys(body) } });
    const o = db.prepare('SELECT name, retention_days FROM organizations WHERE id = ?').get(a.orgId) as { name: string; retention_days: number };
    res.json({ data: { ...a.me.organization, name: o.name, retentionDays: o.retention_days } });
  });

  r.get('/organization/usage', (req, res) => {
    const a = auth(req);
    res.json({ data: usageFor(ctx, a.orgId, a.me.organization.isDemo) });
  });

  // ---------- Tým ----------

  r.get('/organization/members', (req, res) => {
    const a = auth(req);
    const rows = db.prepare(
      `SELECT u.id, u.name, u.email, m.role, m.created_at FROM memberships m JOIN users u ON u.id = m.user_id
       WHERE m.org_id = ? ORDER BY m.created_at`,
    ).all(a.orgId) as Array<{ id: string; name: string; email: string; role: 'owner' | 'recruiter'; created_at: string }>;
    const data: Member[] = rows.map((m) => ({ userId: m.id, name: m.name, email: m.email, role: m.role, joinedAt: m.created_at, isYou: m.id === a.userId }));
    res.json({ data });
  });

  r.patch('/organization/members/:userId', requireOwner, (req, res) => {
    const a = auth(req);
    const body = parse(z.object({ role: z.enum(ROLES) }), req.body);
    const userId = String(req.params.userId);
    db.transaction(() => {
      const m = db.prepare('SELECT role FROM memberships WHERE org_id = ? AND user_id = ?').get(a.orgId, userId) as { role: string } | undefined;
      if (!m) throw notFound('Člen týmu');
      if (m.role === 'owner' && body.role !== 'owner' && ownerCount(db, a.orgId) <= 1) {
        throw new AppError(409, 'last_owner', 'Organizace musí mít aspoň jednoho vlastníka.');
      }
      db.prepare('UPDATE memberships SET role = ? WHERE org_id = ? AND user_id = ?').run(body.role, a.orgId, userId);
      audit(db, { orgId: a.orgId, actorId: a.userId, action: 'member.role_changed', entityType: 'member', entityId: userId, meta: { role: body.role } });
    })();
    res.json({ data: { ok: true } });
  });

  r.delete('/organization/members/:userId', requireOwner, (req, res) => {
    const a = auth(req);
    const userId = String(req.params.userId);
    db.transaction(() => {
      const m = db.prepare('SELECT role FROM memberships WHERE org_id = ? AND user_id = ?').get(a.orgId, userId) as { role: string } | undefined;
      if (!m) throw notFound('Člen týmu');
      if (m.role === 'owner' && ownerCount(db, a.orgId) <= 1) {
        throw new AppError(409, 'last_owner', 'Organizace musí mít aspoň jednoho vlastníka.');
      }
      db.prepare('DELETE FROM memberships WHERE org_id = ? AND user_id = ?').run(a.orgId, userId);
      db.prepare('DELETE FROM sessions WHERE user_id = ? AND org_id = ?').run(userId, a.orgId);
      // Účet je vázaný na jednu organizaci: bez členství ho smažeme (poznámky zůstanou bez autora)
      if (!db.prepare('SELECT 1 FROM memberships WHERE user_id = ?').get(userId)) db.prepare('DELETE FROM users WHERE id = ?').run(userId);
      audit(db, { orgId: a.orgId, actorId: a.userId, action: 'member.removed', entityType: 'member', entityId: userId });
    })();
    res.json({ data: { ok: true } });
  });

  r.get('/organization/invites', requireOwner, (req, res) => {
    const a = auth(req);
    const rows = db.prepare(
      'SELECT id, role, email, created_at, expires_at FROM invites WHERE org_id = ? AND used_at IS NULL AND expires_at > ? ORDER BY created_at DESC',
    ).all(a.orgId, now()) as Array<{ id: string; role: 'owner' | 'recruiter'; email: string | null; created_at: string; expires_at: string }>;
    const data: Invite[] = rows.map((i) => ({ id: i.id, role: i.role, email: i.email, createdAt: i.created_at, expiresAt: i.expires_at }));
    res.json({ data });
  });

  r.post('/organization/invites', requireOwner, (req, res) => {
    const a = auth(req);
    const body = parse(z.object({
      role: z.enum(ROLES),
      email: z.union([z.literal(''), z.string().trim().toLowerCase().pipe(z.email('Zadejte platný e-mail.'))]).optional(),
    }), req.body);
    const { token, hash } = newToken();
    const id = newId();
    const t = now();
    const expires = new Date(Date.now() + 7 * 86_400_000).toISOString();
    db.prepare('INSERT INTO invites (id, org_id, token_hash, role, email, created_by, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run(id, a.orgId, hash, body.role, body.email || null, a.userId, t, expires);
    audit(db, { orgId: a.orgId, actorId: a.userId, action: 'member.invited', entityType: 'invite', entityId: id, meta: { role: body.role } });
    const base = config.publicUrl ?? `${req.protocol}://${req.get('host')}`;
    const data: Invite = { id, role: body.role, email: body.email || null, createdAt: t, expiresAt: expires, url: `${base}/pozvanka/${token}` };
    res.status(201).json({ data });
  });

  r.delete('/organization/invites/:id', requireOwner, (req, res) => {
    const a = auth(req);
    const r2 = db.prepare('DELETE FROM invites WHERE id = ? AND org_id = ?').run(String(req.params.id), a.orgId);
    if (!r2.changes) throw notFound('Pozvánka');
    res.json({ data: { ok: true } });
  });

  return r;
}
