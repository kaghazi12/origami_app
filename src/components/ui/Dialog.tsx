import React, { useEffect, useId, useRef } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'motion/react';
import { X } from 'lucide-react';
import { Button } from './Button';
import { cn } from './cn';

interface DialogProps {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: React.ReactNode;
  children?: React.ReactNode;
  /** Buttons at the bottom, right-aligned. */
  footer?: React.ReactNode;
  className?: string;
}

/**
 * A modal: replaces confirm() and holds small forms. Escape and the backdrop close it, focus moves
 * into it on open and back to where it was on close, and Tab stays inside.
 */
export const Dialog: React.FC<DialogProps> = ({ open, onClose, title, description, children, footer, className }) => {
  const titleId = useId();
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const before = document.activeElement as HTMLElement | null;
    const t = window.setTimeout(() => {
      const first = box.current?.querySelector<HTMLElement>('[data-autofocus], input, textarea, button:not([data-close])');
      (first ?? box.current)?.focus();
    }, 30);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      } else if (e.key === 'Tab' && box.current) {
        const items = [...box.current.querySelectorAll<HTMLElement>('button, a[href], input, textarea, select, [tabindex]:not([tabindex="-1"])')].filter(
          (el) => !el.hasAttribute('disabled'),
        );
        if (!items.length) return;
        const first = items[0], last = items[items.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.clearTimeout(t);
      window.removeEventListener('keydown', onKey, true);
      before?.focus?.();
    };
  }, [open, onClose]);

  return createPortal(
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-[70] flex items-end justify-center p-4 sm:items-center">
          <motion.div
            className="absolute inset-0 bg-ink/40"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
            onClick={onClose}
            aria-hidden="true"
          />
          <motion.div
            ref={box}
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            tabIndex={-1}
            className={cn('relative w-full max-w-md rounded-lg border border-line bg-surface-raised p-6 shadow-dialog focus:outline-none', className)}
            style={{ transformOrigin: 'top center', transformPerspective: 900 }}
            initial={{ opacity: 0, y: 16, rotateX: -10 }}
            animate={{ opacity: 1, y: 0, rotateX: 0 }}
            exit={{ opacity: 0, y: 8, transition: { duration: 0.14 } }}
            transition={{ duration: 0.24, ease: [0.2, 0.8, 0.2, 1] }}
          >
            <button
              type="button"
              data-close
              aria-label="Close"
              onClick={onClose}
              className="absolute right-3 top-3 rounded-sm p-1 text-ink-faint transition-colors hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus/60"
            >
              <X className="size-4" strokeWidth={1.75} />
            </button>
            <h2 id={titleId} className="pr-8 font-display text-xl font-semibold tracking-tight text-ink">
              {title}
            </h2>
            {description && <div className="mt-2 text-sm leading-relaxed text-ink-muted">{description}</div>}
            {children && <div className="mt-5">{children}</div>}
            {footer && <div className="mt-6 flex flex-wrap justify-end gap-2">{footer}</div>}
          </motion.div>
        </div>
      )}
    </AnimatePresence>,
    document.body,
  );
};

/** "Are you sure?" with a cancel and a confirm button. */
export const ConfirmDialog: React.FC<{
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  description?: React.ReactNode;
  confirmLabel: string;
  danger?: boolean;
}> = ({ open, onClose, onConfirm, title, description, confirmLabel, danger }) => (
  <Dialog
    open={open}
    onClose={onClose}
    title={title}
    description={description}
    footer={
      <>
        <Button onClick={onClose}>Cancel</Button>
        <Button
          variant={danger ? 'secondary' : 'primary'}
          className={danger ? 'border-danger/40 text-danger hover:bg-danger-soft' : undefined}
          onClick={() => {
            onConfirm();
            onClose();
          }}
        >
          {confirmLabel}
        </Button>
      </>
    }
  />
);
