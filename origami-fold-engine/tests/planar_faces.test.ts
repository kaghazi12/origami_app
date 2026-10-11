import { describe, expect, it } from 'vitest';
import { FoldFormat } from '../../src/engine/types';
import { createWaterbombBasePattern, extractPlanarFaces, resolveTJunctions } from '../../src/engine/fold';
import { createMeshFromFold } from '../../src/engine/mesh';

describe('Phase 2.5: Planar Face Extraction & T-junction Handling (Requirement 4)', () => {
  it('extracts faces from an edges-only waterbomb base where faces_vertices is omitted', () => {
    const fullWb = createWaterbombBasePattern(1);
    // Omit faces_vertices completely
    const edgesOnlyWb: FoldFormat = {
      file_spec: 1.1,
      vertices_coords: fullWb.vertices_coords,
      edges_vertices: fullWb.edges_vertices,
      edges_assignment: fullWb.edges_assignment,
      edges_foldAngle: fullWb.edges_foldAngle,
    };

    const extractedFaces = extractPlanarFaces(edgesOnlyWb);
    expect(extractedFaces.length).toBeGreaterThanOrEqual(6);

    // Create mesh from edges-only model
    const mesh = createMeshFromFold(edgesOnlyWb);
    expect(mesh.numVertices).toBe(9);
    expect(mesh.numTriangles).toBeGreaterThanOrEqual(6);

    // Verify Euler characteristic V - E + F = 1
    const V = mesh.numVertices;
    const E = mesh.bars.length;
    const F = mesh.numTriangles;
    expect(V - E + F).toBe(1);
  });

  it('handles T-junctions by splitting the intersected edge', () => {
    // Pattern with a T-junction:
    // Boundary square: 4 vertices (0,0), (1,0), (1,1), (0,1)
    // Horizontal edge: (0, 0.5) to (1, 0.5) -> vertex 4 to vertex 5
    // Vertical edge: from bottom (0.5, 0) [vertex 6] up to (0.5, 0.5) [vertex 7]
    // Notice: vertex 7 (0.5, 0.5) lies in the middle of edge 4->5! It's a T-junction!
    const tJunctionFold: FoldFormat = {
      file_spec: 1.1,
      vertices_coords: [
        [0, 0], // 0
        [1, 0], // 1
        [1, 1], // 2
        [0, 1], // 3
        [0, 0.5], // 4
        [1, 0.5], // 5
        [0.5, 0], // 6
        [0.5, 0.5], // 7 T-junction point on edge 4->5
      ],
      edges_vertices: [
        // Boundary
        [0, 6],
        [6, 1],
        [1, 5],
        [5, 2],
        [2, 3],
        [3, 4],
        [4, 0],
        // Horizontal crease crossing paper:
        [4, 5], // Unsplit edge containing vertex 7!
        // Vertical crease terminating at vertex 7:
        [6, 7],
      ],
      edges_assignment: ['B', 'B', 'B', 'B', 'B', 'B', 'B', 'V', 'M'],
    };

    // 1. Verify T-junction resolution
    const resolved = resolveTJunctions(tJunctionFold);
    // Edge [4, 5] should now be split into [4, 7] and [7, 5]
    const hasOriginalEdge = resolved.edges_vertices.some(
      ([u, v]) => (u === 4 && v === 5) || (u === 5 && v === 4)
    );
    expect(hasOriginalEdge).toBe(false);

    const hasSubEdge1 = resolved.edges_vertices.some(
      ([u, v]) => (u === 4 && v === 7) || (u === 7 && v === 4)
    );
    const hasSubEdge2 = resolved.edges_vertices.some(
      ([u, v]) => (u === 7 && v === 5) || (u === 5 && v === 7)
    );
    expect(hasSubEdge1).toBe(true);
    expect(hasSubEdge2).toBe(true);

    // 2. Create mesh directly from T-junction model without faces_vertices
    const mesh = createMeshFromFold(tJunctionFold);
    expect(mesh.numVertices).toBe(8);
    expect(mesh.numTriangles).toBeGreaterThanOrEqual(3);

    // Euler characteristic V - E + F = 1
    const V = mesh.numVertices;
    const E = mesh.bars.length;
    const F = mesh.numTriangles;
    expect(V - E + F).toBe(1);
  });
});
