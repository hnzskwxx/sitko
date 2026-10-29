// Sdílené typy API mezi serverem a webem. Jediný zdroj pravdy pro tvar odpovědí.

export const ROLES = ['owner', 'recruiter'] as const;
export type Role = (typeof ROLES)[number];

export const JOB_STATUSES = ['draft', 'active', 'closed', 'archived'] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];

export const REQUIREMENT_CATEGORIES = ['zkusenosti', 'dovednosti', 'vzdelani', 'jazyky', 'certifikace', 'ostatni'] as const;
export type RequirementCategory = (typeof REQUIREMENT_CATEGORIES)[number];

export const VERDICTS = ['splnuje', 'castecne', 'nesplnuje', 'nelze_overit'] as const;
export type Verdict = (typeof VERDICTS)[number];

export const PROCESSING_STATUSES = ['queued', 'extracting', 'evaluating', 'done', 'failed'] as const;
export type ProcessingStatus = (typeof PROCESSING_STATUSES)[number];

export const DECISIONS = ['pozvat', 'mozna', 'odmitnout'] as const;
export type Decision = (typeof DECISIONS)[number];

export type MustStatus = 'met' | 'unmet' | 'unknown' | 'none';
export type QuoteStatus = 'exact' | 'approximate' | 'not_found' | 'none';
export type Weight = 1 | 2 | 3;

// ---------- Obálky odpovědí ----------

export interface ApiError {
  error: { code: string; message: string; fields?: Record<string, string> };
}
export interface ApiData<T> { data: T }
export interface ApiList<T> {
  data: T[];
  meta: { page: number; pageSize: number; total: number };
}

// ---------- Uživatel a organizace ----------

export interface Me {
  user: { id: string; email: string; name: string };
  organization: { id: string; name: string; isDemo: boolean; retentionDays: number; subscription: Subscription };
  role: Role;
  /** Provozovatel Sítka (ADMIN_EMAILS): vidí Správu firem a tarifů. */
  isPlatformAdmin: boolean;
}

// ---------- Předplatné ----------

export const SUBSCRIPTION_STATUSES = ['active', 'pending', 'expired', 'demo', 'unlimited'] as const;
export type SubscriptionStatus = (typeof SUBSCRIPTION_STATUSES)[number];
export const SUBSCRIPTION_STATUS_LABEL: Record<SubscriptionStatus, string> = {
  active: 'Aktivní',
  pending: 'Čeká na aktivaci',
  expired: 'Vypršelo',
  demo: 'Ukázka',
  unlimited: 'Bez omezení',
};

export interface Plan {
  id: string;
  name: string;
  monthlyCvLimit: number;
  /** Cena za měsíc v Kč; null = zatím nenastavená. */
  priceCzk: number | null;
  /** Nabízí se firmám k objednání. */
  isPublic: boolean;
  position: number;
  /** Jen ve Správě: kolik firem tarif má. */
  organizations?: number;
}

export interface Subscription {
  /** false = server běží bez placeného členství (vývoj, vlastní provoz). */
  enabled: boolean;
  status: SubscriptionStatus;
  /** Smí firma používat AI (hodnocení, návrhy požadavků). */
  canEvaluate: boolean;
  plan: { id: string; name: string } | null;
  monthlyLimit: number;
  /** Poslední den předplatného (YYYY-MM-DD, včetně). */
  paidUntil: string | null;
  daysLeft: number | null;
  requestedPlan: { id: string; name: string } | null;
  requestedAt: string | null;
}

export interface BillingInfo {
  name: string;
  ico: string;
  dic: string;
  address: string;
  email: string;
}

export interface SubscriptionOverview {
  subscription: Subscription;
  plans: Plan[];
  billing: BillingInfo;
  /** Kontakt na provozovatele (BILLING_CONTACT). */
  contact: string | null;
  monthEvaluations: number;
}

export interface AdminOrgRow {
  id: string;
  name: string;
  createdAt: string;
  owner: { name: string; email: string } | null;
  members: number;
  subscription: Subscription;
  monthEvaluations: number;
}

export interface AdminOrgDetail extends AdminOrgRow {
  billing: BillingInfo;
  adminNote: string;
  jobs: number;
  candidates: number;
  lastActivityAt: string | null;
}

export interface Member {
  userId: string;
  name: string;
  email: string;
  role: Role;
  joinedAt: string;
  isYou: boolean;
}

export interface Invite {
  id: string;
  role: Role;
  email: string | null;
  createdAt: string;
  expiresAt: string;
  url?: string; // jen v odpovědi na vytvoření
}

export interface Usage {
  aiConfigured: boolean;
  model: string | null;
  monthEvaluations: number;
  monthlyLimit: number;
  monthInputTokens: number;
  monthOutputTokens: number;
  maxFileMb: number;
  supportedFormats: string[];
}

// ---------- Pozice a požadavky ----------

export interface Requirement {
  id: string;
  name: string;
  description: string;
  category: RequirementCategory;
  weight: Weight;
  mustHave: boolean;
  origin: 'ai' | 'user';
  adQuote: string | null;
}

/** Návrh požadavku od AI (ještě neuložený). */
export interface RequirementSuggestion extends Omit<Requirement, 'id'> {
  sourceFound: boolean; // citace z inzerátu byla v inzerátu skutečně nalezena
}

export interface JobCounts {
  total: number;
  processing: number;
  failed: number;
  done: number;
  stale: number;
  undecided: number;
}

export interface JobSummary {
  id: string;
  title: string;
  status: JobStatus;
  requirementsConfirmed: boolean;
  counts: JobCounts;
  createdAt: string;
  updatedAt: string;
}

export interface JobDetail extends JobSummary {
  adText: string;
  requirementsVersion: number;
  requirements: Requirement[];
}

