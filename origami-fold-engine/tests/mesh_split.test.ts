import { describe, expect, it } from 'vitest';
import { createHalfFoldPattern } from '../../src/engine/fold';
import {
  createMeshFromFold,
  splitMeshAlongSegment,
  splitMeshAlongPolyline,
  getRenderBuffers,
} from '../../src/engine/mesh';

describe('Phase 2.5: Editable Mesh & Shape Continuity (Amendments A & B)', () => {
  it('splits a half-folded 3D mesh with 1e-9 precision and proves shape does not jump', () => {
    const fold = createHalfFoldPattern(1, 1);
    const mesh = createMeshFromFold(fold);

    // Pose the mesh in a 3D half-folded state (right flap rotated 90 deg around u = 0.5 into +z)
    for (let i = 0; i < mesh.numVertices; i++) {
      const u = mesh.uvs[i * 2 + 0];
      const v = mesh.uvs[i * 2 + 1];
      if (u > 0.5) {
        mesh.positions[i * 3 + 0] = 0.5;
        mesh.positions[i * 3 + 1] = v;
        mesh.positions[i * 3 + 2] = u - 0.5;
      } else {
        mesh.positions[i * 3 + 0] = u;
        mesh.positions[i * 3 + 1] = v;
        mesh.positions[i * 3 + 2] = 0;
      }
    }

    const valleyHinge = mesh.hinges.find((h) => h.assignment === 'V')!;
    expect(valleyHinge).toBeDefined();
    valleyHinge.restAngle = Math.PI / 2;

    const initialVertCount = mesh.numVertices;
    const initialTriCount = mesh.numTriangles;

    // Cut diagonally across the paper
    const cutP0: [number, number] = [0.2, -0.1];
    const cutP1: [number, number] = [0.8, 1.1];

    const splitMesh = splitMeshAlongSegment(mesh, cutP0, cutP1, {
      assignment: 'V',
      targetAngleDeg: 180,
    });

    expect(splitMesh.numVertices).toBeGreaterThan(initialVertCount);
    expect(splitMesh.numTriangles).toBeGreaterThan(initialTriCount);

    // Verify 1e-9 tolerance on all 3D coordinates (Requirement 1)
    for (let i = 0; i < splitMesh.numVertices; i++) {
      const u = splitMesh.uvs[i * 2 + 0];
      const v = splitMesh.uvs[i * 2 + 1];

      const x3d = splitMesh.positions[i * 3 + 0];
      const y3d = splitMesh.positions[i * 3 + 1];
      const z3d = splitMesh.positions[i * 3 + 2];

      if (u <= 0.5) {
        expect(Math.abs(x3d - u)).toBeLessThan(1e-9);
        expect(Math.abs(y3d - v)).toBeLessThan(1e-9);
        expect(Math.abs(z3d)).toBeLessThan(1e-9);
      } else {
        const expectedZ = u - 0.5;
        expect(Math.abs(x3d - 0.5)).toBeLessThan(1e-9);
        expect(Math.abs(y3d - v)).toBeLessThan(1e-9);
        expect(Math.abs(z3d - expectedZ)).toBeLessThan(1e-9);
      }
    }

    // Preexisting hinge preserved
    const preservedValleyHinges = splitMesh.hinges.filter(
      (h) => h.assignment === 'V' && Math.abs(h.restAngle - Math.PI / 2) < 1e-9
    );
    expect(preservedValleyHinges.length).toBeGreaterThan(0);

    // Newly cut crease has initial restAngle = 0
    const newlyCutCreases = splitMesh.hinges.filter(
      (h) => h.assignment === 'V' && Math.abs(h.restAngle) < 1e-9
    );
    expect(newlyCutCreases.length).toBeGreaterThan(0);
  });

  it('splits a mesh along a 2-segment polyline with 1e-9 precision (Requirement 5)', () => {
    const fold = createHalfFoldPattern(1, 1);
    const mesh = createMeshFromFold(fold);

    // Fold right flap at 90 deg
    for (let i = 0; i < mesh.numVertices; i++) {
      const u = mesh.uvs[i * 2 + 0];
      const v = mesh.uvs[i * 2 + 1];
      if (u > 0.5) {
        mesh.positions[i * 3 + 0] = 0.5;
        mesh.positions[i * 3 + 1] = v;
        mesh.positions[i * 3 + 2] = u - 0.5;
      } else {
        mesh.positions[i * 3 + 0] = u;
        mesh.positions[i * 3 + 1] = v;
        mesh.positions[i * 3 + 2] = 0;
      }
    }

    const initialVertCount = mesh.numVertices;

    // 2-segment polyline: [P0 -> P1 -> P2]
    const polyline: [number, number][] = [
      [0.1, 0.3],
      [0.4, 0.6],
      [0.9, 0.8],
    ];

    const polySplitMesh = splitMeshAlongPolyline(mesh, polyline, {
      assignment: 'M',
      targetAngleDeg: -90,
    });

    expect(polySplitMesh.numVertices).toBeGreaterThan(initialVertCount + 1);

    // Verify all vertices remain exactly on the half-folded 3D surface
    for (let i = 0; i < polySplitMesh.numVertices; i++) {
      const u = polySplitMesh.uvs[i * 2 + 0];
      const v = polySplitMesh.uvs[i * 2 + 1];

      const x3d = polySplitMesh.positions[i * 3 + 0];
      const y3d = polySplitMesh.positions[i * 3 + 1];
      const z3d = polySplitMesh.positions[i * 3 + 2];

      if (u <= 0.5) {
        expect(Math.abs(x3d - u)).toBeLessThan(1e-9);
        expect(Math.abs(y3d - v)).toBeLessThan(1e-9);
        expect(Math.abs(z3d)).toBeLessThan(1e-9);
      } else {
        const expectedZ = u - 0.5;
        expect(Math.abs(x3d - 0.5)).toBeLessThan(1e-9);
        expect(Math.abs(y3d - v)).toBeLessThan(1e-9);
        expect(Math.abs(z3d - expectedZ)).toBeLessThan(1e-9);
      }
    }
  });

  it('converts Float64Array simulation state to Float32Array render buffers', () => {
    const fold = createHalfFoldPattern(1, 1);
    const mesh = createMeshFromFold(fold);

    const renderBuffers = getRenderBuffers(mesh);
    expect(renderBuffers.positions).toBeInstanceOf(Float32Array);
    expect(renderBuffers.uvs).toBeInstanceOf(Float32Array);
    expect(renderBuffers.indices).toBeInstanceOf(Uint32Array);
    expect(renderBuffers.positions.length).toBe(mesh.positions.length);
  });
});
