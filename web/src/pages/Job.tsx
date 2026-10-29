import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronRight, Download, Ellipsis, Pencil, Trash2, Upload } from 'lucide-react';
import { useEffect, useState, type FormEvent } from 'react';
import { Link, NavLink, Route, Routes, useNavigate, useParams, useSearchParams } from 'react-router';
import type { ActivityEntry, JobDetail, Me } from '@shared/types';
import { JOB_STATUS_LABEL } from '@shared/types';
import { api, ApiFailure, errorMessage } from '../api';
import { ConfirmDialog, Menu } from '../components/overlay';
import { useToast } from '../components/toast';
import { UploadDialog } from '../components/UploadDialog';
import { Badge, Button, EmptyState, ErrorState, Field, IconButton, Input, Notice, Skeleton, Spinner, Textarea } from '../components/ui';
import { fmtDateTime, useDocumentTitle } from '../hooks';
import { JobCandidates } from './JobCandidates';
import { jobStatusActions, STATUS_TONE, useJobStatusChange } from './Jobs';
import { JobRequirements } from './JobRequirements';
import { NotFoundPage } from './NotFound';

export function useJob(jobId: string) {
  return useQuery({
    queryKey: ['job', jobId],
    queryFn: () => api.get<JobDetail>(`/jobs/${jobId}`),
    refetchInterval: (q) => (q.state.data?.counts.processing ? 3000 : false),
  });
}

export function JobPage({ me }: { me: Me }) {
  const { jobId = '' } = useParams();
  const job = useJob(jobId);
  const [params, setParams] = useSearchParams();
  const [uploadOpen, setUploadOpen] = useState(false);
  const wantsUpload = params.get('nahrat') === '1';
  useEffect(() => { if (wantsUpload) setUploadOpen(true); }, [wantsUpload]);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const change = useJobStatusChange();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const toast = useToast();
  useDocumentTitle(job.data?.title);

  if (job.isPending) return <div className="page"><Skeleton w={240} h={24} /><div style={{ height: 24 }} /><Spinner /></div>;
  if (job.isError) {
    if (job.error instanceof ApiFailure && job.error.status === 404) return <NotFoundPage what="Pozice" />;
    return <div className="page"><ErrorState error={job.error} onRetry={() => job.refetch()} /></div>;
  }
  const j = job.data;
  const setup = j.status === 'draft' && !j.requirementsConfirmed;

  const closeUpload = (o: boolean) => {
    setUploadOpen(o);
    if (!o && params.get('nahrat')) { const n = new URLSearchParams(params); n.delete('nahrat'); setParams(n, { replace: true }); }
  };

  return (
    <div className="page">
      <div className="page-head">
        <div className="page-head-text">
          <nav className="crumbs" aria-label="Drobečková navigace"><Link to="/pozice">Pozice</Link><ChevronRight aria-hidden /></nav>
          <div className="row-wrap">
            <h1 className="page-title">{j.title}</h1>
            <Badge tone={STATUS_TONE[j.status]}>{JOB_STATUS_LABEL[j.status]}</Badge>
          </div>
        </div>
        <div className="row">
          {j.status === 'active' && <Button variant="primary" icon={<Upload />} onClick={() => setUploadOpen(true)}>Nahrát životopisy</Button>}
          <Menu
            trigger={<IconButton label="Další akce s pozicí" variant="secondary"><Ellipsis /></IconButton>}
            actions={[
              ...jobStatusActions(j, (s) => change.mutate({ id: j.id, status: s })),
              { label: 'Stáhnout výsledky (CSV)', icon: <Download />, onSelect: () => { window.location.href = `/api/v1/jobs/${j.id}/export.csv`; }, separatorBefore: true, disabled: !j.counts.done },
              ...(me.role === 'owner' ? [{ label: 'Smazat pozici', icon: <Trash2 />, danger: true, separatorBefore: true, onSelect: () => setDeleteOpen(true) }] : []),
            ]}
          />
        </div>
      </div>

      {setup ? null : (
        <nav className="tabs" aria-label="Části pozice">
          <NavLink to={`/pozice/${j.id}`} end className="tab">Kandidáti <Badge>{j.counts.total}</Badge></NavLink>
          <NavLink to={`/pozice/${j.id}/pozadavky`} className="tab">Požadavky <Badge>{j.requirements.length}</Badge></NavLink>
          <NavLink to={`/pozice/${j.id}/inzerat`} className="tab">Inzerát</NavLink>
          <NavLink to={`/pozice/${j.id}/historie`} className="tab">Historie</NavLink>
        </nav>
      )}

      <Routes>
        <Route index element={setup ? <SetupRedirect job={j} /> : <JobCandidates job={j} onUpload={() => setUploadOpen(true)} />} />
        <Route path="pozadavky" element={<JobRequirements job={j} setup={setup} />} />
        <Route path="inzerat" element={<JobAd job={j} />} />
        <Route path="historie" element={<JobHistory jobId={j.id} />} />
        <Route path="*" element={<NotFoundPage />} />
      </Routes>

      <UploadDialog jobId={j.id} open={uploadOpen} onOpenChange={closeUpload} />
      <ConfirmDialog
        open={deleteOpen} onOpenChange={setDeleteOpen} danger title={`Smazat pozici ${j.title}?`} confirmLabel="Smazat pozici"
        onConfirm={async () => {
          await api.del(`/jobs/${j.id}`);
          qc.removeQueries({ queryKey: ['job', j.id] });
          void qc.invalidateQueries({ queryKey: ['jobs'] });
          void qc.invalidateQueries({ queryKey: ['dashboard'] });
          toast('Pozice smazána.');
          navigate('/pozice');
        }}
      >
        Smaže se inzerát, požadavky, všechna hodnocení, poznámky a {j.counts.total} nahraných životopisů, které nejsou u jiné pozice. Akci nejde vrátit.
        Pokud chcete jen ukončit nábor, pozici raději uzavřete nebo archivujte.
      </ConfirmDialog>
    </div>
  );
}

