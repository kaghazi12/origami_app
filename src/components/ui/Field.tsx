import React, { useId } from 'react';
import { cn } from './cn';

const control =
  'w-full rounded-md border border-line-strong bg-surface-raised px-3 text-sm text-ink placeholder:text-ink-faint ' +
  'transition-[border-color,box-shadow] duration-150 ease-out hover:border-ink-faint ' +
  'focus:border-focus focus:outline-none focus:ring-2 focus:ring-focus/30 disabled:cursor-not-allowed disabled:opacity-50';

interface FieldShellProps {
  label: string;
  hint?: React.ReactNode;
  error?: string | null;
  /** Characters used / allowed, shown right of the label. */
  count?: [number, number];
  className?: string;
  children: (id: string, describedBy: string | undefined) => React.ReactNode;
}

/** Label, control, hint and error, wired together for screen readers. */
const FieldShell: React.FC<FieldShellProps> = ({ label, hint, error, count, className, children }) => {
  const id = useId();
  const hintId = hint ? `${id}-hint` : undefined;
  const errId = error ? `${id}-err` : undefined;
  return (
    <div className={cn('space-y-1.5', className)}>
      <div className="flex items-baseline justify-between gap-3">
        <label htmlFor={id} className="text-sm font-medium text-ink">
          {label}
        </label>
        {count && (
          <span className={cn('text-xs tabular-nums', count[0] > count[1] ? 'text-danger' : 'text-ink-faint')}>
            {count[0]}/{count[1]}
          </span>
        )}
      </div>
      {children(id, [hintId, errId].filter(Boolean).join(' ') || undefined)}
      {hint && !error && (
        <p id={hintId} className="text-xs leading-relaxed text-ink-muted">
          {hint}
        </p>
      )}
      {error && (
        <p id={errId} className="text-xs font-medium text-danger">
          {error}
        </p>
      )}
    </div>
  );
};

export interface TextFieldProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'className'> {
  label: string;
  hint?: React.ReactNode;
  error?: string | null;
  maxCount?: number;
  className?: string;
  /** Text before the input, e.g. "@". */
  prefix?: string;
}

export const TextField: React.FC<TextFieldProps> = ({ label, hint, error, maxCount, className, prefix, ...rest }) => (
  <FieldShell
    label={label}
    hint={hint}
    error={error}
    className={className}
    count={maxCount !== undefined ? [String(rest.value ?? '').length, maxCount] : undefined}
  >
    {(id, describedBy) =>
      prefix ? (
        <div className="relative">
          <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-sm text-ink-faint">{prefix}</span>
          <input id={id} aria-describedby={describedBy} aria-invalid={!!error || undefined} className={cn(control, 'h-9 pl-7')} {...rest} />
        </div>
      ) : (
        <input id={id} aria-describedby={describedBy} aria-invalid={!!error || undefined} className={cn(control, 'h-9')} {...rest} />
      )
    }
  </FieldShell>
);

export interface TextAreaProps extends Omit<React.TextareaHTMLAttributes<HTMLTextAreaElement>, 'className'> {
  label: string;
  hint?: React.ReactNode;
  error?: string | null;
  maxCount?: number;
  className?: string;
}

export const TextArea: React.FC<TextAreaProps> = ({ label, hint, error, maxCount, className, rows = 3, ...rest }) => (
  <FieldShell
    label={label}
    hint={hint}
    error={error}
    className={className}
    count={maxCount !== undefined ? [String(rest.value ?? '').length, maxCount] : undefined}
  >
    {(id, describedBy) => (
      <textarea
        id={id}
        rows={rows}
        aria-describedby={describedBy}
        aria-invalid={!!error || undefined}
        className={cn(control, 'resize-y py-2 leading-relaxed')}
        {...rest}
      />
    )}
  </FieldShell>
);

/** A bare input for toolbars and inline editing (no label shown; pass aria-label). */
export const InlineInput = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className, ...rest }, ref) => <input ref={ref} className={cn(control, 'h-8', className)} {...rest} />,
);
InlineInput.displayName = 'InlineInput';
