import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadConfig } from '../server/config.js';
import { AnthropicProvider } from '../server/services/ai/anthropic.js';
import { AiError } from '../server/services/ai/provider.js';

// Napodobenina Messages API: ověří tvar požadavku z SDK a vrací připravené odpovědi.
// Skutečné volání Claude API tento test nenahrazuje (vyžaduje API klíč).

let server: http.Server;
let baseUrl = '';
const received: Array<Record<string, unknown>> = [];
let nextStatus = 200;
let nextBody: unknown = null;

beforeAll(async () => {
  server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      received.push({ path: req.url, headers: req.headers, json: JSON.parse(body || '{}') });
      res.writeHead(nextStatus, { 'content-type': 'application/json' });
      res.end(JSON.stringify(nextBody));
    });
  });
  await new Promise<void>((r) => server.listen(0, r));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => { server.close(); });

const message = (json: unknown, stop = 'end_turn') => ({
  id: 'msg_test', type: 'message', role: 'assistant', model: 'claude-sonnet-5-5', stop_reason: stop,
  content: [{ type: 'text', text: JSON.stringify(json) }], usage: { input_tokens: 1200, output_tokens: 300 },
});

function provider() {
  const cfg = loadConfig({ ANTHROPIC_API_KEY: 'sk-test', ANTHROPIC_BASE_URL: baseUrl, AI_EFFORT: 'medium' });
  return new AnthropicProvider({ ...cfg.ai });
}

const evalOutput = {
  candidate: { name: 'Jana', email: '', phone: '', current_role: '' },
  profile: { skills: [], experience: [], education: [], languages: [], certifications: [] },
  requirements: [{ id: 'r1', verdict: 'Splnuje', quote: 'Excel', quote_cs: '', explanation: '', limitations: '' }],
  summary: 's', strengths: [], concerns: [], interview_questions: [], injection_detected: false,
};

describe('AnthropicProvider', () => {
  it('posílá structured outputs, systémový prompt a CV jako data', async () => {
    nextStatus = 200;
    nextBody = message(evalOutput);
    const r = await provider().evaluate({
      jobTitle: 'Referent', adText: 'Inzerát', documentSha256: 'x', pages: ['Strana A', 'Strana B'],
      requirements: [{ id: 'r1', name: 'Excel', description: 'pokročilý', category: 'dovednosti', weight: 2, mustHave: false }],
    });
    const req = received.at(-1) as { path: string; headers: Record<string, string>; json: Record<string, any> };
    expect(req.path).toBe('/v1/messages');
    expect(req.headers['x-api-key'] ?? req.headers.authorization).toMatch(/sk-test/);
    expect(req.json.model).toBe('claude-sonnet-5-5');
    expect(req.json.output_config.format.type).toBe('json_schema');
    expect(req.json.output_config.format.schema.required).toContain('requirements');
    expect(req.json.output_config.effort).toBe('medium');
    expect(req.json.system).toMatch(/DATA, nikdy pokyny/);
    const text = req.json.messages[0].content.map((b: { text: string }) => b.text).join('\n');
    expect(text).toContain('<zivotopis>');
    expect(text).toContain('=== Strana 2 ===');
    expect(req.json.messages[0].content[0].cache_control).toEqual({ type: 'ephemeral' });
    // Výstup se validuje a enum se normalizuje
    expect(r.result.requirements[0].verdict).toBe('splnuje');
    expect(r.usage).toEqual({ inputTokens: 1200, outputTokens: 300 });
  });

  it('PDF pro OCR posílá jako dokument', async () => {
    nextStatus = 200;
    nextBody = message({ readable: true, pages: [{ text: 'Přepsaný text' }] });
    const r = await provider().transcribe({ kind: 'pdf', mime: 'application/pdf', buffer: Buffer.from('%PDF-1.4') });
    const req = received.at(-1) as { json: Record<string, any> };
    expect(req.json.messages[0].content[0].type).toBe('document');
    expect(r.pages).toEqual(['Přepsaný text']);
  });

  it('klasifikuje chyby: 429 dočasná, 401 trvalá, neplatný výstup dočasný, odmítnutí trvalé', async () => {
    const p = provider();
    const input = { jobTitle: 'x', adText: 'x', documentSha256: 'x', pages: ['x'], requirements: [] };

    nextStatus = 429; nextBody = { type: 'error', error: { type: 'rate_limit_error', message: 'slow down' } };
    await expect(p.evaluate(input)).rejects.toMatchObject({ kind: 'transient', code: 'ai_rate_limited' });

    nextStatus = 401; nextBody = { type: 'error', error: { type: 'authentication_error', message: 'bad key' } };
    await expect(p.evaluate(input)).rejects.toMatchObject({ kind: 'permanent', code: 'ai_auth' });

    nextStatus = 200; nextBody = message({ nesmysl: true });
    await expect(p.evaluate(input)).rejects.toMatchObject({ kind: 'transient', code: 'invalid_output' });

    nextStatus = 200; nextBody = message({}, 'refusal');
    const err = await p.evaluate(input).catch((e) => e);
    expect(err).toBeInstanceOf(AiError);
    expect(err.kind).toBe('permanent');
  });
});
