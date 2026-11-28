/**
 * Opening a stored design's file: step designs are compiled (folded exactly), crease patterns go
 * through prepareFold. Results are cached per design version, because cards, the design page and
 * thumbnails all ask for the same file.
 */
import { compileDesign, type CompiledDesign, type PaperState } from '../../engine/design';
import { worldPolygon } from '../../engine/design';
import { prepareFold, type FoldReport } from '../../engine/fold/prepare';
import type { FoldFormat } from '../../engine/types';
import { db, type DesignRecord } from '../../store';

export type LoadedDesign =
  | { kind: 'steps'; compiled: CompiledDesign | null; error: string | null; file: unknown }
  | { kind: 'pattern'; fold: FoldFormat | null; report: FoldReport | null; error: string | null; file: unknown };

const cache = new Map<string, LoadedDesign>();

export function loadDesign(rec: DesignRecord): LoadedDesign {
  const key = `${rec.id}@${rec.updatedAt}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const file = db.fileOf(rec);
  let out: LoadedDesign;
  if (rec.kind === 'steps') {
    try {
      const compiled = compileDesign(file);
      out = { kind: 'steps', compiled, error: compiled.error ? `Step ${compiled.error.step + 1}: ${compiled.error.message}` : null, file };
    } catch (e) {
      out = { kind: 'steps', compiled: null, error: (e as Error).message, file };
    }
  } else {
    try {
      const { fold, report } = prepareFold(file);
      out = { kind: 'pattern', fold, report, error: null, file };
    } catch (e) {
      out = { kind: 'pattern', fold: null, report: null, error: (e as Error).message, file };
    }
  }
  cache.set(key, out);
  return out;
}

/**
 * A flat (or nearly flat) paper state seen from above: each face's outline in layer order and
 * whether its front faces up. For thumbnails and the editor.
 */
export interface StateOutline {
  faces: { poly: [number, number][]; frontUp: boolean; index: number }[];
  box: { x0: number; y0: number; x1: number; y1: number };
}

export function outlineOf(s: PaperState): StateOutline {
  const n = s.topo.faces.length;
  const polys = s.topo.faces.map((_, i) => worldPolygon(s, i) as [number, number][]);
  const z = s.topo.faces.map((f, i) => {
    const m = s.transforms[i];
    let zz = 0;
    for (const [u, v] of f.poly) zz += m[2] * u + m[6] * v + m[14];
    return zz / f.poly.length;
  });
  const order = [...Array(n).keys()].sort((a, b) => (s.flat ? s.ranks[a] - s.ranks[b] : z[a] - z[b]));
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of polys) for (const [x, y] of p) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
  return {
    faces: order.map((i) => ({ poly: polys[i], frontUp: s.transforms[i][10] >= 0, index: i })),
    box: { x0, y0, x1, y1 },
  };
}
