/**
 * Helpers for the design editor: what each step type is called, a default caption, snapping a
 * pointer to the paper's corners and edges, and compiling a design up to a step.
 */
import {
  ArrowDownUp,
  FlipHorizontal2,
  FoldVertical,
  Layers,
  RotateCcw,
  RotateCw,
  Undo2,
  type LucideIcon,
} from 'lucide-react';
import { compileDesign, type CompiledDesign, type DesignAction, type DesignStep, type OrigamiDesign } from '../../engine/design';
import type { Vec2 } from '../../engine/design';

export type Tool = 'fold' | 'reverseFold' | 'collapse';

export function actionIcon(a: DesignAction): LucideIcon {
  switch (a.type) {
    case 'fold': return FoldVertical;
    case 'reverseFold': return ArrowDownUp;
    case 'collapse': return Layers;
    case 'unfold': return Undo2;
    case 'turnOver': return FlipHorizontal2;
    case 'rotate': return a.degrees >= 0 ? RotateCcw : RotateCw;
  }
}

/** A caption to start from; the author should make it specific ("Fold the corner to the centre"). */
export function defaultCaption(a: DesignAction): string {
  switch (a.type) {
    case 'fold':
      if (a.angle && a.angle < 180) return `Fold ${a.direction === 'valley' ? 'up' : 'behind'} to ${Math.round(a.angle)}°`;
      return a.direction === 'valley' ? 'Valley fold along the line' : 'Mountain fold: fold behind along the line';
    case 'reverseFold': return a.mode === 'inside' ? 'Inside reverse fold' : 'Outside reverse fold';
    case 'collapse': return 'Collapse along the creases';
    case 'unfold': return 'Unfold';
    case 'turnOver': return 'Turn the model over';
    case 'rotate': return `Rotate the model ${Math.abs(a.degrees)}° ${a.degrees >= 0 ? 'to the left' : 'to the right'}`;
  }
}

export function actionLabel(a: DesignAction): string {
  switch (a.type) {
    case 'fold': return a.direction === 'valley' ? 'Valley fold' : 'Mountain fold';
    case 'reverseFold': return a.mode === 'inside' ? 'Inside reverse fold' : 'Outside reverse fold';
    case 'collapse': return 'Collapse';
    case 'unfold': return 'Unfold';
    case 'turnOver': return 'Turn over';
    case 'rotate': return `Rotate ${a.degrees}°`;
  }
}

export function blankDesign(id: string, title = 'Untitled design'): OrigamiDesign {
  return {
    format: 'origami-design',
    version: 1,
    meta: { id, title, difficulty: 'beginner' },
    paper: { width: 1, height: 1, front: '#b8232f', back: '#fbfbf8' },
    steps: [],
  };
}

const compileCache = new Map<string, CompiledDesign>();
/** Compile, remembering the last few results (the editor asks for the same prefixes repeatedly). */
export function compileCached(design: OrigamiDesign): CompiledDesign {
  const key = JSON.stringify({ p: design.paper, s: design.steps.map((s) => s.action) });
  const hit = compileCache.get(key);
  if (hit) return hit;
  const c = compileDesign(design);
  compileCache.set(key, c);
  if (compileCache.size > 40) compileCache.delete(compileCache.keys().next().value!);
  return c;
}

export function withSteps(design: OrigamiDesign, steps: DesignStep[]): OrigamiDesign {
  return { ...design, steps };
}

// ------------------------------------------------------------------------------------------
// snapping

export interface SnapTarget {
  point: Vec2;
  kind: 'corner' | 'middle' | 'edge' | 'free';
}

/**
 * The nearest corner, edge midpoint or edge point to p (all in the canvas's units), within
 * `radius`; else p itself. Corners win over midpoints, midpoints over edges.
 */
export function snap(p: Vec2, polys: Vec2[][], radius: number): SnapTarget {
  const found: { best: SnapTarget | null; d: number } = { best: null, d: radius };
  const consider = (q: Vec2, kind: SnapTarget['kind'], bias: number) => {
    const d = Math.hypot(q[0] - p[0], q[1] - p[1]) * bias;
    if (d < found.d) { found.d = d; found.best = { point: q, kind }; }
  };
  for (const poly of polys) {
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i], b = poly[(i + 1) % poly.length];
      consider(a, 'corner', 0.6);
      consider([(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], 'middle', 0.8);
    }
  }
  if (found.best) return found.best;
  for (const poly of polys) {
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i], b = poly[(i + 1) % poly.length];
      const dx = b[0] - a[0], dy = b[1] - a[1], L2 = dx * dx + dy * dy;
      if (L2 < 1e-12) continue;
      const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / L2));
      consider([a[0] + dx * t, a[1] + dy * t], 'edge', 1);
    }
  }
  return found.best ?? { point: p, kind: 'free' };
}

/** Which side of the line a-b the point p is on (+1 left, -1 right, 0 on it). */
export function sideOf(a: Vec2, b: Vec2, p: Vec2): number {
  const c = (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]);
  return Math.abs(c) < 1e-9 ? 0 : Math.sign(c);
}

/** The line a-b clipped to a box, for drawing it across the whole model. */
export function lineAcross(a: Vec2, b: Vec2, box: { x0: number; y0: number; x1: number; y1: number }): [Vec2, Vec2] | null {
  const d: Vec2 = [b[0] - a[0], b[1] - a[1]];
  let t0 = -Infinity, t1 = Infinity;
  const clip = (p: number, q: number) => {
    if (Math.abs(p) < 1e-12) return q >= 0;
    const r = q / p;
    if (p < 0) t0 = Math.max(t0, r);
    else t1 = Math.min(t1, r);
    return true;
  };
  if (!clip(-d[0], a[0] - box.x0) || !clip(d[0], box.x1 - a[0]) || !clip(-d[1], a[1] - box.y0) || !clip(d[1], box.y1 - a[1])) return null;
  if (t0 > t1) return null;
  return [[a[0] + d[0] * t0, a[1] + d[1] * t0], [a[0] + d[0] * t1, a[1] + d[1] * t1]];
}
