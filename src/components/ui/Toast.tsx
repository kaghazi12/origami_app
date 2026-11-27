import React, { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';
import { CircleCheck, CircleX, X } from 'lucide-react';
import { cn } from './cn';

type ToastTone = 'info' | 'error';

interface ToastItem {
  id: number;
  tone: ToastTone;
  title: string;
  detail?: string;
}

interface ToastApi {
  show: (t: { title: string; detail?: string; tone?: ToastTone }) => void;
}

const ToastContext = createContext<ToastApi | null>(null);

/** Replaces alert(): messages appear bottom-centre. Info toasts leave after 4 s; errors stay until dismissed. */
export const ToastProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [items, setItems] = useState<ToastItem[]>([]);
  const nextId = useRef(1);

  const dismiss = useCallback((id: number) => setItems((xs) => xs.filter((x) => x.id !== id)), []);

  const show = useCallback<ToastApi['show']>(
    ({ title, detail, tone = 'info' }) => {
      const id = nextId.current++;
      setItems((xs) => [...xs.slice(-2), { id, title, detail, tone }]);
      if (tone !== 'error') window.setTimeout(() => dismiss(id), 4000);
    },
    [dismiss],
  );

  const api = useMemo(() => ({ show }), [show]);

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div
        aria-live="polite"
        className="pointer-events-none fixed inset-x-0 bottom-24 z-[60] flex flex-col items-center gap-2 px-4"
      >
        {items.map((t) => (
          <div
            key={t.id}
            role={t.tone === 'error' ? 'alert' : 'status'}
            className="pointer-events-auto flex w-full max-w-md items-start gap-3 rounded-lg border border-line bg-surface-raised px-4 py-3 shadow-dialog"
          >
            {t.tone === 'error' ? (
              <CircleX className="mt-0.5 size-4 shrink-0 text-danger" strokeWidth={1.75} />
            ) : (
              <CircleCheck className="mt-0.5 size-4 shrink-0 text-success" strokeWidth={1.75} />
            )}
            <div className="min-w-0 flex-1 text-sm">
              <div className="font-medium text-ink">{t.title}</div>
              {t.detail && <div className={cn('mt-0.5 break-words text-ink-muted')}>{t.detail}</div>}
            </div>
            <button
              type="button"
              aria-label="Dismiss"
              onClick={() => dismiss(t.id)}
              className="-mr-1 rounded-sm p-0.5 text-ink-faint transition-colors duration-150 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
            >
              <X className="size-4" strokeWidth={1.75} />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
};

export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used inside <ToastProvider>');
  return ctx;
}
