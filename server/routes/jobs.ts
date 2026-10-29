import { Router } from 'express';
import multer from 'multer';
import { z } from 'zod';
import type { AttentionItem, Dashboard, JobStatus, RequirementSuggestion } from '../../shared/types.js';
import { DECISION_LABEL, JOB_STATUSES, REQUIREMENT_CATEGORIES } from '../../shared/types.js';
import { auth, requireOwner } from '../auth.js';
import { pageParams, type Ctx } from '../context.js';
import { newId, now } from '../db/index.js';
import { AppError, parse } from '../lib/errors.js';
import { RateLimiter, rateLimit } from '../lib/ratelimit.js';
import { deleteJob, listApplications } from '../services/applications.js';
import { audit, listActivity } from '../services/audit.js';
import { quoteInText } from '../services/evidence.js';
import { ExtractionError, extractAdText } from '../services/extract.js';
import { detectFile, UnsupportedFileError } from '../services/filetype.js';
import { getJobRow, replaceRequirements, toDetail, toSummary, type JobRow } from '../services/jobs.js';
import { AiError } from '../services/ai/provider.js';
import { usageFor } from './org.js';

const titleSchema = z.string().trim().min(2, 'Vyplňte název pozice.').max(160, 'Název je příliš dlouhý.');
const adSchema = z.string().trim().min(30, 'Inzerát je příliš krátký, vložte celý text.').max(20_000, 'Inzerát je příliš dlouhý (max. 20 000 znaků).');

const requirementSchema = z.object({
  id: z.string().max(64).nullish(),
  name: z.string().trim().min(2, 'Vyplňte název požadavku.').max(120),
  description: z.string().trim().max(400).default(''),
  category: z.enum(REQUIREMENT_CATEGORIES),
  weight: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  mustHave: z.boolean(),
  origin: z.enum(['ai', 'user']),
  adQuote: z.string().trim().max(400).nullish(),
});

/** Povolené přechody stavu pozice (koncept aktivuje až potvrzení požadavků). */
const TRANSITIONS: Record<JobStatus, JobStatus[]> = {
  draft: ['archived'],
  active: ['closed', 'archived'],
  closed: ['active', 'archived'],
  archived: ['active', 'closed'],
};

