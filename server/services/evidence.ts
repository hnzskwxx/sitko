import type { QuoteStatus } from '../../shared/types.js';

/** Sjednotí text pro porovnání: malá písmena, mezery, uvozovky, pomlčky, Unicode NFC. */
export function normalizeForMatch(s: string): string {
  return s
    .normalize('NFC')
    .toLowerCase()
    .replace(/[‘’‚‛′`´]/g, "'")
    .replace(/[“”„‟″«»„“]/g, '"')
    .replace(/[‐-―−]/g, '-')
    .replace(/[•·▪●◦]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const words = (s: string): string[] => normalizeForMatch(s).split(/[^\p{L}\p{N}]+/u).filter((w) => w.length >= 2);

export interface QuoteCheck { status: QuoteStatus; page: number | null }

/**
 * Ověří, že citace od AI je skutečně v textu dokumentu.
 * exact = doslovná shoda po normalizaci; approximate = aspoň 85 % slov citace
 * se vyskytuje ve stejném pořadí v jednom úseku textu; jinak not_found.
 */
export function verifyQuote(quote: string, pages: string[]): QuoteCheck {
  const q = normalizeForMatch(quote);
  if (!q) return { status: 'none', page: null };
  const normPages = pages.map(normalizeForMatch);

  for (let i = 0; i < normPages.length; i++) {
    if (normPages[i].includes(q)) return { status: 'exact', page: i + 1 };
  }
  // Citace přes hranu dvou stránek
  for (let i = 0; i + 1 < normPages.length; i++) {
    if ((normPages[i] + ' ' + normPages[i + 1]).includes(q)) return { status: 'exact', page: i + 1 };
  }

  const qWords = words(quote);
  if (qWords.length < 3) return { status: 'not_found', page: null };
  let best = { ratio: 0, page: -1 };
  pages.forEach((p, i) => {
    const r = orderedCoverage(qWords, words(p));
    if (r > best.ratio) best = { ratio: r, page: i };
  });
  if (best.ratio >= 0.85) return { status: 'approximate', page: best.page + 1 };
  return { status: 'not_found', page: null };
}

/** Podíl slov citace, která se v textu vyskytují ve stejném pořadí (nejdelší společná podposloupnost v okně). */
function orderedCoverage(q: string[], text: string[]): number {
  if (text.length === 0) return 0;
  const window = Math.max(q.length * 3, q.length + 10);
  let best = 0;
  const firstWords = new Set(q.slice(0, 3));
  for (let start = 0; start < text.length; start++) {
    if (!firstWords.has(text[start])) continue;
    let qi = 0;
    let matched = 0;
    for (let t = start; t < Math.min(text.length, start + window) && qi < q.length; t++) {
      const idx = q.indexOf(text[t], qi);
      if (idx !== -1 && idx - qi <= 2) {
        matched++;
        qi = idx + 1;
      }
    }
    best = Math.max(best, matched / q.length);
    if (best === 1) break;
  }
  return best;
}

/** Najde citaci v textu inzerátu (pro kontrolu, že požadavek z inzerátu opravdu plyne). */
export function quoteInText(quote: string, text: string): boolean {
  const r = verifyQuote(quote, [text]);
  return r.status === 'exact' || r.status === 'approximate';
}
