import React from 'react';
import { motion, useReducedMotion } from 'motion/react';
import { cn } from './cn';

const FOLD_EASE = [0.65, 0, 0.35, 1] as const;
const OUT_EASE = [0.2, 0.8, 0.2, 1] as const;

/**
 * Content that unfolds into place the first time it scrolls into view: it starts tipped back
 * along its top edge, like a flap of paper, and folds down flat.
 */
export const Reveal: React.FC<{
  children: React.ReactNode;
  className?: string;
  delay?: number;
  as?: 'div' | 'li' | 'section' | 'article';
}> = ({ children, className, delay = 0, as = 'div' }) => {
  const Tag = motion[as];
  return (
    <Tag
      className={className}
      style={{ transformOrigin: 'top center', transformPerspective: 1200 }}
      initial={{ opacity: 0, rotateX: -18, y: 24 }}
      whileInView={{ opacity: 1, rotateX: 0, y: 0 }}
      viewport={{ once: true, margin: '0px 0px -12% 0px' }}
      transition={{ duration: 0.7, delay, ease: OUT_EASE }}
    >
      {children}
    </Tag>
  );
};

/**
 * A headline whose words fold down one after another, each hinged on its top edge.
 * Wrap a word in `<em>` to set it in the accent colour.
 */
export const FoldInText: React.FC<{ text: string; accent?: string; className?: string; delay?: number }> = ({
  text,
  accent,
  className,
  delay = 0,
}) => {
  const reduced = useReducedMotion();
  const words = text.split(' ');
  return (
    <span className={cn('block', className)} style={{ perspective: 800 }}>
      <span className="sr-only">{text}</span>
      <span aria-hidden="true">
        {words.map((w, i) => {
          const isAccent = accent && w.replace(/[^\p{L}]/gu, '') === accent;
          return (
            <React.Fragment key={i}>
              <motion.span
                className={cn('inline-block', isAccent && 'text-accent')}
                style={{ transformOrigin: '50% 0%', backfaceVisibility: 'hidden' }}
                initial={reduced ? { opacity: 0 } : { opacity: 0, rotateX: -100 }}
                animate={reduced ? { opacity: 1 } : { opacity: 1, rotateX: 0 }}
                transition={{ duration: 0.75, delay: delay + i * 0.07, ease: FOLD_EASE }}
              >
                {w}
              </motion.span>
              {i < words.length - 1 && ' '}
            </React.Fragment>
          );
        })}
      </span>
    </span>
  );
};
