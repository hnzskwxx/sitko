import fs from 'node:fs';
import path from 'node:path';
import { sha256 } from '../../lib/security.js';
import { normalizeForMatch } from '../evidence.js';
import { AiError, NO_USAGE, type AiProvider, type EvalInput } from './provider.js';
import { EvaluateOutput, SuggestOutput } from './schemas.js';

// Poskytovatel pro ukázkovou organizaci. Vrací PŘEDPŘIPRAVENÉ výsledky
// k ukázkovým souborům z ./ukazka. Hodnocení se ukládá se zdrojem 'demo'
// a v UI je zřetelně označené. Cokoli jiného odmítne, nic si nevymýšlí.

type DemoVerdict = [string, string, string, string, string];
interface DemoCandidate {
  candidate: { name: string; email: string; phone: string; current_role: string };
  profile: unknown;
  verdicts: Record<string, DemoVerdict>;
  summary: string;
  strengths: string[];
  concerns: string[];
  interview_questions: string[];
  injection_detected: boolean;
}
interface DemoData {
  suggestion: { position: string; requirements: Array<Record<string, unknown> & { key: string }> };
  candidates: Record<string, DemoCandidate>;
}

const KEYWORDS: Array<[string, RegExp]> = [
  ['erp', /erp|helios|pohoda|sap/i],
  ['ridic', /řidič|průkaz|ridic|prukaz/i],
  ['excel', /excel/i],
  ['nemcina', /němč|nemc|german/i],
  ['maturita', /maturit|vzdělání|vzdelani/i],
  ['praxe', /praxe|obchod|nákup|nakup/i],
];

export class DemoProvider implements AiProvider {
  readonly source = 'demo' as const;
  readonly model = 'ukázková data';
  private data: DemoData;
  private adKey: string;
  private bySha = new Map<string, DemoCandidate>();

  constructor(samplesDir: string) {
    this.data = JSON.parse(fs.readFileSync(path.join(samplesDir, 'demo-data.json'), 'utf8')) as DemoData;
    this.adKey = normalizeForMatch(fs.readFileSync(path.join(samplesDir, 'inzerat.txt'), 'utf8'));
    for (const [file, c] of Object.entries(this.data.candidates)) {
      const p = path.join(samplesDir, file);
      if (fs.existsSync(p)) this.bySha.set(sha256(fs.readFileSync(p)), c);
    }
  }

  async suggestRequirements(adText: string) {
    if (normalizeForMatch(adText) !== this.adKey) {
      throw new AiError('permanent', 'demo_only', 'V ukázkové organizaci umí návrh požadavků jen ukázkový inzerát. Požadavky přidejte ručně.');
    }
    const result = SuggestOutput.parse({
      position: this.data.suggestion.position,
      requirements: this.data.suggestion.requirements.map(({ key: _key, ...r }) => r),
    });
    return { result, usage: NO_USAGE };
  }

  acceptsDocument(sha: string): boolean {
    return this.bySha.has(sha);
  }

  async transcribe(): Promise<never> {
    throw new AiError('permanent', 'demo_only', 'V ukázkové organizaci se skenované dokumenty nezpracovávají.');
  }

  async evaluate(input: EvalInput) {
    const c = this.bySha.get(input.documentSha256);
    if (!c) {
      throw new AiError('permanent', 'demo_only', 'V ukázkové organizaci se hodnotí jen ukázkové životopisy. Skutečné CV nahrajte do své organizace.');
    }
    const result = EvaluateOutput.parse({
      candidate: c.candidate,
      profile: c.profile,
      requirements: input.requirements.map((r) => {
        const key = KEYWORDS.find(([, re]) => re.test(`${r.name} ${r.description}`))?.[0];
        const v = key ? c.verdicts[key] : undefined;
        return v
          ? { id: r.id, verdict: v[0], quote: v[1], quote_cs: v[2], explanation: v[3], limitations: v[4] }
          : { id: r.id, verdict: 'nelze_overit', quote: '', quote_cs: '', explanation: 'Vlastní požadavky se v ukázkové organizaci nevyhodnocují.', limitations: '' };
      }),
      summary: c.summary,
      strengths: c.strengths,
      concerns: c.concerns,
      interview_questions: c.interview_questions,
      injection_detected: c.injection_detected,
    });
    return { result, usage: NO_USAGE };
  }
}
