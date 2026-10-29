import path from 'node:path';

export interface Config {
  isProd: boolean;
  port: number;
  dataDir: string;
  dbPath: string;
  uploadDir: string;
  publicUrl: string | null;
  cookieSecure: boolean;
  allowRegistration: boolean;
  /** Když je nastavený, registrace nové firmy vyžaduje tento kód (ochrana API klíče na veřejném webu). */
  registrationCode: string | null;
  /** Ukázka se připravuje při startu a přihlašovací stránka nabízí vstup do ní. */
  demoOnStart: boolean;
  /** Placené členství: AI jen pro firmy s aktivním předplatným, limit podle tarifu. */
  subscriptions: boolean;
  /** E-maily provozovatelů (malými písmeny), kteří vidí Správu. */
  adminEmails: string[];
  /** Kontakt na provozovatele, který firmy vidí u předplatného. */
  billingContact: string | null;
  sessionDays: number;
  ai: {
    apiKey: string | null;
    baseUrl: string | null;
    model: string;
    effort: 'low' | 'medium' | 'high' | null;
    concurrency: number;
    monthlyLimit: number;
  };
  upload: { maxFileMb: number; maxFiles: number };
}

const int = (v: string | undefined, def: number, min: number, max: number): number => {
  const n = Number.parseInt(v ?? '', 10);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : def;
};

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const isProd = env.NODE_ENV === 'production';
  const dataDir = path.resolve(env.DATA_DIR || 'data');
  const effort = env.AI_EFFORT;
  return {
    isProd,
    port: int(env.PORT, 3000, 1, 65535),
    dataDir,
    dbPath: env.DATABASE_PATH ? path.resolve(env.DATABASE_PATH) : path.join(dataDir, 'sitko.db'),
    uploadDir: path.join(dataDir, 'uploads'),
    // Render nastavuje RENDER_EXTERNAL_URL sám (https://<služba>.onrender.com)
    publicUrl: (env.PUBLIC_URL || env.RENDER_EXTERNAL_URL)?.trim().replace(/\/$/, '') || null,
    cookieSecure: env.COOKIE_SECURE ? env.COOKIE_SECURE === 'true' : isProd,
    allowRegistration: env.ALLOW_REGISTRATION !== 'false',
    registrationCode: env.REGISTRATION_CODE?.trim() || null,
    demoOnStart: env.SEED_DEMO_ON_START === 'true',
    subscriptions: env.SUBSCRIPTIONS === 'true',
    adminEmails: (env.ADMIN_EMAILS ?? '').split(',').map((e) => e.trim().toLowerCase()).filter(Boolean),
    billingContact: env.BILLING_CONTACT?.trim() || null,
    sessionDays: int(env.SESSION_DAYS, 14, 1, 90),
    ai: {
      apiKey: env.ANTHROPIC_API_KEY?.trim() || null,
      baseUrl: env.ANTHROPIC_BASE_URL?.trim() || null,
      model: env.AI_MODEL?.trim() || 'claude-sonnet-5-5',
      effort: effort === 'low' || effort === 'medium' || effort === 'high' ? effort : null,
      concurrency: int(env.AI_CONCURRENCY, 3, 1, 10),
      monthlyLimit: int(env.MONTHLY_EVALUATION_LIMIT, 1000, 1, 1_000_000),
    },
    upload: {
      maxFileMb: int(env.MAX_FILE_MB, 10, 1, 25),
      maxFiles: int(env.MAX_FILES_PER_UPLOAD, 50, 1, 200),
    },
  };
}
