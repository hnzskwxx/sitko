import { useQueryClient } from '@tanstack/react-query';
import { FileUp } from 'lucide-react';
import { useRef, useState } from 'react';
import { Link } from 'react-router';
import type { UploadResult } from '@shared/types';
import { errorMessage, upload } from '../api';
import { plural } from '../hooks';
import { Dialog } from './overlay';
import { Badge, Button, Notice } from './ui';

const ACCEPT = '.pdf,.docx,.txt,.jpg,.jpeg,.png';
const ALLOWED = /\.(pdf|docx|txt|jpe?g|png)$/i;

interface Row { fileName: string; outcome: UploadResult['outcome'] | 'uploading' | 'error'; message: string | null }

export function UploadDialog({ jobId, open, onOpenChange, maxFileMb = 10, blocked = false }: {
  jobId: string; open: boolean; onOpenChange: (o: boolean) => void; maxFileMb?: number;
  /** Firma nemá aktivní předplatné: místo nahrávání vysvětlení (server by soubory stejně odmítl). */
  blocked?: boolean;
}) {
  const [rows, setRows] = useState<Row[]>([]);
  const [progress, setProgress] = useState<number | null>(null);
  const [over, setOver] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const qc = useQueryClient();
  const busy = progress !== null;

  const send = async (list: FileList | File[]) => {
    const files = Array.from(list);
    if (!files.length) return;
    const local: Row[] = [];
    const ok: File[] = [];
    for (const f of files) {
      if (!ALLOWED.test(f.name)) local.push({ fileName: f.name, outcome: 'rejected', message: 'Tento formát neumíme přečíst. Použijte PDF, DOCX, TXT, JPG nebo PNG.' });
      else if (f.size > maxFileMb * 1024 * 1024) local.push({ fileName: f.name, outcome: 'rejected', message: `Soubor je větší než ${maxFileMb} MB.` });
      else ok.push(f);
    }
    setRows((r) => [...ok.map((f) => ({ fileName: f.name, outcome: 'uploading' as const, message: null })), ...local, ...r]);
    if (!ok.length) return;
    const form = new FormData();
    ok.forEach((f) => form.append('files', f, f.name));
    setProgress(0);
    try {
      const res = await upload<UploadResult[]>(`/jobs/${jobId}/applications`, form, setProgress);
      setRows((r) => [...res.map((x) => ({ fileName: x.fileName, outcome: x.outcome, message: x.message })), ...r.filter((x) => x.outcome !== 'uploading')]);
      await qc.invalidateQueries({ queryKey: ['applications', jobId] });
      await qc.invalidateQueries({ queryKey: ['job', jobId] });
    } catch (e) {
      setRows((r) => r.map((x) => (x.outcome === 'uploading' ? { ...x, outcome: 'error', message: errorMessage(e) } : x)));
    } finally {
      setProgress(null);
    }
  };

  const queued = rows.filter((r) => r.outcome === 'queued').length;

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => { if (!busy) { onOpenChange(o); if (!o) setRows([]); } }}
      title="Nahrát životopisy"
      description={`PDF, DOCX, TXT nebo fotka životopisu (JPG, PNG), nejvýš ${maxFileMb} MB na soubor. Zpracování běží na pozadí, dialog můžete zavřít.`}
      footer={<Button variant="primary" onClick={() => { onOpenChange(false); setRows([]); }} disabled={busy}>Hotovo</Button>}
    >
      {blocked ? (
        <Notice tone="warning" action={<Link className="btn btn-secondary btn-sm" to="/nastaveni/predplatne" onClick={() => onOpenChange(false)}>Předplatné</Link>}>
          Hodnocení životopisů je vypnuté, protože předplatné není aktivní. Soubory nahrajete po aktivaci tarifu.
        </Notice>
      ) : (
      <label
        className={`drop${over ? ' is-over' : ''}`}
        onDragOver={(e) => { e.preventDefault(); setOver(true); }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => { e.preventDefault(); setOver(false); if (!busy) void send(e.dataTransfer.files); }}
      >
        <input
          ref={input} type="file" multiple accept={ACCEPT} className="sr-only" disabled={busy}
          onChange={(e) => { if (e.target.files) void send(e.target.files); e.target.value = ''; }}
        />
        <FileUp aria-hidden />
        <strong>Přetáhněte soubory sem</strong>
        <span className="small muted">nebo klikněte a vyberte je z počítače</span>
      </label>
      )}

      {busy && (
        <div className="stack-sm" style={{ marginTop: 12 }} role="status">
          <span className="small muted">Nahrávám… {Math.round((progress ?? 0) * 100)} %</span>
          <div className="progress"><span style={{ width: `${(progress ?? 0) * 100}%` }} /></div>
        </div>
      )}

      {rows.length > 0 && (
        <>
          {queued > 0 && !busy && <p className="small" style={{ marginTop: 12 }}>{plural(queued, 'životopis se zpracovává', 'životopisy se zpracovávají', 'životopisů se zpracovává')} na pozadí.</p>}
          <div className="upload-list" aria-live="polite">
            {rows.map((r, i) => (
              <div className="upload-row" key={`${r.fileName}-${i}`}>
                <span className="ellipsis">{r.fileName}</span>
                {r.outcome === 'uploading' && <Badge>Nahrávám</Badge>}
                {r.outcome === 'queued' && <Badge tone="success">Přijato</Badge>}
                {r.outcome === 'duplicate' && <Badge tone="warning">Duplicita</Badge>}
                {(r.outcome === 'rejected' || r.outcome === 'error') && <Badge tone="error">Nepřijato</Badge>}
                {r.message && <span className="upload-msg">{r.message}</span>}
              </div>
            ))}
          </div>
        </>
      )}
    </Dialog>
  );
}
