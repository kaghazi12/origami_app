/**
 * Any FOLD file, valid or not, must load, fold to 100%, stop, and never pass paper through paper.
 *
 * Regression tests for the failures found with the six test files in src/designs (01_…06_):
 * - creases unwrapping past ±180° and snapping back the wrong way (hinge angles weren't tracked)
 * - plasticity dragging crease rest angles away from the file's angles
 * - the fold amount stalling below 100% whenever paper strain stayed over 4%
 * - jammed layers jittering and drifting for ever after 100% (and flying off via contact momentum)
 * - bars pushing layers back through each other after the contact pass
 * - faces in the file not matching its creases, so some creases could never fold
 * - files in any unit size (6–10 units) against absolute mesh/collision settings
 */
import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';
import { prepareFold } from '../../src/engine/fold/prepare';
import { createMeshFromFold } from '../../src/engine/mesh/mesh';
import { XPBDSolver } from '../../src/engine/physics/xpbd';
import { FoldDriver } from '../../src/engine/physics/foldDriver';
import { countMeshIntersections } from '../../src/engine/physics/collision';
import { computeDihedralAngle } from '../../src/engine/physics/hinges';
import { FoldError, type FoldFormat } from '../../src/engine/types';
import { foldCreasePattern } from '../../src/engine/design/creasePattern';

const DESIGNS = path.resolve(__dirname, '../../src/designs');
/** The original, broken versions of the six test files: kept to test how broken files are handled. */
const INVALID = path.resolve(__dirname, '../fixtures/invalid');
const read = (f: string) => JSON.parse(fs.readFileSync(path.join(DESIGNS, f), 'utf8'));
const readInvalid = (f: string) => JSON.parse(fs.readFileSync(path.join(INVALID, f), 'utf8'));
const TEST_FILES = fs.readdirSync(DESIGNS).filter((f) => /^\d\d_.*\.fold$/.test(f));
const INVALID_FILES = fs.readdirSync(INVALID).filter((f) => f.endsWith('.fold'));

/** Every crease edge borders exactly two faces and every boundary edge one. */
function facesMatchEdges(fold: FoldFormat): boolean {
  const count = new Map<string, number>();
  for (const f of fold.faces_vertices ?? []) for (let i = 0; i < f.length; i++) {
    const a = f[i], b = f[(i + 1) % f.length];
    const k = a < b ? `${a},${b}` : `${b},${a}`;
    count.set(k, (count.get(k) ?? 0) + 1);
  }
  return fold.edges_vertices.every(([a, b], e) => (count.get(a < b ? `${a},${b}` : `${b},${a}`) ?? 0) === (fold.edges_assignment[e] === 'B' ? 1 : 2));
}

