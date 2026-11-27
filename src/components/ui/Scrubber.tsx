import React from 'react';
import { cn } from './cn';

interface ScrubberProps {
  value: number;
  min?: number;
  max: number;
  step?: number;
  onChange: (value: number) => void;
  /** Positions (in value units) to mark on the track, e.g. step boundaries. */
  ticks?: number[];
  label: string;
  /** Text for screen readers, e.g. "Step 3 of 9". */
  valueText?: string;
  disabled?: boolean;
  className?: string;
}

/**
 * The playback track: a thin line filled in ink up to the current position, with optional tick
 * marks. A transparent native range input sits on top for keyboard and screen-reader support.
 */
export const Scrubber: React.FC<ScrubberProps> = ({
  value,
  min = 0,
  max,
  step = 0.001,
  onChange,
  ticks,
  label,
  valueText,
  disabled,
  className,
}) => {
  const span = Math.max(max - min, 1e-9);
  const pct = Math.max(0, Math.min(1, (value - min) / span)) * 100;
  return (
    <div
      className={cn('relative h-5 w-full', disabled && 'opacity-50', className)}
      style={{ ['--range-h' as string]: '20px' }}
    >
      <div className="pointer-events-none absolute inset-x-0 top-1/2 h-1 -translate-y-1/2 rounded-full bg-line" />
      <div
        className="pointer-events-none absolute left-0 top-1/2 h-1 -translate-y-1/2 rounded-full bg-ink"
        style={{ width: `${pct}%` }}
      />
      {ticks?.map((t) => {
        const tp = ((t - min) / span) * 100;
        if (tp <= 0 || tp >= 100) return null;
        return (
          <div
            key={t}
            className={cn(
              'pointer-events-none absolute top-1/2 h-2.5 w-px -translate-y-1/2',
              tp <= pct ? 'bg-ink/40' : 'bg-line-strong',
            )}
            style={{ left: `${tp}%` }}
          />
        );
      })}
      <input
        type="range"
        aria-label={label}
        aria-valuetext={valueText}
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        className="range-input absolute inset-0"
      />
    </div>
  );
};

interface MiniSliderProps {
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (value: number) => void;
  label: string;
  className?: string;
}

/** A compact slider for settings panels. */
export const MiniSlider: React.FC<MiniSliderProps> = ({ value, min, max, step, onChange, label, className }) => {
  const pct = Math.max(0, Math.min(1, (value - min) / Math.max(max - min, 1e-9))) * 100;
  return (
    <div className={cn('relative h-4 w-full', className)} style={{ ['--range-h' as string]: '16px' }}>
      <div className="pointer-events-none absolute inset-x-0 top-1/2 h-0.5 -translate-y-1/2 rounded-full bg-line" />
      <div
        className="pointer-events-none absolute left-0 top-1/2 h-0.5 -translate-y-1/2 rounded-full bg-ink-muted"
        style={{ width: `${pct}%` }}
      />
      <input
        type="range"
        aria-label={label}
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        className="range-input range-input-sm absolute inset-0"
      />
    </div>
  );
};
