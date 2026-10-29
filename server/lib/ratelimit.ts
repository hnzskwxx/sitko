import type { NextFunction, Request, Response } from 'express';
import { AppError } from './errors.js';

/**
 * Jednoduchý rate limiter s pevným oknem v paměti procesu.
 * Stačí pro jednu instanci serveru; při škálování nahradit sdíleným úložištěm.
 */
export class RateLimiter {
  private hits = new Map<string, { count: number; resetAt: number }>();

  constructor(private limit: number, private windowMs: number) {
    setInterval(() => this.sweep(), Math.min(windowMs, 60_000)).unref();
  }

  /** Vrátí true, pokud je požadavek povolen. */
  take(key: string): boolean {
    const now = Date.now();
    const entry = this.hits.get(key);
    if (!entry || entry.resetAt <= now) {
      this.hits.set(key, { count: 1, resetAt: now + this.windowMs });
      return true;
    }
    entry.count++;
    return entry.count <= this.limit;
  }

  reset(key: string): void { this.hits.delete(key); }

  private sweep(): void {
    const now = Date.now();
    for (const [k, v] of this.hits) if (v.resetAt <= now) this.hits.delete(k);
  }
}

export function rateLimit(limiter: RateLimiter, keyFn: (req: Request) => string, message: string) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!limiter.take(keyFn(req))) {
      next(new AppError(429, 'rate_limited', message));
      return;
    }
    next();
  };
}
