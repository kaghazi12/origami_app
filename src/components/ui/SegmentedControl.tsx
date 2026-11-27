import React from 'react';
import { cn } from './cn';

export interface Segment<T extends string> {
  value: T;
  label: React.ReactNode;
  /** Accessible name when the label is an icon only; also shown as the native tooltip. */
  title?: string;
}

interface SegmentedControlProps<T extends string> {
  value: T;
  onChange: (value: T) => void;
  segments: Segment<T>[];
  size?: 'sm' | 'md';
  /** Accessible name for the group. */
  label: string;
  className?: string;
}

export function SegmentedControl<T extends string>({
  value,
  onChange,
  segments,
  size = 'md',
  label,
  className,
}: SegmentedControlProps<T>) {
  const refs = React.useRef<Array<HTMLButtonElement | null>>([]);

  const onKeyDown = (e: React.KeyboardEvent, i: number) => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    e.preventDefault();
    e.stopPropagation();
    const next = (i + (e.key === 'ArrowRight' ? 1 : -1) + segments.length) % segments.length;
    onChange(segments[next].value);
    refs.current[next]?.focus();
  };

  return (
    <div
      role="radiogroup"
      aria-label={label}
      className={cn('inline-flex rounded-md bg-sunken p-0.5', size === 'sm' ? 'h-7' : 'h-8', className)}
    >
      {segments.map((s, i) => {
        const selected = s.value === value;
        return (
          <button
            key={s.value}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="button"
            role="radio"
            aria-checked={selected}
            aria-label={s.title}
            title={s.title}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(s.value)}
            onKeyDown={(e) => onKeyDown(e, i)}
            className={cn(
              'inline-flex flex-1 items-center justify-center gap-1.5 rounded-sm font-medium whitespace-nowrap',
              'transition-[background-color,color,box-shadow] duration-150 ease-out',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40',
              size === 'sm' ? 'px-2 text-xs' : 'px-3 text-sm',
              selected ? 'bg-surface-raised text-ink shadow-sm' : 'text-ink-muted hover:text-ink',
            )}
          >
            {s.label}
          </button>
        );
      })}
    </div>
  );
}
