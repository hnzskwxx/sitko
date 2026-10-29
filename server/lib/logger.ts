// Strukturované logy na stdout. Nikdy sem neposílejte text životopisu ani prompt.

type Level = 'debug' | 'info' | 'warn' | 'error';
const ORDER: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };
const min = ORDER[(process.env.LOG_LEVEL as Level) || 'info'] ?? 20;
const silent = process.env.NODE_ENV === 'test' && !process.env.LOG_LEVEL;

function write(level: Level, event: string, data?: Record<string, unknown>): void {
  if (silent || ORDER[level] < min) return;
  const line = JSON.stringify({ ts: new Date().toISOString(), level, event, ...data });
  if (level === 'error' || level === 'warn') process.stderr.write(line + '\n');
  else process.stdout.write(line + '\n');
}

export const log = {
  debug: (e: string, d?: Record<string, unknown>) => write('debug', e, d),
  info: (e: string, d?: Record<string, unknown>) => write('info', e, d),
  warn: (e: string, d?: Record<string, unknown>) => write('warn', e, d),
  error: (e: string, d?: Record<string, unknown>) => write('error', e, d),
};
