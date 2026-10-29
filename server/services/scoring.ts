import type { MustStatus, Verdict, Weight } from '../../shared/types.js';

export interface ScoredItem { weight: Weight | number; mustHave: boolean; verdict: Verdict }

export interface ScoreResult {
  /** Doložená shoda 0–100: kolik vážených požadavků CV prokazatelně doložilo. */
  score: number;
  /** Úplnost hodnocení 0–100: pro jakou část vah CV vůbec obsahovalo informaci. */
  coverage: number;
  mustStatus: MustStatus;
  metCount: number;
  unverifiedCount: number;
}

export const VERDICT_POINTS: Record<Verdict, number> = {
  splnuje: 1,
  castecne: 0.5,
  nesplnuje: 0,
  nelze_overit: 0,
};

/** Matematika skóre je popsaná v docs/architecture.md (sekce Výpočet skóre). */
export function computeScore(items: ScoredItem[]): ScoreResult {
  let totalWeight = 0;
  let gained = 0;
  let evidenced = 0;
  let metCount = 0;
  let unverifiedCount = 0;
  const must = items.filter((i) => i.mustHave);

  for (const it of items) {
    const w = Number(it.weight);
    if (![1, 2, 3].includes(w)) throw new Error(`Neplatná váha požadavku: ${it.weight}`);
    totalWeight += w;
    gained += w * VERDICT_POINTS[it.verdict];
    if (it.verdict !== 'nelze_overit') evidenced += w;
    else unverifiedCount++;
    if (it.verdict === 'splnuje') metCount++;
  }

  let mustStatus: MustStatus = 'none';
  if (must.length) {
    if (must.some((i) => i.verdict === 'nesplnuje')) mustStatus = 'unmet';
    else if (must.every((i) => i.verdict === 'splnuje')) mustStatus = 'met';
    else mustStatus = 'unknown';
  }

  return {
    score: totalWeight ? Math.round((gained / totalWeight) * 100) : 0,
    coverage: totalWeight ? Math.round((evidenced / totalWeight) * 100) : 0,
    mustStatus,
    metCount,
    unverifiedCount,
  };
}
