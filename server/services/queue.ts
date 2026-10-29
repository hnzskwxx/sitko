import type { Verdict, Weight } from '../../shared/types.js';
import { bool, newId, now, type DB } from '../db/index.js';
import { log } from '../lib/logger.js';
import { audit } from './audit.js';
import { verifyQuote } from './evidence.js';
import { cleanPage, ExtractionError, extractDocumentText } from './extract.js';
import { detectFile, UnsupportedFileError } from './filetype.js';
import { detectInjection } from './injection.js';
import { listRequirements } from './jobs.js';
import { computeScore } from './scoring.js';
import type { FileStorage } from './storage.js';
import { AiError, type AiProvider, type AiUsage } from './ai/provider.js';
import { PROMPT_VERSION } from './ai/prompts.js';

export const MAX_ATTEMPTS = 4;
const BACKOFF_MS = [30_000, 120_000, 480_000];
const STALE_LOCK_MS = 10 * 60_000;

export interface ProviderResolver { forOrg(isDemo: boolean): AiProvider | null }

interface Claimed {
  id: string; org_id: string; job_id: string; document_id: string; candidate_id: string | null; attempts: number;
}

class PermanentError extends Error {
  constructor(public code: string, message: string) { super(message); }
}

/**
 * Fronta zpracování životopisů. Stav je v tabulce applications, takže přežije restart.
 * Úlohu si worker zamkne atomickým UPDATE … WHERE status = 'queued'.
 */
export class ProcessingQueue {
  private running = 0;
  private timer: NodeJS.Timeout | null = null;
  private scheduled = false;
  private stopped = true;
  private idleResolvers: Array<() => void> = [];

  constructor(
    private db: DB,
    private storage: FileStorage,
    private providers: ProviderResolver,
    private opts: { concurrency: number; monthlyLimit: number },
  ) {}

  start(pollMs = 2000): void {
    this.stopped = false;
    this.recoverStale();
    this.timer = setInterval(() => this.kick(), pollMs);
    this.timer.unref();
    this.kick();
  }

  stop(): void {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
  }

  /** Naplánuje okamžité zpracování (po nahrání nebo dokončení úlohy). */
  kick(): void {
    if (this.stopped || this.scheduled) return;
    this.scheduled = true;
    setImmediate(() => {
      this.scheduled = false;
      this.fill();
    });
  }

  /** Pro testy: počká, až fronta nemá co dělat. */
  async drain(): Promise<void> {
    for (;;) {
      this.fill();
      if (this.running === 0 && !this.hasReady()) return;
      await new Promise<void>((r) => this.idleResolvers.push(r));
    }
  }

  private hasReady(): boolean {
    return Boolean(this.db.prepare(
      `SELECT 1 FROM applications WHERE status = 'queued' AND (next_attempt_at IS NULL OR next_attempt_at <= ?) LIMIT 1`,
    ).get(now()));
  }

  private fill(): void {
    while (this.running < this.opts.concurrency) {
      const job = this.claim();
      if (!job) break;
      this.running++;
      void this.process(job).finally(() => {
        this.running--;
        const r = this.idleResolvers.splice(0);
        r.forEach((fn) => fn());
        this.kick();
      });
    }
  }

  private claim(): Claimed | null {
    return this.db.transaction(() => {
      const row = this.db.prepare(
        `SELECT id FROM applications WHERE status = 'queued' AND (next_attempt_at IS NULL OR next_attempt_at <= ?)
         ORDER BY created_at LIMIT 1`,
      ).get(now()) as { id: string } | undefined;
      if (!row) return null;
      const t = now();
      const res = this.db.prepare(
        `UPDATE applications SET status = 'extracting', locked_at = ?, attempts = attempts + 1, updated_at = ?
         WHERE id = ? AND status = 'queued'`,
      ).run(t, t, row.id);
      if (res.changes !== 1) return null;
      return this.db.prepare('SELECT id, org_id, job_id, document_id, candidate_id, attempts FROM applications WHERE id = ?').get(row.id) as Claimed;
    })();
  }

