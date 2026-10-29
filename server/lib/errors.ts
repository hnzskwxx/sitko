import type { NextFunction, Request, Response } from 'express';
import { ZodError, type ZodType } from 'zod';
import multer from 'multer';
import { log } from './logger.js';

/** Chyba se zprávou bezpečnou pro uživatele. */
export class AppError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public fields?: Record<string, string>,
  ) {
    super(message);
  }
}

export const notFound = (what = 'Záznam'): AppError => new AppError(404, 'not_found', `${what} neexistuje.`);
export const forbidden = (msg = 'K této akci nemáte oprávnění.'): AppError => new AppError(403, 'forbidden', msg);

/** Validuje vstup schématem; při chybě vyhodí 400 s chybami u jednotlivých polí. */
export function parse<T>(schema: ZodType<T>, input: unknown): T {
  const r = schema.safeParse(input);
  if (r.success) return r.data;
  throw zodToAppError(r.error);
}

function zodToAppError(err: ZodError): AppError {
  const fields: Record<string, string> = {};
  for (const issue of err.issues) {
    const key = issue.path.join('.') || '_';
    if (!fields[key]) fields[key] = issue.message;
  }
  return new AppError(400, 'validation_error', 'Zkontrolujte vyplněné údaje.', fields);
}

export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction): void {
  if (res.headersSent) return;
  if (err instanceof AppError) {
    res.status(err.status).json({ error: { code: err.code, message: err.message, fields: err.fields } });
    return;
  }
  if (err instanceof ZodError) {
    const e = zodToAppError(err);
    res.status(400).json({ error: { code: e.code, message: e.message, fields: e.fields } });
    return;
  }
  if (err instanceof multer.MulterError) {
    const msg = err.code === 'LIMIT_FILE_SIZE' ? 'Soubor je příliš velký.'
      : err.code === 'LIMIT_FILE_COUNT' ? 'Najednou můžete nahrát méně souborů.'
        : 'Soubor se nepodařilo přijmout.';
    res.status(err.code === 'LIMIT_FILE_SIZE' ? 413 : 400).json({ error: { code: 'upload_error', message: msg } });
    return;
  }
  const e = err as { type?: string; status?: number };
  if (e?.type === 'entity.too.large') {
    res.status(413).json({ error: { code: 'too_large', message: 'Požadavek je příliš velký.' } });
    return;
  }
  if (e?.type === 'entity.parse.failed') {
    res.status(400).json({ error: { code: 'bad_json', message: 'Neplatný formát požadavku.' } });
    return;
  }
  log.error('unhandled_error', { path: req.path, method: req.method, err: err instanceof Error ? err.message : String(err) });
  res.status(500).json({ error: { code: 'internal_error', message: 'Na serveru došlo k chybě. Zkuste to prosím znovu.' } });
}
