import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';
import { parseFold, extractPlanarFaces, createPreliminaryBasePattern, isFoldedForm, unfoldFoldedForm } from '../../src/engine/fold';
import { foldCreasePattern, ExactFoldPlayer } from '../../src/engine/design/creasePattern';

const DESIGNS = path.resolve(__dirname, '../../src/designs');

function load(file: string) {
  const fold = parseFold(JSON.parse(fs.readFileSync(path.join(DESIGNS, file), 'utf8')));
  const faces = fold.faces_vertices && fold.faces_vertices.length ? fold.faces_vertices : extractPlanarFaces(fold);
  return { fold, cp: { vertices_coords: fold.vertices_coords as number[][], edges_vertices: fold.edges_vertices, edges_assignment: fold.edges_assignment, faces_vertices: faces } };
}

describe('bundled .fold files', () => {
  const files = fs.readdirSync(DESIGNS).filter((f) => f.endsWith('.fold'));
  it.each(files)('%s has everything common FOLD tools require (incl. Origami Simulator)', (file) => {
    const d = JSON.parse(fs.readFileSync(path.join(DESIGNS, file), 'utf8'));
    for (const key of ['vertices_coords', 'edges_vertices', 'edges_assignment', 'faces_vertices']) {
      expect(Array.isArray(d[key]) && d[key].length > 0, `${file} is missing ${key}`).toBe(true);
    }
    expect(d.edges_assignment).toHaveLength(d.edges_vertices.length);
    // faces tile the sheet exactly once (folded forms are checked on their unfolded sheet)
    const sheet = isFoldedForm(d) ? unfoldFoldedForm(d).fold : d;
    const V = sheet.vertices_coords as number[][];
    const area = (f: number[]) => f.reduce((s, v, i) => { const a = V[v], b = V[f[(i + 1) % f.length]]; return s + a[0] * b[1] - b[0] * a[1]; }, 0) / 2;
    const total = (sheet.faces_vertices as number[][]).reduce((s, f) => s + Math.abs(area(f)), 0);
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const [x, y] of V) { minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y); }
    expect(total).toBeCloseTo((maxX - minX) * (maxY - minY), 9);
  });
});

describe('exact crease-pattern folding', () => {
  it('folds the traced 48x48 box-pleated pattern (test-3) flat as one piece with a valid stacking', { timeout: 120000 }, () => {
    const { cp } = load('test-3.fold');
    const res = foldCreasePattern(cp, { layerGap: 0 });
    expect(res.ok, res.reason).toBe(true);
    expect(res.tear).toBeLessThan(1e-9);
    expect(res.layerCount).toBeGreaterThan(10);
    // every crease-pattern edge keeps its length in the folded form (zero layer gap = rigid faces)
    const V = cp.vertices_coords, F = res.vertices;
    for (const [a, b] of cp.edges_vertices) {
      const L0 = Math.hypot(V[a][0] - V[b][0], V[a][1] - V[b][1]);
      const L1 = Math.hypot(F[a * 3] - F[b * 3], F[a * 3 + 1] - F[b * 3 + 1], F[a * 3 + 2] - F[b * 3 + 2]);
      expect(Math.abs(L1 - L0)).toBeLessThan(1e-9);
    }
    // the folded model is much smaller than the sheet (a 0.5 x 0.333 base)
    let minX = 9, maxX = -9, minY = 9, maxY = -9;
    for (let i = 0; i < F.length; i += 3) { minX = Math.min(minX, F[i]); maxX = Math.max(maxX, F[i]); minY = Math.min(minY, F[i + 1]); maxY = Math.max(maxY, F[i + 1]); }
    expect([+(maxX - minX).toFixed(4), +(maxY - minY).toFixed(4)].sort()).toEqual([0.3333, 0.5]);
  });

  it('the player goes from the flat sheet to the exact folded form', { timeout: 120000 }, () => {
    const { cp } = load('test-3.fold');
    const res = foldCreasePattern(cp, { layerGap: 0.0002 });
    const player = new ExactFoldPlayer(cp, res.vertices);
    const out = new Float64Array(res.vertices.length);
    player.pose(0, out);
    cp.vertices_coords.forEach((p, i) => { expect(out[i * 3]).toBeCloseTo(p[0], 12); expect(out[i * 3 + 1]).toBeCloseTo(p[1], 12); expect(out[i * 3 + 2]).toBe(0); });
    player.pose(1, out);
    // exact folded form, moved (not rotated) so it collapses around the centre of the sheet
    const dx = out[0] - res.vertices[0], dy = out[1] - res.vertices[1];
    for (let v = 0; v < out.length / 3; v++) {
      expect(out[v * 3]).toBeCloseTo(res.vertices[v * 3] + dx, 12);
      expect(out[v * 3 + 1]).toBeCloseTo(res.vertices[v * 3 + 1] + dy, 12);
      expect(out[v * 3 + 2]).toBeCloseTo(res.vertices[v * 3 + 2], 12);
    }
    player.pose(0.5, out);
    for (const x of out) expect(Number.isFinite(x)).toBe(true);
  });

  it('relaxed keyframes cover the top of the fold range and join the transition without a jump', () => {
    const { cp } = load('bird-base.fold');
    const res = foldCreasePattern(cp, { layerGap: 0 });
    const player = new ExactFoldPlayer(cp, res.flatVertices, res.vertexRanks);
    player.setLayerGap(0.001);
    const n = res.vertices.length;
    const folded = new Float64Array(n);
    player.pose(1, folded);
    const k1 = folded.map((x, i) => x + (i % 3 === 2 ? 0.01 : 0));
    const k2 = folded.map((x, i) => x + (i % 3 === 2 ? 0.03 : 0));
    player.setRelaxedKeyframes([1, 0.95, 0.9], [folded, k1, k2]);
    expect(player.relaxedFrom).toBe(0.9);
    const out = new Float64Array(n);
    player.pose(0.95, out);
    for (let i = 0; i < n; i++) expect(out[i]).toBeCloseTo(k1[i], 12);
    player.pose(0.925, out);
    for (let i = 2; i < n; i += 3) expect(out[i]).toBeCloseTo(folded[i] + 0.02, 12);
    // just below the relaxed range the transition starts from the lowest keyframe
    const below = new Float64Array(n);
    player.pose(0.9, out);
    player.pose(0.9 - 1e-9, below);
    for (let i = 0; i < n; i++) expect(Math.abs(out[i] - below[i])).toBeLessThan(1e-6);
    player.pose(0, out);
    cp.vertices_coords.forEach((p, i) => { expect(out[i * 3]).toBeCloseTo(p[0], 12); expect(out[i * 3 + 2]).toBe(0); });
  });

  it('folds the bird base exactly too', () => {
    expect(foldCreasePattern(load('bird-base.fold').cp).ok).toBe(true);
  });

  it('refuses a pattern that cannot lie flat, and says why', () => {
    // The built-in preliminary base template folds all 8 centre creases (4 V + 4 M), which breaks
    // Maekawa's theorem (|M - V| must be 2), so no flat stacking exists.
    const pre = createPreliminaryBasePattern(1);
    const r = foldCreasePattern({ vertices_coords: pre.vertices_coords as number[][], edges_vertices: pre.edges_vertices, edges_assignment: pre.edges_assignment, faces_vertices: pre.faces_vertices! });
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/stacking/);
  });
});