  /** Úlohy, které zůstaly rozpracované po pádu procesu, vrátí do fronty. */
  recoverStale(): number {
    const cutoff = new Date(Date.now() - STALE_LOCK_MS).toISOString();
    const r = this.db.prepare(
      `UPDATE applications SET status = 'queued', locked_at = NULL, updated_at = ?
       WHERE status IN ('extracting', 'evaluating') AND (locked_at IS NULL OR locked_at < ? OR ? = 1)`,
    ).run(now(), cutoff, this.running === 0 ? 1 : 0);
    if (r.changes) log.warn('queue_recovered', { count: r.changes });
    return r.changes;
  }

  private async process(app: Claimed): Promise<void> {
    const started = Date.now();
    try {
      await this.run(app);
      log.info('application_processed', { applicationId: app.id, ms: Date.now() - started });
    } catch (err) {
      this.handleFailure(app, err);
    }
  }

  private async run(app: Claimed): Promise<void> {
    const db = this.db;
    const org = db.prepare('SELECT id, is_demo FROM organizations WHERE id = ?').get(app.org_id) as { id: string; is_demo: number };
    const job = db.prepare('SELECT id, title, ad_text, requirements_version FROM jobs WHERE id = ?').get(app.job_id) as {
      id: string; title: string; ad_text: string; requirements_version: number;
    } | undefined;
    if (!job) throw new PermanentError('job_missing', 'Pozice už neexistuje.');
    const requirements = listRequirements(db, job.id);
    if (!requirements.length) throw new PermanentError('no_requirements', 'Pozice nemá žádné potvrzené požadavky.');

    const provider = this.providers.forOrg(bool(org.is_demo));
    if (!provider) {
      throw new PermanentError('ai_not_configured', 'AI není nastavená (chybí ANTHROPIC_API_KEY). Po nastavení klíče zkuste zpracování znovu.');
    }
    if (provider.source === 'ai') {
      const monthStart = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1)).toISOString();
      const used = (db.prepare(
        `SELECT COUNT(*) AS n FROM evaluations e JOIN applications a ON a.id = e.application_id
         WHERE a.org_id = ? AND e.source = 'ai' AND e.created_at >= ?`,
      ).get(org.id, monthStart) as { n: number }).n;
      if (used >= this.opts.monthlyLimit) {
        throw new PermanentError('limit_reached', `Organizace vyčerpala měsíční limit ${this.opts.monthlyLimit} hodnocení.`);
      }
    }

    // 1) Text dokumentu (jednou pro dokument, sdílený napříč pozicemi)
    const doc = db.prepare('SELECT id, original_name, sha256, storage_key, text_pages FROM documents WHERE id = ?').get(app.document_id) as {
      id: string; original_name: string; sha256: string; storage_key: string; text_pages: string | null;
    };
    const usage: AiUsage = { inputTokens: 0, outputTokens: 0 };
    let pages: string[];
    if (doc.text_pages) {
      pages = JSON.parse(doc.text_pages) as string[];
    } else {
      const buf = this.storage.read(doc.storage_key);
      const kind = detectFile(doc.original_name, buf);
      const extracted = await extractDocumentText(kind.kind, buf);
      let source: string;
      if (extracted) {
        pages = extracted.pages;
        source = extracted.source;
      } else {
        const ocr = await provider.transcribe({ kind: kind.kind, mime: kind.mime, buffer: buf });
        usage.inputTokens += ocr.usage.inputTokens;
        usage.outputTokens += ocr.usage.outputTokens;
        pages = ocr.pages.map(cleanPage).filter(Boolean);
        if (!pages.join('').trim()) throw new PermanentError('unreadable', 'V dokumentu se nepodařilo najít čitelný text.');
        source = 'ocr';
      }
      db.prepare('UPDATE documents SET text_pages = ?, text_source = ? WHERE id = ?').run(JSON.stringify(pages), source, doc.id);
    }
    db.prepare(`UPDATE applications SET status = 'evaluating', updated_at = ? WHERE id = ?`).run(now(), app.id);

    // 2) Kontrola prompt injection (heuristika, nezávislá na modelu)
    const injectionHeuristic = detectInjection(pages.join('\n'));

    // 3) Extrakce + hodnocení
    const out = await provider.evaluate({
      jobTitle: job.title,
      adText: job.ad_text,
      requirements: requirements.map((r) => ({
        id: r.id, name: r.name, description: r.description, category: r.category, weight: r.weight, mustHave: r.mustHave,
      })),
      pages,
      documentSha256: doc.sha256,
    });
    usage.inputTokens += out.usage.inputTokens;
    usage.outputTokens += out.usage.outputTokens;
    const res = out.result;

    // 4) Položky: každý potvrzený požadavek právě jednou, citace ověřené proti textu
    const byId = new Map(res.requirements.map((r) => [r.id, r]));
    const items = requirements.map((req, position) => {
      const r = byId.get(req.id);
      const verdict: Verdict = r?.verdict ?? 'nelze_overit';
      const quote = r?.quote ?? '';
      const check = quote ? verifyQuote(quote, pages) : { status: 'none' as const, page: null };
      return {
        id: newId(), requirementId: req.id, position, name: req.name, weight: req.weight as Weight, mustHave: req.mustHave,
        verdict, quote, quoteCs: r?.quote_cs ?? '', quoteStatus: check.status, quotePage: check.page,
        explanation: r ? r.explanation : 'Model tento požadavek nevrátil, proto ho nelze ověřit.',
        limitations: r?.limitations ?? '',
      };
    });
    const score = computeScore(items);
    const injection = injectionHeuristic || res.injection_detected;

    // 5) Uložení v transakci
    db.transaction(() => {
      const current = db.prepare('SELECT status, candidate_id FROM applications WHERE id = ?').get(app.id) as { status: string; candidate_id: string | null } | undefined;
      if (!current) return; // mezitím smazáno
      const candidateId = this.matchCandidate(app.org_id, current.candidate_id, res.candidate);
      const version = ((db.prepare('SELECT MAX(version) AS v FROM evaluations WHERE application_id = ?').get(app.id) as { v: number | null }).v ?? 0) + 1;
      const evalId = newId();
      db.prepare(`INSERT INTO evaluations (id, application_id, version, requirements_version, source, model, prompt_version, score, ai_score,
        coverage, must_status, summary, current_role, profile, strengths, concerns, interview_questions, injection_detected,
        input_tokens, output_tokens, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
        evalId, app.id, version, job.requirements_version, provider.source, provider.model, PROMPT_VERSION, score.score, score.score,
        score.coverage, score.mustStatus, res.summary, res.candidate.current_role, JSON.stringify(res.profile),
        JSON.stringify(res.strengths), JSON.stringify(res.concerns), JSON.stringify(res.interview_questions), injection ? 1 : 0,
        usage.inputTokens, usage.outputTokens, now(),
      );
      const ins = db.prepare(`INSERT INTO evaluation_items (id, evaluation_id, requirement_id, position, name, weight, must_have, verdict,
        quote, quote_cs, quote_status, quote_page, explanation, limitations) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
      for (const it of items) {
        ins.run(it.id, evalId, it.requirementId, it.position, it.name, it.weight, it.mustHave ? 1 : 0, it.verdict, it.quote,
          it.quoteCs, it.quoteStatus, it.quotePage, it.explanation, it.limitations);
      }
      const dup = candidateId
        ? db.prepare('SELECT id FROM applications WHERE job_id = ? AND candidate_id = ? AND id != ? ORDER BY created_at LIMIT 1')
          .get(app.job_id, candidateId, app.id) as { id: string } | undefined
        : undefined;
      db.prepare(`UPDATE applications SET status = 'done', candidate_id = ?, injection_flag = ?, duplicate_of = ?, error_code = NULL,
        error_message = NULL, locked_at = NULL, next_attempt_at = NULL, updated_at = ? WHERE id = ?`)
        .run(candidateId, injection ? 1 : 0, dup?.id ?? null, now(), app.id);
      audit(db, {
        orgId: app.org_id, action: 'application.evaluated', entityType: 'application', entityId: app.id, jobId: app.job_id,
        meta: { applicationId: app.id, version, score: score.score, source: provider.source },
      });
    })();
  }

  /** Spáruje kandidáta podle e-mailu v organizaci, jinak založí nového. Ruční opravu údajů nepřepisuje. */
  private matchCandidate(orgId: string, existingId: string | null, c: { name: string; email: string; phone: string }): string | null {
    const db = this.db;
    const email = c.email.trim().toLowerCase() || null;
    const name = c.name.trim() || 'Bez jména';
    const t = now();
    if (existingId) {
      db.prepare(`UPDATE candidates SET name = ?, email = COALESCE(?, email), phone = COALESCE(NULLIF(?, ''), phone), updated_at = ?
        WHERE id = ? AND edited_by_user = 0`).run(name, email, c.phone, t, existingId);
      return existingId;
    }
    if (email) {
      const found = db.prepare('SELECT id FROM candidates WHERE org_id = ? AND email = ?').get(orgId, email) as { id: string } | undefined;
      if (found) return found.id;
    }
    const id = newId();
    db.prepare('INSERT INTO candidates (id, org_id, name, email, phone, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(id, orgId, name, email, c.phone.trim() || null, t, t);
    return id;
  }

  private handleFailure(app: Claimed, err: unknown): void {
    let code = 'internal';
    let message = 'Při zpracování došlo k chybě.';
    let transient = false;
    if (err instanceof PermanentError) { code = err.code; message = err.message; }
    else if (err instanceof AiError) { code = err.code; message = err.message; transient = err.kind === 'transient'; }
    else if (err instanceof ExtractionError) { code = 'unreadable'; message = err.message; }
    else if (err instanceof UnsupportedFileError) { code = 'unsupported'; message = err.message; }
    else log.error('processing_error', { applicationId: app.id, err: err instanceof Error ? err.message : String(err) });

    const t = now();
    if (transient && app.attempts < MAX_ATTEMPTS) {
      const delay = BACKOFF_MS[Math.min(app.attempts - 1, BACKOFF_MS.length - 1)];
      const at = new Date(Date.now() + delay).toISOString();
      this.db.prepare(`UPDATE applications SET status = 'queued', locked_at = NULL, next_attempt_at = ?, error_code = ?, error_message = ?, updated_at = ?
        WHERE id = ?`).run(at, code, `${message} Další pokus proběhne automaticky.`, t, app.id);
      log.warn('processing_retry', { applicationId: app.id, code, attempt: app.attempts });
      return;
    }
    this.db.prepare(`UPDATE applications SET status = 'failed', locked_at = NULL, next_attempt_at = NULL, error_code = ?, error_message = ?, updated_at = ?
      WHERE id = ?`).run(code, message, t, app.id);
    audit(this.db, {
      orgId: app.org_id, action: 'application.failed', entityType: 'application', entityId: app.id, jobId: app.job_id,
      meta: { applicationId: app.id, code },
    });
    log.warn('processing_failed', { applicationId: app.id, code });
  }
}

/** Zařadí přihlášku znovu do fronty (ruční opakování nebo nové hodnocení). */
export function requeue(db: DB, applicationId: string): boolean {
  const r = db.prepare(`UPDATE applications SET status = 'queued', attempts = 0, next_attempt_at = NULL, error_code = NULL,
    error_message = NULL, updated_at = ? WHERE id = ? AND status IN ('done', 'failed')`).run(now(), applicationId);
  return r.changes === 1;
}

