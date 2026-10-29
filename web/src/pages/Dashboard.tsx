import { useQuery } from '@tanstack/react-query';
import { Briefcase, ChevronRight, CircleAlert, ListChecks, Plus, RefreshCw } from 'lucide-react';
import { useCallback } from 'react';
import { Link, useNavigate } from 'react-router';
import type { AttentionItem, Dashboard, Me } from '@shared/types';
import { JOB_STATUS_LABEL } from '@shared/types';
import { api } from '../api';
import { Badge, Button, EmptyState, ErrorState, Notice, Skeleton, SkeletonRows } from '../components/ui';
import { fmtRelative, plural, useDocumentTitle, useHotkey } from '../hooks';

function attentionText(a: AttentionItem): string {
  switch (a.kind) {
    case 'failed': return `${plural(a.count, 'životopis se nepodařilo zpracovat', 'životopisy se nepodařilo zpracovat', 'životopisů se nepodařilo zpracovat')}`;
    case 'stale': return `${plural(a.count, 'hodnocení vychází', 'hodnocení vycházejí', 'hodnocení vychází')} ze starších požadavků`;
    case 'unconfirmed': return 'Čeká na potvrzení požadavků';
    default: return `${a.count} nerozhodnutých kandidátů`;
  }
}
const attentionLink = (a: AttentionItem): string =>
  a.kind === 'unconfirmed' ? `/pozice/${a.jobId}/pozadavky` : a.kind === 'failed' ? `/pozice/${a.jobId}?status=failed` : `/pozice/${a.jobId}`;

