import { useQueryClient } from '@tanstack/react-query';
import { ChevronRight, FileUp } from 'lucide-react';
import { useRef, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router';
import type { JobDetail } from '@shared/types';
import { api, ApiFailure, errorMessage, upload } from '../api';
import { Button, Field, Input, Textarea } from '../components/ui';
import { useDocumentTitle } from '../hooks';

export function Steps({ current }: { current: 1 | 2 | 3 }) {
  const steps = ['Inzerát', 'Požadavky', 'Životopisy'];
  return (
    <ol className="steps" aria-label="Postup" style={{ listStyle: 'none', padding: 0 }}>
      {steps.map((s, i) => (
        <li key={s} className={`step${i + 1 === current ? ' is-current' : ''}${i + 1 < current ? ' is-done' : ''}`} aria-current={i + 1 === current ? 'step' : undefined}>
          <span className="step-n">{i + 1}</span>{s}
        </li>
      ))}
    </ol>
  );
}

export function JobNewPage() {
  useDocumentTitle('Nová pozice');
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [title, setTitle] = useState('');
  const [adText, setAdText] = useState('');
  const [fields, setFields] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [reading, setReading] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const readFile = async (file: File) => {
    setReading(true); setError(null);
    try {
      const form = new FormData();
      form.append('file', file, file.name);
      const r = await upload<{ text: string }>('/jobs/ad-text', form);
      setAdText(r.text);
      if (!title) {
        const first = r.text.split('\n').map((l) => l.trim()).find((l) => l.length > 3 && l.length < 120);
        if (first) setTitle(first);
      }
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setReading(false);
    }
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true); setError(null); setFields({});
    try {
      const job = await api.post<JobDetail>('/jobs', { title, adText });
      qc.setQueryData(['job', job.id], job);
      void qc.invalidateQueries({ queryKey: ['jobs'] });
      navigate(`/pozice/${job.id}/pozadavky`, { replace: true });
    } catch (err) {
      if (err instanceof ApiFailure) setFields(err.fields);
      setError(errorMessage(err));
      setBusy(false);
    }
  };

  return (
    <div className="page page-narrow">
      <div className="page-head">
        <div className="page-head-text">
          <nav className="crumbs" aria-label="Drobečková navigace"><Link to="/pozice">Pozice</Link><ChevronRight aria-hidden /></nav>
          <h1 className="page-title">Nová pozice</h1>
        </div>
      </div>
      <Steps current={1} />
      <form className="panel panel-pad stack" onSubmit={submit} noValidate>
        {error && <p className="form-error" role="alert">{error}</p>}
        <Field label="Název pozice" error={fields.title}>
          {(id, d) => <Input id={id} aria-describedby={d} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Například: Obchodní referent/ka" autoFocus invalid={Boolean(fields.title)} />}
        </Field>
        <Field label="Text inzerátu" hint="Vložte celý inzerát. Požadavky z něj navrhneme v dalším kroku." error={fields.adText}>
          {(id, d) => <Textarea id={id} aria-describedby={d} rows={14} value={adText} onChange={(e) => setAdText(e.target.value)} invalid={Boolean(fields.adText)} />}
        </Field>
        <div className="row-wrap">
          <input ref={fileInput} type="file" accept=".pdf,.docx,.txt" className="sr-only" tabIndex={-1}
            onChange={(e) => { const f = e.target.files?.[0]; if (f) void readFile(f); e.target.value = ''; }} />
          <Button icon={<FileUp />} loading={reading} onClick={() => fileInput.current?.click()}>Načíst inzerát ze souboru</Button>
          <span className="small muted">PDF, DOCX nebo TXT</span>
        </div>
        <hr className="divider" />
        <div className="form-actions">
          <Button onClick={() => navigate('/pozice')}>Zrušit</Button>
          <Button type="submit" variant="primary" loading={busy}>Pokračovat k požadavkům</Button>
        </div>
      </form>
    </div>
  );
}
