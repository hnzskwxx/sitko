import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import type { Me } from '@shared/types';
import { api } from './api';

export function useMe() {
  return useQuery<Me | null>({
    queryKey: ['me'],
    queryFn: () => api.get<Me | null>('/auth/me'),
    staleTime: 60_000,
  });
}

/** Klávesová zkratka, která se ignoruje při psaní do pole. */
export function useHotkey(key: string, handler: (e: KeyboardEvent) => void, opts: { meta?: boolean; enabled?: boolean } = {}) {
  useEffect(() => {
    if (opts.enabled === false) return;
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      const typing = t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);
      if (opts.meta) {
        if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === key) { e.preventDefault(); handler(e); }
        return;
      }
      if (typing || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === key) { e.preventDefault(); handler(e); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [key, handler, opts.meta, opts.enabled]);
}

export function useDocumentTitle(title: string | undefined) {
  useEffect(() => {
    document.title = title ? `${title} · Sítko` : 'Sítko';
  }, [title]);
}

const dateFmt = new Intl.DateTimeFormat('cs-CZ', { day: 'numeric', month: 'numeric', year: 'numeric' });
const dateTimeFmt = new Intl.DateTimeFormat('cs-CZ', { day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit' });
const rtf = new Intl.RelativeTimeFormat('cs', { numeric: 'auto' });

export const fmtDate = (iso: string): string => dateFmt.format(new Date(iso));
export const fmtDateTime = (iso: string): string => dateTimeFmt.format(new Date(iso));
export function fmtRelative(iso: string): string {
  const diff = (new Date(iso).getTime() - Date.now()) / 1000;
  const abs = Math.abs(diff);
  if (abs < 60) return 'právě teď';
  if (abs < 3600) return rtf.format(Math.round(diff / 60), 'minute');
  if (abs < 86400) return rtf.format(Math.round(diff / 3600), 'hour');
  if (abs < 86400 * 7) return rtf.format(Math.round(diff / 86400), 'day');
  return fmtDate(iso);
}

/** Datum RRRR-MM-DD (bez času, např. konec předplatného) česky: 15. 11. 2026 */
export const fmtDay = (ymd: string): string => {
  const [y, m, d] = ymd.split('-').map(Number);
  return `${d}. ${m}. ${y}`;
};

const czk = new Intl.NumberFormat('cs-CZ', { maximumFractionDigits: 0 });
export const fmtCzk = (n: number): string => `${czk.format(n)} Kč`;

export const plural = (n: number, one: string, few: string, many: string): string =>
  `${n} ${n === 1 ? one : n >= 2 && n <= 4 ? few : many}`;

/** Poslední použité filtry seznamu kandidátů (pro odkaz „Zpět na kandidáty“), přežijí i obnovení stránky. */
export const lastListSearch = {
  get(jobId: string): string | undefined {
    try { return sessionStorage.getItem(`sitko:list:${jobId}`) ?? undefined; } catch { return undefined; }
  },
  set(jobId: string, search: string): void {
    try { sessionStorage.setItem(`sitko:list:${jobId}`, search); } catch { /* úložiště nedostupné */ }
  },
};

interface InstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

/** Vrátí funkci pro instalaci aplikace (PWA), pokud ji prohlížeč nabízí, jinak null. */
export function useInstallPrompt(): (() => Promise<void>) | null {
  const [evt, setEvt] = useState<InstallPromptEvent | null>(null);
  useEffect(() => {
    const onPrompt = (e: Event) => { e.preventDefault(); setEvt(e as InstallPromptEvent); };
    const onInstalled = () => setEvt(null);
    window.addEventListener('beforeinstallprompt', onPrompt);
    window.addEventListener('appinstalled', onInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', onPrompt);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);
  if (!evt) return null;
  return async () => {
    await evt.prompt();
    await evt.userChoice;
    setEvt(null);
  };
}
