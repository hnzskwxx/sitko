import path from 'node:path';
import type {
  ApplicationDetail, ApplicationRow, Decision, MustStatus, Note, ProcessingStatus, UploadResult,
} from '../../shared/types.js';
import { bool, newId, now, type DB } from '../db/index.js';
import { AppError, notFound } from '../lib/errors.js';
import { log } from '../lib/logger.js';
import { sha256 } from '../lib/security.js';
import { audit } from './audit.js';
import { evaluationHistory, latestEvaluationId, loadEvaluation } from './evaluations.js';
import { detectFile, UnsupportedFileError } from './filetype.js';
import { getJobRow } from './jobs.js';
import type { FileStorage } from './storage.js';

export interface IncomingFile { originalname: string; buffer: Buffer }

/** Uživatelsky bezpečné jméno souboru pro zobrazení (nikdy se nepoužívá v cestě na disku). */
export function displayName(name: string): string {
  // multer předává jméno jako latin1; převedeme zpět na UTF-8
  let n = name;
  try {
    const decoded = Buffer.from(name, 'latin1').toString('utf8');
    if (!decoded.includes('�')) n = decoded;
  } catch { /* ponechat původní */ }
  return path.basename(n).replace(/[\u0000-\u001f\u007f]/g, '').slice(0, 200) || 'soubor';
}

export const DEMO_UPLOAD_REJECTED = 'V ukázkové organizaci jde nahrát jen ukázkové životopisy. Skutečná CV sem nepatří, ukázku sdílí víc lidí.';

