import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import request from 'supertest';
import { createApp, finalize } from '../server/app.js';
import { loadConfig } from '../server/config.js';
import type { Ctx } from '../server/context.js';
import { openDb } from '../server/db/index.js';
import { AiError, type AiProvider, type EvalInput } from '../server/services/ai/provider.js';
import { EvaluateOutput, SuggestOutput } from '../server/services/ai/schemas.js';
import { ProcessingQueue } from '../server/services/queue.js';
import { FileStorage } from '../server/services/storage.js';
import { quotaFor } from '../server/services/subscription.js';

export const SAMPLES = path.resolve(import.meta.dirname, '..', 'ukazka');
export const sample = (name: string): Buffer => fs.readFileSync(path.join(SAMPLES, name));
export const AD = fs.readFileSync(path.join(SAMPLES, 'inzerat.txt'), 'utf8');

/** Testovací AI: deterministické odpovědi, volitelně selhání. */
export class FakeProvider implements AiProvider {
  readonly source = 'ai' as const;
  readonly model = 'fake-model';
  failNext: AiError | null = null;
  calls = 0;

  async suggestRequirements() {
    return {
      result: SuggestOutput.parse({
        position: 'Obchodní referent',
        requirements: [
          { name: 'Praxe 2+ roky', description: 'Praxe v obchodě', category: 'zkusenosti', weight: 3, must_have: true, ad_quote: 'praxe v obchodě nebo nákupu min. 2 roky (podmínka)' },
          { name: 'Excel', description: 'Pokročilý Excel', category: 'dovednosti', weight: 2, must_have: false, ad_quote: 'pokročilá znalost MS Excel' },
          // Povinný požadavek, který v inzerátu není: server ho nesmí přijmout jako povinný
          { name: 'Vysoká škola', description: 'VŠ vzdělání', category: 'vzdelani', weight: 3, must_have: true, ad_quote: 'vysokoškolské vzdělání nutné' },
        ],
      }),
      usage: { inputTokens: 100, outputTokens: 50 },
    };
  }

  async transcribe() {
    return { pages: ['Přepsaný text skenu: Excel pokročilý, praxe 3 roky'], usage: { inputTokens: 10, outputTokens: 10 } };
  }

  async evaluate(input: EvalInput) {
    this.calls++;
    if (this.failNext) {
      const e = this.failNext;
      this.failNext = null;
      throw e;
    }
    const text = input.pages.join('\n');
    const firstLine = text.split('\n').find((l) => l.trim().length > 5) ?? '';
    const result = EvaluateOutput.parse({
      candidate: { name: firstLine.slice(0, 40), email: text.match(/[\w.]+@example\.(cz|com)/)?.[0] ?? '', phone: '', current_role: 'Testovací role' },
      profile: { skills: ['Excel'], experience: [], education: [], languages: [], certifications: [] },
      requirements: input.requirements.map((r, i) => i === 0
        ? { id: r.id, verdict: 'splnuje', quote: firstLine, quote_cs: '', explanation: 'Doloženo.', limitations: '' }
        : { id: r.id, verdict: 'castecne', quote: 'Tato věta v životopise vůbec není', quote_cs: '', explanation: 'Vymyšlená citace.', limitations: '' }),
      summary: 'Testovací shrnutí.',
      strengths: ['A'], concerns: ['B'], interview_questions: ['Otázka?'],
      injection_detected: false,
    });
    return { result, usage: { inputTokens: 1000, outputTokens: 200 } };
  }
}

export function makeTestApp(provider: AiProvider | null = new FakeProvider(), env: Record<string, string> = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sitko-test-'));
  const config = loadConfig({ NODE_ENV: 'test', DATA_DIR: dir, MONTHLY_EVALUATION_LIMIT: '1000', ...env });
  const db = openDb(':memory:');
  const storage = new FileStorage(path.join(dir, 'uploads'));
  const providers = { forOrg: () => provider };
  const queue = new ProcessingQueue(db, storage, providers, { concurrency: 2, monthlyLimit: config.ai.monthlyLimit, quota: (orgId) => quotaFor(db, config, orgId) });
  const ctx: Ctx = { db, config, storage, queue, providers };
  const express = createApp(ctx, { csp: false });
  finalize(express);
  const app = express.listen(0);
  return {
    app, ctx, dir, queue,
    cleanup: () => { app.close(); db.close(); fs.rmSync(dir, { recursive: true, force: true }); },
  };
}

export const H = { 'X-Sitko-Request': '1' };

export async function registerAgent(app: Parameters<typeof request.agent>[0], email: string, org = 'Firma') {
  const agent = request.agent(app);
  const r = await agent.post('/api/v1/auth/register').set(H)
    .send({ organizationName: org, name: 'Test Uživatel', email, password: 'dostatecne-dlouhe-heslo' });
  if (r.status !== 201) throw new Error(`register failed ${r.status} ${JSON.stringify(r.body)}`);
  return agent;
}
