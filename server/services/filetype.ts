import path from 'node:path';

export type FileKind = 'pdf' | 'docx' | 'txt' | 'png' | 'jpeg';

export interface DetectedFile { kind: FileKind; mime: string }

export const SUPPORTED_FORMATS = ['PDF', 'DOCX', 'TXT', 'JPG', 'PNG'];

export class UnsupportedFileError extends Error {}

/** Určí skutečný typ souboru podle obsahu (magické bajty), přípona slouží jen jako doplněk. */
export function detectFile(name: string, buf: Buffer): DetectedFile {
  const ext = path.extname(name).toLowerCase();
  if (buf.length === 0) throw new UnsupportedFileError('Soubor je prázdný.');
  const head = buf.length >= 4 ? buf.readUInt32BE(0) : -1;
  if (buf.subarray(0, 5).toString('latin1') === '%PDF-') return { kind: 'pdf', mime: 'application/pdf' };
  if (head === 0x89504e47) return { kind: 'png', mime: 'image/png' };
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return { kind: 'jpeg', mime: 'image/jpeg' };
  if (head === 0xd0cf11e0) {
    throw new UnsupportedFileError('Starý formát Word (.doc) neumíme přečíst. Uložte životopis jako PDF nebo DOCX.');
  }
  if (buf.length >= 4 && buf[0] === 0x50 && buf[1] === 0x4b) {
    // ZIP: přijímáme jen DOCX (obsahuje word/document.xml)
    if (buf.includes('word/document.xml')) {
      return { kind: 'docx', mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' };
    }
    throw new UnsupportedFileError('Tento typ archivu neumíme přečíst. Použijte PDF nebo DOCX.');
  }
  if (ext === '.txt' && isPlainUtf8(buf)) return { kind: 'txt', mime: 'text/plain' };
  throw new UnsupportedFileError(`Formát souboru neumíme přečíst. Podporujeme ${SUPPORTED_FORMATS.join(', ')}.`);
}

function isPlainUtf8(buf: Buffer): boolean {
  if (buf.includes(0)) return false;
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(buf);
    return true;
  } catch {
    return false;
  }
}
