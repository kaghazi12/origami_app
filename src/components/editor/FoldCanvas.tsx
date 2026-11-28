import React, { useId, useMemo, useRef, useState } from 'react';
import type { Vec2 } from '../../engine/design';
import { theme } from '../../theme';
import type { StateOutline } from '../community/designFiles';
import { lineAcross, sideOf, snap, type SnapTarget } from './actions';

export interface FoldCanvasProps {
  outline: StateOutline;
  front: string;
  back: string;
  /** Points of the fold line clicked so far (0, 1 or 2), in the model's units. */
  points: Vec2[];
  /** The clicked point on the side that moves. */
  moving: Vec2 | null;
  direction: 'valley' | 'mountain';
  /** Nothing to click (e.g. no tool chosen). */
  interactive: boolean;
  onPoint: (p: Vec2) => void;
  onMoving: (p: Vec2) => void;
}

/**
 * The model from above, for drawing a fold: click two points for the fold line (they snap to
 * corners, edge middles and edges), then click the side that moves. The fold line is drawn in
 * diagram notation (valley dashed blue, mountain dash-dot red) and the moving side is tinted.
 */
export const FoldCanvas: React.FC<FoldCanvasProps> = ({ outline, front, back, points, moving, direction, interactive, onPoint, onMoving }) => {
  const clipId = useId();
  const g = useRef<SVGGElement>(null);
  const [hover, setHover] = useState<SnapTarget | null>(null);
  const [hoverRaw, setHoverRaw] = useState<Vec2 | null>(null);
  const { box } = outline;
  const size = Math.max(box.x1 - box.x0, box.y1 - box.y0) || 1;
  const pad = size * 0.18;
  const view = { x: box.x0 - pad, y: -box.y1 - pad, w: box.x1 - box.x0 + pad * 2, h: box.y1 - box.y0 + pad * 2 };
  const polys = useMemo(() => outline.faces.map((f) => f.poly as Vec2[]), [outline]);
  const corners = useMemo(() => {
    const seen = new Map<string, Vec2>();
    for (const p of polys) for (const q of p) seen.set(`${q[0].toFixed(5)},${q[1].toFixed(5)}`, q);
    return [...seen.values()];
  }, [polys]);
  const stroke = size * 0.004;
  const stage: 'line' | 'side' | 'done' = points.length < 2 ? 'line' : moving ? 'done' : 'side';

  const toModel = (e: React.PointerEvent): { p: Vec2; unitsPerPx: number } | null => {
    const m = g.current?.getScreenCTM();
    if (!m) return null;
    const pt = new DOMPoint(e.clientX, e.clientY).matrixTransform(m.inverse());
    return { p: [pt.x, pt.y], unitsPerPx: 1 / Math.abs(m.a) };
  };

  const onMove = (e: React.PointerEvent) => {
    if (!interactive) return;
    const r = toModel(e);
    if (!r) return;
    setHoverRaw(r.p);
    setHover(stage === 'line' ? snap(r.p, polys, 14 * r.unitsPerPx) : null);
  };
  const onClick = (e: React.PointerEvent) => {
    if (!interactive) return;
    const r = toModel(e);
    if (!r) return;
    if (stage === 'line') {
      const s = snap(r.p, polys, 14 * r.unitsPerPx);
      // the second point can't be the first
      if (points.length === 1 && Math.hypot(s.point[0] - points[0][0], s.point[1] - points[0][1]) < size * 1e-3) return;
      onPoint(s.point);
    } else if (points.length === 2 && sideOf(points[0], points[1], r.p) !== 0) {
      onMoving(r.p);
    }
  };

  // the line, extended across the model (or from the first point to the pointer while drawing)
  const lineEnds: [Vec2, Vec2] | null =
    points.length === 2
      ? lineAcross(points[0], points[1], { x0: box.x0 - pad * 0.5, y0: box.y0 - pad * 0.5, x1: box.x1 + pad * 0.5, y1: box.y1 + pad * 0.5 })
      : points.length === 1 && (hover ?? hoverRaw)
        ? [points[0], (hover?.point ?? hoverRaw)!]
        : null;
  const valley = direction === 'valley';
  const lineColor = valley ? theme.valley : theme.mountain;
  const dash = valley ? `${size * 0.03} ${size * 0.02}` : `${size * 0.03} ${size * 0.012} ${size * 0.004} ${size * 0.012}`;

  // the side that moves: the side already chosen, or the one under the pointer
  const sidePoint = moving ?? (stage === 'side' ? hoverRaw : null);
  let tint: string | null = null;
  if (points.length === 2 && sidePoint && lineEnds) {
    const s = sideOf(points[0], points[1], sidePoint);
    if (s !== 0) {
      const big = size * 10;
      const d: Vec2 = [points[1][0] - points[0][0], points[1][1] - points[0][1]];
      const L = Math.hypot(d[0], d[1]);
      const n: Vec2 = [(-d[1] / L) * s * big, (d[0] / L) * s * big];
      const u: Vec2 = [(d[0] / L) * big, (d[1] / L) * big];
      const a = points[0];
      const quad: Vec2[] = [
        [a[0] - u[0], a[1] - u[1]],
        [a[0] + u[0], a[1] + u[1]],
        [a[0] + u[0] + n[0], a[1] + u[1] + n[1]],
        [a[0] - u[0] + n[0], a[1] - u[1] + n[1]],
      ];
      tint = 'M' + quad.map((q) => `${q[0]} ${q[1]}`).join('L') + 'Z';
    }
  }

  return (
    <svg
      viewBox={`${view.x} ${view.y} ${view.w} ${view.h}`}
      className="size-full touch-none select-none"
      style={{ cursor: interactive ? (stage === 'side' ? 'pointer' : 'crosshair') : 'default' }}
      onPointerMove={onMove}
      onPointerLeave={() => { setHover(null); setHoverRaw(null); }}
      onPointerUp={onClick}
      role="img"
      aria-label="The model from above. Click two points to draw a fold line, then click the side that moves."
    >
      <g ref={g} transform="scale(1,-1)">
        <defs>
          <clipPath id={clipId}>
            {outline.faces.map((f) => (
              <path key={f.index} d={'M' + f.poly.map(([x, y]) => `${x} ${y}`).join('L') + 'Z'} />
            ))}
          </clipPath>
        </defs>
        {outline.faces.map((f) => (
          <path
            key={f.index}
            d={'M' + f.poly.map(([x, y]) => `${x} ${y}`).join('L') + 'Z'}
            fill={f.frontUp ? front : back}
            stroke={theme.ink}
            strokeOpacity={0.6}
            strokeWidth={stroke}
            strokeLinejoin="round"
          />
        ))}
        {tint && <path d={tint} clipPath={`url(#${clipId})`} fill={theme.accent} fillOpacity={moving ? 0.38 : 0.22} />}
        {interactive && stage === 'line' &&
          corners.map((c, i) => <circle key={i} cx={c[0]} cy={c[1]} r={size * 0.007} fill={theme.ink} fillOpacity={0.35} />)}
        {lineEnds && (
          <line
            x1={lineEnds[0][0]}
            y1={lineEnds[0][1]}
            x2={lineEnds[1][0]}
            y2={lineEnds[1][1]}
            stroke={lineColor}
            strokeWidth={stroke * 2.2}
            strokeDasharray={dash}
            strokeLinecap="round"
          />
        )}
        {points.map((p, i) => (
          <circle key={i} cx={p[0]} cy={p[1]} r={size * 0.016} fill={theme.paper} stroke={theme.ink} strokeWidth={stroke * 1.5} />
        ))}
        {moving && <circle cx={moving[0]} cy={moving[1]} r={size * 0.014} fill={theme.accent} stroke={theme.ink} strokeWidth={stroke * 1.5} />}
        {hover && (
          <circle
            cx={hover.point[0]}
            cy={hover.point[1]}
            r={size * (hover.kind === 'free' ? 0.01 : 0.02)}
            fill={hover.kind === 'free' ? 'none' : theme.accent}
            stroke={theme.ink}
            strokeWidth={stroke * 1.5}
          />
        )}
      </g>
    </svg>
  );
};
