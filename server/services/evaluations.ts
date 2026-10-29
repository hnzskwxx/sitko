import type {
  CandidateProfile, Evaluation, EvaluationHistoryEntry, EvaluationItem, MustStatus, QuoteStatus, Verdict, Weight,
} from '../../shared/types.js';
import { bool, now, type DB } from '../db/index.js';
import { computeScore } from './scoring.js';

interface EvalRow {
  id: string; application_id: string; version: number; requirements_version: number; source: 'ai' | 'demo';
  model: string; score: number; ai_score: number; coverage: number; must_status: MustStatus; summary: string;
  current_role: string; profile: string; strengths: string; concerns: string; interview_questions: string;
  injection_detected: number; created_at: string;
}
interface ItemRow {
  id: string; requirement_id: string | null; position: number; name: string; weight: Weight; must_have: number;
  verdict: Verdict; quote: string; quote_cs: string; quote_status: QuoteStatus; quote_page: number | null;
  explanation: string; limitations: string; override_verdict: Verdict | null; override_note: string | null;
  overridden_at: string | null; overridden_by_name: string | null;
}

export function latestEvaluationId(db: DB, applicationId: string): string | null {
  const r = db.prepare('SELECT id FROM evaluations WHERE application_id = ? ORDER BY version DESC LIMIT 1').get(applicationId) as { id: string } | undefined;
  return r?.id ?? null;
}

export function loadEvaluation(db: DB, evaluationId: string, jobRequirementsVersion: number): Evaluation | null {
  const e = db.prepare('SELECT * FROM evaluations WHERE id = ?').get(evaluationId) as EvalRow | undefined;
  if (!e) return null;
  const items = db.prepare(
    `SELECT i.*, u.name AS overridden_by_name FROM evaluation_items i
     LEFT JOIN users u ON u.id = i.overridden_by WHERE i.evaluation_id = ? ORDER BY i.position`,
  ).all(evaluationId) as ItemRow[];

  return {
    id: e.id,
    version: e.version,
    requirementsVersion: e.requirements_version,
    stale: e.requirements_version < jobRequirementsVersion,
    source: e.source,
    model: e.model,
    score: e.score,
    aiScore: e.ai_score,
    coverage: e.coverage,
    mustStatus: e.must_status,
    summary: e.summary,
    currentRole: e.current_role,
    profile: JSON.parse(e.profile) as CandidateProfile,
    strengths: JSON.parse(e.strengths) as string[],
    concerns: JSON.parse(e.concerns) as string[],
    interviewQuestions: JSON.parse(e.interview_questions) as string[],
    injectionDetected: bool(e.injection_detected),
    createdAt: e.created_at,
    items: items.map((i): EvaluationItem => ({
      id: i.id,
      requirementId: i.requirement_id,
      name: i.name,
      weight: i.weight,
      mustHave: bool(i.must_have),
      aiVerdict: i.verdict,
      verdict: i.override_verdict ?? i.verdict,
      quote: i.quote,
      quoteCs: i.quote_cs,
      quoteStatus: i.quote_status,
      quotePage: i.quote_page,
      explanation: i.explanation,
      limitations: i.limitations,
      override: i.override_verdict
        ? { verdict: i.override_verdict, note: i.override_note ?? '', by: i.overridden_by_name, at: i.overridden_at ?? '' }
        : null,
    })),
  };
}

export function evaluationHistory(db: DB, applicationId: string): EvaluationHistoryEntry[] {
  const rows = db.prepare(
    `SELECT id, version, requirements_version, score, coverage, source, model, created_at
     FROM evaluations WHERE application_id = ? ORDER BY version DESC`,
  ).all(applicationId) as Array<{ id: string; version: number; requirements_version: number; score: number; coverage: number; source: 'ai' | 'demo'; model: string; created_at: string }>;
  return rows.map((r) => ({
    id: r.id, version: r.version, requirementsVersion: r.requirements_version, score: r.score,
    coverage: r.coverage, source: r.source, model: r.model, createdAt: r.created_at,
  }));
}

/** Přepočítá skóre hodnocení po opravě verdiktu personalistou. */
export function recomputeEvaluation(db: DB, evaluationId: string): void {
  const items = db.prepare(
    'SELECT weight, must_have, COALESCE(override_verdict, verdict) AS verdict FROM evaluation_items WHERE evaluation_id = ?',
  ).all(evaluationId) as Array<{ weight: Weight; must_have: number; verdict: Verdict }>;
  const s = computeScore(items.map((i) => ({ weight: i.weight, mustHave: bool(i.must_have), verdict: i.verdict })));
  db.prepare('UPDATE evaluations SET score = ?, coverage = ?, must_status = ? WHERE id = ?').run(s.score, s.coverage, s.mustStatus, evaluationId);
}

export function setOverride(db: DB, itemId: string, userId: string, verdict: Verdict | null, note: string): void {
  if (verdict) {
    db.prepare('UPDATE evaluation_items SET override_verdict = ?, override_note = ?, overridden_by = ?, overridden_at = ? WHERE id = ?')
      .run(verdict, note, userId, now(), itemId);
  } else {
    db.prepare('UPDATE evaluation_items SET override_verdict = NULL, override_note = NULL, overridden_by = NULL, overridden_at = NULL WHERE id = ?')
      .run(itemId);
  }
}
