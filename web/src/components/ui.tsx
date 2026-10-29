import * as RTooltip from '@radix-ui/react-tooltip';
import {
  AlertCircle, Check, ChevronLeft, ChevronRight, CircleHelp, Contrast, LoaderCircle, Search, X,
} from 'lucide-react';
import {
  forwardRef, useId, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react';
import { MUST_LABEL, VERDICT_LABEL, type MustStatus, type Verdict } from '@shared/types';

const cx = (...c: Array<string | false | null | undefined>): string => c.filter(Boolean).join(' ');

// ---------- Tlačítka ----------

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';
interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: 'sm' | 'md' | 'lg';
  loading?: boolean;
  icon?: ReactNode;
  block?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'secondary', size = 'md', loading, icon, block, className, children, disabled, type = 'button', ...rest }, ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      className={cx('btn', `btn-${variant}`, size !== 'md' && `btn-${size}`, block && 'btn-block', className)}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...rest}
    >
      {loading ? <LoaderCircle className="spin" aria-hidden /> : icon}
      {children}
    </button>
  );
});

interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  label: string;
  size?: 'sm' | 'md';
  variant?: Variant;
}
export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { label, size = 'md', variant = 'ghost', className, children, ...rest }, ref,
) {
  return (
    <Tooltip content={label}>
      <button ref={ref} type="button" aria-label={label} className={cx('btn icon-btn', `btn-${variant}`, size === 'sm' && 'btn-sm', className)} {...rest}>
        {children}
      </button>
    </Tooltip>
  );
});

// ---------- Tooltip ----------

export function Tooltip({ content, children, side = 'top' }: { content: ReactNode; children: ReactNode; side?: 'top' | 'bottom' | 'left' | 'right' }) {
  return (
    <RTooltip.Root delayDuration={300}>
      <RTooltip.Trigger asChild>{children}</RTooltip.Trigger>
      <RTooltip.Portal>
        <RTooltip.Content className="tooltip" side={side} sideOffset={6} collisionPadding={8}>{content}</RTooltip.Content>
      </RTooltip.Portal>
    </RTooltip.Root>
  );
}

// ---------- Formuláře ----------

interface FieldProps { label: string; hint?: ReactNode; error?: string; children: (id: string, describedBy: string | undefined) => ReactNode }
export function Field({ label, hint, error, children }: FieldProps) {
  const id = useId();
  const hintId = hint ? `${id}-hint` : undefined;
  const errId = error ? `${id}-err` : undefined;
  return (
    <div className="field">
      <label className="label" htmlFor={id}>{label}</label>
      {children(id, [hintId, errId].filter(Boolean).join(' ') || undefined)}
      {hint && !error && <p className="hint" id={hintId}>{hint}</p>}
      {error && <p className="field-error" id={errId}>{error}</p>}
    </div>
  );
}

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement> & { invalid?: boolean; compact?: boolean }>(
  function Input({ invalid, compact, className, ...rest }, ref) {
    return <input ref={ref} className={cx('input', compact && 'input-sm', className)} aria-invalid={invalid || undefined} {...rest} />;
  },
);

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement> & { invalid?: boolean }>(
  function Textarea({ invalid, className, ...rest }, ref) {
    return <textarea ref={ref} className={cx('textarea', className)} aria-invalid={invalid || undefined} {...rest} />;
  },
);

export function Select({ compact, className, ...rest }: SelectHTMLAttributes<HTMLSelectElement> & { compact?: boolean }) {
  return <select className={cx('select', compact && 'select-sm', className)} {...rest} />;
}

export const SearchInput = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement> & { shortcut?: string }>(
  function SearchInput({ shortcut, ...rest }, ref) {
    return (
      <div className="search">
        <Search aria-hidden />
        <input ref={ref} type="search" className="input input-sm" {...rest} />
        {shortcut && !rest.value && <kbd aria-hidden>{shortcut}</kbd>}
      </div>
    );
  },
);

// ---------- Štítky ----------

export type Tone = 'neutral' | 'success' | 'warning' | 'error' | 'info' | 'outline';
export function Badge({ tone = 'neutral', children, icon, title }: { tone?: Tone; children: ReactNode; icon?: ReactNode; title?: string }) {
  return <span className={cx('badge', tone !== 'neutral' && `badge-${tone}`)} title={title}>{icon}{children}</span>;
}

const VERDICT_ICON: Record<Verdict, ReactNode> = {
  splnuje: <Check aria-hidden />,
  castecne: <Contrast aria-hidden />,
  nesplnuje: <X aria-hidden />,
  nelze_overit: <CircleHelp aria-hidden />,
};
export function VerdictBadge({ verdict }: { verdict: Verdict }) {
  return <span className={`verdict verdict-${verdict}`}>{VERDICT_ICON[verdict]}{VERDICT_LABEL[verdict]}</span>;
}

