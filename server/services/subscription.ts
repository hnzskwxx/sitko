import type { BillingInfo, Plan, Subscription } from '../../shared/types.js';
import type { Config } from '../config.js';
import { bool, type DB } from '../db/index.js';
import { AppError } from '../lib/errors.js';

// Placené členství. Firma platí fakturou, provozovatel ve Správě nastaví tarif a datum,
// do kdy má zaplaceno. Bez aktivního předplatného firma vidí svá data, ale AI nepoužije.

/** Dnešní datum v Česku jako YYYY-MM-DD (předplatné platí do konce uvedeného dne). */
export function todayLocal(at = new Date()): string {
  return at.toLocaleDateString('sv-SE', { timeZone: 'Europe/Prague' });
}

/** Počet dní mezi dvěma daty YYYY-MM-DD. */
export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

/** Sloupce organizace potřebné pro výpočet stavu (sessionLoader je načítá rovnou v jednom dotazu). */
export interface SubscriptionRow {
  is_demo: number;
  plan_id: string | null;
  plan_name: string | null;
  plan_limit: number | null;
  paid_until: string | null;
  requested_plan_id: string | null;
  requested_plan_name: string | null;
  requested_at: string | null;
}

export const SUBSCRIPTION_SELECT = `
  o.is_demo, o.plan_id, p.name AS plan_name, p.monthly_cv_limit AS plan_limit, o.paid_until,
  o.requested_plan_id, rp.name AS requested_plan_name, o.requested_at`;
export const SUBSCRIPTION_JOIN = `
  LEFT JOIN plans p ON p.id = o.plan_id
  LEFT JOIN plans rp ON rp.id = o.requested_plan_id`;

export function computeSubscription(row: SubscriptionRow, config: Config, today = todayLocal()): Subscription {
  const plan = row.plan_id && row.plan_name ? { id: row.plan_id, name: row.plan_name } : null;
  const requestedPlan = row.requested_plan_id && row.requested_plan_name ? { id: row.requested_plan_id, name: row.requested_plan_name } : null;
  const base = {
    enabled: config.subscriptions,
    plan,
    paidUntil: row.paid_until,
    daysLeft: row.paid_until ? daysBetween(today, row.paid_until) : null,
    requestedPlan,
    requestedAt: row.requested_at,
  };
  if (bool(row.is_demo)) {
    // Ukázka nikdy nevolá skutečnou AI, nic nestojí
    return { ...base, enabled: config.subscriptions, status: 'demo', canEvaluate: true, monthlyLimit: config.ai.monthlyLimit };
  }
  if (!config.subscriptions) {
    return { ...base, status: 'unlimited', canEvaluate: true, monthlyLimit: config.ai.monthlyLimit };
  }
  const active = Boolean(plan && row.paid_until && row.paid_until >= today);
  if (active) return { ...base, status: 'active', canEvaluate: true, monthlyLimit: row.plan_limit ?? 0 };
  return { ...base, status: row.paid_until ? 'expired' : 'pending', canEvaluate: false, monthlyLimit: row.plan_limit ?? 0 };
}

export function loadSubscription(db: DB, config: Config, orgId: string): Subscription {
  const row = db.prepare(`SELECT ${SUBSCRIPTION_SELECT} FROM organizations o ${SUBSCRIPTION_JOIN} WHERE o.id = ?`).get(orgId) as SubscriptionRow | undefined;
  if (!row) throw new AppError(404, 'not_found', 'Organizace nenalezena.');
  return computeSubscription(row, config);
}

export function inactiveMessage(sub: Subscription, contact: string | null): string {
  const reach = contact ? ` Kontakt: ${contact}.` : '';
  if (sub.status === 'expired') {
    return `Předplatné vypršelo, hodnocení životopisů je pozastavené. Prodlužte ho v Nastavení → Předplatné.${reach}`;
  }
  return `Předplatné ještě není aktivní. Vyberte tarif v Nastavení → Předplatné, po zaplacení faktury se hodnocení zapne.${reach}`;
}

/** Vyhodí 402, když firma nesmí používat AI. Volá se před každou akcí, která AI spouští. */
export function assertCanUseAi(db: DB, config: Config, orgId: string): Subscription {
  const sub = loadSubscription(db, config, orgId);
  if (!sub.canEvaluate) throw new AppError(402, 'subscription_inactive', inactiveMessage(sub, config.billingContact));
  return sub;
}

/** Hodnocení skutečnou AI v aktuálním kalendářním měsíci. */
export function monthEvaluations(db: DB, orgId: string): number {
  const monthStart = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1)).toISOString();
  return (db.prepare(
    `SELECT COUNT(*) AS n FROM evaluations e JOIN applications a ON a.id = e.application_id
     WHERE a.org_id = ? AND e.source = 'ai' AND e.created_at >= ?`,
  ).get(orgId, monthStart) as { n: number }).n;
}

/** Pro frontu: smí se teď pro firmu hodnotit, a s jakým limitem. */
export type Quota = { ok: true; limit: number } | { ok: false; code: string; message: string };

export function quotaFor(db: DB, config: Config, orgId: string): Quota {
  const sub = loadSubscription(db, config, orgId);
  if (!sub.canEvaluate) return { ok: false, code: 'subscription_inactive', message: inactiveMessage(sub, config.billingContact) };
  return { ok: true, limit: sub.monthlyLimit };
}

// ---------- Převody řádků ----------

export interface PlanRow {
  id: string; name: string; monthly_cv_limit: number; price_czk: number | null; is_public: number; position: number; orgs?: number;
}
export const planFromRow = (r: PlanRow): Plan => ({
  id: r.id, name: r.name, monthlyCvLimit: r.monthly_cv_limit, priceCzk: r.price_czk, isPublic: bool(r.is_public), position: r.position,
  ...(r.orgs !== undefined ? { organizations: r.orgs } : {}),
});

export interface BillingRow { billing_name: string; billing_ico: string; billing_dic: string; billing_address: string; billing_email: string }
export const billingFromRow = (r: BillingRow): BillingInfo => ({
  name: r.billing_name, ico: r.billing_ico, dic: r.billing_dic, address: r.billing_address, email: r.billing_email,
});
