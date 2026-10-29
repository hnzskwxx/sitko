import { Check, TriangleAlert } from 'lucide-react';
import type { EvaluationItem } from '@shared/types';

/**
 * Citace z CV. Zvýrazňovač dostane jen citace, které server našel v textu dokumentu.
 * Nenalezená citace je podtržená přerušovaně a výslovně označená jako neověřená.
 */
export function Evidence({ item }: { item: Pick<EvaluationItem, 'quote' | 'quoteCs' | 'quoteStatus' | 'quotePage'> }) {
  if (!item.quote) return <p className="evidence-none">V životopise neuvedeno</p>;
  const verified = item.quoteStatus === 'exact' || item.quoteStatus === 'approximate';
  return (
    <div className="evidence">
      <p className="evidence-quote">
        {verified ? <mark>{item.quote}</mark> : <span className="unverified">{item.quote}</span>}
      </p>
      {item.quoteCs && <p className="evidence-trans">Překlad: {item.quoteCs}</p>}
      <p className="evidence-meta">
        {item.quoteStatus === 'exact' && <span className="is-ok"><Check aria-hidden />Ověřeno v dokumentu</span>}
        {item.quoteStatus === 'approximate' && <span className="is-ok"><Check aria-hidden />Nalezeno v dokumentu s drobnou odchylkou</span>}
        {item.quoteStatus === 'not_found' && <span className="is-warn"><TriangleAlert aria-hidden />Citaci se v dokumentu nepodařilo najít, ověřte ji v originálu</span>}
        {verified && item.quotePage && <span>· strana {item.quotePage}</span>}
      </p>
    </div>
  );
}

/** Rozdělí text stránky na části se zvýrazněnými citacemi (bez innerHTML). */
export function highlightQuotes(text: string, quotes: string[]): Array<{ text: string; mark: boolean }> {
  const patterns = quotes.filter((q) => q.trim().length >= 3).map((q) =>
    q.trim()
      .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      .replace(/\s+/g, '\\s+')
      .replace(/[-–—]/g, '[-–—]')
      .replace(/["„“”]/g, '["„“”]'),
  );
  if (!patterns.length) return [{ text, mark: false }];
  const re = new RegExp(`(${patterns.join('|')})`, 'giu');
  const out: Array<{ text: string; mark: boolean }> = [];
  let last = 0;
  for (const m of text.matchAll(re)) {
    const i = m.index ?? 0;
    if (i > last) out.push({ text: text.slice(last, i), mark: false });
    out.push({ text: m[0], mark: true });
    last = i + m[0].length;
  }
  if (last < text.length) out.push({ text: text.slice(last), mark: false });
  return out;
}
