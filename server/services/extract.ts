import mammoth from 'mammoth';
import { extractText as pdfExtract, getDocumentProxy } from 'unpdf';
import type { FileKind } from './filetype.js';

export interface ExtractedText {
  pages: string[];
  source: 'pdf' | 'docx' | 'txt';
}

export class ExtractionError extends Error {}

const MAX_CHARS = 80_000;
/** Pod touto hranicí znaků považujeme PDF za sken bez textové vrstvy. */
const MIN_TEXT_CHARS = 80;

export function cleanPage(text: string): string {
  return text
    .replace(/\r\n?/g, '\n')
    .replace(/[\t\f\v\u00a0]+/g, ' ')
    .replace(/ {2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

const meaningfulLength = (pages: string[]): number => pages.join('').replace(/\s+/g, '').length;

/**
 * Vytáhne text z dokumentu. Vrací null, pokud dokument nemá textovou vrstvu
 * (sken PDF nebo obrázek) a je potřeba OCR.
 */
export async function extractDocumentText(kind: FileKind, buf: Buffer): Promise<ExtractedText | null> {
  if (kind === 'png' || kind === 'jpeg') return null;

  if (kind === 'txt') {
    const pages = [cleanPage(buf.toString('utf8'))];
    if (meaningfulLength(pages) === 0) throw new ExtractionError('Textový soubor je prázdný.');
    return { pages: limit(pages), source: 'txt' };
  }

  if (kind === 'docx') {
    let value: string;
    try {
      ({ value } = await mammoth.extractRawText({ buffer: buf }));
    } catch {
      throw new ExtractionError('Dokument DOCX je poškozený nebo zaheslovaný.');
    }
    const pages = [cleanPage(value)];
    if (meaningfulLength(pages) === 0) throw new ExtractionError('V dokumentu DOCX není žádný text.');
    return { pages: limit(pages), source: 'docx' };
  }

  // PDF
  let pages: string[];
  try {
    const pdf = await getDocumentProxy(new Uint8Array(buf), { disableFontFace: true, enableXfa: false });
    const r = await pdfExtract(pdf, { mergePages: false });
    pages = (r.text as string[]).map(cleanPage);
    await pdf.loadingTask.destroy();
  } catch (err) {
    const msg = err instanceof Error ? err.message : '';
    if (/password/i.test(msg)) throw new ExtractionError('PDF je chráněné heslem. Nahrajte verzi bez hesla.');
    throw new ExtractionError('PDF je poškozené a nejde přečíst.');
  }
  if (meaningfulLength(pages) < MIN_TEXT_CHARS) return null;
  return { pages: limit(pages), source: 'pdf' };
}

/** Ořízne celkovou délku textu, aby jedno CV nemohlo vyčerpat rozpočet. */
function limit(pages: string[]): string[] {
  let total = 0;
  const out: string[] = [];
  for (const p of pages) {
    if (total >= MAX_CHARS) break;
    out.push(p.slice(0, MAX_CHARS - total));
    total += p.length;
  }
  return out;
}

/** Text inzerátu z nahraného souboru (PDF, DOCX, TXT). */
export async function extractAdText(kind: FileKind, buf: Buffer): Promise<string> {
  if (kind === 'png' || kind === 'jpeg') throw new ExtractionError('Inzerát nahrajte jako PDF, DOCX nebo TXT, případně text vložte.');
  const r = await extractDocumentText(kind, buf);
  if (!r) throw new ExtractionError('PDF neobsahuje text (jde nejspíš o sken). Text inzerátu vložte ručně.');
  return r.pages.join('\n\n').slice(0, 20_000);
}
