import React, { useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Pause, Play, RotateCcw } from 'lucide-react';
import { DesignAnimator, type CompiledDesign } from '../../engine/design';
import { DesignViewer3D } from '../prototype/DesignViewer3D';
import { IconButton } from '../ui/Button';
import { Scrubber } from '../ui/Scrubber';
import { usePrefersReducedMotion } from '../../hooks';
import { theme } from '../../theme';

/** Steps per second. */
const RATE = 0.62;

/**
 * A compact player for a step design: the 3D model, the current instruction, and play/scrub.
 * `upTo` limits playback to the first steps (the editor previews the steps so far).
 */
export const StepPlayer: React.FC<{ compiled: CompiledDesign; autoPlay?: boolean; upTo?: number; className?: string; startAtEnd?: boolean }> = ({
  compiled,
  autoPlay = false,
  upTo,
  className,
  startAtEnd,
}) => {
  const reduced = usePrefersReducedMotion();
  const animator = useMemo(() => new DesignAnimator(compiled), [compiled]);
  const total = Math.min(animator.stepCount, upTo ?? Infinity);
  const [progress, setProgress] = useState(startAtEnd ? total : 0);
  const [playing, setPlaying] = useState(autoPlay && !reduced);

  useEffect(() => {
    setProgress(startAtEnd ? total : 0);
  }, [animator, total, startAtEnd]);

  useEffect(() => {
    if (!playing) return;
    let id = 0;
    let last: number | null = null;
    const tick = (t: number) => {
      const dt = last === null ? 0 : Math.min(0.1, (t - last) / 1000);
      last = t;
      setProgress((p) => {
        const next = p + dt * RATE;
        if (next >= total) {
          setPlaying(false);
          return total;
        }
        return next;
      });
      id = requestAnimationFrame(tick);
    };
    id = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(id);
  }, [playing, total]);

  const loc = animator.locate(progress);
  const done = progress >= total;
  const step = !done ? compiled.steps[loc.stepIndex] : null;
  const paper = compiled.design.paper;

  return (
    <div className={className}>
      <div className="relative min-h-0 flex-1 overflow-hidden rounded-lg bg-viewer">
        <DesignViewer3D
          animator={animator}
          progress={Math.min(progress, total)}
          front={paper.front ?? theme.paperBack}
          back={paper.back ?? theme.paperFront}
          showCreases
          resetKey={0}
        />
        <div className="pointer-events-none absolute inset-x-3 bottom-3">
          <div className="rounded-md bg-surface-raised px-4 py-2.5 shadow-float">
            <div className="text-xs font-medium tabular-nums text-ink-muted">
              {done ? (total ? 'Finished' : 'Flat sheet') : `Step ${loc.stepIndex + 1} of ${total}`}
            </div>
            <div className="relative h-6 overflow-hidden">
              <AnimatePresence mode="wait" initial={false}>
                <motion.div
                  key={done ? 'end' : loc.stepIndex}
                  initial={{ y: 12, opacity: 0 }}
                  animate={{ y: 0, opacity: 1 }}
                  exit={{ y: -8, opacity: 0 }}
                  transition={{ duration: 0.2 }}
                  className="truncate font-display text-base font-semibold text-ink"
                >
                  {done ? compiled.design.meta.title : step?.caption}
                </motion.div>
              </AnimatePresence>
            </div>
          </div>
        </div>
      </div>
      <div className="mt-3 flex items-center gap-3">
        <IconButton
          label={playing ? 'Pause' : done ? 'Play again' : 'Play'}
          icon={playing ? Pause : done ? RotateCcw : Play}
          variant="primary"
          tooltipSide="top"
          disabled={!total}
          onClick={() => {
            if (!playing && done) setProgress(0);
            setPlaying((p) => !p);
          }}
        />
        <Scrubber
          label="Fold progress"
          value={Math.min(progress, total)}
          max={Math.max(total, 0.0001)}
          ticks={Array.from({ length: Math.max(0, total - 1) }, (_, i) => i + 1)}
          disabled={!total}
          onChange={(v) => {
            setPlaying(false);
            setProgress(v);
          }}
        />
        <span className="w-12 shrink-0 text-right text-xs tabular-nums text-ink-muted">
          {done ? total : loc.stepIndex + 1}/{total}
        </span>
      </div>
    </div>
  );
};
