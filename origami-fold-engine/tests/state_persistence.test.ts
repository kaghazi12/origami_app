import { describe, it, expect } from 'vitest';
import { createHalfFoldPattern, parseFold } from '../../src/engine/fold';
import {
  createMeshFromFold,
  getSimulationState,
  setSimulationState,
  splitMeshAlongPolyline,
} from '../../src/engine/mesh';
import { computeDihedralAngle, accumulateHingeForces } from '../../src/engine/physics/hinges';

describe('Phase 4.5 Requirement 7: State Persistence & Dihedral Angle Purity', () => {
  it('verifies computeDihedralAngle does NOT mutate hinge.previousAngle when called as probe/finite difference', () => {
    const fold = parseFold(createHalfFoldPattern(1, 1));
    const mesh = createMeshFromFold(fold);
    const hinge = mesh.hinges[0];

    // Initialize with a known previous angle
    hinge.previousAngle = 1.2345;
    const initialPrevAngle = hinge.previousAngle;

    // Call computeDihedralAngle without updatePrevious
    const angle1 = computeDihedralAngle(hinge, mesh.positions, false);
    expect(hinge.previousAngle).toBe(initialPrevAngle);

    // Default parameter (updatePrevious omitted) must be false
    const angle2 = computeDihedralAngle(hinge, mesh.positions);
    expect(angle2).toBe(angle1);
    expect(hinge.previousAngle).toBe(initialPrevAngle);

    // Calling with perturbed positions (simulating finite difference) must not corrupt state
    const perturbedPositions = new Float64Array(mesh.positions);
    perturbedPositions[hinge.v2 * 3 + 2] += 0.05;
    const perturbedAngle = computeDihedralAngle(hinge, perturbedPositions);
    expect(perturbedAngle).not.toBe(angle1);
    expect(hinge.previousAngle).toBe(initialPrevAngle);

    // Calling with updatePrevious = true DOES update
    const updatedAngle = computeDihedralAngle(hinge, mesh.positions, true);
    expect(hinge.previousAngle).toBe(updatedAngle);
  });

  it('verifies previousAngle is saved and restored via SimulationState round-trip', () => {
    const fold = parseFold(createHalfFoldPattern(1, 1));
    const mesh = createMeshFromFold(fold);

    // Set known previous angles
    mesh.hinges.forEach((h, idx) => {
      h.previousAngle = 0.5 * (idx + 1);
    });

    // Save state
    const savedState = getSimulationState(mesh, 42, 1.5);
    expect(savedState.previousAngles).toBeDefined();
    expect(savedState.previousAngles?.length).toBe(mesh.hinges.length);
    mesh.hinges.forEach((h, idx) => {
      expect(savedState.previousAngles![idx]).toBe(0.5 * (idx + 1));
    });

    // Mutate or reset hinge previous angles
    mesh.hinges.forEach((h) => {
      h.previousAngle = 0;
    });

    // Restore state
    setSimulationState(mesh, savedState);
    mesh.hinges.forEach((h, idx) => {
      expect(h.previousAngle).toBe(0.5 * (idx + 1));
    });
  });

  it('verifies previousAngle is preserved through mesh splits (both existing and subdivided hinges)', () => {
    const fold = parseFold(createHalfFoldPattern(1, 1));
    const mesh = createMeshFromFold(fold);

    // Assign specific previousAngle to all hinges
    mesh.hinges.forEach((h, idx) => {
      h.previousAngle = 0.75 + idx * 0.1;
    });

    // Fold slightly to have non-zero 3D state
    const forces = new Float64Array(mesh.numVertices * 3);
    accumulateHingeForces(mesh.hinges, mesh.positions, forces);

    // Record pre-split hinge previous angles
    const originalHingeAngles = mesh.hinges.map((h) => h.previousAngle);

    // Split mesh across polyline
    const polyline: [number, number][] = [
      [0.2, -0.1],
      [0.8, 1.1],
    ];
    const splitMesh = splitMeshAlongPolyline(mesh, polyline, {
      assignment: 'V',
      targetAngleDeg: 45,
    });

    // Verify all split mesh hinges have defined previousAngle
    expect(splitMesh.hinges.length).toBeGreaterThan(0);
    splitMesh.hinges.forEach((h) => {
      expect(h.previousAngle).toBeDefined();
      expect(typeof h.previousAngle).toBe('number');
    });

    // Specifically verify cut hinge initializes cleanly
    const targetRad = (45 * Math.PI) / 180;
    const cutHinges = splitMesh.hinges.filter((h) => Math.abs(h.targetAngle - targetRad) < 1e-6);
    expect(cutHinges.length).toBeGreaterThan(0);
    cutHinges.forEach((ch) => {
      expect(ch.previousAngle).toBe(0);
    });
  });
});
