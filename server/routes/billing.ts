import { Router } from 'express';
import { z } from 'zod';
import type { BillingInfo, Plan, SubscriptionOverview } from '../../shared/types.js';
import { auth, requireOwner } from '../auth.js';
import type { Ctx } from '../context.js';
import { now } from '../db/index.js';
import { AppError, parse } from '../lib/errors.js';
import { audit } from '../services/audit.js';
import {
  billingFromRow, loadSubscription, monthEvaluations, planFromRow, type BillingRow, type PlanRow,
} from '../services/subscription.js';

// Předplatné z pohledu firmy: přehled, fakturační údaje, objednávka tarifu.
// Aktivaci po zaplacení dělá provozovatel ve Správě (routes/admin.ts).

export const billingSchema = z.object({
  name: z.string().trim().max(200),
  ico: z.string().trim().max(20).refine((v) => v === '' || /^\d{8}$/.test(v.replace(/\s/g, '')), 'IČO má 8 číslic.')
    .transform((v) => v.replace(/\s/g, '')),
  dic: z.string().trim().max(20),
  address: z.string().trim().max(500),
  email: z.union([z.literal(''), z.string().trim().toLowerCase().pipe(z.email('Zadejte platný e-mail.')).pipe(z.string().max(200))]),
});

const BILLING_COLS = 'billing_name, billing_ico, billing_dic, billing_address, billing_email';

export function publicPlans(ctx: Ctx): Plan[] {
  return (ctx.db.prepare('SELECT * FROM plans WHERE is_public = 1 ORDER BY position, monthly_cv_limit').all() as PlanRow[]).map(planFromRow);
}

export function billingRoutes(ctx: Ctx): Router {
  const r = Router();
  const { db, config } = ctx;

  const overview = (orgId: string): SubscriptionOverview => ({
    subscription: loadSubscription(db, config, orgId),
    plans: publicPlans(ctx),
    billing: billingFromRow(db.prepare(`SELECT ${BILLING_COLS} FROM organizations WHERE id = ?`).get(orgId) as BillingRow),
    contact: config.billingContact,
    monthEvaluations: monthEvaluations(db, orgId),
  });

  r.get('/organization/subscription', (req, res) => {
    res.json({ data: overview(auth(req).orgId) });
  });

  r.put('/organization/billing', requireOwner, (req, res) => {
    const a = auth(req);
    const b: BillingInfo = parse(billingSchema, req.body);
    db.prepare(`UPDATE organizations SET billing_name = ?, billing_ico = ?, billing_dic = ?, billing_address = ?, billing_email = ? WHERE id = ?`)
      .run(b.name, b.ico, b.dic, b.address, b.email, a.orgId);
    audit(db, { orgId: a.orgId, actorId: a.userId, action: 'billing.updated', entityType: 'organization', entityId: a.orgId });
    res.json({ data: overview(a.orgId) });
  });

  /** Objednávka tarifu: provozovatel ji uvidí ve Správě a pošle fakturu. */
  r.post('/organization/subscription/order', requireOwner, (req, res) => {
    const a = auth(req);
    if (!config.subscriptions || a.me.organization.isDemo) {
      throw new AppError(409, 'subscriptions_disabled', 'Na tomto serveru se předplatné neobjednává.');
    }
    const body = parse(z.object({ planId: z.string().max(64) }), req.body);
    const plan = db.prepare('SELECT * FROM plans WHERE id = ? AND is_public = 1').get(body.planId) as PlanRow | undefined;
    if (!plan) throw new AppError(404, 'not_found', 'Tarif nenalezen.');
    const b = billingFromRow(db.prepare(`SELECT ${BILLING_COLS} FROM organizations WHERE id = ?`).get(a.orgId) as BillingRow);
    const missing: Record<string, string> = {};
    if (!b.name) missing.name = 'Vyplňte název firmy pro fakturu.';
    if (!b.address) missing.address = 'Vyplňte adresu.';
    if (!b.email) missing.email = 'Vyplňte e-mail pro faktury.';
    if (Object.keys(missing).length) {
      throw new AppError(400, 'billing_incomplete', 'Před objednáním vyplňte fakturační údaje.', missing);
    }
    db.prepare('UPDATE organizations SET requested_plan_id = ?, requested_at = ? WHERE id = ?').run(plan.id, now(), a.orgId);
    audit(db, { orgId: a.orgId, actorId: a.userId, action: 'subscription.ordered', entityType: 'organization', entityId: a.orgId, meta: { planId: plan.id } });
    res.status(201).json({ data: overview(a.orgId) });
  });

  r.delete('/organization/subscription/order', requireOwner, (req, res) => {
    const a = auth(req);
    db.prepare('UPDATE organizations SET requested_plan_id = NULL, requested_at = NULL WHERE id = ?').run(a.orgId);
    audit(db, { orgId: a.orgId, actorId: a.userId, action: 'subscription.order_cancelled', entityType: 'organization', entityId: a.orgId });
    res.json({ data: overview(a.orgId) });
  });

  return r;
}
