import { Router } from 'express';
import { z } from 'zod';
import type { AdminOrgDetail, AdminOrgRow, Plan } from '../../shared/types.js';
import { auth, requirePlatformAdmin } from '../auth.js';
import type { Ctx } from '../context.js';
import { newId, now } from '../db/index.js';
import { AppError, notFound, parse } from '../lib/errors.js';
import { audit } from '../services/audit.js';
import {
  billingFromRow, computeSubscription, monthEvaluations, planFromRow, SUBSCRIPTION_JOIN, SUBSCRIPTION_SELECT,
  type BillingRow, type PlanRow, type SubscriptionRow,
} from '../services/subscription.js';

// Správa Sítka pro provozovatele (ADMIN_EMAILS). Vidí firmy, jejich tarif a fakturační údaje,
// NE kandidáty, životopisy ani pozice: k těm přístup nepotřebuje a nemá ho mít.

type OrgRow = SubscriptionRow & {
  id: string; name: string; created_at: string; members: number; owner_name: string | null; owner_email: string | null;
};

const ORG_SELECT = `
  SELECT o.id, o.name, o.created_at, ${SUBSCRIPTION_SELECT},
         (SELECT COUNT(*) FROM memberships m WHERE m.org_id = o.id) AS members,
         (SELECT u.name FROM memberships m JOIN users u ON u.id = m.user_id
           WHERE m.org_id = o.id AND m.role = 'owner' ORDER BY m.created_at LIMIT 1) AS owner_name,
         (SELECT u.email FROM memberships m JOIN users u ON u.id = m.user_id
           WHERE m.org_id = o.id AND m.role = 'owner' ORDER BY m.created_at LIMIT 1) AS owner_email
    FROM organizations o ${SUBSCRIPTION_JOIN}`;

const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Datum ve tvaru RRRR-MM-DD.')
  .refine((v) => !Number.isNaN(Date.parse(`${v}T00:00:00Z`)), 'Neplatné datum.');

const planSchema = z.object({
  name: z.string().trim().min(1, 'Vyplňte název.').max(60),
  monthlyCvLimit: z.number().int('Celé číslo.').min(1, 'Aspoň 1.').max(100_000, 'Nejvýš 100 000.'),
  priceCzk: z.number().int('Celé číslo.').min(0, 'Nejméně 0.').max(10_000_000).nullable(),
  isPublic: z.boolean(),
  position: z.number().int().min(0).max(1000).optional(),
});

