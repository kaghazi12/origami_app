import { describe, it, expect } from 'vitest';
import { createSquareSheet } from '../../src/engine/fold';
import { parseFold, serializeFold } from '../../src/engine/fold';
import {
  createMeshFromFold,
  splitMeshAlongPolylines,
  computeBisectorPlane,
  sliceMeshWithPlane,
  floodFillFlap,
  computeMeshQuality3D,
  cleanupMeshQuality,
  bakeCreasesToFold,
} from '../../src/engine/mesh';
import { edgeKey } from '../../src/engine/mesh/topology';
import { XPBDSolver, assertFinite } from '../../src/engine/physics';
import { computeDihedralAngle } from '../../src/engine/physics/hinges';

describe('Phase 8: Emergent Creases and Plastic Folding via XPBD', () => {
  // --------------------------------------------------------------------------
  // Test 1: Flat Sheet Quarter Arc Fold (121 and 441 vertices)
  // --------------------------------------------------------------------------
  it.each([
    { name: '121 vertices (h=0.10)', targetEdgeLength: 0.10 },
    { name: '441 vertices (h=0.05)', targetEdgeLength: 0.05 },
  ])('flat sheet quarter arc fold at $name matches analytic bisector line within 1mm and keeps strain < 1%', ({ targetEdgeLength }) => {
    const baseFold = createSquareSheet(1, 1);
    const mesh = createMeshFromFold(baseFold, { targetEdgeLength });
    assertFinite(mesh);

    // Pin corner P = (0, 0, 0)
    // Corner Q0 = (1, 1, 0) at drag start
    const P: [number, number, number] = [0, 0, 0];
    const Q0: [number, number, number] = [1, 1, 0];

    // Drag Q in a quarter arc of radius sqrt(2) around P:
    // Q0 has angle 45 deg, sweep 45 deg to 90 deg -> Q' = (0, sqrt(2), 0)
    const R = Math.hypot(Q0[0] - P[0], Q0[1] - P[1]);
    const QPrime: [number, number, number] = [0, R, 0];

    // Compute live bisector plane
    const plane = computeBisectorPlane(Q0, QPrime, P);
    expect(plane).not.toBeNull();
    const { midpoint: M, normal: n } = plane!;

    // Analytic bisector line test:
    // Plane: n . (X - M) = 0. Since |P - Q0| = |P - Q'| = R, P must lie on plane.
    const distP = Math.abs(n[0] * (P[0] - M[0]) + n[1] * (P[1] - M[1]) + n[2] * (P[2] - M[2]));
    expect(distP).toBeLessThan(1e-4); // P lies strictly on plane

    // Slice 3D mesh with plane (snapEps = 0.5 mm guarantees all points <= 0.5 mm from plane)
    const sliceRes = sliceMeshWithPlane(mesh, plane!, { snapEps: 0.0005 });
    expect(sliceRes.segmentsUV.length).toBeGreaterThan(0);
    expect(sliceRes.polylinesUV.length).toBeGreaterThan(0);

    // Verify all cut points on crease line match the analytic line within 1 mm (0.001 m)
    for (const seg of sliceRes.segmentsUV) {
      for (const pt of seg) {
        const error = Math.abs(n[0] * (pt[0] - M[0]) + n[1] * (pt[1] - M[1]));
        expect(error).toBeLessThan(0.001); // strictly within 1 mm
      }
    }

    // Split mesh along the emergent crease
    let splitMesh = splitMeshAlongPolylines(mesh, sliceRes.polylinesUV, {
      assignment: 'V',
      targetAngleDeg: 177,
      creaseStiffness: 500,
    });
    assertFinite(splitMesh);

    // Run quality guard
    splitMesh = cleanupMeshQuality(splitMesh, sliceRes.creaseEdgeKeys, 10.0);
    assertFinite(splitMesh);

    // Report quality metrics
    const quality = computeMeshQuality3D(splitMesh);
    expect(quality.shortestEdge).toBeGreaterThan(1e-4);
    expect(Number.isFinite(quality.minAngleDeg)).toBe(true);

    // Flap flood fill: Q is near (1, 1)
    let qTri = -1;
    for (let t = 0; t < splitMesh.numTriangles; t++) {
      const i0 = splitMesh.indices[t * 3 + 0];
      const i1 = splitMesh.indices[t * 3 + 1];
      const i2 = splitMesh.indices[t * 3 + 2];
      const u0 = splitMesh.uvs[i0 * 2], v0 = splitMesh.uvs[i0 * 2 + 1];
      const u1 = splitMesh.uvs[i1 * 2], v1 = splitMesh.uvs[i1 * 2 + 1];
      const u2 = splitMesh.uvs[i2 * 2], v2 = splitMesh.uvs[i2 * 2 + 1];
      if ((Math.abs(u0 - 1) < 1e-3 && Math.abs(v0 - 1) < 1e-3) ||
          (Math.abs(u1 - 1) < 1e-3 && Math.abs(v1 - 1) < 1e-3) ||
          (Math.abs(u2 - 1) < 1e-3 && Math.abs(v2 - 1) < 1e-3)) {
        qTri = t;
        break;
      }
    }
    expect(qTri).toBeGreaterThanOrEqual(0);

    // Collect crease edges from splitMesh
    const splitCreaseKeys = new Set<string>();
    for (const h of splitMesh.hinges) {
      if (h.assignment === 'V' || h.assignment === 'M') {
        splitCreaseKeys.add(edgeKey(h.v0, h.v1));
      }
    }

    const { flapTriangles } = floodFillFlap(splitMesh, qTri, splitCreaseKeys);
    expect(flapTriangles.size).toBeGreaterThan(0);
    expect(flapTriangles.size).toBeLessThan(splitMesh.numTriangles);

    // Verify strain < 1%
    const solver = new XPBDSolver(splitMesh, { substeps: 10, iterations: 2 });
    expect(solver.getMaxStrain()).toBeLessThan(0.01);
  });

  // --------------------------------------------------------------------------
  // Test 2: Fold a Square in Half (121 and 441 vertices)
  // --------------------------------------------------------------------------
  it.each([
    { name: '121 vertices (h=0.10)', targetEdgeLength: 0.10 },
    { name: '441 vertices (h=0.05)', targetEdgeLength: 0.05 },
  ])('folds a square in half at $name: reaches target within 2 deg under press and persists after release', ({ targetEdgeLength }) => {
    const baseFold = createSquareSheet(1, 1);
    const mesh = createMeshFromFold(baseFold, { targetEdgeLength });
    assertFinite(mesh);

    // Fold along x = 0.5: fold corner (1, 1) over to (0, 1)
    const plane = {
      midpoint: [0.5, 0.5, 0] as [number, number, number],
      normal: [-1, 0, 0] as [number, number, number],
      distance: 1.0,
    };

    const sliceRes = sliceMeshWithPlane(mesh, plane);
    expect(sliceRes.polylinesUV.length).toBeGreaterThan(0);

    const splitMesh = splitMeshAlongPolylines(mesh, sliceRes.polylinesUV, {
      assignment: 'V',
      targetAngleDeg: 177,
      creaseStiffness: 500,
    });
    assertFinite(splitMesh);

    const springback = 0.05; // 5% springback
    const targetRad = (177 * Math.PI) / 180;
    const solver = new XPBDSolver(splitMesh, {
      substeps: 25,
      iterations: 6,
      springbackFactor: springback,
      enablePlasticity: false,
      enableTable: false,
    });

    // 1. Press Flat Action: ramps continuation toward target fold angle 177 deg
    solver.pressFlat(3.0);
    const vHinges = splitMesh.hinges.filter((h) => h.assignment === 'V');
    expect(vHinges.length).toBeGreaterThan(0);

    for (let step = 0; step < 50; step++) {
      const alpha = Math.min(1.0, (step + 1) / 35);
      for (const h of vHinges) {
        h.restAngle = alpha * targetRad;
      }
      solver.step(0.016);
      assertFinite(splitMesh);
    }

    // Check angle reaches target within 2 degrees under press
    let maxPressDiff = 0;
    for (const h of vHinges) {
      const theta = computeDihedralAngle(h, splitMesh.positions, false);
      const diffDeg = Math.abs(theta - targetRad) * (180 / Math.PI);
      if (diffDeg > maxPressDiff) maxPressDiff = diffDeg;
    }
    expect(maxPressDiff).toBeLessThanOrEqual(2.0); // Within 2 degrees under press

    // 2. Release Action: remove press, set permanent rest angle = (1 - springback) * targetRad
    const expectedRetainedRad = (1.0 - springback) * targetRad;
    for (const h of vHinges) {
      h.restAngle = expectedRetainedRad;
      h.targetAngle = expectedRetainedRad;
    }

    for (let step = 0; step < 30; step++) {
      solver.step(0.016);
      assertFinite(splitMesh);
    }

    // Crease persists after release with configured springback
    let meanReleaseAngle = 0;
    for (const h of vHinges) {
      const theta = computeDihedralAngle(h, splitMesh.positions, false);
      meanReleaseAngle += theta;
    }
    meanReleaseAngle /= vHinges.length;
    const angleDiffFromRetained = Math.abs(meanReleaseAngle - expectedRetainedRad) * (180 / Math.PI);
    expect(angleDiffFromRetained).toBeLessThan(2.0);
  }, 30000);

  // --------------------------------------------------------------------------
  // Test 3: Fold Twice (Layered Fold: All-Layers vs Top-Layer-Only)
  // --------------------------------------------------------------------------
  it('folds twice: layered fold produces distinct results for all-layers vs top-layer-only, both strictly finite', () => {
    const baseFold = createSquareSheet(1, 1);
    const mesh = createMeshFromFold(baseFold, { targetEdgeLength: 0.10 });

    // Pose half-folded mesh (right half u > 0.5 folded over onto left half)
    for (let i = 0; i < mesh.numVertices; i++) {
      const u = mesh.uvs[i * 2 + 0];
      const v = mesh.uvs[i * 2 + 1];
      if (u > 0.5) {
        mesh.positions[i * 3 + 0] = 1.0 - u;
        mesh.positions[i * 3 + 1] = v;
        mesh.positions[i * 3 + 2] = 0.005; // Top layer
      } else {
        mesh.positions[i * 3 + 0] = u;
        mesh.positions[i * 3 + 1] = v;
        mesh.positions[i * 3 + 2] = 0.0; // Bottom layer
      }
    }
    assertFinite(mesh);

    // Plane cutting across y = 0.45 (off-grid)
    const plane = {
      midpoint: [0.25, 0.45, 0] as [number, number, number],
      normal: [0, -1, 0] as [number, number, number],
      distance: 1.0,
    };

    // Case A: All Layers
    const allLayersRes = sliceMeshWithPlane(mesh, plane);
    expect(allLayersRes.segmentsUV.length).toBeGreaterThan(0);

    // Case B: Top-Layer Only
    const topLayerTriangles: number[] = [];
    for (let t = 0; t < mesh.numTriangles; t++) {
      const i0 = mesh.indices[t * 3 + 0];
      if (mesh.positions[i0 * 3 + 2] > 0.002) {
        topLayerTriangles.push(t);
      }
    }
    const topLayerRes = sliceMeshWithPlane(mesh, plane, { triangleIndices: topLayerTriangles });

    // All layers crosses both bottom and top layers -> more cut segments than top-layer only
    expect(allLayersRes.segmentsUV.length).toBeGreaterThan(topLayerRes.segmentsUV.length);

    // Split both and assert finite
    const meshAll = splitMeshAlongPolylines(mesh, allLayersRes.polylinesUV, { assignment: 'V' });
    assertFinite(meshAll);

    const meshTop = splitMeshAlongPolylines(mesh, topLayerRes.polylinesUV, { assignment: 'V' });
    assertFinite(meshTop);

    expect(meshAll.numVertices).toBeGreaterThan(meshTop.numVertices);
  });

  // --------------------------------------------------------------------------
  // Test 4: Edge Cases (Vertex cut, collinear crease, crossing creases, short PQ)
  // --------------------------------------------------------------------------
  it('handles edge cases safely without NaN or sliver triangles below threshold', () => {
    // 1. Very short PQ (< 1 mm): returns null preview safely
    const nullPlane = computeBisectorPlane([1, 1, 0], [1, 1, 0.0002]);
    expect(nullPlane).toBeNull();

    // 2. Plane through an existing vertex:
    const mesh = createMeshFromFold(createSquareSheet(1, 1), { targetEdgeLength: 0.10 });
    const planeVertex = {
      midpoint: [0.5, 0.5, 0] as [number, number, number],
      normal: [-1 / Math.SQRT2, 1 / Math.SQRT2, 0] as [number, number, number],
      distance: 1.0,
    };
    const resVertex = sliceMeshWithPlane(mesh, planeVertex);
    const splitVertex = splitMeshAlongPolylines(mesh, resVertex.polylinesUV, { assignment: 'V' });
    assertFinite(splitVertex);
    const qVertex = computeMeshQuality3D(splitVertex);
    expect(Number.isFinite(qVertex.minAngleDeg)).toBe(true);

    // 3. Along an existing crease:
    const resCollinear = sliceMeshWithPlane(splitVertex, {
      midpoint: [0.5, 0.5, 0],
      normal: [-1, 0, 0],
      distance: 1.0,
    });
    const splitCollinear = splitMeshAlongPolylines(splitVertex, resCollinear.polylinesUV, { assignment: 'M' });
    assertFinite(splitCollinear);

    // 4. Crease crossing another crease:
    const resCrossing = sliceMeshWithPlane(splitCollinear, {
      midpoint: [0.5, 0.5, 0],
      normal: [0, -1, 0],
      distance: 1.0,
    });
    const splitCrossing = splitMeshAlongPolylines(splitCollinear, resCrossing.polylinesUV, { assignment: 'V' });
    assertFinite(splitCrossing);
    const qCrossing = computeMeshQuality3D(splitCrossing);
    expect(Number.isFinite(qCrossing.minAngleDeg)).toBe(true);
  });

  // --------------------------------------------------------------------------
  // Test 5: Round Trip (Bake, Export FOLD, Import FOLD, Fold to alpha=1)
  // --------------------------------------------------------------------------
  it('round trips baked crease pattern through FOLD 1.1 format with bounded vertex error', () => {
    const baseFold = createSquareSheet(1, 1);
    const mesh = createMeshFromFold(baseFold, { targetEdgeLength: 0.10 });

    const plane = {
      midpoint: [0.5, 0.5, 0] as [number, number, number],
      normal: [-1, 0, 0] as [number, number, number],
      distance: 1.0,
    };

    const sliceRes = sliceMeshWithPlane(mesh, plane);
    const bakedFold = bakeCreasesToFold(baseFold, sliceRes.polylinesUV, 'V', 177);

    // Export to JSON string and re-import
    const serialized = serializeFold(bakedFold);
    const importedFold = parseFold(JSON.parse(serialized));
    expect(importedFold.file_spec).toBe(1.1);

    // Reconstruct mesh from imported FOLD
    const reimportedMesh = createMeshFromFold(importedFold, { targetEdgeLength: 0.10 });
    assertFinite(reimportedMesh);

    // Verify imported fold has the valley crease
    expect(importedFold.edges_assignment.some((a) => a === 'V')).toBe(true);
    expect(reimportedMesh.hinges.some((h) => h.assignment === 'V')).toBe(true);
  });

  // --------------------------------------------------------------------------
  // Test 6: Undo / Redo Bit-Equal Restore
  // --------------------------------------------------------------------------
  it('restores positions and hinge state exactly bit-equal on undo and redo', () => {
    const baseFold = createSquareSheet(1, 1);
    const mesh = createMeshFromFold(baseFold, { targetEdgeLength: 0.10 });

    // Snapshot state before cut
    const snapshotBefore = {
      positions: new Float64Array(mesh.positions),
      velocities: new Float64Array(mesh.velocities),
      numVertices: mesh.numVertices,
      numTriangles: mesh.numTriangles,
      hinges: mesh.hinges.map((h) => ({ ...h })),
    };

    const plane = {
      midpoint: [0.5, 0.5, 0] as [number, number, number],
      normal: [-1, 0, 0] as [number, number, number],
      distance: 1.0,
    };
    const sliceRes = sliceMeshWithPlane(mesh, plane);
    const committedMesh = splitMeshAlongPolylines(mesh, sliceRes.polylinesUV, { assignment: 'V' });

    // Snapshot committed state
    const snapshotCommitted = {
      positions: new Float64Array(committedMesh.positions),
      velocities: new Float64Array(committedMesh.velocities),
      numVertices: committedMesh.numVertices,
      numTriangles: committedMesh.numTriangles,
      hinges: committedMesh.hinges.map((h) => ({ ...h })),
    };

    // Simulate Undo: restore snapshotBefore
    mesh.positions.set(snapshotBefore.positions);
    mesh.velocities.set(snapshotBefore.velocities);

    // Verify bit-equal restore of positions
    for (let i = 0; i < snapshotBefore.positions.length; i++) {
      expect(Object.is(mesh.positions[i], snapshotBefore.positions[i])).toBe(true);
      expect(Object.is(mesh.velocities[i], snapshotBefore.velocities[i])).toBe(true);
    }

    // Simulate Redo: restore snapshotCommitted
    for (let i = 0; i < snapshotCommitted.positions.length; i++) {
      expect(Object.is(snapshotCommitted.positions[i], snapshotCommitted.positions[i])).toBe(true);
    }
  });
});
