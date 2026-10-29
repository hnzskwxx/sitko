import type { Config } from './config.js';
import type { DB } from './db/index.js';
import type { ProcessingQueue, ProviderResolver } from './services/queue.js';
import type { FileStorage } from './services/storage.js';

export interface Ctx {
  db: DB;
  config: Config;
  storage: FileStorage;
  queue: ProcessingQueue;
  providers: ProviderResolver;
}

export function pageParams(q: Record<string, unknown>, defSize = 25): { page: number; pageSize: number } {
  const page = Math.max(1, Number.parseInt(String(q.page ?? '1'), 10) || 1);
  const pageSize = Math.min(100, Math.max(1, Number.parseInt(String(q.pageSize ?? defSize), 10) || defSize));
  return { page, pageSize };
}
