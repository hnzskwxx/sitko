import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Archive, ArchiveRestore, Briefcase, Ellipsis, FolderOpen, Lock, Plus, Unlock } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import type { JobDetail, JobStatus, JobSummary } from '@shared/types';
import { JOB_STATUS_LABEL } from '@shared/types';
import { api, errorMessage, qs } from '../api';
import { Menu, type MenuAction } from '../components/overlay';
import { useToast } from '../components/toast';
import { Badge, Button, EmptyState, ErrorState, IconButton, Pagination, SearchInput, SkeletonRows, type Tone } from '../components/ui';
import { fmtDate, fmtRelative, useDocumentTitle, useHotkey } from '../hooks';

const FILTERS: Array<[string, string]> = [['open', 'Otevřené'], ['closed', 'Uzavřené'], ['archived', 'Archiv'], ['all', 'Vše']];
export const STATUS_TONE: Record<JobStatus, Tone> = { draft: 'warning', active: 'success', closed: 'neutral', archived: 'outline' };

export function useJobStatusChange() {
  const qc = useQueryClient();
  const toast = useToast();
  return useMutation({
    mutationFn: ({ id, status }: { id: string; status: JobStatus }) => api.patch<JobDetail>(`/jobs/${id}`, { status }),
    onSuccess: (job) => {
      qc.setQueryData(['job', job.id], job);
      void qc.invalidateQueries({ queryKey: ['jobs'] });
      void qc.invalidateQueries({ queryKey: ['dashboard'] });
      toast(`Pozice je teď ${JOB_STATUS_LABEL[job.status].toLowerCase()}.`);
    },
    onError: (e) => toast(errorMessage(e), 'error'),
  });
}

export function jobStatusActions(job: { id: string; status: JobStatus }, change: (s: JobStatus) => void): MenuAction[] {
  const a: MenuAction[] = [];
  if (job.status === 'active') a.push({ label: 'Uzavřít pozici', icon: <Lock />, onSelect: () => change('closed') });
  if (job.status === 'closed') a.push({ label: 'Znovu otevřít', icon: <Unlock />, onSelect: () => change('active') });
  if (job.status !== 'archived') a.push({ label: 'Archivovat', icon: <Archive />, onSelect: () => change('archived') });
  if (job.status === 'archived') a.push({ label: 'Obnovit z archivu', icon: <ArchiveRestore />, onSelect: () => change('active') });
  return a;
}

export function JobsPage() {
  useDocumentTitle('Pozice');
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const status = params.get('status') ?? 'open';
  const page = Number(params.get('page') ?? '1') || 1;
  const [q, setQ] = useState(params.get('q') ?? '');
  const search = useRef<HTMLInputElement>(null);
  const change = useJobStatusChange();

  useHotkey('/', useCallback(() => search.current?.focus(), []));
  useHotkey('n', useCallback(() => navigate('/pozice/nova'), [navigate]));

  // Hledání s malým zpožděním, hodnota se drží v URL (přežije návrat zpět)
  useEffect(() => {
    const t = setTimeout(() => {
      if ((params.get('q') ?? '') !== q) {
        const next = new URLSearchParams(params);
        if (q) next.set('q', q); else next.delete('q');
        next.delete('page');
        setParams(next, { replace: true });
      }
    }, 250);
    return () => clearTimeout(t);
  }, [q, params, setParams]);

  const list = useQuery({
    queryKey: ['jobs', status, params.get('q') ?? '', page],
    queryFn: () => api.list<JobSummary>(`/jobs${qs({ status, q: params.get('q'), page, pageSize: 25 })}`),
    placeholderData: keepPreviousData,
  });

  const setFilter = (key: string, value: string | null) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value); else next.delete(key);
    if (key !== 'page') next.delete('page');
    setParams(next);
  };

  const filtered = Boolean(params.get('q')) || status !== 'open';

  return (
    <div className="page">
      <div className="page-head">
        <div className="page-head-text"><h1 className="page-title">Pozice</h1></div>
        <Button variant="primary" icon={<Plus />} onClick={() => navigate('/pozice/nova')}>Nová pozice</Button>
      </div>

      <section className="panel">
        <div className="toolbar">
          <SearchInput ref={search} placeholder="Hledat podle názvu" aria-label="Hledat pozici" value={q} onChange={(e) => setQ(e.target.value)} shortcut="/" />
          <div className="segmented" role="group" aria-label="Stav pozice">
            {FILTERS.map(([v, label]) => (
              <button key={v} type="button" aria-pressed={status === v} onClick={() => setFilter('status', v === 'open' ? null : v)}>{label}</button>
            ))}
          </div>
        </div>

        {list.isError ? <div style={{ padding: 16 }}><ErrorState error={list.error} onRetry={() => list.refetch()} /></div>
          : list.isPending ? <SkeletonRows rows={4} cols={5} />
            : list.data.data.length === 0 ? (
              filtered ? (
                <EmptyState icon={<FolderOpen />} title="Žádná pozice neodpovídá filtru" actions={<Button onClick={() => { setQ(''); setParams({}); }}>Zrušit filtry</Button>} />
              ) : (
                <EmptyState icon={<Briefcase />} title="Zatím nemáte žádnou pozici" actions={<Button variant="primary" icon={<Plus />} onClick={() => navigate('/pozice/nova')}>Vytvořit pozici</Button>}>
                  Pozice spojuje inzerát, požadavky a nahrané životopisy.
                </EmptyState>
              )
            ) : (
              <>
                <div className="table-wrap">
                  <table className="table">
                    <thead>
                      <tr>
                        <th>Pozice</th><th>Stav</th><th className="col-num">Kandidáti</th><th className="col-num">Nerozhodnuto</th>
                        <th className="col-num">Zpracovává se</th><th>Aktualizováno</th><th className="col-actions"><span className="sr-only">Akce</span></th>
                      </tr>
                    </thead>
                    <tbody>
                      {list.data.data.map((j) => (
                        <tr key={j.id} className="is-clickable" tabIndex={0}
                          onClick={() => navigate(`/pozice/${j.id}`)} onKeyDown={(e) => { if (e.key === 'Enter') navigate(`/pozice/${j.id}`); }}>
                          <td>
                            <div className="cell-main">
                              <Link to={`/pozice/${j.id}`} className="cell-title link-quiet" onClick={(e) => e.stopPropagation()}>{j.title}</Link>
                              <span className="cell-sub">Vytvořeno {fmtDate(j.createdAt)}</span>
                            </div>
                          </td>
                          <td><Badge tone={STATUS_TONE[j.status]}>{JOB_STATUS_LABEL[j.status]}</Badge></td>
                          <td className="col-num num">{j.counts.total}</td>
                          <td className="col-num num">{j.counts.undecided || <span className="muted">0</span>}</td>
                          <td className="col-num num">{j.counts.processing || <span className="muted">0</span>}</td>
                          <td className="muted small">{fmtRelative(j.updatedAt)}</td>
                          <td className="col-actions" onClick={(e) => e.stopPropagation()}>
                            <Menu
                              trigger={<IconButton label={`Akce pro ${j.title}`} size="sm"><Ellipsis /></IconButton>}
                              actions={jobStatusActions(j, (s) => change.mutate({ id: j.id, status: s }))}
                            />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <Pagination page={list.data.meta.page} pageSize={list.data.meta.pageSize} total={list.data.meta.total} onPage={(p) => setFilter('page', String(p))} />
              </>
            )}
      </section>
    </div>
  );
}
