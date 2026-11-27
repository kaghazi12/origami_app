/**
 * Folds at any angle: crease directions and fold angles that aren't 45° or 90° multiples.
 * Seeded random cases, so a failure is reproducible.
 */
import { describe, expect, it } from 'vitest';
import { foldCreasePattern } from '../../src/engine/design/creasePattern';
import { extractPlanarFaces } from '../../src/engine/fold/faces';
import { prepareFold } from '../../src/engine/fold/prepare';
import { createMiuraOriPattern, computeMiuraCoupledAngles } from '../../src/engine/fold/templates';
import { createMeshFromFold } from '../../src/engine/mesh/mesh';
import { XPBDSolver } from '../../src/engine/physics/xpbd';
import { FoldDriver } from '../../src/engine/physics/foldDriver';
import { computeDihedralAngle } from '../../src/engine/physics/hinges';
import { countMeshIntersections } from '../../src/engine/physics/collision';
import type { EdgeAssignment, FoldFormat } from '../../src/engine/types';

const DEG = 180 / Math.PI;
let seed = 20261127;
const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
const between = (a: number, b: number) => a + (b - a) * rnd();

const exact = (f: FoldFormat) => foldCreasePattern({
  vertices_coords: f.vertices_coords as number[][], edges_vertices: f.edges_vertices,
  edges_assignment: f.edges_assignment, edges_foldAngle: f.edges_foldAngle, faces_vertices: f.faces_vertices!,
}, { layerGap: 0 });

/** One corner inside the unit square with four creases at the given directions (degrees). */
function vertexPattern(c: [number, number], dirs: number[], asg: EdgeAssignment[]): FoldFormat {
  const V: [number, number][] = [c];
  const E: [number, number][] = [];
  const A: EdgeAssignment[] = [];
  const hits: { t: number; v: number }[] = [];
  const perim = (p: [number, number]) => (p[1] < 1e-9 ? p[0] : p[0] > 1 - 1e-9 ? 1 + p[1] : p[1] > 1 - 1e-9 ? 3 - p[0] : 4 - p[1]);
  dirs.forEach((d, k) => {
    const dx = Math.cos(d / DEG), dy = Math.sin(d / DEG);
    let t = Infinity;
    if (dx > 1e-12) t = Math.min(t, (1 - c[0]) / dx); if (dx < -1e-12) t = Math.min(t, -c[0] / dx);
    if (dy > 1e-12) t = Math.min(t, (1 - c[1]) / dy); if (dy < -1e-12) t = Math.min(t, -c[1] / dy);
    const p: [number, number] = [c[0] + dx * t, c[1] + dy * t];
    V.push(p);
    E.push([0, V.length - 1]); A.push(asg[k]);
    hits.push({ t: perim(p), v: V.length - 1 });
  });
  for (const [t, p] of [[0, [0, 0]], [1, [1, 0]], [2, [1, 1]], [3, [0, 1]]] as [number, [number, number]][]) {
    V.push(p); hits.push({ t, v: V.length - 1 });
  }
  hits.sort((a, b) => a.t - b.t);
  hits.forEach((h, i) => { E.push([h.v, hits[(i + 1) % hits.length].v]); A.push('B'); });
  const f: FoldFormat = { file_spec: 1.1, vertices_coords: V, edges_vertices: E, edges_assignment: A } as FoldFormat;
  f.edges_foldAngle = A.map((a) => (a === 'V' ? 180 : a === 'M' ? -180 : 0));
  f.faces_vertices = extractPlanarFaces(f);
  return f;
}

describe('flat folds with arbitrary crease angles', () => {
  it('25 random single corners (any sector angles satisfying Kawasaki) fold flat with a valid layer order', () => {
    for (let n = 0; n < 25; n++) {
      // sectors a, b, 180 - a, 180 - b in a random order around the corner, none tiny
      const a = between(12, 168), b = between(12, 168);
      const sectors = [a, b, 180 - a, 180 - b];
      const start = between(0, 360);
      const dirs = sectors.map((_, k) => start + sectors.slice(0, k).reduce((s, x) => s + x, 0));
      // Maekawa (3 + 1) and big-little-big: the odd crease borders the smallest sector
      const small = sectors.indexOf(Math.min(...sectors));
      const asg: EdgeAssignment[] = ['V', 'V', 'V', 'V'];
      asg[small] = 'M';
      const c: [number, number] = [between(0.35, 0.65), between(0.35, 0.65)];
      const f = vertexPattern(c, dirs, asg);
      const { report } = prepareFold(JSON.parse(JSON.stringify(f)));
      expect(report.flatFoldViolations, `sectors ${sectors.map((x) => x.toFixed(2))}`).toBe(0);
      const ex = exact(f);
      expect(ex.ok, `sectors ${sectors.map((x) => x.toFixed(2))}: ${ex.reason}`).toBe(true);
    }
  });
});