describe('prepareFold: any FOLD file becomes a clean unit-size crease pattern with a report', () => {
  it.each([...TEST_FILES.map((f) => [f, read(f)]), ...INVALID_FILES.map((f) => [`invalid/${f}`, readInvalid(f)])])('%s: unit sheet, faces consistent with creases, angles signed by assignment', (_file, raw) => {
    const { fold } = prepareFold(raw);
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (const v of fold.vertices_coords) { x0 = Math.min(x0, v[0]); x1 = Math.max(x1, v[0]); y0 = Math.min(y0, v[1]); y1 = Math.max(y1, v[1]); }
    expect(Math.max(x1 - x0, y1 - y0)).toBeCloseTo(1, 9);
    expect(Math.min(x0, y0)).toBeCloseTo(0, 9);
    expect(facesMatchEdges(fold)).toBe(true);
    fold.edges_assignment.forEach((a, e) => {
      const d = fold.edges_foldAngle![e];
      if (a === 'V') expect(d).toBeGreaterThan(0);
      if (a === 'M') expect(d).toBeLessThan(0);
    });
  });

  it('reports the patterns that cannot fold flat, and only those', () => {
    const bad = (f: string) => prepareFold(readInvalid(f)).report.flatFoldViolations;
    expect(bad('02_waterbomb_tessellation_4x4.fold')).toBe(21);
    expect(bad('04_square_twist_2x2.fold')).toBe(16);
    expect(bad('05_bird_base_multiframe.fold')).toBe(13);
    // valid flat-foldable patterns: no false alarms
    const ok = (f: string) => prepareFold(read(f)).report.flatFoldViolations;
    expect(ok('bird-base.fold')).toBe(0);
    expect(ok('test-3.fold')).toBe(0);
  });

  it('rebuilds faces that do not match the creases', () => {
    for (const f of ['03_yoshimura_buckling_6x5.fold', '04_square_twist_2x2.fold']) {
      const { report } = prepareFold(readInvalid(f));
      expect(report.issues.some((i) => i.kind === 'repaired' && /faces/.test(i.title)), f).toBe(true);
    }
  });

  it('uses a multi-frame file’s folded frame only when it is the same paper', () => {
    expect(prepareFold(read('bird-base.fold')).report.issues.some((i) => /folded frame/.test(i.title) && i.kind === 'note')).toBe(true);
    expect(prepareFold(readInvalid('05_bird_base_multiframe.fold')).report.issues.some((i) => /folded frame .* ignored/.test(i.title))).toBe(true);
    expect(prepareFold(read('05_bird_base_multiframe.fold')).report.issues.some((i) => /folded frame/.test(i.title) && i.kind === 'note')).toBe(true);
  });

  it('builds faces when the file has none, and joins creases that cross without a shared corner', () => {
    // a square with both diagonals as separate edges that cross in the middle, no faces
    const raw = {
      file_spec: 1.1,
      vertices_coords: [[0, 0], [2, 0], [2, 2], [0, 2]],
      edges_vertices: [[0, 1], [1, 2], [2, 3], [3, 0], [0, 2], [1, 3]],
      edges_assignment: ['B', 'B', 'B', 'B', 'V', 'M'],
    };
    const { fold, report } = prepareFold(raw);
    expect(fold.vertices_coords).toHaveLength(5);
    expect(fold.faces_vertices).toHaveLength(4);
    expect(facesMatchEdges(fold)).toBe(true);
    expect(report.issues.some((i) => /cross/.test(i.title))).toBe(true);
  });

  it('rejects things that are not FOLD files with a readable error', () => {
    expect(() => prepareFold(null)).toThrow(FoldError);
    expect(() => prepareFold({ vertices_coords: [] , edges_vertices: [], edges_assignment: [] })).toThrow(FoldError);
  });
});

describe('the six test files (generated by scripts/generate-test-folds.ts) are valid', () => {
  it.each(TEST_FILES)('%s: nothing to repair, nothing impossible, and the exact folder folds it', { timeout: 120000 }, (file) => {
    const { fold, report } = prepareFold(read(file));
    expect(report.issues.filter((i) => i.kind !== 'note').map((i) => i.title)).toEqual([]);
    expect(report.flatFoldViolations).toBe(0);
    const ex = foldCreasePattern({
      vertices_coords: fold.vertices_coords as number[][], edges_vertices: fold.edges_vertices,
      edges_assignment: fold.edges_assignment, edges_foldAngle: fold.edges_foldAngle, faces_vertices: fold.faces_vertices!,
    }, { layerGap: 0 });
    expect(ex.ok, ex.reason).toBe(true);
    expect(ex.tear).toBeLessThan(1e-6); // the exact folder's own tolerance
  });
});

describe('XPBD solver', () => {
  it('a free sheet gains no net momentum (no drift, no spin)', () => {
    const { fold } = prepareFold(read('bird-base.fold'));
    const mesh = createMeshFromFold(fold, { targetEdgeLength: 0.1 });
    for (let i = 0; i < mesh.velocities.length; i++) mesh.velocities[i] = Math.sin(i * 12.9898) * 0.5;
    const solver = new XPBDSolver(mesh, { substeps: 4 });
    solver.step(0.016);
    let px = 0, py = 0, pz = 0;
    for (let i = 0; i < mesh.numVertices; i++) { px += mesh.velocities[i * 3]; py += mesh.velocities[i * 3 + 1]; pz += mesh.velocities[i * 3 + 2]; }
    expect(Math.hypot(px, py, pz)).toBeLessThan(1e-9);
  });
});

