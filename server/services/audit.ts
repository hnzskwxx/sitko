import type { ActivityEntry, Decision, JobStatus, Role } from '../../shared/types.js';
import { DECISION_LABEL, JOB_STATUS_LABEL, ROLE_LABEL, VERDICT_LABEL } from '../../shared/types.js';
import { now, type DB } from '../db/index.js';

export interface AuditEvent {
  orgId: string;
  actorId?: string | null;
  action: string;
  entityType: 'job' | 'application' | 'candidate' | 'member' | 'invite' | 'organization' | 'evaluation_item' | 'note';
  entityId?: string | null;
  jobId?: string | null;
  /** Jen technické údaje, nikdy text CV ani kontaktní údaje kandidáta. */
  meta?: Record<string, unknown>;
}

export function audit(db: DB, e: AuditEvent): void {
  db.prepare(
    `INSERT INTO audit_logs (org_id, actor_id, action, entity_type, entity_id, job_id, meta, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(e.orgId, e.actorId ?? null, e.action, e.entityType, e.entityId ?? null, e.jobId ?? null,
    e.meta ? JSON.stringify(e.meta) : null, now());
}

interface Row {
  id: number; action: string; entity_type: string; entity_id: string | null; job_id: string | null;
  meta: string | null; created_at: string; actor_name: string | null; job_title: string | null; candidate_name: string | null;
}

const plural = (n: number, one: string, few: string, many: string): string => (n === 1 ? one : n >= 2 && n <= 4 ? few : many);

function describe(r: Row, m: Record<string, unknown>): string {
  const who = r.candidate_name ?? 'kandidát';
  switch (r.action) {
    case 'job.created': return 'Vytvořena pozice';
    case 'job.updated': return 'Upraven inzerát nebo název pozice';
    case 'job.status_changed': return `Stav pozice změněn na „${JOB_STATUS_LABEL[m.to as JobStatus] ?? m.to}“`;
    case 'job.requirements_confirmed': return `Potvrzeny požadavky (${m.count}, verze ${m.version})`;
    case 'applications.uploaded': {
      const n = Number(m.queued ?? 0);
      const extra = [m.duplicates ? `${m.duplicates} duplicitní` : '', m.rejected ? `${m.rejected} odmítnuto` : ''].filter(Boolean).join(', ');
      return `Nahráno ${n} ${plural(n, 'životopis', 'životopisy', 'životopisů')}${extra ? ` (${extra})` : ''}`;
    }
    case 'application.evaluated': return `${who}: vyhodnoceno (verze ${m.version}, shoda ${m.score})`;
    case 'application.failed': return `${who === 'kandidát' ? 'Životopis' : who}: zpracování selhalo`;
    case 'application.decision': return m.decision
      ? `${who}: ${DECISION_LABEL[m.decision as Decision].toLowerCase()}`
      : `${who}: rozhodnutí zrušeno`;
    case 'application.reevaluate': return `${who}: spuštěno nové hodnocení`;
    case 'application.retry': return 'Zpracování životopisu spuštěno znovu';
    case 'application.deleted': return 'Životopis odebrán z pozice';
    case 'evaluation_item.overridden': return m.to
      ? `${who}: verdikt „${m.requirement}“ opraven na „${VERDICT_LABEL[m.to as keyof typeof VERDICT_LABEL]}“`
      : `${who}: oprava verdiktu „${m.requirement}“ zrušena`;
    case 'candidate.updated': return `${who}: opraveny kontaktní údaje`;
    case 'candidate.deleted': return 'Kandidát a jeho dokumenty smazány';
    case 'note.created': return `${who}: přidána poznámka`;
    case 'member.invited': return `Vytvořena pozvánka (${ROLE_LABEL[m.role as Role] ?? m.role})`;
    case 'member.joined': return 'Do týmu se přidal nový člen';
    case 'member.role_changed': return `Změněna role člena na ${ROLE_LABEL[m.role as Role] ?? m.role}`;
    case 'member.removed': return 'Člen odebrán z týmu';
    case 'organization.updated': return 'Upraveno nastavení organizace';
    case 'retention.cleanup': return `Automaticky smazáno ${m.applications} starých přihlášek (retence dat)`;
    default: return r.action;
  }
}

export function listActivity(db: DB, orgId: string, opts: { jobId?: string; limit?: number } = {}): ActivityEntry[] {
  const rows = db.prepare(
    `SELECT a.id, a.action, a.entity_type, a.entity_id, a.job_id, a.meta, a.created_at,
            u.name AS actor_name, j.title AS job_title,
            (SELECT c.name FROM applications ap JOIN candidates c ON c.id = ap.candidate_id
              WHERE a.entity_type IN ('application', 'evaluation_item', 'note') AND ap.id = json_extract(a.meta, '$.applicationId')
              AND ap.org_id = a.org_id) AS candidate_name
       FROM audit_logs a
       LEFT JOIN users u ON u.id = a.actor_id
       LEFT JOIN jobs j ON j.id = a.job_id AND j.org_id = a.org_id
      WHERE a.org_id = ? ${opts.jobId ? 'AND a.job_id = ?' : ''}
      ORDER BY a.id DESC LIMIT ?`,
  ).all(...(opts.jobId ? [orgId, opts.jobId] : [orgId]), opts.limit ?? 30) as Row[];

  return rows.map((r) => {
    const m = r.meta ? (JSON.parse(r.meta) as Record<string, unknown>) : {};
    const appId = typeof m.applicationId === 'string' ? m.applicationId : null;
    return {
      id: r.id,
      action: r.action,
      text: describe(r, m),
      actorName: r.actor_name,
      jobId: r.job_title ? r.job_id : null,
      jobTitle: r.job_title,
      link: appId && r.job_id && r.candidate_name ? `/pozice/${r.job_id}/kandidati/${appId}` : r.job_title ? `/pozice/${r.job_id}` : null,
      createdAt: r.created_at,
    };
  });
}