function SetupRedirect({ job }: { job: JobDetail }) {
  return (
    <Notice tone="warning" action={<Link className="btn btn-primary btn-sm" to={`/pozice/${job.id}/pozadavky`}>Potvrdit požadavky</Link>}>
      Pozice je koncept. Potvrďte požadavky, pak půjde nahrávat životopisy.
    </Notice>
  );
}

function JobAd({ job }: { job: JobDetail }) {
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(job.title);
  const [adText, setAdText] = useState(job.adText);
  const [fields, setFields] = useState<Record<string, string>>({});
  const qc = useQueryClient();
  const toast = useToast();
  const save = useMutation({
    mutationFn: () => api.patch<JobDetail>(`/jobs/${job.id}`, { title, adText }),
    onSuccess: (j) => { qc.setQueryData(['job', j.id], j); void qc.invalidateQueries({ queryKey: ['jobs'] }); setEditing(false); toast('Inzerát uložen.'); },
    onError: (e) => { if (e instanceof ApiFailure) setFields(e.fields); toast(errorMessage(e), 'error'); },
  });

  if (!editing) {
    return (
      <section className="panel panel-pad stack">
        <div className="section-head">
          <h2 className="section-title">Text inzerátu</h2>
          <Button size="sm" icon={<Pencil />} onClick={() => { setTitle(job.title); setAdText(job.adText); setEditing(true); }}>Upravit</Button>
        </div>
        <div className="ad-text">{job.adText}</div>
      </section>
    );
  }
  return (
    <form className="panel panel-pad stack" onSubmit={(e: FormEvent) => { e.preventDefault(); save.mutate(); }} noValidate>
      <Field label="Název pozice" error={fields.title}>{(id, d) => <Input id={id} aria-describedby={d} value={title} onChange={(e) => setTitle(e.target.value)} />}</Field>
      <Field label="Text inzerátu" hint="Změna textu nemění potvrzené požadavky. Ty upravíte v záložce Požadavky." error={fields.adText}>
        {(id, d) => <Textarea id={id} aria-describedby={d} rows={16} value={adText} onChange={(e) => setAdText(e.target.value)} />}
      </Field>
      <div className="form-actions">
        <Button onClick={() => setEditing(false)}>Zrušit</Button>
        <Button type="submit" variant="primary" loading={save.isPending}>Uložit inzerát</Button>
      </div>
    </form>
  );
}

function JobHistory({ jobId }: { jobId: string }) {
  const q = useQuery({ queryKey: ['activity', jobId], queryFn: () => api.get<ActivityEntry[]>(`/jobs/${jobId}/activity`) });
  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  if (q.isPending) return <Spinner />;
  if (!q.data.length) return <EmptyState title="Zatím žádné změny" />;
  return (
    <section className="panel">
      <ol className="activity" style={{ listStyle: 'none', margin: 0, padding: '8px 0' }}>
        {q.data.map((a) => (
          <li key={a.id} className="activity-item">
            <div>
              {a.link && a.link.includes('/kandidati/') ? <Link to={a.link} className="link-quiet">{a.text}</Link> : a.text}
              <div className="activity-meta">{a.actorName ?? 'Systém'}, {fmtDateTime(a.createdAt)}</div>
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}