export function ingestFiles(
  db: DB, storage: FileStorage, orgId: string, userId: string, jobId: string, files: IncomingFile[],
  opts: { accept?: (sha256: string) => boolean } = {},
): UploadResult[] {
  const job = getJobRow(db, orgId, jobId);
  if (job.status !== 'active') {
    throw new AppError(409, 'job_not_active', job.status === 'draft'
      ? 'Nejdřív potvrďte požadavky pozice, pak můžete nahrávat životopisy.'
      : 'Do uzavřené nebo archivované pozice nelze nahrávat životopisy.');
  }
  const results: UploadResult[] = [];

  for (const f of files) {
    const fileName = displayName(f.originalname);
    let kind;
    try {
      kind = detectFile(fileName, f.buffer);
    } catch (err) {
      if (err instanceof UnsupportedFileError) {
        results.push({ fileName, outcome: 'rejected', message: err.message, applicationId: null });
        continue;
      }
      throw err;
    }
    const hash = sha256(f.buffer);
    if (opts.accept && !opts.accept(hash)) {
      results.push({ fileName, outcome: 'rejected', message: DEMO_UPLOAD_REJECTED, applicationId: null });
      continue;
    }
    let doc = db.prepare('SELECT id FROM documents WHERE org_id = ? AND sha256 = ?').get(orgId, hash) as { id: string } | undefined;
    let savedKey: string | null = null;
    try {
      if (!doc) {
        savedKey = storage.save(orgId, f.buffer);
        const id = newId();
        db.prepare(`INSERT INTO documents (id, org_id, original_name, mime, size_bytes, sha256, storage_key, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(id, orgId, fileName, kind.mime, f.buffer.length, hash, savedKey, now());
        doc = { id };
        savedKey = null; // úspěšně zapsáno, už neuklízet
      }
      const dup = db.prepare('SELECT id FROM applications WHERE job_id = ? AND document_id = ?').get(jobId, doc.id) as { id: string } | undefined;
      if (dup) {
        results.push({ fileName, outcome: 'duplicate', message: 'Tento soubor už u pozice je.', applicationId: dup.id });
        continue;
      }
      const appId = newId();
      const t = now();
      db.prepare(`INSERT INTO applications (id, org_id, job_id, document_id, status, created_by, created_at, updated_at)
        VALUES (?, ?, ?, ?, 'queued', ?, ?, ?)`).run(appId, orgId, jobId, doc.id, userId, t, t);
      results.push({ fileName, outcome: 'queued', message: null, applicationId: appId });
    } catch (err) {
      if (savedKey) storage.remove(savedKey);
      throw err;
    }
  }

  const count = (o: UploadResult['outcome']) => results.filter((r) => r.outcome === o).length;
  audit(db, {
    orgId, actorId: userId, action: 'applications.uploaded', entityType: 'job', entityId: jobId, jobId,
    meta: { queued: count('queued'), duplicates: count('duplicate'), rejected: count('rejected') },
  });
  db.prepare('UPDATE jobs SET updated_at = ? WHERE id = ?').run(now(), jobId);
  return results;
}

// ---------- Seznam ----------

export interface ListParams {
  q?: string;
  decision?: 'none' | Decision;
  must?: MustStatus;
  status?: 'processing' | 'failed' | 'done';
  sort?: 'match' | 'name' | 'created' | 'coverage';
  dir?: 'asc' | 'desc';
  page: number;
  pageSize: number;
}

export function listApplications(db: DB, orgId: string, jobId: string, p: ListParams): { rows: ApplicationRow[]; total: number } {
  const job = getJobRow(db, orgId, jobId);
  const where = ['a.job_id = ?', 'a.org_id = ?'];
  const args: Array<string | number> = [jobId, orgId];
  if (p.q) {
    where.push(`(c.name LIKE ? ESCAPE '\\' OR d.original_name LIKE ? ESCAPE '\\' OR e.current_role LIKE ? ESCAPE '\\')`);
    const like = `%${p.q.replace(/[\\%_]/g, (m) => `\\${m}`)}%`;
    args.push(like, like, like);
  }
  if (p.decision === 'none') where.push(`a.decision IS NULL AND a.status = 'done'`);
  else if (p.decision) { where.push('a.decision = ?'); args.push(p.decision); }
  if (p.must) { where.push('e.must_status = ?'); args.push(p.must); }
  if (p.status === 'processing') where.push(`a.status IN ('queued', 'extracting', 'evaluating')`);
  else if (p.status) { where.push('a.status = ?'); args.push(p.status); }

  const dir = p.dir === 'asc' ? 'ASC' : 'DESC';
  const order = {
    match: `(a.status != 'done') DESC, (e.must_status = 'unmet') ASC, e.score ${dir}, e.coverage DESC, a.created_at ASC`,
    name: `COALESCE(c.name, d.original_name) COLLATE NOCASE ${dir === 'DESC' ? 'DESC' : 'ASC'}`,
    created: `a.created_at ${dir}`,
    coverage: `e.coverage ${dir}, e.score DESC`,
  }[p.sort ?? 'match'];

  const from = `FROM applications a
    JOIN documents d ON d.id = a.document_id
    LEFT JOIN candidates c ON c.id = a.candidate_id
    LEFT JOIN evaluations e ON e.id = (SELECT id FROM evaluations WHERE application_id = a.id ORDER BY version DESC LIMIT 1)
    WHERE ${where.join(' AND ')}`;

  const total = (db.prepare(`SELECT COUNT(*) AS n ${from}`).get(...args) as { n: number }).n;
  const rows = db.prepare(`
    SELECT a.id, a.candidate_id, a.status, a.error_message, a.error_code, a.decision, a.injection_flag, a.duplicate_of, a.created_at,
           d.original_name, c.name AS candidate_name,
           e.id AS eval_id, e.score, e.coverage, e.must_status, e.current_role, e.requirements_version AS eval_rv, e.source,
           (SELECT COUNT(*) FROM evaluation_items i WHERE i.evaluation_id = e.id) AS req_count,
           (SELECT COUNT(*) FROM evaluation_items i WHERE i.evaluation_id = e.id AND COALESCE(i.override_verdict, i.verdict) = 'splnuje') AS met_count,
           (SELECT COUNT(*) FROM evaluation_items i WHERE i.evaluation_id = e.id AND (COALESCE(i.override_verdict, i.verdict) = 'nelze_overit'
              OR (i.override_verdict IS NULL AND i.verdict != 'nelze_overit' AND i.quote_status = 'not_found'))) AS unverified_count
    ${from} ORDER BY ${order} LIMIT ? OFFSET ?`,
  ).all(...args, p.pageSize, (p.page - 1) * p.pageSize) as Array<Record<string, unknown>>;

  return {
    total,
    rows: rows.map((r): ApplicationRow => ({
      id: r.id as string,
      candidateId: (r.candidate_id as string) ?? null,
      candidateName: (r.candidate_name as string) ?? null,
      currentRole: (r.current_role as string) || null,
      fileName: r.original_name as string,
      status: r.status as ProcessingStatus,
      errorMessage: (r.error_message as string) ?? null,
      canRetry: r.status === 'failed' && r.error_code !== 'unsupported',
      decision: (r.decision as Decision) ?? null,
      score: r.eval_id ? (r.score as number) : null,
      coverage: r.eval_id ? (r.coverage as number) : null,
      mustStatus: r.eval_id ? (r.must_status as MustStatus) : null,
      metCount: r.eval_id ? (r.met_count as number) : null,
      requirementCount: r.eval_id ? (r.req_count as number) : null,
      unverifiedCount: r.eval_id ? (r.unverified_count as number) : null,
      injectionFlag: bool(r.injection_flag),
      possibleDuplicate: Boolean(r.duplicate_of),
      stale: Boolean(r.eval_id) && (r.eval_rv as number) < job.requirements_version,
      isDemo: r.source === 'demo',
      createdAt: r.created_at as string,
    })),
  };
}

// ---------- Detail ----------

export interface ApplicationRowDb {
  id: string; org_id: string; job_id: string; document_id: string; candidate_id: string | null; status: ProcessingStatus;
  attempts: number; error_code: string | null; error_message: string | null; decision: Decision | null; decided_at: string | null;
  injection_flag: number; duplicate_of: string | null; created_at: string;
}

export function getApplicationRow(db: DB, orgId: string, id: string): ApplicationRowDb {
  const r = db.prepare('SELECT * FROM applications WHERE id = ? AND org_id = ?').get(id, orgId) as ApplicationRowDb | undefined;
  if (!r) throw notFound('Kandidát');
  return r;
}

export function getApplicationDetail(db: DB, orgId: string, userId: string, id: string): ApplicationDetail {
  const a = getApplicationRow(db, orgId, id);
  const job = getJobRow(db, orgId, a.job_id);
  const doc = db.prepare('SELECT id, original_name, mime, size_bytes, text_pages, text_source FROM documents WHERE id = ?').get(a.document_id) as {
    id: string; original_name: string; mime: string; size_bytes: number; text_pages: string | null; text_source: string | null;
  };
  const cand = a.candidate_id
    ? db.prepare('SELECT id, name, email, phone FROM candidates WHERE id = ?').get(a.candidate_id) as { id: string; name: string; email: string | null; phone: string | null }
    : null;
  const evalId = latestEvaluationId(db, a.id);
  const notes = db.prepare(
    `SELECT n.id, n.body, n.author_id, n.created_at, u.name AS author_name FROM notes n
     LEFT JOIN users u ON u.id = n.author_id WHERE n.application_id = ? ORDER BY n.created_at DESC`,
  ).all(a.id) as Array<{ id: string; body: string; author_id: string | null; created_at: string; author_name: string | null }>;

  return {
    id: a.id,
    job: { id: job.id, title: job.title, requirementsVersion: job.requirements_version },
    candidate: cand,
    document: {
      id: doc.id, fileName: doc.original_name, mime: doc.mime, sizeBytes: doc.size_bytes,
      pageCount: doc.text_pages ? (JSON.parse(doc.text_pages) as string[]).length : 0, textSource: doc.text_source,
    },
    status: a.status,
    errorMessage: a.error_message,
    canRetry: a.status === 'failed' && a.error_code !== 'unsupported',
    decision: a.decision,
    decidedAt: a.decided_at,
    injectionFlag: bool(a.injection_flag),
    possibleDuplicate: Boolean(a.duplicate_of),
    createdAt: a.created_at,
    evaluation: evalId ? loadEvaluation(db, evalId, job.requirements_version) : null,
    history: evaluationHistory(db, a.id),
    notes: notes.map((n): Note => ({ id: n.id, body: n.body, authorName: n.author_name, isMine: n.author_id === userId, createdAt: n.created_at })),
  };
}

// ---------- Mazání ----------

/** Smaže dokumenty bez přihlášek a kandidáty bez přihlášek; vrátí klíče souborů ke smazání z disku. */
function deleteOrphans(db: DB, orgId: string, documentIds: string[]): string[] {
  const keys: string[] = [];
  for (const id of new Set(documentIds)) {
    const used = db.prepare('SELECT 1 FROM applications WHERE document_id = ? LIMIT 1').get(id);
    if (used) continue;
    const d = db.prepare('SELECT storage_key FROM documents WHERE id = ? AND org_id = ?').get(id, orgId) as { storage_key: string } | undefined;
    if (!d) continue;
    db.prepare('DELETE FROM documents WHERE id = ?').run(id);
    keys.push(d.storage_key);
  }
  db.prepare('DELETE FROM candidates WHERE org_id = ? AND NOT EXISTS (SELECT 1 FROM applications a WHERE a.candidate_id = candidates.id)').run(orgId);
  return keys;
}

function removeFiles(storage: FileStorage, keys: string[]): void {
  for (const k of keys) {
    try { storage.remove(k); } catch (err) { log.error('file_remove_failed', { err: (err as Error).message }); }
  }
}

export function deleteApplication(db: DB, storage: FileStorage, orgId: string, userId: string, id: string): void {
  const keys = db.transaction(() => {
    const a = getApplicationRow(db, orgId, id);
    if (a.status === 'extracting' || a.status === 'evaluating') {
      throw new AppError(409, 'processing', 'Životopis se právě zpracovává. Zkuste to za chvíli.');
    }
    db.prepare('DELETE FROM applications WHERE id = ?').run(id);
    audit(db, { orgId, actorId: userId, action: 'application.deleted', entityType: 'application', entityId: id, jobId: a.job_id });
    return deleteOrphans(db, orgId, [a.document_id]);
  })();
  removeFiles(storage, keys);
}

/** Výmaz kandidáta (GDPR): všechny jeho přihlášky, hodnocení, poznámky a soubory v organizaci. */
export function eraseCandidate(db: DB, storage: FileStorage, orgId: string, userId: string, candidateId: string): void {
  const keys = db.transaction(() => {
    const c = db.prepare('SELECT id FROM candidates WHERE id = ? AND org_id = ?').get(candidateId, orgId);
    if (!c) throw notFound('Kandidát');
    const apps = db.prepare('SELECT id, document_id, status FROM applications WHERE candidate_id = ?').all(candidateId) as Array<{ id: string; document_id: string; status: string }>;
    if (apps.some((a) => a.status === 'extracting' || a.status === 'evaluating')) {
      throw new AppError(409, 'processing', 'Některý životopis kandidáta se právě zpracovává. Zkuste to za chvíli.');
    }
    db.prepare('DELETE FROM applications WHERE candidate_id = ?').run(candidateId);
    db.prepare('DELETE FROM candidates WHERE id = ?').run(candidateId);
    audit(db, { orgId, actorId: userId, action: 'candidate.deleted', entityType: 'candidate', entityId: candidateId, meta: { applications: apps.length } });
    return deleteOrphans(db, orgId, apps.map((a) => a.document_id));
  })();
  removeFiles(storage, keys);
}

export function deleteJob(db: DB, storage: FileStorage, orgId: string, jobId: string): void {
  const keys = db.transaction(() => {
    getJobRow(db, orgId, jobId);
    const busy = db.prepare(`SELECT 1 FROM applications WHERE job_id = ? AND status IN ('extracting', 'evaluating') LIMIT 1`).get(jobId);
    if (busy) throw new AppError(409, 'processing', 'U pozice se právě zpracovávají životopisy. Zkuste to za chvíli.');
    const docs = (db.prepare('SELECT document_id FROM applications WHERE job_id = ?').all(jobId) as Array<{ document_id: string }>).map((r) => r.document_id);
    db.prepare('DELETE FROM jobs WHERE id = ?').run(jobId);
    db.prepare('UPDATE audit_logs SET job_id = NULL WHERE job_id = ? AND org_id = ?').run(jobId, orgId);
    return deleteOrphans(db, orgId, docs);
  })();
  removeFiles(storage, keys);
}

/** Retence: smaže přihlášky v uzavřených/archivovaných pozicích starší než retention_days. */
export function retentionSweep(db: DB, storage: FileStorage): number {
  const orgs = db.prepare('SELECT id, retention_days FROM organizations').all() as Array<{ id: string; retention_days: number }>;
  let total = 0;
  for (const o of orgs) {
    const cutoff = new Date(Date.now() - o.retention_days * 86_400_000).toISOString();
    const keys = db.transaction(() => {
      const apps = db.prepare(
        `SELECT a.id, a.document_id FROM applications a JOIN jobs j ON j.id = a.job_id
         WHERE a.org_id = ? AND j.status IN ('closed', 'archived') AND COALESCE(j.closed_at, j.updated_at) < ?
           AND a.status NOT IN ('extracting', 'evaluating')`,
      ).all(o.id, cutoff) as Array<{ id: string; document_id: string }>;
      if (!apps.length) return [];
      const del = db.prepare('DELETE FROM applications WHERE id = ?');
      for (const a of apps) del.run(a.id);
      audit(db, { orgId: o.id, action: 'retention.cleanup', entityType: 'organization', entityId: o.id, meta: { applications: apps.length } });
      total += apps.length;
      return deleteOrphans(db, o.id, apps.map((a) => a.document_id));
    })();
    removeFiles(storage, keys);
  }
  return total;
}

export function documentPages(db: DB, orgId: string, documentId: string): { pages: string[]; source: string | null } {
  const d = db.prepare('SELECT text_pages, text_source FROM documents WHERE id = ? AND org_id = ?').get(documentId, orgId) as { text_pages: string | null; text_source: string | null } | undefined;
  if (!d) throw notFound('Dokument');
  return { pages: d.text_pages ? (JSON.parse(d.text_pages) as string[]) : [], source: d.text_source };
}
