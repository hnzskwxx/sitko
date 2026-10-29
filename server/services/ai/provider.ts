import type { RequirementCategory, Weight } from '../../../shared/types.js';
import type { FileKind } from '../filetype.js';
import type { EvaluateOutput, SuggestOutput } from './schemas.js';

export interface AiUsage { inputTokens: number; outputTokens: number }

export interface EvalRequirement {
  id: string;
  name: string;
  description: string;
  category: RequirementCategory;
  weight: Weight;
  mustHave: boolean;
}

export interface EvalInput {
  jobTitle: string;
  adText: string;
  requirements: EvalRequirement[];
  pages: string[];
  documentSha256: string;
}

export interface AiProvider {
  /** 'ai' = skutečný model, 'demo' = předpřipravené výsledky ukázkové organizace. */
  readonly source: 'ai' | 'demo';
  readonly model: string;
  suggestRequirements(adText: string): Promise<{ result: SuggestOutput; usage: AiUsage }>;
  transcribe(file: { kind: FileKind; mime: string; buffer: Buffer }): Promise<{ pages: string[]; usage: AiUsage }>;
  evaluate(input: EvalInput): Promise<{ result: EvaluateOutput; usage: AiUsage }>;
  /**
   * Volitelné omezení nahrávání: když vrátí false, soubor se vůbec neuloží.
   * Ukázková organizace tak přijme jen ukázkové životopisy (na veřejném demu ji sdílí víc lidí).
   */
  acceptsDocument?(sha256: string): boolean;
}

/**
 * Chyba AI vrstvy. transient = má smysl opakovat (429, 5xx, síť),
 * permanent = opakování nepomůže (nečitelný vstup, neplatný klíč, odmítnutí).
 */
export class AiError extends Error {
  constructor(
    public kind: 'transient' | 'permanent',
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

export const NO_USAGE: AiUsage = { inputTokens: 0, outputTokens: 0 };
