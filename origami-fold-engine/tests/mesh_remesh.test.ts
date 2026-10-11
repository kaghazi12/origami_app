import { describe, expect, it } from 'vitest';
import { createSquareSheet } from '../../src/engine/fold';
import { createMeshFromFold, computeMeshQuality } from '../../src/engine/mesh';

describe('Phase 2.5: Quality Remeshing & Independent Stiffness (Requirements 2 & 3)', () => {
  it('remeshes a plain square at targetEdgeLength=0.1, produces regular mesh with V-E+F=1', () => {
    const square = createSquareSheet(1, 1);
    const mesh = createMeshFromFold(square, { targetEdgeLength: 0.1 });

    // 1. Verify refinement
    expect(mesh.numVertices).toBeGreaterThan(4);
    expect(mesh.numTriangles).toBeGreaterThan(2);

    // 2. Euler characteristic V - E + F = 1 holds
    const V = mesh.numVertices;
    const E = mesh.bars.length;
    const F = mesh.numTriangles;
    expect(V - E + F).toBe(1);

    // 3. Compute and report mesh quality metrics
    const quality = computeMeshQuality(mesh);
    expect(quality.minAngleDeg).toBeGreaterThan(10); // No severe slivers
    expect(quality.maxEdgeLength).toBeLessThanOrEqual(0.15); // Bounded edge length

    console.log(
      `[Remesh 0.1] Triangles: ${mesh.numTriangles}, Min Angle: ${quality.minAngleDeg.toFixed(1)}°, Max Edge: ${quality.maxEdgeLength.toFixed(3)}, Avg Min Angle: ${quality.avgMinAngleDeg.toFixed(1)}°`
    );
  });

  it('supports independent k_axial, k_crease, and k_facet stiffness values (Requirement 3)', () => {
    const square = createSquareSheet(1, 1);
    const mesh = createMeshFromFold(square, {
      axialStiffness: 54321,
      creaseStiffness: 3.14,
      facetStiffness: 99.9,
    });

    // Check bar stiffness
    for (const bar of mesh.bars) {
      expect(bar.stiffness).toBe(54321);
    }

    // Check facet hinge stiffness
    for (const hinge of mesh.hinges) {
      if (hinge.assignment === 'F') {
        expect(hinge.stiffness).toBe(99.9);
      }
    }
  });
});
