import { it, expect } from 'vitest';
import { createPreliminaryBasePattern } from '../../src/engine/fold';
import { createMeshFromFold, rampRestAngles } from '../../src/engine/mesh';
import { XPBDSolver } from '../../src/engine/physics';

// Regression: preliminary base with app defaults used to blow up (>1000% strain) and interpenetrate.
it('preliminary base folds with collision: no intersections, bounded strain, flat sheet has no contacts', () => {
  const mesh = createMeshFromFold(createPreliminaryBasePattern(1), { axialStiffness: 40000, creaseStiffness: 40, facetStiffness: 200, targetEdgeLength: 0.1 });
  const solver = new XPBDSolver(mesh, { substeps: 10, iterations: 2, velocityDamping: 0.995, enableTable: true, paperThickness: 0.002, enableGravity: true, gravity: 1, muStatic: 0.5, muKinetic: 0.4, bendingCompliance: 0.0005, enablePlasticity: true, enableSelfCollision: true });
  solver.step(0.016);
  expect((solver as any).selfContacts.length).toBe(0);
  mesh.positions[Math.floor(mesh.numVertices / 2) * 3 + 2] = 0.01;
  let a = 0, peak = 0, maxX = 0;
  for (let t = 0; t < 300; t++) {
    if (a < 1 && solver.getMaxStrain() < 0.04) { a = Math.min(1, a + 0.025 * Math.max(0.1, 1 - solver.getMaxStrain() / 0.04)); rampRestAngles(mesh, a); }
    solver.step(0.016);
    solver.getMaxResidualForce();
    peak = Math.max(peak, solver.getMaxStrain());
    if (t % 20 === 0) maxX = Math.max(maxX, solver.checkSelfIntersections().intersectionCount);
  }
  expect(a).toBe(1);
  expect(Number.isFinite(peak)).toBe(true);
  expect(peak).toBeLessThan(0.05);
  expect(maxX).toBe(0);
  expect(solver.checkSelfIntersections().intersectionCount).toBe(0);
}, 120000);
