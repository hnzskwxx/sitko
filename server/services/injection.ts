// Heuristické hledání pokynů pro AI ukrytých v dokumentu (prompt injection).
// Nález neblokuje zpracování: model má pokyn obsah dokumentu nikdy neposlouchat,
// ale personalista uvidí upozornění a může CV projít ručně.

const PATTERNS: RegExp[] = [
  /ignore\s+(all\s+)?(the\s+)?(previous|prior|above|earlier)\s+(instructions|prompts?|rules)/i,
  /disregard\s+(all\s+)?(previous|prior|above)\s+(instructions|rules)/i,
  /(^|\n)\s*(system|assistant)\s*:\s*(ignore|disregard|you|your|new instructions|act as|ignoruj)/i,
  /you\s+are\s+(now\s+)?(an?\s+)?(ai|assistant|language model|chatgpt|claude)/i,
  /(rate|score|mark|rank)\s+(this|the|me)\s+(candidate\s+)?(as\s+)?(the\s+)?(highest|best|top|perfect|100)/i,
  /meets\s+every\s+(criterion|requirement)/i,
  /ignoruj(te)?\s+(všechny\s+)?(předchozí|výše\s+uvedené|dosavadní)\s+(pokyny|instrukce)/i,
  /(ohodnoť|ohodnoťte|označ|označte)\s+(mě|mne|tohoto\s+kandidáta|kandidáta)\s+(jako\s+)?(nejlépe|nejlepšího|nejvýše|100)/i,
  /<\s*\/?\s*(system|instructions?|prompt)\s*>/i,
  /\[\s*(system|inst)\s*\]/i,
];

export function detectInjection(text: string): boolean {
  const sample = text.slice(0, 100_000);
  return PATTERNS.some((re) => re.test(sample));
}
