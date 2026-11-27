import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';
import { isFoldedForm, unfoldFoldedForm } from '../../src/engine/fold';
import { foldCreasePattern } from '../../src/engine/design/creasePattern';
import { overlapArea, signedArea } from '../../src/engine/design/polygon';

const BOX = path.resolve(__dirname, '../../src/designs/box.fold');

/** Largest difference in distance between any two vertices (0 = same shape up to a rigid move). */
function shapeError(a: ArrayLike<number>, b: number[][]): number {
  const n = b.length;
  let worst = 0;
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
    const d0 = Math.hypot(b[i][0] - b[j][0], b[i][1] - b[j][1], (b[i][2] ?? 0) - (b[j][2] ?? 0));
    const d1 = Math.hypot(a[i * 3] - a[j * 3], a[i * 3 + 1] - a[j * 3 + 1], a[i * 3 + 2] - a[j * 3 + 2]);
    worst = Math.max(worst, Math.abs(d0 - d1));
  }
  return worst;
}

describe('folded-form FOLD files (3D coordinates instead of a crease pattern)', () => {
  const raw = JSON.parse(fs.readFileSync(BOX, 'utf8'));

  it('recognises the box as a folded form', () => {
    expect(isFoldedForm(raw)).toBe(true);
  });

  it('unfolds the box into a flat 8 x 8 sheet without overlaps', () => {
    const { fold, mismatch } = unfoldFoldedForm(raw);
    expect(mismatch).toBeLessThan(1e-9);
    const V = fold.vertices_coords as [number, number][];
    const polys = fold.faces_vertices!.map((f) => f.map((v) => V[v]));
    const area = polys.reduce((s, p) => s + signedArea(p), 0);
    expect(area).toBeCloseTo(64, 9);
    for (let i = 0; i < polys.length; i++) {
      expect(signedArea(polys[i])).toBeGreaterThan(0);
      for (let j = i + 1; j < polys.length; j++) expect(overlapArea(polys[i], polys[j])).toBeLessThan(1e-9);
    }
    expect(fold.frame_classes).toEqual(['creasePattern']);
  });

  it('folds the unfolded sheet back into exactly the original 3D box', () => {
    const { fold } = unfoldFoldedForm(raw);
    const res = foldCreasePattern({
      vertices_coords: fold.vertices_coords as number[][],
      edges_vertices: fold.edges_vertices,
      edges_assignment: fold.edges_assignment,
      edges_foldAngle: fold.edges_foldAngle,
      faces_vertices: fold.faces_vertices!,
    }, { layerGap: 0 });
    expect(res.ok, res.reason).toBe(true);
    expect(shapeError(res.flatVertices, raw.vertices_coords)).toBeLessThan(1e-6);
  });

  it('leaves crease patterns alone', () => {
    const cp = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../src/designs/test-3.fold'), 'utf8'));
    expect(isFoldedForm(cp)).toBe(false);
  });
});
