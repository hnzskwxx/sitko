import { useQueryClient } from '@tanstack/react-query';
import { CircleAlert, Sparkles } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import type { JobDetail, RequirementSuggestion } from '@shared/types';
import { api, ApiFailure, errorMessage } from '../api';
import { ConfirmDialog } from '../components/overlay';
import {
  emptyRequirement, fromRequirement, fromSuggestion, RequirementsEditor, toPayload, validateRequirements, type DraftRequirement,
} from '../components/RequirementsEditor';
import { useToast } from '../components/toast';
import { Button, Notice, Spinner } from '../components/ui';
import { plural, useMe } from '../hooks';
import { Steps } from './JobNew';

export function JobRequirements({ job, setup }: { job: JobDetail; setup: boolean }) {
  const initial = useMemo(() => job.requirements.map(fromRequirement), [job.requirements]);
  const [drafts, setDrafts] = useState<DraftRequirement[]>(initial);
  const [suggesting, setSuggesting] = useState(false);
  const [aiNotice, setAiNotice] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmSave, setConfirmSave] = useState(false);
  const [confirmSuggest, setConfirmSuggest] = useState(false);
  const qc = useQueryClient();
  const toast = useToast();
  const navigate = useNavigate();
  const autoRan = useRef(false);
  // Bez aktivního předplatného server návrh odmítne: rovnou to říct a nevolat ho
  const canAi = useMe().data?.organization.subscription.canEvaluate ?? true;

  const dirty = JSON.stringify(toPayload(drafts)) !== JSON.stringify(toPayload(initial));

  const suggest = async () => {
    setSuggesting(true); setAiNotice(null); setError(null);
    try {
      const r = await api.post<{ position: string; requirements: RequirementSuggestion[] }>(`/jobs/${job.id}/requirements/suggest`);
      setDrafts(r.requirements.map(fromSuggestion));
      const missing = r.requirements.filter((x) => !x.sourceFound).length;
      if (missing) setAiNotice(`Návrhy bez opory v textu inzerátu: ${missing}. Nejsou označené jako povinné, zkontrolujte je nebo je odeberte.`);
    } catch (e) {
      setAiNotice(e instanceof ApiFailure && e.status === 503
        ? 'AI teď není k dispozici, požadavky přidejte ručně.'
        : errorMessage(e));
      setDrafts((d) => (d.length ? d : [emptyRequirement()]));
    } finally {
      setSuggesting(false);
    }
  };

  // Nová pozice bez požadavků: rovnou navrhnout z inzerátu
  useEffect(() => {
    if (setup && !job.requirements.length && !autoRan.current) {
      autoRan.current = true;
      if (canAi) void suggest();
      else setDrafts((d) => (d.length ? d : [emptyRequirement()]));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [setup, job.requirements.length]);

  const save = async () => {
    const v = validateRequirements(drafts);
    if (v) { setError(v); return; }
    setSaving(true); setError(null);
    try {
      const updated = await api.put<JobDetail>(`/jobs/${job.id}/requirements`, { requirements: toPayload(drafts) });
      qc.setQueryData(['job', job.id], updated);
      void qc.invalidateQueries({ queryKey: ['applications', job.id] });
      void qc.invalidateQueries({ queryKey: ['dashboard'] });
      void qc.invalidateQueries({ queryKey: ['jobs'] });
      if (setup) {
        toast('Požadavky potvrzeny, pozice je aktivní.');
        navigate(`/pozice/${job.id}?nahrat=1`);
      } else {
        toast('Požadavky uloženy.');
        setDrafts(updated.requirements.map(fromRequirement));
      }
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="stack">
      {setup && <Steps current={2} />}
      <div className="dash" style={{ gridTemplateColumns: 'minmax(0, 1fr) minmax(260px, 380px)' }}>
        <div className="stack">
          <div className="section-head" style={{ marginBottom: 0 }}>
            <div>
              <h2 className="section-title">{setup ? 'Zkontrolujte požadavky' : 'Požadavky pozice'}</h2>
              <p className="small muted">Podle nich se hodnotí každý životopis. Povinné požadavky ovlivňují řazení, nikoho ale nevyřazují.</p>
            </div>
            <Button size="sm" icon={<Sparkles />} loading={suggesting} disabled={!canAi}
              onClick={() => (drafts.some((d) => d.name.trim()) ? setConfirmSuggest(true) : void suggest())}>
              Navrhnout z inzerátu
            </Button>
          </div>
          {!canAi && <Notice>Návrh požadavků z inzerátu se zapne s aktivním předplatným. Zatím je přidejte ručně, uloží se.</Notice>}

          {aiNotice && <Notice tone="warning" icon={<CircleAlert />}>{aiNotice}</Notice>}
          {suggesting && !drafts.length ? <div className="panel panel-pad"><Spinner label="Čtu inzerát a navrhuji požadavky…" /></div>
            : <RequirementsEditor value={drafts} onChange={setDrafts} />}
          {error && <p className="form-error" role="alert">{error}</p>}

          <div className="form-actions" style={{ justifyContent: 'flex-start' }}>
            <Button variant="primary" loading={saving} disabled={!setup && !dirty} onClick={() => (!setup && job.counts.done ? setConfirmSave(true) : void save())}>
              {setup ? 'Potvrdit požadavky a aktivovat pozici' : 'Uložit požadavky'}
            </Button>
            {!setup && dirty && <Button variant="ghost" onClick={() => setDrafts(initial)}>Zahodit změny</Button>}
          </div>
        </div>

        <aside className="panel" style={{ position: 'sticky', top: 16 }} aria-label="Text inzerátu">
          <div className="panel-head"><h3 className="section-title">Inzerát</h3></div>
          <div className="ad-text small" style={{ padding: 16, maxHeight: '70vh', overflow: 'auto' }}>{job.adText}</div>
        </aside>
      </div>

      <ConfirmDialog open={confirmSave} onOpenChange={setConfirmSave} title="Uložit změněné požadavky?" confirmLabel="Uložit požadavky" onConfirm={save}>
        {plural(job.counts.done, 'stávající hodnocení se označí', 'stávající hodnocení se označí', 'stávajících hodnocení se označí')} jako zastaralá.
        Nové hodnocení spustíte tlačítkem „Vyhodnotit znovu“ u kandidátů. Původní hodnocení zůstanou v historii.
      </ConfirmDialog>
      <ConfirmDialog open={confirmSuggest} onOpenChange={setConfirmSuggest} title="Nahradit požadavky novým návrhem?" confirmLabel="Nahradit návrhem"
        onConfirm={() => { void suggest(); }}>
        Současné požadavky v editoru nahradí nový návrh z inzerátu. Uloží se až po potvrzení.
      </ConfirmDialog>
    </div>
  );
}
