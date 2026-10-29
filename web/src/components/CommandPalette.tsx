import * as RDialog from '@radix-ui/react-dialog';
import { useQuery } from '@tanstack/react-query';
import { Briefcase, LayoutDashboard, Plus, Search, Settings, Users } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router';
import type { JobSummary } from '@shared/types';
import { JOB_STATUS_LABEL } from '@shared/types';
import { api } from '../api';

interface Item { id: string; group: string; label: string; hint?: string; icon: ReactNode; to: string }

const ACTIONS: Item[] = [
  { id: 'new', group: 'Akce', label: 'Nová pozice', icon: <Plus />, to: '/pozice/nova' },
  { id: 'dash', group: 'Přejít na', label: 'Přehled', icon: <LayoutDashboard />, to: '/' },
  { id: 'jobs', group: 'Přejít na', label: 'Pozice', icon: <Briefcase />, to: '/pozice' },
  { id: 'team', group: 'Přejít na', label: 'Tým', icon: <Users />, to: '/nastaveni/tym' },
  { id: 'settings', group: 'Přejít na', label: 'Nastavení', icon: <Settings />, to: '/nastaveni' },
];

const norm = (s: string) => s.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();

export function CommandPalette({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const [q, setQ] = useState('');
  const [active, setActive] = useState(0);
  const navigate = useNavigate();
  const listRef = useRef<HTMLDivElement>(null);
  const jobs = useQuery({
    queryKey: ['jobs', 'palette'],
    queryFn: () => api.list<JobSummary>('/jobs?status=all&pageSize=100'),
    enabled: open,
    staleTime: 30_000,
  });

  const items = useMemo(() => {
    const jobItems: Item[] = (jobs.data?.data ?? []).map((j) => ({
      id: j.id, group: 'Pozice', label: j.title, hint: JOB_STATUS_LABEL[j.status], icon: <Briefcase />, to: `/pozice/${j.id}`,
    }));
    const all = [...ACTIONS, ...jobItems];
    const nq = norm(q.trim());
    return nq ? all.filter((i) => norm(i.label).includes(nq)) : all;
  }, [q, jobs.data]);

  useEffect(() => { setActive(0); }, [q, open]);
  useEffect(() => { if (!open) setQ(''); }, [open]);
  useEffect(() => {
    listRef.current?.querySelector(`[data-index="${active}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  const go = (item: Item | undefined) => {
    if (!item) return;
    onOpenChange(false);
    navigate(item.to);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => Math.min(items.length - 1, a + 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(0, a - 1)); }
    else if (e.key === 'Enter') { e.preventDefault(); go(items[active]); }
  };

  let lastGroup = '';
  return (
    <RDialog.Root open={open} onOpenChange={onOpenChange}>
      <RDialog.Portal>
        <RDialog.Overlay className="overlay" />
        <RDialog.Content className="dialog palette" onKeyDown={onKeyDown}>
          <RDialog.Title className="sr-only">Hledat a přejít</RDialog.Title>
          <RDialog.Description className="sr-only">Napište název pozice nebo akce, šipkami vyberte a potvrďte Enterem.</RDialog.Description>
          <div className="palette-input">
            <Search aria-hidden />
            <input
              autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Hledat pozici nebo akci…"
              role="combobox" aria-expanded aria-controls="palette-list" aria-activedescendant={items[active] ? `pal-${items[active].id}` : undefined}
            />
          </div>
          <div className="palette-list" id="palette-list" role="listbox" ref={listRef} aria-label="Výsledky">
            {items.length === 0 && <p className="muted small" style={{ padding: 12 }}>Nic nenalezeno.</p>}
            {items.map((item, i) => {
              const header = item.group !== lastGroup ? item.group : null;
              lastGroup = item.group;
              return (
                <div key={item.id}>
                  {header && <div className="palette-group">{header}</div>}
                  <button
                    type="button" id={`pal-${item.id}`} role="option" aria-selected={i === active} data-index={i}
                    className="palette-item" onMouseMove={() => setActive(i)} onClick={() => go(item)}
                  >
                    {item.icon}<span className="ellipsis">{item.label}</span>
                    {item.hint && <span className="xs muted" style={{ marginLeft: 'auto' }}>{item.hint}</span>}
                  </button>
                </div>
              );
            })}
          </div>
          <div className="palette-foot" aria-hidden><span><kbd>↑</kbd> <kbd>↓</kbd> výběr</span><span><kbd>Enter</kbd> otevřít</span><span><kbd>Esc</kbd> zavřít</span></div>
        </RDialog.Content>
      </RDialog.Portal>
    </RDialog.Root>
  );
}
