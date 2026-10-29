// Migrace databáze. Každá se aplikuje právě jednou, v transakci, v pořadí podle id.
// Nikdy needitujte už vydanou migraci, přidejte novou.

export interface Migration { id: string; sql: string }

export const migrations: Migration[] = [
  {
    id: '001_init',
    sql: `
CREATE TABLE organizations (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  retention_days INTEGER NOT NULL DEFAULT 180 CHECK (retention_days BETWEEN 30 AND 3650),
  is_demo INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

CREATE TABLE users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE memberships (
  org_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('owner', 'recruiter')),
  created_at TEXT NOT NULL,
  PRIMARY KEY (org_id, user_id)
);
CREATE INDEX idx_memberships_user ON memberships(user_id);

CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  org_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);
CREATE INDEX idx_sessions_user ON sessions(user_id);
CREATE INDEX idx_sessions_expires ON sessions(expires_at);

CREATE TABLE invites (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  role TEXT NOT NULL CHECK (role IN ('owner', 'recruiter')),
  email TEXT,
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  used_at TEXT
);
CREATE INDEX idx_invites_org ON invites(org_id);

CREATE TABLE jobs (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  ad_text TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('draft', 'active', 'closed', 'archived')),
  requirements_version INTEGER NOT NULL DEFAULT 0,
  requirements_confirmed_at TEXT,
  closed_at TEXT,
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_jobs_org_status ON jobs(org_id, status, updated_at);

CREATE TABLE job_requirements (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  category TEXT NOT NULL CHECK (category IN ('zkusenosti', 'dovednosti', 'vzdelani', 'jazyky', 'certifikace', 'ostatni')),
  weight INTEGER NOT NULL CHECK (weight IN (1, 2, 3)),
  must_have INTEGER NOT NULL DEFAULT 0 CHECK (must_have IN (0, 1)),
  origin TEXT NOT NULL CHECK (origin IN ('ai', 'user')),
  ad_quote TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_requirements_job ON job_requirements(job_id, position);

CREATE TABLE candidates (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  email TEXT,
  phone TEXT,
  edited_by_user INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_candidates_org_email ON candidates(org_id, email);

CREATE TABLE documents (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  original_name TEXT NOT NULL,
  mime TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  sha256 TEXT NOT NULL,
  storage_key TEXT NOT NULL,
  text_pages TEXT,
  text_source TEXT CHECK (text_source IN ('pdf', 'docx', 'txt', 'ocr')),
  created_at TEXT NOT NULL,
  UNIQUE (org_id, sha256)
);

CREATE TABLE applications (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE RESTRICT,
  candidate_id TEXT REFERENCES candidates(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK (status IN ('queued', 'extracting', 'evaluating', 'done', 'failed')),
  attempts INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TEXT,
  locked_at TEXT,
  error_code TEXT,
  error_message TEXT,
  decision TEXT CHECK (decision IN ('pozvat', 'mozna', 'odmitnout')),
  decided_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  decided_at TEXT,
  injection_flag INTEGER NOT NULL DEFAULT 0,
  duplicate_of TEXT REFERENCES applications(id) ON DELETE SET NULL,
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (job_id, document_id)
);
CREATE INDEX idx_applications_job ON applications(job_id, created_at);
CREATE INDEX idx_applications_queue ON applications(status, next_attempt_at);
CREATE INDEX idx_applications_candidate ON applications(candidate_id);
CREATE INDEX idx_applications_document ON applications(document_id);

CREATE TABLE evaluations (
  id TEXT PRIMARY KEY,
  application_id TEXT NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
  version INTEGER NOT NULL,
  requirements_version INTEGER NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('ai', 'demo')),
  model TEXT NOT NULL,
  prompt_version TEXT NOT NULL,
  score INTEGER NOT NULL,
  ai_score INTEGER NOT NULL,
  coverage INTEGER NOT NULL,
  must_status TEXT NOT NULL CHECK (must_status IN ('met', 'unmet', 'unknown', 'none')),
  summary TEXT NOT NULL,
  current_role TEXT NOT NULL DEFAULT '',
  profile TEXT NOT NULL,
  strengths TEXT NOT NULL,
  concerns TEXT NOT NULL,
  interview_questions TEXT NOT NULL,
  injection_detected INTEGER NOT NULL DEFAULT 0,
  input_tokens INTEGER,
  output_tokens INTEGER,
  created_at TEXT NOT NULL,
  UNIQUE (application_id, version)
);
CREATE INDEX idx_evaluations_created ON evaluations(created_at);

CREATE TABLE evaluation_items (
  id TEXT PRIMARY KEY,
  evaluation_id TEXT NOT NULL REFERENCES evaluations(id) ON DELETE CASCADE,
  requirement_id TEXT REFERENCES job_requirements(id) ON DELETE SET NULL,
  position INTEGER NOT NULL,
  name TEXT NOT NULL,
  weight INTEGER NOT NULL CHECK (weight IN (1, 2, 3)),
  must_have INTEGER NOT NULL CHECK (must_have IN (0, 1)),
  verdict TEXT NOT NULL CHECK (verdict IN ('splnuje', 'castecne', 'nesplnuje', 'nelze_overit')),
  quote TEXT NOT NULL DEFAULT '',
  quote_cs TEXT NOT NULL DEFAULT '',
  quote_status TEXT NOT NULL CHECK (quote_status IN ('exact', 'approximate', 'not_found', 'none')),
  quote_page INTEGER,
  explanation TEXT NOT NULL DEFAULT '',
  limitations TEXT NOT NULL DEFAULT '',
  override_verdict TEXT CHECK (override_verdict IN ('splnuje', 'castecne', 'nesplnuje', 'nelze_overit')),
  override_note TEXT,
  overridden_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  overridden_at TEXT
);
CREATE INDEX idx_items_evaluation ON evaluation_items(evaluation_id, position);

CREATE TABLE notes (
  id TEXT PRIMARY KEY,
  application_id TEXT NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
  author_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  body TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_notes_application ON notes(application_id, created_at);

CREATE TABLE audit_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  org_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  actor_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT,
  job_id TEXT,
  meta TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_audit_org ON audit_logs(org_id, created_at);
CREATE INDEX idx_audit_job ON audit_logs(job_id, created_at);
`,
  },
];
