import React, { useMemo } from 'react';
import type { FoldFormat } from '../../engine/types';
import { theme } from '../../theme';

/**
 * A crease pattern drawn flat, in diagram notation: mountain dash-dot in red, valley dashed in
 * blue, the paper edge in ink. Uses only the 2D coordinates.
 */
export const CreaseThumbnail: React.FC<{
  fold: FoldFormat | null;
  className?: string;
  /** Stroke width in px at the rendered size. */
  weight?: number;
  /** Hide unassigned / flat lines. */
  creasesOnly?: boolean;
  title?: string;
}> = ({ fold, className, weight = 1, creasesOnly = true, title }) => {
  const data = useMemo(() => {
    if (!fold?.vertices_coords?.length) return null;
    const vs = fold.vertices_coords;
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const v of vs) {
      minX = Math.min(minX, v[0]); maxX = Math.max(maxX, v[0]);
      minY = Math.min(minY, v[1]); maxY = Math.max(maxY, v[1]);
    }
    const size = Math.max(maxX - minX, maxY - minY) || 1;
    const groups: Record<'M' | 'V' | 'B' | 'O', string[]> = { M: [], V: [], B: [], O: [] };
    const ev = fold.edges_vertices ?? [];
    const ea = fold.edges_assignment ?? [];
    for (let i = 0; i < ev.length; i++) {
      const a = vs[ev[i][0]];
      const b = vs[ev[i][1]];
      if (!a || !b) continue;
      const kind = ea[i] === 'M' || ea[i] === 'V' || ea[i] === 'B' ? ea[i] : 'O';
      if (kind === 'O' && creasesOnly) continue;
      // y flipped so the pattern reads with y up, like the FOLD coordinates
      groups[kind as 'M' | 'V' | 'B' | 'O'].push(
        `M${(a[0] - minX) / size} ${(maxY - a[1]) / size}L${(b[0] - minX) / size} ${(maxY - b[1]) / size}`,
      );
    }
    return { groups, w: (maxX - minX) / size, h: (maxY - minY) / size };
  }, [fold, creasesOnly]);

  if (!data) return <div className={className} />;
  const pad = 0.04;
  const vb = `${-pad} ${-pad} ${data.w + pad * 2} ${data.h + pad * 2}`;
  const sw = { vectorEffect: 'non-scaling-stroke' as const };
  return (
    <svg viewBox={vb} className={className} role={title ? 'img' : 'presentation'} aria-label={title}>
      <rect x={0} y={0} width={data.w} height={data.h} fill={theme.surface} />
      {data.groups.O.length > 0 && (
        <path d={data.groups.O.join('')} stroke={theme.lineStrong} strokeWidth={weight * 0.75} fill="none" {...sw} />
      )}
      <path d={data.groups.V.join('')} stroke={theme.valley} strokeWidth={weight} strokeDasharray={`${weight * 3} ${weight * 2}`} fill="none" {...sw} />
      <path d={data.groups.M.join('')} stroke={theme.mountain} strokeWidth={weight} fill="none" {...sw} />
      <path d={data.groups.B.join('')} stroke={theme.paperEdge} strokeWidth={weight * 1.25} fill="none" strokeLinecap="square" {...sw} />
    </svg>
  );
};

/** A sheet of paper showing both colours, folded corner to corner. For step designs in pickers. */
export const PaperSwatch: React.FC<{ front: string; back: string; className?: string }> = ({ front, back, className }) => (
  <svg viewBox="0 0 32 32" className={className} aria-hidden="true">
    <rect x="1" y="1" width="30" height="30" rx="2" fill={front} stroke={theme.lineStrong} strokeWidth="1" />
    <path d="M31 1 L31 31 L1 31 Z" fill={back} stroke={theme.lineStrong} strokeWidth="1" strokeLinejoin="round" />
  </svg>
);
