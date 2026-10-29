import type { JobCounts, JobDetail, JobStatus, JobSummary, Requirement, RequirementCategory, Weight } from '../../shared/types.js';
import { bool, newId, now, type DB } from '../db/index.js';
import { notFound } from '../lib/errors.js';
import { audit } from './audit.js';

export interface JobRow {
  id: string; org_id: string; title: string; ad_text: string; status: JobStatus;
  requirements_version: number; requirements_confirmed_at: string | null; closed_at: string | null;
  created_at: string; updated_at: string;
}

interface RequirementRow {
  id: string; name: string; description: string; category: RequirementCategory; weight: Weight;
  must_have: number; origin: 'ai' | 'user'; ad_quote: string | null; position: number;
}

/** Načte pozici jen v rámci organizace; cizí ID = 404. */
export function getJobRow(db: DB, orgId: string, jobId: string): JobRow {
  const row = db.prepare('SELECT * FROM jobs WHERE id = ? AND org_id = ?').get(jobId, orgId) as JobRow | undefined;
  if (!row) throw notFound('Pozice');
  return row;
}

const COUNTS_SQL = `
  SELECT
    COUNT(*) AS total,
    SUM(a.status IN ('queued', 'extracting', 'evaluating')) AS processing,
    SUM(a.status = 'failed') AS failed,
    SUM(a.status = 'done') AS done,
    SUM(a.status = 'done' AND a.decision IS NULL) AS undecided,
    SUM(a.status = 'done' AND (SELECT e.requirements_version FROM evaluations e WHERE e.application_id = a.id
        ORDER BY e.version DESC LIMIT 1) < j.requirements_version) AS stale
  FROM applications a JOIN jobs j ON j.id = a.job_id
  WHERE a.job_id = ?`;

export function jobCounts(db: DB, jobId: string): JobCounts {
  const r = db.prepare(COUNTS_SQL).get(jobId) as Record<string, number | null>;
  return {
    total: r.total ?? 0, processing: r.processing ?? 0, failed: r.failed ?? 0,
    done: r.done ?? 0, stale: r.stale ?? 0, undecided: r.undecided ?? 0,
  };
}

export function toSummary(db: DB, row: JobRow): JobSummary {
  return {
    id: row.id,
    title: row.title,
    status: row.status,
    requirementsConfirmed: Boolean(row.requirements_confirmed_at),
    counts: jobCounts(db, row.id),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function listRequirements(db: DB, jobId: string): Requirement[] {
  const rows = db.prepare('SELECT * FROM job_requirements WHERE job_id = ? ORDER BY position').all(jobId) as RequirementRow[];
  return rows.map((r) => ({
    id: r.id, name: r.name, description: r.description, category: r.category, weight: r.weight,
    mustHave: bool(r.must_have), origin: r.origin, adQuote: r.ad_quote,
  }));
}

export function toDetail(db: DB, row: JobRow): JobDetail {
  return { ...toSummary(db, row), adText: row.ad_text, requirementsVersion: row.requirements_version, requirements: listRequirements(db, row.id) };
}

export interface RequirementInput {
  id?: string | null;
  name: string;
  description: string;
  category: RequirementCategory;
  weight: Weight;
  mustHave: boolean;
  origin: 'ai' | 'user';
  adQuote?: string | null;
}

/**
 * Nahradí sadu požadavků pozice a potvrdí ji. Zachová ID existujících požadavků
 * (kvůli vazbám na hodnocení), zvýší verzi a koncept aktivuje.
 */
export function replaceRequirements(db: DB, orgId: string, actorId: string, jobId: string, input: RequirementInput[]): JobRow {
  return db.transaction(() => {
    const job = getJobRow(db, orgId, jobId);
    const existing = new Map(listRequirements(db, jobId).map((r) => [r.id, r]));
    const t = now();
    const keep = new Set<string>();
    const upd = db.prepare(`UPDATE job_requirements SET position = ?, name = ?, description = ?, category = ?, weight = ?,
      must_have = ?, origin = ?, ad_quote = ?, updated_at = ? WHERE id = ? AND job_id = ?`);
    const ins = db.prepare(`INSERT INTO job_requirements (id, job_id, position, name, description, category, weight, must_have,
      origin, ad_quote, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);

    let changed = existing.size !== input.length;
    input.forEach((r, i) => {
      const prev = r.id ? existing.get(r.id) : undefined;
      if (prev) {
        keep.add(prev.id);
        if (prev.name !== r.name || prev.description !== r.description || prev.weight !== r.weight
          || prev.mustHave !== r.mustHave || prev.category !== r.category) changed = true;
        upd.run(i, r.name, r.description, r.category, r.weight, r.mustHave ? 1 : 0, prev.origin, prev.adQuote, t, prev.id, jobId);
      } else {
        changed = true;
        ins.run(newId(), jobId, i, r.name, r.description, r.category, r.weight, r.mustHave ? 1 : 0, r.origin, r.adQuote ?? null, t, t);
      }
    });
    for (const id of existing.keys()) {
      if (!keep.has(id)) db.prepare('DELETE FROM job_requirements WHERE id = ? AND job_id = ?').run(id, jobId);
    }

    const version = changed || !job.requirements_confirmed_at ? job.requirements_version + 1 : job.requirements_version;
    const status: JobStatus = job.status === 'draft' ? 'active' : job.status;
    db.prepare(`UPDATE jobs SET requirements_version = ?, requirements_confirmed_at = ?, status = ?, updated_at = ? WHERE id = ?`)
      .run(version, t, status, t, jobId);
    audit(db, { orgId, actorId, action: 'job.requirements_confirmed', entityType: 'job', entityId: jobId, jobId, meta: { count: input.length, version } });
    if (status !== job.status) {
      audit(db, { orgId, actorId, action: 'job.status_changed', entityType: 'job', entityId: jobId, jobId, meta: { from: job.status, to: status } });
    }
    return getJobRow(db, orgId, jobId);
  })();
}
