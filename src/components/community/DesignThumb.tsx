import React, { useMemo } from 'react';
import { CreaseThumbnail } from '../ui/Thumbnails';
import { cn } from '../ui/cn';
import { theme } from '../../theme';
import type { DesignRecord } from '../../store';
import { loadDesign, outlineOf, type StateOutline } from './designFiles';

/** A paper state from above: faces in layer order, each in the colour of the side facing up. */
export const StateThumbnail: React.FC<{ outline: StateOutline; front: string; back: string; className?: string; title?: string }> = ({
  outline,
  front,
  back,
  className,
  title,
}) => {
  const { box } = outline;
  const size = Math.max(box.x1 - box.x0, box.y1 - box.y0) || 1;
  const pad = size * 0.08;
  const cx = (box.x0 + box.x1) / 2, cy = (box.y0 + box.y1) / 2;
  const half = size / 2 + pad;
  return (
    <svg viewBox={`${cx - half} ${-cy - half} ${half * 2} ${half * 2}`} className={className} role={title ? 'img' : 'presentation'} aria-label={title}>
      {outline.faces.map((f) => (
        <path
          key={f.index}
          d={'M' + f.poly.map(([x, y]) => `${x} ${-y}`).join('L') + 'Z'}
          fill={f.frontUp ? front : back}
          stroke={theme.ink}
          strokeOpacity={0.55}
          strokeWidth={size * 0.006}
          strokeLinejoin="round"
        />
      ))}
    </svg>
  );
};

/** A design's picture for cards: the finished model (steps) or the crease pattern (pattern). */
export const DesignThumb: React.FC<{ design: DesignRecord; className?: string }> = ({ design, className }) => {
  const loaded = useMemo(() => loadDesign(design), [design]);
  if (loaded.kind === 'steps') {
    const c = loaded.compiled;
    if (!c) return <div className={cn('bg-sunken', className)} />;
    const paper = c.design.paper;
    return (
      <StateThumbnail
        outline={outlineOf(c.final)}
        front={paper.front ?? theme.paperBack}
        back={paper.back ?? theme.paperFront}
        className={className}
        title={`${design.title}, finished`}
      />
    );
  }
  return <CreaseThumbnail fold={loaded.fold} className={className} weight={0.75} title={`${design.title}, crease pattern`} />;
};
