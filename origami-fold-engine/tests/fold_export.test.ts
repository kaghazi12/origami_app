import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';
import { compileDesign, exportCompiledFold, type FoldFile } from '../../src/engine/design';
import { parseFold } from '../../src/engine/fold';

const DESIGNS = path.resolve(__dirname, '../../src/designs');

/** Pretty JSON with every small array on one line (how FOLD files are usually written). */
export function formatFold(f: FoldFile): string {
  return JSON.stringify(f, null, 2).replace(/\[\s*([^\[\]{}]*?)\s*\]/g, (_, inner: string) => `[${inner.split(/,\s*/).join(', ')}]`);
}

function birdBase(): FoldFile {
  const c = compileDesign(JSON.parse(fs.readFileSync(path.join(DESIGNS, 'crane.json'), 'utf8')));
  const n = c.steps.findIndex((s) => s.caption === 'Repeat behind: Petal fold') + 1;
  const fold = exportCompiledFold(c, n, 'Bird Base');
  fold.file_author = 'Traditional';
  fold.file_description = 'Bird base from a unit square: a preliminary base with a petal fold on each side. ' +
    'Frame 0 is the crease pattern (M/V folded, F = precrease left flat); file_frames[0] is the folded form with faceOrders.';
  return fold;
}

/** Flat-foldability at every interior vertex of the crease pattern. */
function checkVertices(f: FoldFile) {
  const n = f.vertices_coords.length;
  const around: { ang: number; a: string }[][] = Array.from({ length: n }, () => []);
  f.edges_vertices.forEach(([u, v], e) => {
    const a = f.edges_assignment[e];
    for (const [p, q] of [[u, v], [v, u]]) {
      const [x0, y0] = f.vertices_coords[p];
      const [x1, y1] = f.vertices_coords[q];
      around[p].push({ ang: Math.atan2(y1 - y0, x1 - x0), a });
    }
  });
  let checked = 0;
  around.forEach((list) => {
    if (list.some((e) => e.a === 'B')) return; // boundary vertex
    const folded = list.filter((e) => e.a === 'M' || e.a === 'V').sort((x, y) => x.ang - y.ang);
    if (folded.length === 0) return;
    checked++;
    const m = folded.filter((e) => e.a === 'M').length;
    expect(Math.abs(m - (folded.length - m))).toBe(2); // Maekawa
    let alt = 0;
    folded.forEach((e, i) => {
      const next = folded[(i + 1) % folded.length].ang + (i + 1 === folded.length ? 2 * Math.PI : 0);
      alt += (i % 2 ? -1 : 1) * (next - e.ang);
    });
    expect(Math.abs(alt)).toBeLessThan(1e-6); // Kawasaki
  });
  return checked;
}

describe('FOLD export', () => {
  const fold = birdBase();

  it('writes src/designs/bird-base.fold', () => {
    fs.writeFileSync(path.join(DESIGNS, 'bird-base.fold'), formatFold(fold) + '\n');
    const again = JSON.parse(fs.readFileSync(path.join(DESIGNS, 'bird-base.fold'), 'utf8'));
    expect(again).toEqual(JSON.parse(JSON.stringify(fold)));
  });

  it('is accepted by the existing FOLD parser', () => {
    const parsed = parseFold(JSON.parse(JSON.stringify(fold)));
    expect(parsed.vertices_coords).toHaveLength(fold.vertices_coords.length);
    expect(parsed.edges_vertices).toHaveLength(fold.edges_vertices.length);
    expect(parsed.faces_vertices).toHaveLength(fold.faces_vertices.length);
  });

  it('crease pattern is a bird base: unit square, flat-foldable at every vertex', () => {
    for (const [x, y] of fold.vertices_coords) {
      expect(x).toBeGreaterThanOrEqual(-1e-9);
      expect(x).toBeLessThanOrEqual(1 + 1e-9);
      expect(y).toBeGreaterThanOrEqual(-1e-9);
      expect(y).toBeLessThanOrEqual(1 + 1e-9);
    }
    expect(fold.edges_assignment.filter((a) => a === 'B')).toHaveLength(8);
    expect(checkVertices(fold)).toBeGreaterThanOrEqual(3); // centre + the two kite vertices on each side
  });

  it('folded frame keeps every edge length and folds all four corners to two points', () => {
    const cp = fold.vertices_coords;
    const fo = fold.file_frames[0].vertices_coords;
    fold.edges_vertices.forEach(([u, v]) => {
      const a = Math.hypot(cp[u][0] - cp[v][0], cp[u][1] - cp[v][1]);
      const b = Math.hypot(fo[u][0] - fo[v][0], fo[u][1] - fo[v][1], fo[u][2] - fo[v][2]);
      expect(b).toBeCloseTo(a, 6);
    });
    const corner = (x: number, y: number) => fo[cp.findIndex((p) => Math.hypot(p[0] - x, p[1] - y) < 1e-9)];
    // bird base: two corners at the top point, two at the bottom point
    expect(corner(0, 0)).toEqual(corner(1, 1));
    expect(corner(0, 1)).toEqual(corner(1, 0));
    expect(Math.hypot(corner(0, 0)[0] - corner(0, 1)[0], corner(0, 0)[1] - corner(0, 1)[1])).toBeCloseTo(1, 6);
    expect(fold.file_frames[0].faceOrders!.length).toBeGreaterThan(0);
  });
});