// ---------- Přihlášky a hodnocení ----------

export interface ApplicationRow {
  id: string;
  candidateId: string | null;
  candidateName: string | null;
  currentRole: string | null;
  fileName: string;
  status: ProcessingStatus;
  errorMessage: string | null;
  canRetry: boolean;
  decision: Decision | null;
  score: number | null;
  coverage: number | null;
  mustStatus: MustStatus | null;
  metCount: number | null;
  requirementCount: number | null;
  unverifiedCount: number | null;
  injectionFlag: boolean;
  possibleDuplicate: boolean;
  stale: boolean;
  isDemo: boolean;
  createdAt: string;
}

export interface UploadResult {
  fileName: string;
  outcome: 'queued' | 'duplicate' | 'rejected';
  message: string | null;
  applicationId: string | null;
}

export interface ProfileExperience { title: string; employer: string; period: string; summary: string }
export interface ProfileEducation { institution: string; degree: string; period: string }
export interface ProfileLanguage { language: string; level: string }
export interface CandidateProfile {
  skills: string[];
  experience: ProfileExperience[];
  education: ProfileEducation[];
  languages: ProfileLanguage[];
  certifications: string[];
}

export interface EvaluationItem {
  id: string;
  requirementId: string | null;
  name: string;
  weight: Weight;
  mustHave: boolean;
  aiVerdict: Verdict;
  verdict: Verdict; // platný verdikt (oprava personalisty má přednost)
  quote: string;
  quoteCs: string;
  quoteStatus: QuoteStatus;
  quotePage: number | null;
  explanation: string;
  limitations: string;
  override: { verdict: Verdict; note: string; by: string | null; at: string } | null;
}

export interface Evaluation {
  id: string;
  version: number;
  requirementsVersion: number;
  stale: boolean;
  source: 'ai' | 'demo';
  model: string;
  score: number;
  aiScore: number;
  coverage: number;
  mustStatus: MustStatus;
  summary: string;
  currentRole: string;
  profile: CandidateProfile;
  strengths: string[];
  concerns: string[];
  interviewQuestions: string[];
  injectionDetected: boolean;
  items: EvaluationItem[];
  createdAt: string;
}

export interface EvaluationHistoryEntry {
  id: string;
  version: number;
  requirementsVersion: number;
  score: number;
  coverage: number;
  source: 'ai' | 'demo';
  model: string;
  createdAt: string;
}

export interface Note {
  id: string;
  body: string;
  authorName: string | null;
  isMine: boolean;
  createdAt: string;
}

export interface ApplicationDetail {
  id: string;
  job: { id: string; title: string; requirementsVersion: number };
  candidate: { id: string; name: string; email: string | null; phone: string | null } | null;
  document: { id: string; fileName: string; mime: string; sizeBytes: number; pageCount: number; textSource: string | null };
  status: ProcessingStatus;
  errorMessage: string | null;
  canRetry: boolean;
  decision: Decision | null;
  decidedAt: string | null;
  injectionFlag: boolean;
  possibleDuplicate: boolean;
  createdAt: string;
  evaluation: Evaluation | null;
  history: EvaluationHistoryEntry[];
  notes: Note[];
}

export interface DocumentText { pages: string[]; source: string | null }

// ---------- Přehled a aktivita ----------

export interface ActivityEntry {
  id: number;
  action: string;
  text: string;
  actorName: string | null;
  jobId: string | null;
  jobTitle: string | null;
  link: string | null;
  createdAt: string;
}

export interface AttentionItem {
  kind: 'failed' | 'unconfirmed' | 'stale' | 'undecided';
  jobId: string;
  jobTitle: string;
  count: number;
}

export interface Dashboard {
  activeJobs: JobSummary[];
  attention: AttentionItem[];
  activity: ActivityEntry[];
  totals: { activeJobs: number; processedThisMonth: number; processing: number; failed: number };
  usage: Usage;
}

// ---------- Popisky pro UI ----------

export const JOB_STATUS_LABEL: Record<JobStatus, string> = {
  draft: 'Koncept', active: 'Aktivní', closed: 'Uzavřená', archived: 'Archivovaná',
};
export const VERDICT_LABEL: Record<Verdict, string> = {
  splnuje: 'Splňuje', castecne: 'Částečně', nesplnuje: 'Nesplňuje', nelze_overit: 'Nelze ověřit',
};
export const DECISION_LABEL: Record<Decision, string> = {
  pozvat: 'Pozvat na pohovor', mozna: 'Možná', odmitnout: 'Odmítnout',
};
export const DECISION_STATE_LABEL: Record<Decision, string> = {
  pozvat: 'Pozván(a)', mozna: 'Možná', odmitnout: 'Odmítnut(a)',
};
export const CATEGORY_LABEL: Record<RequirementCategory, string> = {
  zkusenosti: 'Zkušenosti', dovednosti: 'Dovednosti', vzdelani: 'Vzdělání',
  jazyky: 'Jazyky', certifikace: 'Certifikace', ostatni: 'Ostatní',
};
export const WEIGHT_LABEL: Record<Weight, string> = { 3: 'Klíčové', 2: 'Důležité', 1: 'Výhoda' };
export const ROLE_LABEL: Record<Role, string> = { owner: 'Vlastník', recruiter: 'Personalista' };
export const MUST_LABEL: Record<MustStatus, string> = {
  met: 'Splněny', unmet: 'Nesplněny', unknown: 'K ověření', none: 'Bez povinných',
};
export const PROCESSING_LABEL: Record<ProcessingStatus, string> = {
  queued: 'Ve frontě', extracting: 'Čtu dokument', evaluating: 'Hodnotím', done: 'Hotovo', failed: 'Chyba',
};
