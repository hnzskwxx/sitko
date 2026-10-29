import { Router } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { DECISIONS, VERDICTS, type DocumentText } from '../../shared/types.js';
import { auth } from '../auth.js';
import { pageParams, type Ctx } from '../context.js';
import { newId, now } from '../db/index.js';
import { AppError, notFound, parse } from '../lib/errors.js';
import { RateLimiter, rateLimit } from '../lib/ratelimit.js';
import {
  deleteApplication, documentPages, eraseCandidate, getApplicationDetail, getApplicationRow, ingestFiles, listApplications,
} from '../services/applications.js';
import { audit } from '../services/audit.js';
import { recomputeEvaluation, setOverride } from '../services/evaluations.js';
import { getJobRow } from '../services/jobs.js';
import { requeue } from '../services/queue.js';
import { assertCanUseAi } from '../services/subscription.js';

export function applicationRoutes(ctx: Ctx): Router {
  const r = Router();
  const { db, storage, queue } = ctx;
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: ctx.config.upload.maxFileMb * 1024 * 1024, files: ctx.config.upload.maxFiles },
  });
  const uploadLimiter = new RateLimiter(60, 60 * 60_000);

  r.get('/jobs/:id/applications', (req, res) => {
    const a = auth(req);
    const q = parse(z.object({
      q: z.string().trim().max(100).optional(),
      decision: z.enum(['none', ...DECISIONS]).optional(),
      must: z.enum(['met', 'unmet', 'unknown']).optional(),
      status: z.enum(['processing', 'failed', 'done']).optional(),
      sort: z.enum(['match', 'name', 'created', 'coverage']).optional(),
      dir: z.enum(['asc', 'desc']).optional(),
    }), Object.fromEntries(Object.entries(req.query).filter(([, v]) => v !== '' && v !== undefined)));
    const { page, pageSize } = pageParams(req.query);
    const { rows, total } = listApplications(db, a.orgId, String(req.params.id), { ...q, page, pageSize });
    res.json({ data: rows, meta: { page, pageSize, total } });
  });

  r.post('/jobs/:id/applications',
    rateLimit(uploadLimiter, (req) => `upload:${req.auth?.orgId}`, 'Příliš mnoho nahrávání za hodinu. Zkuste to později.'),
    upload.array('files'),
    (req, res) => {
      const a = auth(req);
      const files = (req.files as Express.Multer.File[] | undefined) ?? [];
      if (!files.length) throw new AppError(400, 'no_files', 'Vyberte aspoň jeden soubor.');
      assertCanUseAi(db, ctx.config, a.orgId);
      const provider = a.me.organization.isDemo ? ctx.providers.forOrg(true) : null;
      // Ukázková organizace: jen ukázkové soubory (bez poskytovatele nic)
      const accept = a.me.organization.isDemo ? (sha: string) => provider?.acceptsDocument?.(sha) ?? false : undefined;
      const results = ingestFiles(db, storage, a.orgId, a.userId, String(req.params.id), files, { accept });
      queue.kick();
      res.status(201).json({ data: results });
    });

  /** Hromadné nové hodnocení: vybrané přihlášky, nebo všechny zastaralé. */
  r.post('/jobs/:id/applications/reevaluate', (req, res) => {
    const a = auth(req);
    const job = getJobRow(db, a.orgId, String(req.params.id));
    assertCanUseAi(db, ctx.config, a.orgId);
    const body = parse(z.object({ ids: z.array(z.string().max(64)).max(500).optional(), staleOnly: z.boolean().optional() }), req.body);
    let ids: string[];
    if (body.ids?.length) {
      ids = (db.prepare(`SELECT id FROM applications WHERE job_id = ? AND org_id = ? AND id IN (${body.ids.map(() => '?').join(',')})`)
        .all(job.id, a.orgId, ...body.ids) as Array<{ id: string }>).map((x) => x.id);
    } else if (body.staleOnly) {
      ids = (db.prepare(`SELECT a.id FROM applications a WHERE a.job_id = ? AND a.status = 'done'
        AND (SELECT e.requirements_version FROM evaluations e WHERE e.application_id = a.id ORDER BY e.version DESC LIMIT 1) < ?`)
        .all(job.id, job.requirements_version) as Array<{ id: string }>).map((x) => x.id);
    } else {
      throw new AppError(400, 'nothing_selected', 'Vyberte kandidáty k novému hodnocení.');
    }
    if (job.status !== 'active') throw new AppError(409, 'job_not_active', 'Hodnotit lze jen v aktivní pozici.');
    let count = 0;
    db.transaction(() => {
      for (const id of ids) if (requeue(db, id)) count++;
      if (count) audit(db, { orgId: a.orgId, actorId: a.userId, action: 'application.reevaluate', entityType: 'job', entityId: job.id, jobId: job.id, meta: { count } });
    })();
    queue.kick();
    res.json({ data: { queued: count } });
  });

  r.get('/applications/:id', (req, res) => {
    const a = auth(req);
    res.json({ data: getApplicationDetail(db, a.orgId, a.userId, String(req.params.id)) });
  });

  r.patch('/applications/:id', (req, res) => {
    const a = auth(req);
    const body = parse(z.object({ decision: z.enum(DECISIONS).nullable() }), req.body);
    const app = getApplicationRow(db, a.orgId, String(req.params.id));
    if (app.status !== 'done') throw new AppError(409, 'not_ready', 'Rozhodnout lze až po vyhodnocení životopisu.');
    db.transaction(() => {
      db.prepare('UPDATE applications SET decision = ?, decided_by = ?, decided_at = ?, updated_at = ? WHERE id = ?')
        .run(body.decision, body.decision ? a.userId : null, body.decision ? now() : null, now(), app.id);
      audit(db, { orgId: a.orgId, actorId: a.userId, action: 'application.decision', entityType: 'application', entityId: app.id,
        jobId: app.job_id, meta: { applicationId: app.id, decision: body.decision } });
    })();
    res.json({ data: getApplicationDetail(db, a.orgId, a.userId, app.id) });
  });

  r.post('/applications/:id/retry', (req, res) => {
    const a = auth(req);
    const app = getApplicationRow(db, a.orgId, String(req.params.id));
    if (app.status !== 'failed') throw new AppError(409, 'not_failed', 'Zpracování neskončilo chybou.');
    assertCanUseAi(db, ctx.config, a.orgId);
    if (app.error_code === 'unsupported') throw new AppError(409, 'unsupported', 'Tento soubor nejde zpracovat ani napodruhé.');
    requeue(db, app.id);
    audit(db, { orgId: a.orgId, actorId: a.userId, action: 'application.retry', entityType: 'application', entityId: app.id, jobId: app.job_id, meta: { applicationId: app.id } });
    queue.kick();
    res.json({ data: { ok: true } });
  });

  r.post('/applications/:id/reevaluate', (req, res) => {
    const a = auth(req);
    const app = getApplicationRow(db, a.orgId, String(req.params.id));
    const job = getJobRow(db, a.orgId, app.job_id);
    if (job.status !== 'active') throw new AppError(409, 'job_not_active', 'Hodnotit lze jen v aktivní pozici.');
    assertCanUseAi(db, ctx.config, a.orgId);
    if (!requeue(db, app.id)) throw new AppError(409, 'processing', 'Životopis se právě zpracovává.');
    audit(db, { orgId: a.orgId, actorId: a.userId, action: 'application.reevaluate', entityType: 'application', entityId: app.id, jobId: app.job_id, meta: { applicationId: app.id } });
    queue.kick();
    res.json({ data: { ok: true } });
  });

  r.delete('/applications/:id', (req, res) => {
    const a = auth(req);
    deleteApplication(db, storage, a.orgId, a.userId, String(req.params.id));
    res.json({ data: { ok: true } });
  });

  // ---------- Oprava verdiktu ----------

  r.patch('/evaluation-items/:id', (req, res) => {
    const a = auth(req);
    const body = parse(z.object({
      verdict: z.enum(VERDICTS).nullable(),
      note: z.string().trim().max(500).default(''),
    }), req.body);
    const item = db.prepare(
      `SELECT i.id, i.name, i.verdict, i.evaluation_id, ap.id AS app_id, ap.job_id FROM evaluation_items i
       JOIN evaluations e ON e.id = i.evaluation_id JOIN applications ap ON ap.id = e.application_id
       WHERE i.id = ? AND ap.org_id = ?`,
    ).get(String(req.params.id), a.orgId) as { id: string; name: string; verdict: string; evaluation_id: string; app_id: string; job_id: string } | undefined;
    if (!item) throw notFound('Položka hodnocení');
    if (body.verdict && !body.note) throw new AppError(400, 'note_required', 'Napište krátce, proč verdikt opravujete.', { note: 'Vyplňte důvod opravy.' });
    db.transaction(() => {
      setOverride(db, item.id, a.userId, body.verdict === item.verdict ? null : body.verdict, body.note);
      recomputeEvaluation(db, item.evaluation_id);
      audit(db, { orgId: a.orgId, actorId: a.userId, action: 'evaluation_item.overridden', entityType: 'evaluation_item', entityId: item.id,
        jobId: item.job_id, meta: { applicationId: item.app_id, requirement: item.name, to: body.verdict === item.verdict ? null : body.verdict } });
    })();
    res.json({ data: getApplicationDetail(db, a.orgId, a.userId, item.app_id) });
  });

  // ---------- Poznámky ----------

  r.post('/applications/:id/notes', (req, res) => {
    const a = auth(req);
    const body = parse(z.object({ body: z.string().trim().min(1, 'Poznámka je prázdná.').max(4000) }), req.body);
    const app = getApplicationRow(db, a.orgId, String(req.params.id));
    db.prepare('INSERT INTO notes (id, application_id, author_id, body, created_at) VALUES (?, ?, ?, ?, ?)')
      .run(newId(), app.id, a.userId, body.body, now());
    audit(db, { orgId: a.orgId, actorId: a.userId, action: 'note.created', entityType: 'note', entityId: app.id, jobId: app.job_id, meta: { applicationId: app.id } });
    res.status(201).json({ data: getApplicationDetail(db, a.orgId, a.userId, app.id).notes });
  });

  r.delete('/notes/:id', (req, res) => {
    const a = auth(req);
    const n = db.prepare(
      `SELECT n.id, n.author_id FROM notes n JOIN applications ap ON ap.id = n.application_id WHERE n.id = ? AND ap.org_id = ?`,
    ).get(String(req.params.id), a.orgId) as { id: string; author_id: string | null } | undefined;
    if (!n) throw notFound('Poznámka');
    if (n.author_id !== a.userId && a.role !== 'owner') throw new AppError(403, 'forbidden', 'Smazat můžete jen vlastní poznámku.');
    db.prepare('DELETE FROM notes WHERE id = ?').run(n.id);
    res.json({ data: { ok: true } });
  });

  // ---------- Kandidát ----------

  r.patch('/candidates/:id', (req, res) => {
    const a = auth(req);
    const body = parse(z.object({
      name: z.string().trim().min(1, 'Vyplňte jméno.').max(120),
      email: z.union([z.literal(''), z.string().trim().toLowerCase().pipe(z.email('Zadejte platný e-mail.'))]),
      phone: z.string().trim().max(60),
    }), req.body);
    const c = db.prepare('SELECT id FROM candidates WHERE id = ? AND org_id = ?').get(String(req.params.id), a.orgId);
    if (!c) throw notFound('Kandidát');
    db.prepare('UPDATE candidates SET name = ?, email = ?, phone = ?, edited_by_user = 1, updated_at = ? WHERE id = ?')
      .run(body.name, body.email || null, body.phone || null, now(), String(req.params.id));
    audit(db, { orgId: a.orgId, actorId: a.userId, action: 'candidate.updated', entityType: 'candidate', entityId: String(req.params.id) });
    res.json({ data: { ok: true } });
  });

  r.delete('/candidates/:id', (req, res) => {
    const a = auth(req);
    eraseCandidate(db, storage, a.orgId, a.userId, String(req.params.id));
    res.json({ data: { ok: true } });
  });

  // ---------- Dokumenty ----------

  r.get('/documents/:id/file', (req, res) => {
    const a = auth(req);
    const d = db.prepare('SELECT original_name, mime, storage_key FROM documents WHERE id = ? AND org_id = ?')
      .get(String(req.params.id), a.orgId) as { original_name: string; mime: string; storage_key: string } | undefined;
    if (!d) throw notFound('Dokument');
    const ascii = d.original_name.normalize('NFD').replace(/[^\x20-\x7e]/g, '').replace(/["\\]/g, '') || 'zivotopis';
    res.setHeader('Content-Type', d.mime);
    res.setHeader('Content-Disposition', `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(d.original_name)}`);
    res.setHeader('Cache-Control', 'private, no-store');
    res.send(storage.read(d.storage_key));
  });

  r.get('/documents/:id/text', (req, res) => {
    const a = auth(req);
    const data: DocumentText = documentPages(db, a.orgId, String(req.params.id));
    res.json({ data });
  });

  return r;
}