export function jobRoutes(ctx: Ctx): Router {
  const r = Router();
  const { db } = ctx;
  const adUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024, files: 1 } });
  const suggestLimiter = new RateLimiter(30, 60 * 60_000);

  // ---------- Přehled ----------

  r.get('/dashboard', (req, res) => {
    const a = auth(req);
    const jobs = db.prepare(`SELECT * FROM jobs WHERE org_id = ? AND status IN ('draft', 'active') ORDER BY updated_at DESC LIMIT 50`).all(a.orgId) as JobRow[];
    const summaries = jobs.map((j) => toSummary(db, j));
    const attention: AttentionItem[] = [];
    for (const j of summaries) {
      if (j.status === 'draft' && !j.requirementsConfirmed) attention.push({ kind: 'unconfirmed', jobId: j.id, jobTitle: j.title, count: 0 });
      if (j.counts.failed) attention.push({ kind: 'failed', jobId: j.id, jobTitle: j.title, count: j.counts.failed });
      if (j.counts.stale) attention.push({ kind: 'stale', jobId: j.id, jobTitle: j.title, count: j.counts.stale });
    }
    const monthStart = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1)).toISOString();
    const totals = db.prepare(
      `SELECT
         (SELECT COUNT(*) FROM jobs WHERE org_id = ? AND status = 'active') AS active_jobs,
         (SELECT COUNT(*) FROM evaluations e JOIN applications ap ON ap.id = e.application_id WHERE ap.org_id = ? AND e.created_at >= ?) AS processed,
         (SELECT COUNT(*) FROM applications WHERE org_id = ? AND status IN ('queued', 'extracting', 'evaluating')) AS processing,
         (SELECT COUNT(*) FROM applications WHERE org_id = ? AND status = 'failed') AS failed`,
    ).get(a.orgId, a.orgId, monthStart, a.orgId, a.orgId) as { active_jobs: number; processed: number; processing: number; failed: number };
    const data: Dashboard = {
      activeJobs: summaries,
      attention,
      activity: listActivity(db, a.orgId, { limit: 8 }),
      totals: { activeJobs: totals.active_jobs, processedThisMonth: totals.processed, processing: totals.processing, failed: totals.failed },
      usage: usageFor(ctx, a.orgId, a.me.organization.isDemo),
    };
    res.json({ data });
  });

  // ---------- Pozice ----------

  r.get('/jobs', (req, res) => {
    const a = auth(req);
    const { page, pageSize } = pageParams(req.query);
    const status = String(req.query.status ?? 'open');
    const q = String(req.query.q ?? '').trim().slice(0, 100);
    const where = ['org_id = ?'];
    const args: Array<string | number> = [a.orgId];
    if (status === 'open') where.push(`status IN ('draft', 'active')`);
    else if ((JOB_STATUSES as readonly string[]).includes(status)) { where.push('status = ?'); args.push(status); }
    else if (status !== 'all') throw new AppError(400, 'bad_filter', 'Neplatný filtr stavu.');
    if (q) { where.push(`title LIKE ? ESCAPE '\\'`); args.push(`%${q.replace(/[\\%_]/g, (m) => `\\${m}`)}%`); }
    const total = (db.prepare(`SELECT COUNT(*) AS n FROM jobs WHERE ${where.join(' AND ')}`).get(...args) as { n: number }).n;
    const rows = db.prepare(`SELECT * FROM jobs WHERE ${where.join(' AND ')} ORDER BY updated_at DESC LIMIT ? OFFSET ?`)
      .all(...args, pageSize, (page - 1) * pageSize) as JobRow[];
    res.json({ data: rows.map((j) => toSummary(db, j)), meta: { page, pageSize, total } });
  });

  r.post('/jobs', (req, res) => {
    const a = auth(req);
    const body = parse(z.object({ title: titleSchema, adText: adSchema }), req.body);
    const id = newId();
    const t = now();
    db.prepare(`INSERT INTO jobs (id, org_id, title, ad_text, status, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, 'draft', ?, ?, ?)`)
      .run(id, a.orgId, body.title, body.adText, a.userId, t, t);
    audit(db, { orgId: a.orgId, actorId: a.userId, action: 'job.created', entityType: 'job', entityId: id, jobId: id });
    res.status(201).json({ data: toDetail(db, getJobRow(db, a.orgId, id)) });
  });

  r.post('/jobs/ad-text', adUpload.single('file'), async (req, res) => {
    auth(req);
    if (!req.file) throw new AppError(400, 'no_file', 'Vyberte soubor s inzerátem.');
    try {
      const kind = detectFile(req.file.originalname, req.file.buffer);
      const text = await extractAdText(kind.kind, req.file.buffer);
      res.json({ data: { text } });
    } catch (err) {
      if (err instanceof UnsupportedFileError || err instanceof ExtractionError) throw new AppError(422, 'unreadable', err.message);
      throw err;
    }
  });

  r.get('/jobs/:id', (req, res) => {
    const a = auth(req);
    res.json({ data: toDetail(db, getJobRow(db, a.orgId, String(req.params.id))) });
  });

  r.patch('/jobs/:id', (req, res) => {
    const a = auth(req);
    const body = parse(z.object({
      title: titleSchema.optional(),
      adText: adSchema.optional(),
      status: z.enum(JOB_STATUSES).optional(),
    }), req.body);
    const job = getJobRow(db, a.orgId, String(req.params.id));
    db.transaction(() => {
      const t = now();
      if (body.title !== undefined || body.adText !== undefined) {
        db.prepare('UPDATE jobs SET title = ?, ad_text = ?, updated_at = ? WHERE id = ?')
          .run(body.title ?? job.title, body.adText ?? job.ad_text, t, job.id);
        audit(db, { orgId: a.orgId, actorId: a.userId, action: 'job.updated', entityType: 'job', entityId: job.id, jobId: job.id,
          meta: { fields: Object.keys(body).filter((k) => k !== 'status') } });
      }
      if (body.status && body.status !== job.status) {
        if (!TRANSITIONS[job.status].includes(body.status)) {
          throw new AppError(409, 'bad_transition', body.status === 'active' && job.status === 'draft'
            ? 'Pozici aktivujete potvrzením požadavků.'
            : 'Tuto změnu stavu nelze provést.');
        }
        const closedAt = body.status === 'closed' || body.status === 'archived' ? (job.closed_at ?? t) : null;
        db.prepare('UPDATE jobs SET status = ?, closed_at = ?, updated_at = ? WHERE id = ?').run(body.status, closedAt, t, job.id);
        audit(db, { orgId: a.orgId, actorId: a.userId, action: 'job.status_changed', entityType: 'job', entityId: job.id, jobId: job.id,
          meta: { from: job.status, to: body.status } });
      }
    })();
    res.json({ data: toDetail(db, getJobRow(db, a.orgId, job.id)) });
  });

  r.delete('/jobs/:id', requireOwner, (req, res) => {
    const a = auth(req);
    deleteJob(db, ctx.storage, a.orgId, String(req.params.id));
    res.json({ data: { ok: true } });
  });

  // ---------- Požadavky ----------

  r.post('/jobs/:id/requirements/suggest',
    rateLimit(suggestLimiter, (req) => `suggest:${req.auth?.orgId}`, 'Příliš mnoho návrhů za hodinu. Zkuste to později.'),
    async (req, res) => {
      const a = auth(req);
      const job = getJobRow(db, a.orgId, String(req.params.id));
      const provider = ctx.providers.forOrg(a.me.organization.isDemo);
      if (!provider) {
        throw new AppError(503, 'ai_not_configured', 'Návrh požadavků vyžaduje AI, která není nastavená. Požadavky přidejte ručně.');
      }
      let result;
      try {
        ({ result } = await provider.suggestRequirements(job.ad_text));
      } catch (err) {
        if (err instanceof AiError) throw new AppError(err.kind === 'transient' ? 503 : 422, err.code, err.message);
        throw err;
      }
      const requirements: RequirementSuggestion[] = result.requirements.map((s) => {
        const sourceFound = Boolean(s.ad_quote) && quoteInText(s.ad_quote, job.ad_text);
        return {
          name: s.name,
          description: s.description,
          category: s.category,
          weight: s.weight,
          // Povinný požadavek bez dohledatelného zdroje v inzerátu nepřijmeme jako povinný
          mustHave: s.must_have && sourceFound,
          origin: 'ai',
          adQuote: s.ad_quote || null,
          sourceFound,
        };
      });
      res.json({ data: { position: result.position, requirements } });
    });

  r.put('/jobs/:id/requirements', (req, res) => {
    const a = auth(req);
    getJobRow(db, a.orgId, String(req.params.id));
    const body = parse(z.object({
      requirements: z.array(requirementSchema).min(1, 'Přidejte aspoň jeden požadavek.').max(20, 'Nejvýš 20 požadavků.'),
    }), req.body);
    const job = replaceRequirements(db, a.orgId, a.userId, String(req.params.id), body.requirements.map((r) => ({
      ...r, description: r.description ?? '', adQuote: r.adQuote ?? null,
    })));
    res.json({ data: toDetail(db, job) });
  });

  r.get('/jobs/:id/activity', (req, res) => {
    const a = auth(req);
    const job = getJobRow(db, a.orgId, String(req.params.id));
    res.json({ data: listActivity(db, a.orgId, { jobId: job.id, limit: 100 }) });
  });

  // ---------- Export ----------

  r.get('/jobs/:id/export.csv', (req, res) => {
    const a = auth(req);
    const job = getJobRow(db, a.orgId, String(req.params.id));
    const { rows } = listApplications(db, a.orgId, job.id, { page: 1, pageSize: 10_000, sort: 'match' });
    const cell = (v: unknown): string => {
      let s = String(v ?? '');
      if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`; // ochrana proti vzorcům v Excelu
      return `"${s.replace(/"/g, '""')}"`;
    };
    const head = ['Pořadí', 'Kandidát', 'Současná pozice', 'Doložená shoda', 'Úplnost', 'Povinné požadavky', 'Splněno', 'Neověřeno', 'Rozhodnutí', 'Soubor', 'Přidáno'];
    const mustText = { met: 'Splněny', unmet: 'Nesplněny', unknown: 'K ověření', none: '' } as const;
    const lines = rows.filter((r) => r.status === 'done').map((r, i) => [
      i + 1, r.candidateName, r.currentRole, r.score, r.coverage, r.mustStatus ? mustText[r.mustStatus] : '',
      r.metCount !== null ? `${r.metCount}/${r.requirementCount}` : '', r.unverifiedCount,
      r.decision ? DECISION_LABEL[r.decision] : '', r.fileName, r.createdAt.slice(0, 10),
    ]);
    const csv = '﻿' + [head, ...lines].map((l) => l.map(cell).join(';')).join('\r\n');
    const fname = `sitko-${job.title.normalize('NFD').replace(/[^\w-]+/g, '-').replace(/-+/g, '-').slice(0, 60)}.csv`;
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${fname}"`);
    res.send(csv);
  });

  return r;
}

