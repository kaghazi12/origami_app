import React, { useEffect, useState } from 'react';
import { animate, motion, useMotionValue, useTransform } from 'motion/react';
import { theme } from '../../theme';
import { usePrefersReducedMotion } from '../../hooks';
import { cn } from '../ui/cn';

/*
 * The mark: a square sheet with its top-right corner folded in to the centre, showing the
 * marigold back of the paper. The flap really folds: its tip moves across the crease
 * (16,4)–(28,16), and the colour flips from the front (ink) to the back (marigold) halfway.
 *
 * k = cos(fold angle): -1 = flat (tip at the corner), 1 = folded (tip at the centre).
 */
/** The intro fold plays once per visit, not on every page change. */
let introPlayed = false;

const FOOT = [22, 10]; // the centre's foot on the crease
const HALF = [-6, 6]; // from the foot to the folded tip

/** `fold`: play the fold when it first appears. `hover`: unfold a little on hover (pass the parent's hover state). */
export const Mark: React.FC<{ className?: string; tone?: 'default' | 'inverse'; hovered?: boolean; intro?: boolean }> = ({
  className,
  tone = 'default',
  hovered = false,
  intro = true,
}) => {
  const reduced = usePrefersReducedMotion();
  const [playIntro] = useState(() => intro && !reduced && !introPlayed);
  const k = useMotionValue(playIntro ? -1 : 1);
  const tip = useTransform(k, (v) => `M16 4L28 16L${FOOT[0] + HALF[0] * v} ${FOOT[1] + HALF[1] * v}Z`);
  const flapFill = useTransform(k, (v) => (v < 0 ? (tone === 'inverse' ? theme.paper : theme.ink) : theme.accent));
  const [ready, setReady] = useState(!playIntro);

  useEffect(() => {
    if (ready) return;
    introPlayed = true;
    const c = animate(k, 1, { duration: 0.9, delay: 0.25, ease: [0.65, 0, 0.35, 1], onComplete: () => setReady(true) });
    return () => c.stop();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!ready || reduced) return;
    const c = animate(k, hovered ? -0.35 : 1, { type: 'spring', stiffness: 260, damping: 18 });
    return () => c.stop();
  }, [hovered, ready, reduced, k]);

  const sheet = tone === 'inverse' ? theme.paper : theme.ink;
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden="true">
      {/* the sheet, minus the corner that folds */}
      <path d="M4 4H16L28 16V28H4Z" fill={sheet} />
      <motion.path d={tip} fill={flapFill} />
    </svg>
  );
};

/**
 * The logo. The name is trimmed to its x-height (.trim-ex) so it sits on the mark's
 * centre line instead of floating above it.
 * `compact` drops the name on small screens, leaving the mark.
 */
export const Wordmark: React.FC<{ className?: string; compact?: boolean; tone?: 'default' | 'inverse'; intro?: boolean }> = ({
  className,
  compact,
  tone = 'default',
  intro,
}) => {
  const [hovered, setHovered] = useState(false);
  return (
    <span
      className={cn('inline-flex items-center gap-1.5', className)}
      onPointerEnter={() => setHovered(true)}
      onPointerLeave={() => setHovered(false)}
    >
      <Mark className="size-6 shrink-0" tone={tone} hovered={hovered} intro={intro} />
      <span
        className={cn(
          'trim-ex font-display text-xl font-bold tracking-tight',
          tone === 'inverse' ? 'text-paper' : 'text-ink',
          compact && 'hidden sm:inline',
        )}
        style={{ fontVariationSettings: '"opsz" 24' }}
      >
        origami
      </span>
    </span>
  );
};