/** The app's physics path: prepared fold -> mesh -> solver -> FoldDriver, as the worker runs it. */
function foldToTheEnd(raw: unknown) {
  const { fold } = prepareFold(raw);
  const mesh = createMeshFromFold(fold, { axialStiffness: 40000, creaseStiffness: 40, facetStiffness: 200, targetEdgeLength: 0.1 });
  const solver = new XPBDSolver(mesh, { substeps: 20, iterations: 2, bendingCompliance: 0.0005, enablePlasticity: false, enableSelfCollision: true });
  mesh.positions[Math.floor(mesh.numVertices / 2) * 3 + 2] = 0.01;
  const driver = new FoldDriver(mesh, solver);
  let tick = 0;
  // a fixed clock so the result doesn't depend on machine speed
  driver.now = () => tick * 16;
  driver.setTarget(1);
  let reachedAt = -1, worstIx = 0;
  for (; tick < 600 && !driver.frozen; tick++) {
    driver.tick(0.016);
    if (reachedAt < 0 && driver.atTargetAlpha) reachedAt = tick;
    if (tick % 25 === 0) worstIx = Math.max(worstIx, countMeshIntersections(mesh.positions, mesh.indices, mesh.numTriangles).intersectionCount);
  }
  const frozenPose = Float64Array.from(mesh.positions);
  for (let k = 0; k < 60; k++) driver.tick(0.016);
  let moved = 0;
  for (let i = 0; i < frozenPose.length; i++) moved = Math.max(moved, Math.abs(frozenPose[i] - mesh.positions[i]));
  let err = 0, n = 0;
  for (const h of mesh.hinges) {
    if (h.assignment !== 'M' && h.assignment !== 'V') continue;
    err += Math.abs(computeDihedralAngle(h, mesh.positions, false) - h.targetAngle); n++;
  }
  return {
    reachedAt, frozenAt: driver.frozen ? tick : -1, moved, worstIx,
    endIx: countMeshIntersections(mesh.positions, mesh.indices, mesh.numTriangles).intersectionCount,
    finite: mesh.positions.every(Number.isFinite), strain: solver.getMaxStrain(), meanErrDeg: ((err / Math.max(1, n)) * 180) / Math.PI,
  };
}

describe('every bundled FOLD file folds to 100%, stops, and never passes through itself', () => {
  const files = fs.readdirSync(DESIGNS).filter((f) => f.endsWith('.fold') && f !== 'test-3.fold'); // test-3 folds exactly (crease_pattern_fold.test.ts)
  it.each(files)('%s', { timeout: 300000 }, (file) => {
    const r = foldToTheEnd(read(file));
    expect(r.finite).toBe(true);
    expect(r.reachedAt, 'reaches 100%').toBeGreaterThan(0);
    expect(r.reachedAt).toBeLessThan(200); // within ~3 s
    expect(r.frozenAt, 'stops').toBeGreaterThan(0);
    expect(r.frozenAt - r.reachedAt).toBeLessThanOrEqual(200); // settles within ~3 s of 100%
    expect(r.moved, 'a stopped model does not move').toBe(0);
    expect(r.worstIx, 'no paper through paper while folding').toBe(0);
    expect(r.endIx, 'no paper through paper at the end').toBe(0);
    expect(r.strain).toBeLessThan(0.05);
  });

  it('a valid flat-foldable pattern (bird base) reaches its crease angles', { timeout: 300000 }, () => {
    expect(foldToTheEnd(read('bird-base.fold')).meanErrDeg).toBeLessThan(3);
  });
});
