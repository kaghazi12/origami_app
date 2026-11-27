import React, { useEffect, useRef, useState } from 'react';
import { Keyboard } from 'lucide-react';
import { IconButton } from './Button';
import { Kbd } from './Kbd';

export interface Shortcut {
  keys: string[];
  label: string;
}

/** The "?" popover that lists a page's keyboard shortcuts. Also opens with the ? key. */
export const ShortcutsButton: React.FC<{ shortcuts: Shortcut[] }> = ({ shortcuts }) => {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      if (e.key === '?') setOpen((o) => !o);
      else if (e.key === 'Escape') setOpen(false);
    };
    const onDown = (e: PointerEvent) => {
      if (root.current && !root.current.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('pointerdown', onDown);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('pointerdown', onDown);
    };
  }, []);

  return (
    <div ref={root} className="relative">
      <IconButton label="Keyboard shortcuts" shortcut="?" icon={Keyboard} active={open} onClick={() => setOpen((o) => !o)} />
      {open && (
        <div
          role="dialog"
          aria-label="Keyboard shortcuts"
          className="absolute right-0 top-full z-50 mt-1 w-64 rounded-lg border border-line bg-surface-raised p-3 shadow-dialog"
        >
          <div className="mb-2 text-sm font-semibold text-ink">Keyboard shortcuts</div>
          <dl className="space-y-1.5">
            {shortcuts.map((s) => (
              <div key={s.label} className="flex items-center justify-between gap-3 text-sm">
                <dt className="text-ink-muted">{s.label}</dt>
                <dd className="flex gap-1">
                  {s.keys.map((k) => (
                    <Kbd key={k}>{k}</Kbd>
                  ))}
                </dd>
              </div>
            ))}
          </dl>
        </div>
      )}
    </div>
  );
};

/** True when a key event should be left to the focused control (text fields, lists, sliders). */
export function isTypingTarget(target: EventTarget | null): boolean {
  const t = target as HTMLElement | null;
  if (!t) return false;
  if (t.isContentEditable) return true;
  const tag = t.tagName;
  if (tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (tag === 'INPUT') return (t as HTMLInputElement).type !== 'range' && (t as HTMLInputElement).type !== 'checkbox';
  return t.getAttribute('role') === 'listbox';
}
