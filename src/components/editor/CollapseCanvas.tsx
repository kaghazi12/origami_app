import React, { useMemo, useRef, useState } from 'react';
import type { CreaseFold, PaperState, Vec2 } from '../../engine/design';
import { theme } from '../../theme';
import { snap } from './actions';

export interface NewSegment {
  from: Vec2;
  to: Vec2;
  fold: CreaseFold;
}

export type CollapseMode = 'pick' | 'draw' | 'fixed';

/** Cycle a crease's target: unchanged → valley → mountain → flat → auto → unchanged. */
export function nextFold(f: CreaseFold | undefined): CreaseFold | undefined {
  const order: (CreaseFold | undefined)[] = [undefined, 'valley', 'mountain', 'flat', 'auto'];
  return order[(order.indexOf(f) + 1) % order.length];
}

const FOLD_STYLE: Record<CreaseFold, { color: string; dash: (s: number) => string | undefined }> = {
  valley: { color: theme.valley, dash: (s) => `${s * 0.025} ${s * 0.016}` },
  mountain: { color: theme.mountain, dash: (s) => `${s * 0.025} ${s * 0.01} ${s * 0.004} ${s * 0.01}` },
  flat: { color: theme.inkFaint, dash: () => undefined },
  auto: { color: theme.ink, dash: (s) => `${s * 0.006} ${s * 0.01}` },
};

/**
 * The unfolded sheet with every crease made so far, for collapses (squash, petal, sink...): click a
 * crease to say how it should end up, draw new creases between corners and edges, and pick the face
 * that stays put. Coordinates are the paper's, in the model's units.
 */
