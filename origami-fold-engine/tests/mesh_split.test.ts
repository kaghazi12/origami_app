import { describe, expect, it } from 'vitest';
import { createHalfFoldPattern } from '../../src/engine/fold';
import { createMeshFromFold, splitMeshAlongSegment } from '../../src/engine/mesh';

describe('Phase 2: Editable Mesh & Shape Continuity (Amendment B)', () => {
  it('splits a half-folded 3D mesh and proves the shape does not jump', () => {
    // 1. Create a half-fold pattern (valley crease at u = 0.5)
    const fold = createHalfFoldPattern(1, 1);
    const mesh = createMeshFromFold(fold);

    // 2. Pose the mesh in a 3D half-folded state (right flap rotated 90 deg around u = 0.5 into +z)
    // Vertices:
    // v0: (0, 0, 0)
    // v1: (0.5, 0, 0) [crease bottom]
    // v2: (1, 0, 0) -> in 3D: (0.5, 0, 0.5)
    // v3: (1, 1, 0) -> in 3D: (0.5, 1, 0.5)
    // v4: (0.5, 1, 0) [crease top]
    // v5: (0, 1, 0)
    for (let i = 0; i < mesh.numVertices; i++) {
      const u = mesh.uvs[i * 2 + 0];
      const v = mesh.uvs[i * 2 + 1];
      if (u > 0.5) {
        // Rotated 90 degrees around crease line at u = 0.5
        const offset = u - 0.5;
        mesh.positions[i * 3 + 0] = 0.5;
        mesh.positions[i * 3 + 1] = v;
        mesh.positions[i * 3 + 2] = offset; // 3D elevation
      } else {
        mesh.positions[i * 3 + 0] = u;
        mesh.positions[i * 3 + 1] = v;
        mesh.positions[i * 3 + 2] = 0;
      }
    }

    // Set the valley hinge restAngle to 90 deg (pi / 2) to match this 3D pose
    const valleyHinge = mesh.hinges.find((h) => h.assignment === 'V')!;
    expect(valleyHinge).toBeDefined();
    valleyHinge.restAngle = Math.PI / 2;

    const initialVertCount = mesh.numVertices;
    const initialTriCount = mesh.numTriangles;

    // 3. Cut across the paper diagonally from (0.2, -0.1) to (0.8, 1.1)
    // This crosses both the flat left wing (u < 0.5) and the 3D-elevated right wing (u > 0.5)
    const cutP0: [number, number] = [0.2, -0.1];
    const cutP1: [number, number] = [0.8, 1.1];

    const splitMesh = splitMeshAlongSegment(mesh, cutP0, cutP1, {
      assignment: 'V',
      targetAngleDeg: 180,
    });

    // 4. Assert new geometry was formed
    expect(splitMesh.numVertices).toBeGreaterThan(initialVertCount);
    expect(splitMesh.numTriangles).toBeGreaterThan(initialTriCount);

    // 5. Verification: CHECK THE SHAPE DOES NOT JUMP
    // Every vertex in splitMesh (old and new) must lie EXACTLY on the half-folded 3D surface!
    for (let i = 0; i < splitMesh.numVertices; i++) {
      const u = splitMesh.uvs[i * 2 + 0];
      const v = splitMesh.uvs[i * 2 + 1];

      const x3d = splitMesh.positions[i * 3 + 0];
      const y3d = splitMesh.positions[i * 3 + 1];
      const z3d = splitMesh.positions[i * 3 + 2];

      if (u <= 0.5) {
        // Left side: must remain strictly flat at z = 0 with x = u, y = v
        expect(x3d).toBeCloseTo(u, 6);
        expect(y3d).toBeCloseTo(v, 6);
        expect(z3d).toBeCloseTo(0, 6);
      } else {
        // Right side: must lie strictly on the vertical 3D flap at x = 0.5, y = v, z = u - 0.5
        const expectedZ = u - 0.5;
        expect(x3d).toBeCloseTo(0.5, 6);
        expect(y3d).toBeCloseTo(v, 6);
        expect(z3d).toBeCloseTo(expectedZ, 6);
      }
    }

    // 6. Verify preexisting hinge states are preserved
    const preservedValleyHinges = splitMesh.hinges.filter(
      (h) => h.assignment === 'V' && Math.abs(h.restAngle - Math.PI / 2) < 1e-4
    );
    expect(preservedValleyHinges.length).toBeGreaterThan(0);

    // 7. Verify the newly inserted crease has initial restAngle = 0 (no sudden impulse!)
    const newlyCutCreases = splitMesh.hinges.filter(
      (h) => h.assignment === 'V' && Math.abs(h.restAngle) < 1e-6
    );
    expect(newlyCutCreases.length).toBeGreaterThan(0);
  });
});
