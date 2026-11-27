import React from 'react';
import { cn } from './cn';
import { Tooltip } from './Tooltip';

/** `inverse`: a secondary button for ink-coloured bands (the landing hero). */
type Variant = 'primary' | 'secondary' | 'ghost' | 'inverse';
type Size = 'sm' | 'md' | 'lg';

const base =
  'inline-flex items-center justify-center gap-2 rounded-md font-medium whitespace-nowrap select-none ' +
  'transition-[background-color,border-color,color,box-shadow,transform] duration-150 ease-out ' +
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus/60 focus-visible:ring-offset-1 focus-visible:ring-offset-canvas ' +
  'disabled:opacity-50 disabled:cursor-not-allowed';

/*
 * Primary and secondary buttons have a 2px "paper edge" under them (shadow-edge). Pressing
 * pushes the button down onto it, like pressing a crease flat.
 */
const press = 'enabled:active:translate-y-0.5 enabled:active:shadow-none [a&]:active:translate-y-0.5 [a&]:active:shadow-none';

const variants: Record<Variant, string> = {
  primary: `bg-accent text-on-accent font-semibold shadow-edge-accent hover:bg-accent-hover disabled:hover:bg-accent ${press}`,
  secondary: `bg-surface-raised text-ink border border-line-strong shadow-edge hover:bg-surface hover:border-ink-faint disabled:hover:bg-surface-raised ${press}`,
  ghost: 'text-ink-muted hover:text-ink hover:bg-sunken disabled:hover:bg-transparent',
  inverse: `text-paper border border-paper-muted/50 shadow-[0_2px_0_var(--color-ink-line)] hover:border-paper hover:bg-ink-line ${press}`,
};

const sizes: Record<Size, string> = {
  sm: 'h-7 px-2.5 text-xs',
  md: 'h-8 px-3 text-sm',
  /** Landing page calls to action only. Tool UI uses sm and md. */
  lg: 'h-10 px-4 text-sm',
};

/** The button look, for links that should read as buttons. */
export function buttonClasses(variant: Variant = 'secondary', size: Size = 'md', className?: string): string {
  return cn(base, variants[variant], sizes[size], className);
}

export interface ButtonLinkProps extends React.AnchorHTMLAttributes<HTMLAnchorElement> {
  variant?: Variant;
  size?: Size;
  icon?: React.ComponentType<{ className?: string; strokeWidth?: number }>;
  /** Icon after the label, e.g. an arrow. */
  trailingIcon?: React.ComponentType<{ className?: string; strokeWidth?: number }>;
}

export const ButtonLink: React.FC<ButtonLinkProps> = ({
  variant = 'secondary',
  size = 'md',
  icon: Icon,
  trailingIcon: Trailing,
  className,
  children,
  ...rest
}) => (
  <a className={buttonClasses(variant, size, className)} {...rest}>
    {Icon && <Icon className="size-4" strokeWidth={1.75} />}
    {children}
    {Trailing && <Trailing className="size-4" strokeWidth={1.75} />}
  </a>
);

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  /** A Lucide icon rendered before the label. */
  icon?: React.ComponentType<{ className?: string; strokeWidth?: number }>;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ variant = 'secondary', size = 'md', icon: Icon, className, children, type = 'button', ...rest }, ref) => (
    <button ref={ref} type={type} className={cn(base, variants[variant], sizes[size], className)} {...rest}>
      {Icon && <Icon className={size === 'sm' ? 'size-3.5' : 'size-4'} strokeWidth={1.75} />}
      {children}
    </button>
  ),
);
Button.displayName = 'Button';

export interface IconButtonProps extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'children'> {
  /** Required: used as the accessible name and the tooltip. */
  label: string;
  /** Optional keyboard shortcut shown in the tooltip. */
  shortcut?: string;
  icon: React.ComponentType<{ className?: string; strokeWidth?: number }>;
  variant?: Variant;
  size?: Size;
  /** Pressed state for toggles. */
  active?: boolean;
  tooltipSide?: 'top' | 'bottom';
}

export const IconButton = React.forwardRef<HTMLButtonElement, IconButtonProps>(
  (
    { label, shortcut, icon: Icon, variant = 'ghost', size = 'md', active, tooltipSide = 'bottom', className, type = 'button', ...rest },
    ref,
  ) => (
    <Tooltip content={label} shortcut={shortcut} side={tooltipSide}>
      <button
        ref={ref}
        type={type}
        aria-label={label}
        aria-pressed={active}
        className={cn(
          base,
          variants[variant],
          size === 'sm' ? 'size-7' : 'size-8',
          active && variant === 'ghost' && 'bg-sunken text-ink',
          variant === 'ghost' && 'active:bg-line',
          className,
        )}
        {...rest}
      >
        <Icon className="size-4" strokeWidth={1.75} />
      </button>
    </Tooltip>
  ),
);
IconButton.displayName = 'IconButton';