export const CollapseCanvas: React.FC<{
  state: PaperState;
  targets: Record<number, CreaseFold>;
  newSegments: NewSegment[];
  fixed: Vec2 | null;
  mode: CollapseMode;
  onToggleCrease: (k: number) => void;
  onToggleNew: (i: number) => void;
  onAddSegment: (from: Vec2, to: Vec2) => void;
  onFixed: (p: Vec2) => void;
}> = ({ state, targets, newSegments, fixed, mode, onToggleCrease, onToggleNew, onAddSegment, onFixed }) => {
  const g = useRef<SVGGElement>(null);
  const [hoverCrease, setHoverCrease] = useState<number | null>(null);
  const [hoverPoint, setHoverPoint] = useState<Vec2 | null>(null);
  const [first, setFirst] = useState<Vec2 | null>(null);
  const faces = state.topo.faces;
  const polys = useMemo(() => faces.map((f) => f.poly as Vec2[]), [faces]);
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of polys) for (const [x, y] of p) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
  const size = Math.max(x1 - x0, y1 - y0) || 1;
  const pad = size * 0.06;
  const stroke = size * 0.004;

  const toModel = (e: React.PointerEvent): { p: Vec2; upp: number } | null => {
    const m = g.current?.getScreenCTM();
    if (!m) return null;
    const pt = new DOMPoint(e.clientX, e.clientY).matrixTransform(m.inverse());
    return { p: [pt.x, pt.y], upp: 1 / Math.abs(m.a) };
  };
  const nearestCrease = (p: Vec2, radius: number): number | null => {
    let best: number | null = null, bd = radius;
    state.topo.creases.forEach((c, k) => {
      const dx = c.p1[0] - c.p0[0], dy = c.p1[1] - c.p0[1], L2 = dx * dx + dy * dy;
      const t = Math.max(0, Math.min(1, ((p[0] - c.p0[0]) * dx + (p[1] - c.p0[1]) * dy) / L2));
      const d = Math.hypot(p[0] - (c.p0[0] + dx * t), p[1] - (c.p0[1] + dy * t));
      if (d < bd) { bd = d; best = k; }
    });
    return best;
  };
  const nearestNew = (p: Vec2, radius: number): number | null => {
    let best: number | null = null, bd = radius;
    newSegments.forEach((s, i) => {
      const dx = s.to[0] - s.from[0], dy = s.to[1] - s.from[1], L2 = dx * dx + dy * dy;
      const t = Math.max(0, Math.min(1, ((p[0] - s.from[0]) * dx + (p[1] - s.from[1]) * dy) / L2));
      const d = Math.hypot(p[0] - (s.from[0] + dx * t), p[1] - (s.from[1] + dy * t));
      if (d < bd) { bd = d; best = i; }
    });
    return best;
  };

  const onMove = (e: React.PointerEvent) => {
    const r = toModel(e);
    if (!r) return;
    if (mode === 'pick') setHoverCrease(nearestCrease(r.p, 10 * r.upp));
    else if (mode === 'draw') setHoverPoint(snap(r.p, polys, 14 * r.upp).point);
    else setHoverPoint(r.p);
  };
  const onUp = (e: React.PointerEvent) => {
    const r = toModel(e);
    if (!r) return;
    if (mode === 'pick') {
      const n = nearestNew(r.p, 10 * r.upp);
      if (n !== null) return onToggleNew(n);
      const k = nearestCrease(r.p, 10 * r.upp);
      if (k !== null) onToggleCrease(k);
    } else if (mode === 'draw') {
      const s = snap(r.p, polys, 14 * r.upp).point;
      if (!first) setFirst(s);
      else if (Math.hypot(s[0] - first[0], s[1] - first[1]) > size * 1e-3) {
        onAddSegment(first, s);
        setFirst(null);
      }
    } else {
      onFixed(r.p);
    }
  };

  const fixedFace = fixed ? faces.findIndex((f) => inside(f.poly as Vec2[], fixed)) : -1;

  return (
    <svg
      viewBox={`${x0 - pad} ${-y1 - pad} ${x1 - x0 + pad * 2} ${y1 - y0 + pad * 2}`}
      className="size-full touch-none select-none"
      style={{ cursor: mode === 'pick' ? (hoverCrease !== null ? 'pointer' : 'default') : 'crosshair' }}
      onPointerMove={onMove}
      onPointerUp={onUp}
      onPointerLeave={() => { setHoverCrease(null); setHoverPoint(null); }}
      role="img"
      aria-label="The unfolded sheet with its creases. Click a crease to change how it folds."
    >
      <g ref={g} transform="scale(1,-1)">
        {faces.map((f, i) => (
          <path
            key={f.id}
            d={'M' + f.poly.map(([x, y]) => `${x} ${y}`).join('L') + 'Z'}
            fill={i === fixedFace ? theme.accent : theme.paper}
            fillOpacity={i === fixedFace ? 0.35 : 1}
            stroke="none"
          />
        ))}
        {/* creases: their state now, thin; a chosen target, thick with a marigold halo */}
        {state.topo.creases.map((c, k) => {
          const target = targets[k];
          const a = state.angles[k];
          const now: CreaseFold = Math.abs(a) < 1e-6 ? 'flat' : a > 0 ? 'valley' : 'mountain';
          const st = FOLD_STYLE[target ?? now];
          const hot = hoverCrease === k;
          return (
            <g key={k}>
              {(target || hot) && (
                <line x1={c.p0[0]} y1={c.p0[1]} x2={c.p1[0]} y2={c.p1[1]} stroke={theme.accent} strokeOpacity={target ? 0.55 : 0.35} strokeWidth={stroke * 5} strokeLinecap="round" />
              )}
              <line
                x1={c.p0[0]}
                y1={c.p0[1]}
                x2={c.p1[0]}
                y2={c.p1[1]}
                stroke={st.color}
                strokeOpacity={target ? 1 : now === 'flat' ? 0.45 : 0.7}
                strokeWidth={stroke * (target ? 2 : 1.2)}
                strokeDasharray={st.dash(size)}
              />
            </g>
          );
        })}
        {newSegments.map((s, i) => (
          <g key={`n${i}`}>
            <line x1={s.from[0]} y1={s.from[1]} x2={s.to[0]} y2={s.to[1]} stroke={theme.accent} strokeOpacity={0.55} strokeWidth={stroke * 5} strokeLinecap="round" />
            <line x1={s.from[0]} y1={s.from[1]} x2={s.to[0]} y2={s.to[1]} stroke={FOLD_STYLE[s.fold].color} strokeWidth={stroke * 2} strokeDasharray={FOLD_STYLE[s.fold].dash(size)} />
          </g>
        ))}
        {/* the paper's edge (the sheet is a rectangle) */}
        <rect x={x0} y={y0} width={x1 - x0} height={y1 - y0} fill="none" stroke={theme.ink} strokeWidth={stroke * 1.4} />
        {mode === 'draw' && first && hoverPoint && (
          <line x1={first[0]} y1={first[1]} x2={hoverPoint[0]} y2={hoverPoint[1]} stroke={theme.ink} strokeWidth={stroke * 1.5} strokeDasharray={`${size * 0.01} ${size * 0.008}`} />
        )}
        {mode === 'draw' && first && <circle cx={first[0]} cy={first[1]} r={size * 0.014} fill={theme.paper} stroke={theme.ink} strokeWidth={stroke * 1.5} />}
        {mode === 'draw' && hoverPoint && <circle cx={hoverPoint[0]} cy={hoverPoint[1]} r={size * 0.016} fill={theme.accent} stroke={theme.ink} strokeWidth={stroke * 1.5} />}
      </g>
    </svg>
  );
};

function inside(poly: Vec2[], p: Vec2): boolean {
  let s = 0;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    const c = (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]);
    if (Math.abs(c) < 1e-12) continue;
    if (s === 0) s = Math.sign(c);
    else if (Math.sign(c) !== s) return false;
  }
  return true;
}
