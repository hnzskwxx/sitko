import { CircleAlert, CircleCheck } from 'lucide-react';
import { createContext, useCallback, useContext, useState, type ReactNode } from 'react';

interface Toast { id: number; tone: 'success' | 'error'; text: string }
const Ctx = createContext<(text: string, tone?: Toast['tone']) => void>(() => {});

/** Toast se ukazuje jen po skutečné odpovědi serveru, nikdy „naslepo“. */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const push = useCallback((text: string, tone: Toast['tone'] = 'success') => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t.slice(-2), { id, tone, text }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), tone === 'error' ? 7000 : 4000);
  }, []);
  return (
    <Ctx.Provider value={push}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast toast-${t.tone}`}>
            {t.tone === 'success' ? <CircleCheck aria-hidden /> : <CircleAlert aria-hidden />}
            <span>{t.text}</span>
          </div>
        ))}
      </div>
    </Ctx.Provider>
  );
}

export const useToast = () => useContext(Ctx);