export function adminRoutes(ctx: Ctx): Router {
  const r = Router();
  const { db, config } = ctx;
  r.use('/admin', requirePlatformAdmin(config));

  const toRow = (o: OrgRow, used: number): AdminOrgRow => ({
    id: o.id,
    name: o.name,
    createdAt: o.created_at,
    owner: o.owner_email ? { name: o.owner_name ?? '', email: o.owner_email } : null,
    members: o.members,
    subscription: computeSubscription(o, config),
    monthEvaluations: used,
  });

  const detail = (id: string): AdminOrgDetail => {
    const o = db.prepare(`${ORG_SELECT} WHERE o.id = ? AND o.is_demo = 0`).get(id) as (OrgRow & BillingRow & { admin_note: string }) | undefined;
    if (!o) throw notFound('Firma');
    const extra = db.prepare(`SELECT o.admin_note, o.billing_name, o.billing_ico, o.billing_dic, o.billing_address, o.billing_email,
        (SELECT COUNT(*) FROM jobs j WHERE j.org_id = o.id) AS jobs,
        (SELECT COUNT(*) FROM candidates c WHERE c.org_id = o.id) AS candidates,
        (SELECT MAX(created_at) FROM audit_logs l WHERE l.org_id = o.id) AS last_activity
      FROM organizations o WHERE o.id = ?`).get(id) as BillingRow & { admin_note: string; jobs: number; candidates: number; last_activity: string | null };
    return {
      ...toRow(o, monthEvaluations(db, id)),
      billing: billingFromRow(extra),
      adminNote: extra.admin_note,
      jobs: extra.jobs,
      candidates: extra.candidates,
      lastActivityAt: extra.last_activity,
    };
  };

  r.get('/admin/organizations', (_req, res) => {
    const rows = db.prepare(`${ORG_SELECT} WHERE o.is_demo = 0
      ORDER BY (o.requested_at IS NOT NULL) DESC, o.requested_at DESC, o.created_at DESC LIMIT 2000`).all() as OrgRow[];
    const monthStart = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1)).toISOString();
    const usage = new Map((db.prepare(`SELECT a.org_id, COUNT(*) AS n FROM evaluations e JOIN applications a ON a.id = e.application_id
      WHERE e.source = 'ai' AND e.created_at >= ? GROUP BY a.org_id`).all(monthStart) as Array<{ org_id: string; n: number }>)
      .map((u) => [u.org_id, u.n]));
    res.json({ data: rows.map((o) => toRow(o, usage.get(o.id) ?? 0)) });
  });

  r.get('/admin/organizations/:id', (req, res) => {
    res.json({ data: detail(String(req.params.id)) });
  });

  /** Aktivace a změny předplatného (po zaplacení faktury), interní poznámka. */
  r.patch('/admin/organizations/:id', (req, res) => {
    const a = auth(req);
    const id = String(req.params.id);
    const before = detail(id);
    const body = parse(z.object({
      planId: z.string().max(64).nullable().optional(),
      paidUntil: dateSchema.nullable().optional(),
      adminNote: z.string().max(2000).optional(),
    }), req.body);
    const planId = body.planId === undefined ? before.subscription.plan?.id ?? null : body.planId;
    if (planId && !db.prepare('SELECT 1 FROM plans WHERE id = ?').get(planId)) throw new AppError(404, 'not_found', 'Tarif nenalezen.');
    const paidUntil = body.paidUntil === undefined ? before.subscription.paidUntil : body.paidUntil;
    if (paidUntil && !planId) throw new AppError(400, 'plan_required', 'Nejdřív vyberte tarif.', { planId: 'Vyberte tarif.' });

    db.transaction(() => {
      db.prepare('UPDATE organizations SET plan_id = ?, paid_until = ? WHERE id = ?').run(planId, paidUntil, id);
      if (body.adminNote !== undefined) db.prepare('UPDATE organizations SET admin_note = ? WHERE id = ?').run(body.adminNote.trim(), id);
      // Vyřízená objednávka: firma dostala tarif, o který žádala
      if (planId && paidUntil && planId === before.subscription.requestedPlan?.id) {
        db.prepare('UPDATE organizations SET requested_plan_id = NULL, requested_at = NULL WHERE id = ?').run(id);
      }
      audit(db, { orgId: id, actorId: a.userId, action: 'subscription.updated_by_operator', entityType: 'organization', entityId: id,
        meta: { planId, paidUntil } });
    })();
    res.json({ data: detail(id) });
  });

  // ---------- Tarify ----------

  const plans = (): Plan[] => (db.prepare(`SELECT p.*, (SELECT COUNT(*) FROM organizations o WHERE o.plan_id = p.id) AS orgs
    FROM plans p ORDER BY p.position, p.monthly_cv_limit`).all() as PlanRow[]).map(planFromRow);

  r.get('/admin/plans', (_req, res) => { res.json({ data: plans() }); });

  r.post('/admin/plans', (req, res) => {
    const b = parse(planSchema, req.body);
    const t = now();
    const position = b.position ?? ((db.prepare('SELECT COALESCE(MAX(position), 0) + 1 AS n FROM plans').get() as { n: number }).n);
    db.prepare(`INSERT INTO plans (id, name, monthly_cv_limit, price_czk, is_public, position, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(newId(), b.name, b.monthlyCvLimit, b.priceCzk, b.isPublic, position, t, t);
    res.status(201).json({ data: plans() });
  });

  r.patch('/admin/plans/:id', (req, res) => {
    const id = String(req.params.id);
    if (!db.prepare('SELECT 1 FROM plans WHERE id = ?').get(id)) throw notFound('Tarif');
    const b = parse(planSchema, req.body);
    db.prepare(`UPDATE plans SET name = ?, monthly_cv_limit = ?, price_czk = ?, is_public = ?, position = COALESCE(?, position), updated_at = ? WHERE id = ?`)
      .run(b.name, b.monthlyCvLimit, b.priceCzk, b.isPublic, b.position ?? null, now(), id);
    res.json({ data: plans() });
  });

  r.delete('/admin/plans/:id', (req, res) => {
    const id = String(req.params.id);
    if (!db.prepare('SELECT 1 FROM plans WHERE id = ?').get(id)) throw notFound('Tarif');
    if (db.prepare('SELECT 1 FROM organizations WHERE plan_id = ? OR requested_plan_id = ? LIMIT 1').get(id, id)) {
      throw new AppError(409, 'plan_in_use', 'Tarif má nebo objednává některá firma. Místo smazání ho přestaňte nabízet.');
    }
    db.prepare('DELETE FROM plans WHERE id = ?').run(id);
    res.json({ data: plans() });
  });

  return r;
}
