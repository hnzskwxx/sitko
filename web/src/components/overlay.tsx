import * as RDialog from '@radix-ui/react-dialog';
import * as RMenu from '@radix-ui/react-dropdown-menu';
import { X } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { Button } from './ui';

// ---------- Dialog ----------

interface DialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
  size?: 'md' | 'lg';
}

export function Dialog({ open, onOpenChange, title, description, children, footer, size = 'md' }: DialogProps) {
  return (
    <RDialog.Root open={open} onOpenChange={onOpenChange}>
      <RDialog.Portal>
        <RDialog.Overlay className="overlay" />
        <RDialog.Content className={`dialog${size === 'lg' ? ' dialog-lg' : ''}`} aria-describedby={description ? undefined : undefined}>
          <div className="dialog-head">
            <div>
              <RDialog.Title className="dialog-title">{title}</RDialog.Title>
              {description ? <RDialog.Description className="dialog-desc">{description}</RDialog.Description>
                : <RDialog.Description className="sr-only">{title}</RDialog.Description>}
            </div>
            <RDialog.Close className="btn btn-ghost btn-sm icon-btn" aria-label="Zavřít"><X aria-hidden /></RDialog.Close>
          </div>
          {children && <div className="dialog-body">{children}</div>}
          {footer && <div className="dialog-foot">{footer}</div>}
        </RDialog.Content>
      </RDialog.Portal>
    </RDialog.Root>
  );
}

// ---------- Potvrzení ----------

interface ConfirmProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  children: ReactNode;
  confirmLabel: string;
  danger?: boolean;
  onConfirm: () => Promise<unknown> | void;
}

export function ConfirmDialog({ open, onOpenChange, title, children, confirmLabel, danger, onConfirm }: ConfirmProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = async () => {
    setBusy(true);
    setError(null);
    try {
      await onConfirm();
      onOpenChange(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Akce se nepodařila.');
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => { if (!busy) { setError(null); onOpenChange(o); } }}
      title={title}
      footer={<>
        <Button onClick={() => onOpenChange(false)} disabled={busy}>Zrušit</Button>
        <Button variant={danger ? 'danger' : 'primary'} loading={busy} onClick={run}>{confirmLabel}</Button>
      </>}
    >
      <div className="stack-sm">
        <div className="muted">{children}</div>
        {error && <p className="form-error" role="alert">{error}</p>}
      </div>
    </Dialog>
  );
}

// ---------- Drawer (mobilní navigace) ----------

export function Drawer({ open, onOpenChange, title, children }: { open: boolean; onOpenChange: (o: boolean) => void; title: string; children: ReactNode }) {
  return (
    <RDialog.Root open={open} onOpenChange={onOpenChange}>
      <RDialog.Portal>
        <RDialog.Overlay className="overlay" />
        <RDialog.Content className="drawer">
          <RDialog.Title className="sr-only">{title}</RDialog.Title>
          <RDialog.Description className="sr-only">{title}</RDialog.Description>
          {children}
        </RDialog.Content>
      </RDialog.Portal>
    </RDialog.Root>
  );
}

// ---------- Menu ----------

export interface MenuAction {
  label: string;
  icon?: ReactNode;
  onSelect: () => void;
  danger?: boolean;
  disabled?: boolean;
  separatorBefore?: boolean;
}

export function Menu({ trigger, actions, align = 'end' }: { trigger: ReactNode; actions: MenuAction[]; align?: 'start' | 'end' }) {
  return (
    <RMenu.Root modal={false}>
      <RMenu.Trigger asChild>{trigger}</RMenu.Trigger>
      <RMenu.Portal>
        <RMenu.Content className="menu" align={align} sideOffset={4} collisionPadding={8} onClick={(e) => e.stopPropagation()}>
          {actions.map((a) => (
            <div key={a.label}>
              {a.separatorBefore && <RMenu.Separator className="menu-sep" />}
              <RMenu.Item className={`menu-item${a.danger ? ' is-danger' : ''}`} disabled={a.disabled} onSelect={a.onSelect}>
                {a.icon}{a.label}
              </RMenu.Item>
            </div>
          ))}
        </RMenu.Content>
      </RMenu.Portal>
    </RMenu.Root>
  );
}