describe('partial folds at arbitrary angles', () => {
  it('10 random Miura-ori (any parallelogram angle, any fold amount) close up exactly', () => {
    for (let n = 0; n < 10; n++) {
      const gamma = between(35, 80), thetaV = between(10, 170);
      const base = createMiuraOriPattern(4, 3, 4, 3, gamma);
      const { thetaH } = computeMiuraCoupledAngles(gamma / DEG, thetaV / DEG);
      const V = base.vertices_coords as number[][];
      const ok = [false, true].some((swap) => {
        const f: FoldFormat = {
          ...base,
          edges_foldAngle: base.edges_vertices.map(([p, q], e) => {
            const s = base.edges_assignment[e];
            if (s !== 'M' && s !== 'V') return 0;
            const horizontal = Math.abs(V[p][1] - V[q][1]) < 1e-9;
            const mag = (horizontal !== swap ? Math.abs(thetaH) : thetaV / DEG) * DEG;
            return s === 'V' ? mag : -mag;
          }),
        };
        f.faces_vertices = extractPlanarFaces(f);
        const ex = exact(f);
        return ex.ok && ex.tear < 1e-9;
      });
      expect(ok, `gamma ${gamma.toFixed(2)}, fold ${thetaV.toFixed(2)}`).toBe(true);
    }
  });

  it.each([23.7, 97.3, 151.9])('physics reaches pleats folded to %s degrees, without paper through paper', { timeout: 120000 }, (deg) => {
    // five slanted parallel creases (19° off vertical), alternating mountain and valley
    const V: [number, number][] = [[0, 0], [1, 0], [1, 0.8], [0, 0.8]];
    const E: [number, number][] = [];
    const A: EdgeAssignment[] = [];
    const bottom: number[] = [0, 1], top: number[] = [3, 2];
    const tilt = Math.tan(19 / DEG) * 0.8;
    for (let k = 0; k < 5; k++) {
      const x = 0.1 + k * 0.15;
      V.push([x, 0], [x + tilt, 0.8]);
      E.push([V.length - 2, V.length - 1]); A.push(k % 2 ? 'M' : 'V');
      bottom.splice(bottom.length - 1, 0, V.length - 2);
      top.splice(top.length - 1, 0, V.length - 1);
    }
    const loop = [...bottom, ...top.slice().reverse()];
    loop.forEach((v, i) => { E.push([v, loop[(i + 1) % loop.length]]); A.push('B'); });
    const raw = { file_spec: 1.1, vertices_coords: V, edges_vertices: E, edges_assignment: A, edges_foldAngle: A.map((a) => (a === 'V' ? deg : a === 'M' ? -deg : 0)) };
    const { fold } = prepareFold(raw);
    const mesh = createMeshFromFold(fold, { axialStiffness: 40000, creaseStiffness: 40, facetStiffness: 200, targetEdgeLength: 0.1 });
    const solver = new XPBDSolver(mesh, { substeps: 20, iterations: 2, bendingCompliance: 0.0005, enablePlasticity: false, enableSelfCollision: true });
    mesh.positions[Math.floor(mesh.numVertices / 2) * 3 + 2] = 0.01;
    const driver = new FoldDriver(mesh, solver);
    let tick = 0; driver.now = () => tick * 16;
    driver.setTarget(1);
    for (; tick < 600 && !driver.frozen; tick++) driver.tick(0.016);
    expect(driver.frozen).toBe(true);
    let err = 0, n = 0;
    for (const h of mesh.hinges) {
      if (h.assignment !== 'M' && h.assignment !== 'V') continue;
      err = Math.max(err, Math.abs(computeDihedralAngle(h, mesh.positions, false) - h.targetAngle) * DEG); n++;
    }
    expect(n).toBeGreaterThan(0);
    expect(err).toBeLessThan(3);
    expect(countMeshIntersections(mesh.positions, mesh.indices, mesh.numTriangles).intersectionCount).toBe(0);
  });
});
