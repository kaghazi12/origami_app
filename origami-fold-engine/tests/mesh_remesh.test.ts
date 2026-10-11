import { describe, expect, it } from 'vitest';
import { createSquareSheet } from '../../src/engine/fold';
import {
  createMeshFromFold,
  computeMeshQuality,
  canGridHonorCreases,
  isCreaseCoveredByMeshEdges,
} from '../../src/engine/mesh';

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

  // Phase 3.5 Requirement 7: Non-axis-aligned and offset-diagonal remeshing with exact crease preservation
  it('Requirement 7: non-axis-aligned 22.5° crease falls back to constrained triangulation and covers crease exactly', () => {
    // 22.5 degree angle line across unit square
    const yTarget = Math.tan((22.5 * Math.PI) / 180); // tan(22.5 deg) = sqrt(2) - 1 ≈ 0.41421356
    const fold22_5 = {
      file_spec: 1.1,
      file_creator: 'origami-fold-engine',
      vertices_coords: [
        [0, 0],         // 0
        [1, 0],         // 1
        [1, yTarget],   // 2: intersection of 22.5° line with right border
        [1, 1],         // 3
        [0, 1],         // 4
      ],
      edges_vertices: [
        [0, 1], // B
        [1, 2], // B
        [2, 3], // B
        [3, 4], // B
        [4, 0], // B
        [0, 2], // V: 22.5 degree crease line
      ],
      edges_assignment: ['B', 'B', 'B', 'B', 'B', 'V'] as any,
      edges_foldAngle: [0, 0, 0, 0, 0, 90],
      faces_vertices: [
        [0, 1, 2],
        [0, 2, 3, 4],
      ],
    };

    // 1. Grid cannot honor 22.5° crease
    expect(canGridHonorCreases(fold22_5, 0.1)).toBe(false);

    // 2. Create mesh with targetEdgeLength=0.1
    const mesh = createMeshFromFold(fold22_5, { targetEdgeLength: 0.1 });

    // 3. Assert crease segment [0, 2] is exactly covered by mesh edges
    const p1 = fold22_5.vertices_coords[0] as [number, number];
    const p2 = fold22_5.vertices_coords[2] as [number, number];
    const covered = isCreaseCoveredByMeshEdges(p1, p2, mesh);
    expect(covered).toBe(true);

    // 4. Report min angle
    const quality = computeMeshQuality(mesh);
    console.log(`[22.5° Crease Remeshing] Triangles: ${mesh.numTriangles}, Min Angle: ${quality.minAngleDeg.toFixed(2)}°`);
    expect(quality.minAngleDeg).toBeGreaterThan(15);
  });

  it('Requirement 7: offset-diagonal waterbomb pattern exactly preserves every crease segment and reports min angle', () => {
    // Waterbomb with center offset to (0.37, 0.63)
    const cx = 0.37;
    const cy = 0.63;

    const offsetWaterbomb = {
      file_spec: 1.1,
      file_creator: 'origami-fold-engine',
      vertices_coords: [
        [0, 0],   // 0
        [1, 0],   // 1
        [1, cy],  // 2
        [1, 1],   // 3
        [0, 1],   // 4
        [0, cy],  // 5
        [cx, cy], // 6: offset center vertex
      ],
      edges_vertices: [
        [0, 1], // 0: B bottom
        [1, 2], // 1: B right lower
        [2, 3], // 2: B right upper
        [3, 4], // 3: B top
        [4, 5], // 4: B left upper
        [5, 0], // 5: B left lower
        // Creases
        [5, 6], // 6: V horizontal left
        [6, 2], // 7: V horizontal right
        [0, 6], // 8: M diagonal bottom-left
        [1, 6], // 9: M diagonal bottom-right
        [3, 6], // 10: M diagonal top-right
        [4, 6], // 11: M diagonal top-left
      ],
      edges_assignment: ['B', 'B', 'B', 'B', 'B', 'B', 'V', 'V', 'M', 'M', 'M', 'M'] as any,
      edges_foldAngle: [0, 0, 0, 0, 0, 0, 180, 180, -180, -180, -180, -180],
      faces_vertices: [
        [0, 1, 6],
        [1, 2, 6],
        [2, 3, 6],
        [3, 4, 6],
        [4, 5, 6],
        [5, 0, 6],
      ],
    };

    // 1. Grid cannot honor offset coordinates and diagonal slopes
    expect(canGridHonorCreases(offsetWaterbomb, 0.1)).toBe(false);

    // 2. Create mesh with targetEdgeLength=0.1
    const mesh = createMeshFromFold(offsetWaterbomb, { targetEdgeLength: 0.1 });

    // 3. Assert EVERY crease segment is exactly covered by mesh edges
    const creaseIndices = [6, 7, 8, 9, 10, 11];
    for (const eIdx of creaseIndices) {
      const [u, v] = offsetWaterbomb.edges_vertices[eIdx];
      const p1 = offsetWaterbomb.vertices_coords[u] as [number, number];
      const p2 = offsetWaterbomb.vertices_coords[v] as [number, number];
      const covered = isCreaseCoveredByMeshEdges(p1, p2, mesh);
      expect(covered).toBe(true);
    }

    // 4. Report min angle
    const quality = computeMeshQuality(mesh);
    console.log(
      `[Offset-Diagonal Waterbomb] Triangles: ${mesh.numTriangles}, Min Angle: ${quality.minAngleDeg.toFixed(2)}°, Max Angle: ${quality.maxAngleDeg.toFixed(2)}°`
    );
    expect(quality.minAngleDeg).toBeGreaterThan(15);
  });
});
