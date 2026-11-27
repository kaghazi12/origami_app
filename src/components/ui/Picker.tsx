import React, { useEffect, useId, useRef, useState } from 'react';
import { Check, ChevronDown } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { cn } from './cn';

export interface PickerItem {
  id: string;
  title: string;
  /** One line of detail: difficulty, step count, crease count... */
  meta?: string;
  group?: string;
  /** Small visual on the left: a crease-pattern thumbnail or paper swatch. */
  thumbnail?: React.ReactNode;
}

interface PickerProps {
  items: PickerItem[];
  value: string | null;
  onChange: (id: string) => void;
  /** Shown in the trigger when `value` isn't one of the items (e.g. an uploaded file). */
  fallbackTitle?: string;
  label: string;
  className?: string;
  /** Extra content at the bottom of the list, e.g. an "Open a file…" action. */
  footer?: React.ReactNode;
}

/** A design picker: a trigger button and a popover list with titles, details and thumbnails. */
export const Picker: React.FC<PickerProps> = ({ items, value, onChange, fallbackTitle, label, className, footer }) => {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const root = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const listId = useId();

  const selected = items.find((i) => i.id === value) ?? null;

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (root.current && !root.current.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener('pointerdown', onDown);
    return () => window.removeEventListener('pointerdown', onDown);
  }, [open]);

  useEffect(() => {
    if (open) {
      const i = Math.max(0, items.findIndex((x) => x.id === value));
      setActive(i);
      requestAnimationFrame(() => listRef.current?.focus());
    }
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const choose = (i: number) => {
    const item = items[i];
    if (!item) return;
    onChange(item.id);
    setOpen(false);
  };

  const onListKey = (e: React.KeyboardEvent) => {
    e.stopPropagation();
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((a) => Math.min(items.length - 1, a + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((a) => Math.max(0, a - 1));
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      choose(active);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      setOpen(false);
    } else if (e.key === 'Tab') {
      setOpen(false);
    }
  };

  let lastGroup: string | undefined;

  return (
    <div ref={root} className={cn('relative', className)}>
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        aria-label={`${label}: ${selected?.title ?? fallbackTitle ?? 'none'}`}
        onClick={() => setOpen((o) => !o)}
        className={cn(
          'flex h-8 w-full items-center gap-2 rounded-md border border-line-strong bg-surface-raised pl-2 pr-2 text-left text-sm',
          'transition-[background-color,border-color] duration-150 ease-out hover:bg-sunken',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus/60 focus-visible:ring-offset-1',
        )}
      >
        {selected?.thumbnail && <span className="size-5 shrink-0">{selected.thumbnail}</span>}
        <span className="min-w-0 flex-1 truncate font-medium text-ink">{selected?.title ?? fallbackTitle ?? 'Choose…'}</span>
        <ChevronDown
          className={cn('size-4 shrink-0 text-ink-muted transition-transform duration-150', open && 'rotate-180')}
          strokeWidth={1.75}
        />
      </button>

      <AnimatePresence>
      {open && (
        <motion.div
          key="list"
          initial={{ opacity: 0, y: -6, scaleY: 0.96 }}
          animate={{ opacity: 1, y: 0, scaleY: 1 }}
          exit={{ opacity: 0, y: -4, scaleY: 0.98, transition: { duration: 0.12 } }}
          transition={{ duration: 0.2, ease: [0.2, 0.8, 0.2, 1] }}
          style={{ transformOrigin: 'top' }}
          className="absolute left-0 top-full z-50 mt-1 w-full min-w-72 rounded-lg border border-line bg-surface-raised p-1 shadow-dialog"
        >
          <ul
            ref={listRef}
            id={listId}
            role="listbox"
            tabIndex={-1}
            aria-label={label}
            aria-activedescendant={`${listId}-${active}`}
            onKeyDown={onListKey}
            className="max-h-96 overflow-y-auto focus:outline-none"
          >
            {items.map((item, i) => {
              const header = item.group && item.group !== lastGroup ? item.group : null;
              lastGroup = item.group;
              const isSelected = item.id === value;
              return (
                <React.Fragment key={item.id}>
                  {header && (
                    <li role="presentation" className="px-2 pb-1 pt-2 text-xs font-medium text-ink-faint first:pt-1">
                      {header}
                    </li>
                  )}
                  <li
                    id={`${listId}-${i}`}
                    role="option"
                    aria-selected={isSelected}
                    onPointerEnter={() => setActive(i)}
                    onClick={() => choose(i)}
                    className={cn(
                      'relative flex cursor-pointer items-center gap-3 rounded-md px-2 py-1.5 transition-colors duration-100',
                      i === active && 'bg-sunken',
                    )}
                  >
                    {item.thumbnail && <span className="size-8 shrink-0">{item.thumbnail}</span>}
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-ink">{item.title}</span>
                      {item.meta && <span className="block truncate text-xs text-ink-muted">{item.meta}</span>}
                    </span>
                    {isSelected && <Check className="size-4 shrink-0 text-accent-ink" strokeWidth={2.25} />}
                  </li>
                </React.Fragment>
              );
            })}
          </ul>
          {footer && (
            <div className="mt-1 border-t border-line pt-1" onClick={() => setOpen(false)}>
              {footer}
            </div>
          )}
        </motion.div>
      )}
      </AnimatePresence>
    </div>
  );
};
