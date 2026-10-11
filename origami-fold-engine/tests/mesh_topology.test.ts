import { describe, expect, it } from 'vitest';
import {
  createSquareSheet,
  createHalfFoldPattern,
  createWaterbombBasePattern,
  createPreliminaryBasePattern,
} from '../../src/engine/fold';
import {
  createMeshFromFold,
  getSimulationState,
  setSimulationState,
  rampRestAngles,
} from '../../src/engine/mesh';

describe('Phase 2: Triangulation & Mesh Topology', () => {
  it('preserves all creases from FOLD model as mesh edges', () => {
    const fold = createHalfFoldPattern(1, 1);
    const mesh = createMeshFromFold(fold);

    expect(mesh.numVertices).toBe(6);
    expect(mesh.numTriangles).toBeGreaterThanOrEqual(2);

    // Valley crease was [1, 4] (from (0.5, 0) to (0.5, 1))
    const valleyHinge = mesh.hinges.find((h) => h.assignment === 'V');
    expect(valleyHinge).toBeDefined();
    expect(valleyHinge?.targetAngle).toBeCloseTo(Math.PI);
    expect(valleyHinge?.restAngle).toBe(0);
  });

  it('correctly extracts hinges for internal shared edges', () => {
    const fold = createSquareSheet(1, 1);
    const mesh = createMeshFromFold(fold);

    // A single square triangulated into 2 triangles has 1 internal shared diagonal
    expect(mesh.numTriangles).toBe(2);
    expect(mesh.hinges).toHaveLength(1);

    const diagonalHinge = mesh.hinges[0];
    expect(diagonalHinge.assignment).toBe('F'); // Virtual flat diagonal
    expect(diagonalHinge.targetAngle).toBe(0);
    expect(diagonalHinge.restAngle).toBe(0);
    expect(diagonalHinge.stiffness).toBeGreaterThan(diagonalHinge.targetAngle + 10); // Facet stiffness is high
  });

  it('ensures boundary edges are never registered as hinges', () => {
    const fold = createSquareSheet(1, 1);
    const mesh = createMeshFromFold(fold);

    // Boundary edges have only 1 adjacent triangle, so none should be in hinges
    for (const h of mesh.hinges) {
      expect(h.v2).toBeDefined();
      expect(h.v3).toBeDefined();
      expect(h.v0).not.toBe(h.v1);
      expect(h.v2).not.toBe(h.v3);
    }
  });

  it('satisfies Euler characteristic V - E + F = 1 for simply connected sheet', () => {
    const patterns = [
      createSquareSheet(),
      createHalfFoldPattern(),
      createWaterbombBasePattern(),
      createPreliminaryBasePattern(),
    ];

    for (const fold of patterns) {
      const mesh = createMeshFromFold(fold);
      const V = mesh.numVertices;
      const E = mesh.bars.length;
      const F = mesh.numTriangles;

      expect(V - E + F).toBe(1);
    }
  });

  it('manages persistent simulation state across poses (Amendment A)', () => {
    const fold = createHalfFoldPattern(1, 1);
    const mesh = createMeshFromFold(fold);

    // Perturb positions and velocities
    mesh.positions[2] = 0.5; // z-displacement on vertex 0
    mesh.velocities[0] = 1.2;
    mesh.hinges[0].restAngle = 1.0;

    const savedState = getSimulationState(mesh, 42, 0.42);
    expect(savedState.positions[2]).toBeCloseTo(0.5, 5);
    expect(savedState.velocities[0]).toBeCloseTo(1.2, 5);
    expect(savedState.restAngles[0]).toBeCloseTo(1.0, 5);
    expect(savedState.stepCount).toBe(42);

    // Reset mesh and restore state
    mesh.positions.fill(0);
    mesh.velocities.fill(0);
    mesh.hinges[0].restAngle = 0;

    setSimulationState(mesh, savedState);
    expect(mesh.positions[2]).toBeCloseTo(0.5, 5);
    expect(mesh.velocities[0]).toBeCloseTo(1.2, 5);
    expect(mesh.hinges[0].restAngle).toBeCloseTo(1.0, 5);
  });

  it('ramps per-hinge restAngle toward FOLD target angle (Amendment A)', () => {
    const fold = createHalfFoldPattern(1, 1);
    const mesh = createMeshFromFold(fold);

    const valleyHinge = mesh.hinges.find((h) => h.assignment === 'V')!;
    const facetHinge = mesh.hinges.find((h) => h.assignment === 'F')!;

    // At alpha = 0: all restAngles are 0
    rampRestAngles(mesh, 0);
    expect(valleyHinge.restAngle).toBe(0);
    expect(facetHinge.restAngle).toBe(0);

    // At alpha = 0.5: valley rests at 90 deg (pi / 2), facet stays 0
    rampRestAngles(mesh, 0.5);
    expect(valleyHinge.restAngle).toBeCloseTo(Math.PI / 2);
    expect(facetHinge.restAngle).toBe(0);

    // At alpha = 1.0: valley rests at 180 deg (pi), facet stays 0
    rampRestAngles(mesh, 1.0);
    expect(valleyHinge.restAngle).toBeCloseTo(Math.PI);
    expect(facetHinge.restAngle).toBe(0);
  });
});
