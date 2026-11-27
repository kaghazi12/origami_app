import React from 'react';
import { AlertTriangle, CircleX, Info } from 'lucide-react';
import { cn } from './cn';

type Tone = 'warning' | 'danger' | 'info';

const tones: Record<Tone, { box: string; icon: string; Icon: typeof Info }> = {
  warning: { box: 'bg-warning-soft border-warning/25', icon: 'text-warning', Icon: AlertTriangle },
  danger: { box: 'bg-danger-soft border-danger/25', icon: 'text-danger', Icon: CircleX },
  info: { box: 'bg-sunken border-line', icon: 'text-ink-muted', Icon: Info },
};

interface CalloutProps {
  tone?: Tone;
  title: string;
  children?: React.ReactNode;
  className?: string;
}

/** An inline message inside a panel: icon, one-line title, optional detail. */
export const Callout: React.FC<CalloutProps> = ({ tone = 'warning', title, children, className }) => {
  const t = tones[tone];
  return (
    <div role={tone === 'info' ? 'note' : 'alert'} className={cn('flex gap-2.5 rounded-md border px-3 py-2.5 text-sm', t.box, className)}>
      <t.Icon className={cn('mt-0.5 size-4 shrink-0', t.icon)} strokeWidth={1.75} />
      <div className="min-w-0">
        <div className="font-medium text-ink">{title}</div>
        {children && <div className="mt-0.5 text-ink-muted">{children}</div>}
      </div>
    </div>
  );
};