export function MustBadge({ status }: { status: MustStatus | null }) {
  if (!status || status === 'none') return <span className="muted small">–</span>;
  const tone: Tone = status === 'met' ? 'success' : status === 'unmet' ? 'error' : 'warning';
  return <Badge tone={tone}>{MUST_LABEL[status]}</Badge>;
}

// ---------- Skóre ----------

export function ScoreBar({ score, coverage, muted }: { score: number; coverage?: number | null; muted?: boolean }) {
  const content = (
    <span className={cx('score', muted && 'is-muted')} aria-label={`Doložená shoda ${score} %${coverage != null ? `, úplnost ${coverage} %` : ''}`}>
      <span className="score-num">{score}</span>
      <span className="score-track" aria-hidden><span className="score-fill" style={{ width: `${score}%` }} /></span>
    </span>
  );
  if (coverage == null) return content;
  return (
    <Tooltip content={<>Doložená shoda s požadavky této pozice: {score} %.<br />Úplnost hodnocení: {coverage} % (podíl vah, u kterých CV obsahovalo informaci).</>}>
      {content}
    </Tooltip>
  );
}

// ---------- Stavy ----------

export function Spinner({ label = 'Načítám…' }: { label?: string }) {
  return <span className="row muted small" role="status"><LoaderCircle className="spin" width={16} height={16} aria-hidden />{label}</span>;
}

export function Skeleton({ w = '100%', h = 14, style }: { w?: number | string; h?: number; style?: React.CSSProperties }) {
  return <span className="skeleton" style={{ width: w, height: h, ...style }} aria-hidden />;
}

export function SkeletonRows({ rows = 5, cols = 4 }: { rows?: number; cols?: number }) {
  return (
    <div role="status" aria-label="Načítám">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} style={{ display: 'grid', gridTemplateColumns: `2fr repeat(${cols - 1}, 1fr)`, gap: 16, padding: '16px 12px', borderBottom: '1px solid var(--border)' }}>
          <div className="stack-sm"><Skeleton w="60%" /><Skeleton w="40%" h={12} /></div>
          {Array.from({ length: cols - 1 }, (__, j) => <Skeleton key={j} w="70%" />)}
        </div>
      ))}
    </div>
  );
}

export function EmptyState({ icon, title, children, actions, center }: { icon?: ReactNode; title: string; children?: ReactNode; actions?: ReactNode; center?: boolean }) {
  return (
    <div className={cx('empty', center && 'empty-center')}>
      {icon && <div className="empty-icon" aria-hidden>{icon}</div>}
      <h3>{title}</h3>
      {children && <p>{children}</p>}
      {actions && <div className="row-wrap">{actions}</div>}
    </div>
  );
}

export function ErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  return (
    <div className="error-state" role="alert">
      <AlertCircle aria-hidden />
      <div className="stack-sm">
        <span>{error instanceof Error ? error.message : 'Něco se nepovedlo.'}</span>
        {onRetry && <div><Button size="sm" onClick={onRetry}>Zkusit znovu</Button></div>}
      </div>
    </div>
  );
}

export function Notice({ tone = 'neutral', icon, children, action }: { tone?: 'warning' | 'info' | 'neutral'; icon?: ReactNode; children: ReactNode; action?: ReactNode }) {
  return <div className={`notice notice-${tone}`}>{icon}<div>{children}</div>{action}</div>;
}

// ---------- Avatar ----------

export function Avatar({ name, size }: { name: string; size?: 'lg' }) {
  const initials = name.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]?.toUpperCase()).join('') || '?';
  return <span className={cx('avatar', size === 'lg' && 'avatar-lg')} aria-hidden>{initials}</span>;
}

// ---------- Stránkování ----------

export function Pagination({ page, pageSize, total, onPage }: { page: number; pageSize: number; total: number; onPage: (p: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const from = total ? (page - 1) * pageSize + 1 : 0;
  const to = Math.min(total, page * pageSize);
  return (
    <div className="table-foot">
      <span className="num">{from}–{to} z {total}</span>
      {pages > 1 && (
        <nav className="pagination" aria-label="Stránkování">
          <IconButton label="Předchozí stránka" size="sm" disabled={page <= 1} onClick={() => onPage(page - 1)}><ChevronLeft /></IconButton>
          <span className="num small">{page} / {pages}</span>
          <IconButton label="Další stránka" size="sm" disabled={page >= pages} onClick={() => onPage(page + 1)}><ChevronRight /></IconButton>
        </nav>
      )}
    </div>
  );
}

// ---------- Logo ----------

export function Logo({ size = 24 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden>
      <rect x="1" y="1" width="30" height="30" rx="8" fill="var(--logo-bg)" />
      <g fill="var(--evidence)">
        <circle cx="10.5" cy="11" r="2" /><circle cx="16" cy="11" r="2" /><circle cx="21.5" cy="11" r="2" />
        <circle cx="13.25" cy="16.5" r="2" /><circle cx="18.75" cy="16.5" r="2" />
        <circle cx="16" cy="22" r="2" />
      </g>
    </svg>
  );
}

export { cx };
