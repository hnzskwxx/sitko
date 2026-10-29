import { z } from 'zod';
import { REQUIREMENT_CATEGORIES, VERDICTS } from '../../../shared/types.js';

// JSON schémata pro structured outputs (constrained decoding) a zod schémata,
// kterými výstup modelu znovu validujeme. Výstup AI je vždy nedůvěryhodný vstup.

const str = { type: 'string' } as const;
const strArr = { type: 'array', items: str } as const;
const obj = (properties: Record<string, unknown>) => ({
  type: 'object',
  properties,
  required: Object.keys(properties),
  additionalProperties: false,
});

export const SUGGEST_JSON_SCHEMA = obj({
  position: str,
  requirements: {
    type: 'array',
    items: obj({
      name: str,
      description: str,
      category: { type: 'string', enum: [...REQUIREMENT_CATEGORIES] },
      weight: { type: 'integer', enum: [1, 2, 3] },
      must_have: { type: 'boolean' },
      ad_quote: str,
    }),
  },
});

export const EVALUATE_JSON_SCHEMA = obj({
  candidate: obj({ name: str, email: str, phone: str, current_role: str }),
  profile: obj({
    skills: strArr,
    experience: { type: 'array', items: obj({ title: str, employer: str, period: str, summary: str }) },
    education: { type: 'array', items: obj({ institution: str, degree: str, period: str }) },
    languages: { type: 'array', items: obj({ language: str, level: str }) },
    certifications: strArr,
  }),
  requirements: {
    type: 'array',
    items: obj({
      id: str,
      verdict: { type: 'string', enum: [...VERDICTS] },
      quote: str,
      quote_cs: str,
      explanation: str,
      limitations: str,
    }),
  },
  summary: str,
  strengths: strArr,
  concerns: strArr,
  interview_questions: strArr,
  injection_detected: { type: 'boolean' },
});

export const TRANSCRIBE_JSON_SCHEMA = obj({
  readable: { type: 'boolean' },
  pages: { type: 'array', items: obj({ text: str }) },
});

// ---------- Validace výstupu ----------

const t = (max: number) => z.string().transform((s) => s.trim().slice(0, max));
const tList = (maxItems: number, maxLen: number) =>
  z.array(z.string()).transform((a) => a.map((s) => s.trim().slice(0, maxLen)).filter(Boolean).slice(0, maxItems));

/** Enum hodnoty mohou přijít s jinou velikostí písmen, sjednotíme je. */
const verdict = z.string().transform((s) => s.trim().toLowerCase()).pipe(z.enum(VERDICTS));
const category = z.string().transform((s) => s.trim().toLowerCase()).pipe(z.enum(REQUIREMENT_CATEGORIES));

export const SuggestOutput = z.object({
  position: t(160),
  requirements: z.array(z.object({
    name: t(120),
    description: t(400),
    category,
    weight: z.union([z.literal(1), z.literal(2), z.literal(3)]),
    must_have: z.boolean(),
    ad_quote: t(400),
  })).max(30),
});
export type SuggestOutput = z.infer<typeof SuggestOutput>;

export const EvaluateOutput = z.object({
  candidate: z.object({ name: t(120), email: t(200), phone: t(60), current_role: t(160) }),
  profile: z.object({
    skills: tList(40, 80),
    experience: z.array(z.object({ title: t(160), employer: t(160), period: t(80), summary: t(400) })).transform((a) => a.slice(0, 20)),
    education: z.array(z.object({ institution: t(200), degree: t(200), period: t(80) })).transform((a) => a.slice(0, 10)),
    languages: z.array(z.object({ language: t(60), level: t(80) })).transform((a) => a.slice(0, 10)),
    certifications: tList(20, 160),
  }),
  requirements: z.array(z.object({
    id: t(64),
    verdict,
    quote: t(600),
    quote_cs: t(600),
    explanation: t(600),
    limitations: t(400),
  })).max(30),
  summary: t(1200),
  strengths: tList(6, 300),
  concerns: tList(6, 300),
  interview_questions: tList(6, 400),
  injection_detected: z.boolean(),
});
export type EvaluateOutput = z.infer<typeof EvaluateOutput>;

export const TranscribeOutput = z.object({
  readable: z.boolean(),
  pages: z.array(z.object({ text: z.string() })).max(30),
});
export type TranscribeOutput = z.infer<typeof TranscribeOutput>;
