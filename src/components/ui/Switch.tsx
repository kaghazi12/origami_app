import React, { useId } from 'react';
import { cn } from './cn';

interface SwitchProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  description?: string;
  className?: string;
}

/** A labelled on/off toggle for settings rows. */
export const Switch: React.FC<SwitchProps> = ({ checked, onChange, label, description, className }) => {
  const id = useId();
  return (
    <div className={cn('flex items-center justify-between gap-3', className)}>
      <label htmlFor={id} className="min-w-0 cursor-pointer text-sm text-ink">
        {label}
        {description && <span className="block text-xs text-ink-muted">{description}</span>}
      </label>
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={cn(
          'relative inline-flex h-4.5 w-8 shrink-0 items-center rounded-full transition-colors duration-150 ease-out',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus/60 focus-visible:ring-offset-1',
          checked ? 'bg-ink' : 'bg-line-strong',
        )}
      >
        <span
          className={cn(
            'inline-block size-3.5 rounded-full shadow-sm transition-[translate,background-color] duration-200 ease-out',
            checked ? 'translate-x-4 bg-accent' : 'translate-x-0.5 bg-surface-raised',
          )}
        />
      </button>
    </div>
  );
};
