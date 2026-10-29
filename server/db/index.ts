import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import type { StatementSync } from 'node:sqlite';
import { migrations } from './migrations.js';

// Vestavěné SQLite z Node.js (node:sqlite): žádný nativní modul, žádná kompilace při instalaci,
// funguje stejně na Windows, macOS, Linuxu i v Dockeru. Vyžaduje Node.js 22.13+.
// Modul se načítá přes require, abychom mohli potlačit upozornění „experimental feature“.
const originalEmitWarning = process.emitWarning;
process.emitWarning = ((warning: string | Error, ...rest: unknown[]) => {
  const msg = typeof warning === 'string' ? warning : warning?.message;
  if (msg?.includes('SQLite')) return;
  return (originalEmitWarning as (...a: unknown[]) => void).call(process, warning, ...rest);
}) as typeof process.emitWarning;
const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite') as typeof import('node:sqlite');
process.emitWarning = originalEmitWarning;

type Param = string | number | bigint | boolean | null | undefined | Uint8Array;
type Bound = string | number | bigint | null | Uint8Array;
const bind = (params: Param[]): Bound[] =>
  params.map((v) => (v === undefined ? null : typeof v === 'boolean' ? (v ? 1 : 0) : v));

export class Statement {
  constructor(private stmt: StatementSync) {}
  get(...params: Param[]): unknown {
    return this.stmt.get(...bind(params));
  }
  all(...params: Param[]): unknown[] {
    return this.stmt.all(...bind(params));
  }
  run(...params: Param[]): { changes: number; lastInsertRowid: number | bigint } {
    const r = this.stmt.run(...bind(params));
    return { changes: Number(r.changes), lastInsertRowid: r.lastInsertRowid };
  }
}

/** Tenká vrstva nad node:sqlite s transakcemi (vnořené přes SAVEPOINT) a mezipamětí dotazů. */
export class DB {
  private db: InstanceType<typeof DatabaseSync>;
  private cache = new Map<string, Statement>();
  private depth = 0;

  constructor(file: string) {
    this.db = new DatabaseSync(file);
  }

  prepare(sql: string): Statement {
    let s = this.cache.get(sql);
    if (!s) {
      s = new Statement(this.db.prepare(sql));
      if (this.cache.size < 500) this.cache.set(sql, s);
    }
    return s;
  }

  exec(sql: string): void {
    this.db.exec(sql);
  }

  pragma(setting: string): void {
    this.db.exec(`PRAGMA ${setting}`);
  }

  /** Stejné použití jako better-sqlite3: db.transaction(() => …)() */
  transaction<A extends unknown[], R>(fn: (...args: A) => R): (...args: A) => R {
    return (...args: A): R => {
      const savepoint = this.depth > 0 ? `sp_${this.depth}` : null;
      this.db.exec(savepoint ? `SAVEPOINT ${savepoint}` : 'BEGIN IMMEDIATE');
      this.depth++;
      try {
        const result = fn(...args);
        this.depth--;
        this.db.exec(savepoint ? `RELEASE ${savepoint}` : 'COMMIT');
        return result;
      } catch (err) {
        this.depth--;
        this.db.exec(savepoint ? `ROLLBACK TO ${savepoint}; RELEASE ${savepoint}` : 'ROLLBACK');
        throw err;
      }
    };
  }

  close(): void {
    this.cache.clear();
    this.db.close();
  }
}

export function openDb(file: string): DB {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DB(file);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');
  db.pragma('synchronous = NORMAL');
  migrate(db);
  return db;
}

export function migrate(db: DB): string[] {
  db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (id TEXT PRIMARY KEY, applied_at TEXT NOT NULL)`);
  const applied = new Set(
    (db.prepare('SELECT id FROM schema_migrations').all() as { id: string }[]).map((r) => r.id),
  );
  const done: string[] = [];
  for (const m of [...migrations].sort((a, b) => a.id.localeCompare(b.id))) {
    if (applied.has(m.id)) continue;
    db.transaction(() => {
      db.exec(m.sql);
      db.prepare('INSERT INTO schema_migrations (id, applied_at) VALUES (?, ?)').run(m.id, new Date().toISOString());
    })();
    done.push(m.id);
  }
  return done;
}

export const now = (): string => new Date().toISOString();
export const newId = (): string => randomUUID();
export const bool = (v: unknown): boolean => v === 1 || v === true;