export function DashboardPage({ me }: { me: Me }) {
  useDocumentTitle('Přehled');
  const navigate = useNavigate();
  useHotkey('n', useCallback(() => navigate('/pozice/nova'), [navigate]));
  const q = useQuery({
    queryKey: ['dashboard'],
    queryFn: () => api.get<Dashboard>('/dashboard'),
    refetchInterval: (query) => (query.state.data?.totals.processing ? 3000 : false),
  });
  const d = q.data;

  return (
    <div className="page">
      <div className="page-head">
        <div className="page-head-text">
          <h1 className="page-title">Přehled</h1>
          <p className="page-sub">{me.organization.name}</p>
        </div>
        <Button variant="primary" icon={<Plus />} onClick={() => navigate('/pozice/nova')}>Nová pozice <kbd aria-hidden style={{ marginLeft: 4 }}>N</kbd></Button>
      </div>

      {q.isError && <ErrorState error={q.error} onRetry={() => q.refetch()} />}

      {d && !d.usage.aiConfigured && !me.organization.isDemo && (
        <div style={{ marginBottom: 16 }}>
          <Notice tone="warning" icon={<CircleAlert />}>
            AI není nastavená, takže se životopisy nebudou hodnotit. Správce serveru musí doplnit proměnnou <code>ANTHROPIC_API_KEY</code>.
            Pozice a požadavky můžete připravit už teď.
          </Notice>
        </div>
      )}

      <div className="dash">
        <div className="stack">
          <section className="panel" aria-label="Souhrn">
            <div className="stat-line">
              {[
                ['Aktivní pozice', d?.totals.activeJobs],
                ['Zpracováno tento měsíc', d?.totals.processedThisMonth],
                ['Zpracovává se', d?.totals.processing],
                ['Chyby ke kontrole', d?.totals.failed],
              ].map(([label, value]) => (
                <div className="stat" key={label as string}>
                  <span className="stat-value">{value ?? <Skeleton w={28} h={22} />}</span>
                  <span className="stat-label">{label}</span>
                </div>
              ))}
            </div>
          </section>

          <section className="panel" aria-labelledby="dash-jobs">
            <div className="panel-head">
              <h2 className="section-title" id="dash-jobs">Rozpracované pozice</h2>
              <Link to="/pozice" className="btn btn-ghost btn-sm">Všechny pozice</Link>
            </div>
            {q.isPending ? <SkeletonRows rows={3} cols={4} /> : d && d.activeJobs.length === 0 ? (
              <EmptyState icon={<Briefcase />} title="Zatím nemáte žádnou pozici"
                actions={<Button variant="primary" icon={<Plus />} onClick={() => navigate('/pozice/nova')}>Vytvořit první pozici</Button>}>
                Vložte inzerát, zkontrolujte požadavky a nahrajte životopisy. Sítko je seřadí podle doložené shody.
              </EmptyState>
            ) : (
              <div className="table-wrap">
                <table className="table">
                  <thead><tr><th>Pozice</th><th className="col-num">Kandidáti</th><th className="col-num">Nerozhodnuto</th><th className="col-num">Zpracovává se</th><th>Aktualizováno</th></tr></thead>
                  <tbody>
                    {d?.activeJobs.map((j) => (
                      <tr key={j.id} className="is-clickable" tabIndex={0}
                        onClick={() => navigate(`/pozice/${j.id}`)} onKeyDown={(e) => { if (e.key === 'Enter') navigate(`/pozice/${j.id}`); }}>
                        <td>
                          <div className="cell-main">
                            <Link to={`/pozice/${j.id}`} className="cell-title link-quiet" onClick={(e) => e.stopPropagation()}>{j.title}</Link>
                            {j.status === 'draft' && <span><Badge tone="warning">{JOB_STATUS_LABEL.draft}</Badge></span>}
                          </div>
                        </td>
                        <td className="col-num num">{j.counts.total}</td>
                        <td className="col-num num">{j.counts.undecided || <span className="muted">0</span>}</td>
                        <td className="col-num num">{j.counts.processing ? <span className="row" style={{ justifyContent: 'flex-end' }}><RefreshCw className="spin" width={12} height={12} aria-hidden />{j.counts.processing}</span> : <span className="muted">0</span>}</td>
                        <td className="muted small">{fmtRelative(j.updatedAt)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </div>

        <div className="stack">
          <section className="panel" aria-labelledby="dash-att">
            <div className="panel-head"><h2 className="section-title" id="dash-att">Vyžaduje pozornost</h2></div>
            {q.isPending ? <div style={{ padding: 16 }}><Skeleton w="80%" /></div> : d && d.attention.length === 0 ? (
              <p className="muted small" style={{ padding: 16 }}>Nic nečeká. Všechny životopisy jsou zpracované.</p>
            ) : (
              <div className="attention">
                {d?.attention.map((a) => (
                  <Link key={`${a.kind}-${a.jobId}`} to={attentionLink(a)} className="attention-item">
                    {a.kind === 'failed' ? <CircleAlert style={{ color: 'var(--error)' }} aria-hidden /> : <ListChecks style={{ color: 'var(--warning-icon)' }} aria-hidden />}
                    <span className="cell-main">
                      <span className="cell-title ellipsis">{a.jobTitle}</span>
                      <span className="cell-sub">{attentionText(a)}</span>
                    </span>
                    <ChevronRight width={16} height={16} className="muted" aria-hidden style={{ marginLeft: 'auto' }} />
                  </Link>
                ))}
              </div>
            )}
          </section>

          <section className="panel" aria-labelledby="dash-act">
            <div className="panel-head"><h2 className="section-title" id="dash-act">Nedávná aktivita</h2></div>
            {q.isPending ? <div style={{ padding: 16 }}><Skeleton w="70%" /></div> : d && d.activity.length === 0 ? (
              <p className="muted small" style={{ padding: 16 }}>Zatím žádná aktivita.</p>
            ) : (
              <ol className="activity" style={{ listStyle: 'none', margin: 0, padding: '6px 0' }}>
                {d?.activity.map((a) => (
                  <li key={a.id} className="activity-item">
                    <div>
                      {a.link ? <Link to={a.link} className="link-quiet">{a.text}</Link> : a.text}
                      <div className="activity-meta">
                        {[a.jobTitle, a.actorName ?? 'Systém', fmtRelative(a.createdAt)].filter(Boolean).join(', ')}
                      </div>
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </section>

          {d && d.usage.aiConfigured && !me.organization.isDemo && (
            <p className="xs muted" style={{ padding: '0 4px' }}>
              Tento měsíc {d.usage.monthEvaluations} z {d.usage.monthlyLimit} hodnocení. <Link className="link" to="/nastaveni/zpracovani">Podrobnosti</Link>
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
