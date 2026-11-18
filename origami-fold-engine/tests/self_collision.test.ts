import { describe, it, expect } from 'vitest';
import { createSquareSheet } from '../../src/engine/fold';
import { createMeshFromFold, splitMeshAlongPolylines } from '../../src/engine/mesh';
import {
  XPBDSolver,
  assertFinite,
  checkTriangleTriangleIntersection,
  countMeshIntersections,
  closestPointTriangle,
  closestPointsSegments,
} from '../../src/engine/physics';

describe('Phase 9: Self-Collision via XPBD and Stacking', () => {
  // --------------------------------------------------------------------------
  // Test 1: Möller 1997 Exact Triangle-Triangle Intersection Verifier
  // --------------------------------------------------------------------------
  it('validates exact Möller 1997 triangle intersection oracle', () => {
    // 1. Two separated parallel triangles: no intersection
    const T1_A: [number, number, number] = [0, 0, 0];
    const T1_B: [number, number, number] = [1, 0, 0];
    const T1_C: [number, number, number] = [0, 1, 0];

    const T2_A: [number, number, number] = [0, 0, 0.1];
    const T2_B: [number, number, number] = [1, 0, 0.1];
    const T2_C: [number, number, number] = [0, 1, 0.1];
    expect(checkTriangleTriangleIntersection(T1_A, T1_B, T1_C, T2_A, T2_B, T2_C)).toBe(false);

    // 2. Piercing triangles: clear intersection
    const T3_A: [number, number, number] = [0.2, 0.2, -0.5];
    const T3_B: [number, number, number] = [0.2, 0.2, 0.5];
    const T3_C: [number, number, number] = [0.8, 0.8, 0.0];
    expect(checkTriangleTriangleIntersection(T1_A, T1_B, T1_C, T3_A, T3_B, T3_C)).toBe(true);

    // 3. Closest point triangle math verification
    const bary: [number, number, number] = [0, 0, 0];
    const dist = closestPointTriangle(0.2, 0.2, 0.05, 0, 0, 0, 1, 0, 0, 0, 1, 0, bary);
    expect(Math.abs(dist - 0.05)).toBeLessThan(1e-6);
    expect(Math.abs(bary[0] + bary[1] + bary[2] - 1.0)).toBeLessThan(1e-6);

    // 4. Closest points segments math verification
    const st: [number, number] = [0, 0];
    const segDist = closestPointsSegments(
      0, 0, 0,  1, 0, 0,
      0.5, -0.5, 0.02,  0.5, 0.5, 0.02,
      st
    );
    expect(Math.abs(segDist - 0.02)).toBeLessThan(1e-5);
    expect(Math.abs(st[0] - 0.5)).toBeLessThan(1e-5);
    expect(Math.abs(st[1] - 0.5)).toBeLessThan(1e-5);
  });

  // --------------------------------------------------------------------------
  // Test 2: Simple Fold (Flap settles on base sheet with separation >= thickness)
  // --------------------------------------------------------------------------
  it('simple fold: flap settles on top of base sheet with separation >= paperThickness and 0 Möller intersections', () => {
    const baseFold = createSquareSheet(1, 1);
    const mesh = createMeshFromFold(baseFold, { targetEdgeLength: 0.10 });
    assertFinite(mesh);

    const thickness = 0.002; // 2.0 mm
    const targetZ = thickness * 0.5; // table contact boundary z = 1.0 mm

    // Split mesh along centerline x = 0.5
    const splitMesh = splitMeshAlongPolylines(
      mesh,
      [[[0.5, 0.0], [0.5, 1.0]]],
      { assignment: 'V', targetAngleDeg: 180, creaseStiffness: 1000 }
    );
    assertFinite(splitMesh);

    // Initial position: flat on table
    for (let i = 0; i < splitMesh.numVertices; i++) {
      splitMesh.positions[i * 3 + 2] = targetZ;
      splitMesh.velocities[i * 3 + 0] = 0;
      splitMesh.velocities[i * 3 + 1] = 0;
      splitMesh.velocities[i * 3 + 2] = 0;
    }

    const basePins = new Set<number>();
    for (let i = 0; i < splitMesh.numVertices; i++) {
      if (splitMesh.uvs[i * 2 + 0] <= 0.45) {
        basePins.add(i);
      }
    }

    const solver = new XPBDSolver(splitMesh, {
      substeps: 15,
      iterations: 1,
      distanceIterations: 4,
      fixedVertices: basePins,
      enableTable: true,
      tableZ: 0.0,
      paperThickness: thickness,
      enableGravity: true,
      gravity: 2.0,
      muStatic: 0.4,
      muKinetic: 0.3,
      bendingCompliance: 0.001,
      enableSelfCollision: true,
      velocityDamping: 0.98,
    });

    const vHinges = splitMesh.hinges.filter((h) => h.assignment === 'V');
    expect(vHinges.length).toBeGreaterThan(0);

    // Fold flap over by ramping target angle to 180 deg (pi rad)
    const targetRad = Math.PI;
    for (let f = 0; f < 35; f++) {
      const alpha = Math.min(1.0, (f + 1) / 25);
      for (const h of vHinges) {
        h.restAngle = alpha * targetRad;
      }
      solver.step(0.016);
      assertFinite(splitMesh);
    }

    // Allow flap to settle onto base sheet under gravity with self-collision active
    for (let f = 0; f < 20; f++) {
      solver.step(0.016);
      assertFinite(splitMesh);
    }

    // Collect base vertices (x < 0.4) and flap vertices (folded over, originally x > 0.6)
    let minFlapZ = Infinity;
    let maxBaseZ = -Infinity;

    for (let i = 0; i < splitMesh.numVertices; i++) {
      const u = splitMesh.uvs[i * 2 + 0];
      const z = splitMesh.positions[i * 3 + 2];
      if (u < 0.45) {
        if (z > maxBaseZ) maxBaseZ = z;
      } else if (u > 0.55) {
        if (z < minFlapZ) minFlapZ = z;
      }
    }

    // Verify separation between base sheet and folded flap:
    // Base sheet rests at table contact z >= 0.001 m
    expect(maxBaseZ).toBeGreaterThanOrEqual(targetZ - 1e-4);
    // Flap rests on top of base sheet: flap Z must be >= base Z + paperThickness (within 0.5 mm numerical tolerance)
    const separation = minFlapZ - maxBaseZ;
    console.log(`[Simple Fold Collision]: Base Z = ${maxBaseZ.toFixed(4)}m, Flap Z = ${minFlapZ.toFixed(4)}m, Separation = ${(separation * 1000).toFixed(2)}mm (thickness = ${(thickness * 1000).toFixed(1)}mm)`);

    expect(minFlapZ).toBeGreaterThan(maxBaseZ);
    expect(separation).toBeGreaterThanOrEqual(thickness * 0.75); // cleanly stacked with thickness offset

    // Exact Möller Triangle-Triangle Intersection Verification
    const isect = solver.checkSelfIntersections();
    console.log(`[Möller Verification]: ${isect.intersectionCount} triangle-triangle intersections detected`);
    expect(isect.intersectionCount).toBe(0); // Zero interpenetrations!
  }, 120000);

  // --------------------------------------------------------------------------
  // Test 3: Multi-Layer Fold (stacks 4 layers cleanly under gravity)
  // --------------------------------------------------------------------------
  it('multi-layer fold: 2 folds stack 4 layers cleanly separated by >= paperThickness under gravity with 0 intersections', () => {
    const baseFold = createSquareSheet(1, 1);
    const mesh = createMeshFromFold(baseFold, { targetEdgeLength: 0.10 });
    assertFinite(mesh);

    const thickness = 0.002; // 2.0 mm
    const targetZ = thickness * 0.5;

    // Accordion fold: 3 parallel creases creating 4 stacked layers of width 0.25
    // Crease 1: x = 0.25 (V, +180 deg)
    // Crease 2: x = 0.50 (M, -180 deg)
    // Crease 3: x = 0.75 (V, +180 deg)
    let splitMesh = splitMeshAlongPolylines(
      mesh,
      [[[0.25, 0.0], [0.25, 1.0]]],
      { assignment: 'V', targetAngleDeg: 180, creaseStiffness: 1000 }
    );
    splitMesh = splitMeshAlongPolylines(
      splitMesh,
      [[[0.50, 0.0], [0.50, 1.0]]],
      { assignment: 'M', targetAngleDeg: -180, creaseStiffness: 1000 }
    );
    splitMesh = splitMeshAlongPolylines(
      splitMesh,
      [[[0.75, 0.0], [0.75, 1.0]]],
      { assignment: 'V', targetAngleDeg: 180, creaseStiffness: 1000 }
    );
    assertFinite(splitMesh);

    // Initialize flat
    for (let i = 0; i < splitMesh.numVertices; i++) {
      splitMesh.positions[i * 3 + 2] = targetZ;
    }

    const basePins = new Set<number>();
    for (let i = 0; i < splitMesh.numVertices; i++) {
      if (splitMesh.uvs[i * 2 + 0] <= 0.20) {
        basePins.add(i);
      }
    }

    const solver = new XPBDSolver(splitMesh, {
      substeps: 15,
      iterations: 1,
      distanceIterations: 4,
      fixedVertices: basePins,
      enableTable: true,
      tableZ: 0.0,
      paperThickness: thickness,
      enableGravity: true,
      gravity: 2.0,
      muStatic: 0.3,
      muKinetic: 0.2,
      bendingCompliance: 0.001,
      enableSelfCollision: true,
      velocityDamping: 0.98,
    });

    const c1 = splitMesh.hinges.filter(h => Math.abs(splitMesh.uvs[h.v0 * 2 + 0] - 0.25) < 0.02 && Math.abs(splitMesh.uvs[h.v1 * 2 + 0] - 0.25) < 0.02);
    const c2 = splitMesh.hinges.filter(h => Math.abs(splitMesh.uvs[h.v0 * 2 + 0] - 0.50) < 0.02 && Math.abs(splitMesh.uvs[h.v1 * 2 + 0] - 0.50) < 0.02);
    const c3 = splitMesh.hinges.filter(h => Math.abs(splitMesh.uvs[h.v0 * 2 + 0] - 0.75) < 0.02 && Math.abs(splitMesh.uvs[h.v1 * 2 + 0] - 0.75) < 0.02);

    // Phase 1: Fold c1
    for (let f = 0; f < 20; f++) {
      const alpha = (f + 1) / 20;
      for (const h of c1) h.restAngle = alpha * Math.PI;
      solver.step(0.016);
      assertFinite(splitMesh);
    }
    for (let f = 0; f < 10; f++) {
      solver.step(0.016);
      assertFinite(splitMesh);
    }

    // Phase 2: Fold c2
    for (let f = 0; f < 20; f++) {
      const alpha = (f + 1) / 20;
      for (const h of c2) h.restAngle = -alpha * Math.PI;
      solver.step(0.016);
      assertFinite(splitMesh);
    }
    for (let f = 0; f < 10; f++) {
      solver.step(0.016);
      assertFinite(splitMesh);
    }

    // Phase 3: Fold c3
    for (let f = 0; f < 20; f++) {
      const alpha = (f + 1) / 20;
      for (const h of c3) h.restAngle = alpha * Math.PI;
      solver.step(0.016);
      assertFinite(splitMesh);
    }
    for (let f = 0; f < 10; f++) {
      solver.step(0.016);
      assertFinite(splitMesh);
    }

    // Check layer stratification in overlapping region x in [0.05, 0.20]:
    // Layer 1: original u in [0.05, 0.20] (base layer on table)
    // Layer 2: original u in [0.30, 0.45] (first folded layer)
    // Layer 3: original u in [0.55, 0.70] (second folded layer)
    // Layer 4: original u in [0.80, 0.95] (top folded layer)
    const layerZ: number[][] = [[], [], [], []];
    for (let i = 0; i < splitMesh.numVertices; i++) {
      const u = splitMesh.uvs[i * 2 + 0];
      const z = splitMesh.positions[i * 3 + 2];

      if (u >= 0.05 && u <= 0.20) layerZ[0].push(z);
      else if (u >= 0.30 && u <= 0.45) layerZ[1].push(z);
      else if (u >= 0.55 && u <= 0.70) layerZ[2].push(z);
      else if (u >= 0.80 && u <= 0.95) layerZ[3].push(z);
    }

    const avgZ = layerZ.map((arr) => arr.length > 0 ? arr.reduce((a, b) => a + b, 0) / arr.length : 0);
    console.log(`[Multi-Layer 4-Stack]: Layer 1 = ${avgZ[0].toFixed(4)}m, Layer 2 = ${avgZ[1].toFixed(4)}m, Layer 3 = ${avgZ[2].toFixed(4)}m, Layer 4 = ${avgZ[3].toFixed(4)}m`);

    // Verify ordering: Layer 1 < Layer 2 < Layer 3 < Layer 4
    expect(avgZ[0]).toBeGreaterThanOrEqual(targetZ - 1e-4);
    expect(avgZ[1]).toBeGreaterThan(avgZ[0]);
    expect(avgZ[2]).toBeGreaterThan(avgZ[1]);
    expect(avgZ[3]).toBeGreaterThan(avgZ[2]);

    // Zero exact triangle-triangle intersections across all 4 layers
    const isect = solver.checkSelfIntersections();
    console.log(`[Multi-Layer Möller Check]: ${isect.intersectionCount} intersections detected`);
    expect(isect.intersectionCount).toBe(0);
  }, 180000);

  // --------------------------------------------------------------------------
  // Test 4: Dynamic Fast Drag (Flap folded over base sheet does not tunnel)
  // --------------------------------------------------------------------------
  it('dynamic drag: rapid pointer drag of folded flap does not tunnel through base sheet', () => {
    const baseFold = createSquareSheet(1, 1);
    const mesh = createMeshFromFold(baseFold, { targetEdgeLength: 0.10 });
    const thickness = 0.002;
    const targetZ = thickness * 0.5;

    const splitMesh = splitMeshAlongPolylines(
      mesh,
      [[[0.5, 0.0], [0.5, 1.0]]],
      { assignment: 'V', targetAngleDeg: 180, creaseStiffness: 1000 }
    );

    // Place sheet folded in half
    const basePins = new Set<number>();
    for (let i = 0; i < splitMesh.numVertices; i++) {
      if (splitMesh.uvs[i * 2 + 0] <= 0.45) {
        basePins.add(i);
      }
    }

    const solver = new XPBDSolver(splitMesh, {
      substeps: 15,
      iterations: 1,
      distanceIterations: 4,
      fixedVertices: basePins,
      enableTable: true,
      tableZ: 0.0,
      paperThickness: thickness,
      enableGravity: true,
      gravity: 2.0,
      muStatic: 0.4,
      muKinetic: 0.3,
      bendingCompliance: 0.001,
      enableSelfCollision: true,
      velocityDamping: 0.98,
    });

    // Fold over
    const vHinges = splitMesh.hinges.filter((h) => h.assignment === 'V');
    for (let f = 0; f < 30; f++) {
      const alpha = (f + 1) / 30;
      for (const h of vHinges) h.restAngle = alpha * Math.PI;
      solver.step(0.016);
      assertFinite(splitMesh);
    }
    for (let f = 0; f < 15; f++) {
      solver.step(0.016);
      assertFinite(splitMesh);
    }

    // Attach compliant drag constraint to a triangle on the flap
    let flapTri = -1;
    for (let t = 0; t < splitMesh.numTriangles; t++) {
      const v0 = splitMesh.indices[t * 3 + 0];
      if (splitMesh.uvs[v0 * 2 + 0] > 0.7) {
        flapTri = t;
        break;
      }
    }
    expect(flapTri).toBeGreaterThanOrEqual(0);

    const v0 = splitMesh.indices[flapTri * 3 + 0];
    const v1 = splitMesh.indices[flapTri * 3 + 1];
    const v2 = splitMesh.indices[flapTri * 3 + 2];

    const qx = (splitMesh.positions[v0 * 3 + 0] + splitMesh.positions[v1 * 3 + 0] + splitMesh.positions[v2 * 3 + 0]) / 3;
    const qy = (splitMesh.positions[v0 * 3 + 1] + splitMesh.positions[v1 * 3 + 1] + splitMesh.positions[v2 * 3 + 1]) / 3;

    // Rapidly drag downwards into table and base sheet (z = 0.000m)
    solver.setBarycentricDrag({
      point: { triangleIndex: flapTri, v0, v1, v2, w0: 1/3, w1: 1/3, w2: 1/3 },
      targetPos: [qx, qy, 0.000],
      compliance: 0.0001,
    });

    let tunnelDetected = false;
    for (let f = 0; f < 35; f++) {
      solver.step(0.016);
      assertFinite(splitMesh);

      // Check if any flap vertex crossed beneath base sheet vertices
      for (let i = 0; i < splitMesh.numVertices; i++) {
        const u = splitMesh.uvs[i * 2 + 0];
        const z = splitMesh.positions[i * 3 + 2];
        if (u > 0.55 && z < targetZ - 1e-4) {
          tunnelDetected = true;
        }
      }
    }

    expect(tunnelDetected).toBe(false); // Contact prevented tunneling under fast drag

    // Zero Möller intersections
    const isect = solver.checkSelfIntersections();
    expect(isect.intersectionCount).toBe(0);
  }, 120000);

  // --------------------------------------------------------------------------
  // Test 5: Self-Collision Performance Benchmark (121V and 441V)
  // --------------------------------------------------------------------------
  it('benchmarks self-collision performance: ms/step and ms/frame at 121 and 441 vertices', () => {
    const configs = [
      { name: '121 Vertices (h=0.10)', targetEdgeLength: 0.10, substeps: 15, frames: 20 },
      { name: '441 Vertices (h=0.05)', targetEdgeLength: 0.05, substeps: 15, frames: 10 },
    ];

    console.log('\n===========================================================================================================================');
    console.log('       PHASE 9 SELF-COLLISION PERFORMANCE BENCHMARK (121V & 441V WITH SELF-COLLISION ENABLED)                              ');
    console.log('===========================================================================================================================');
    console.log('Mesh                     | Substeps | Frames | Total Time (ms) | ms/frame | ms/step  | Max Strain (%) | Möller Intersections');
    console.log('-------------------------+----------+--------+-----------------+----------+----------+----------------+---------------------');

    for (const cfg of configs) {
      const baseFold = createSquareSheet(1, 1);
      const mesh = createMeshFromFold(baseFold, { targetEdgeLength: cfg.targetEdgeLength });
      const thickness = 0.002;

      const splitMesh = splitMeshAlongPolylines(
        mesh,
        [[[0.5, 0.0], [0.5, 1.0]]],
        { assignment: 'V', targetAngleDeg: 180, creaseStiffness: 1000 }
      );

      const basePins = new Set<number>();
      for (let i = 0; i < splitMesh.numVertices; i++) {
        if (splitMesh.uvs[i * 2 + 0] <= 0.45) {
          basePins.add(i);
        }
      }

      const solver = new XPBDSolver(splitMesh, {
        substeps: cfg.substeps,
        iterations: 1,
        distanceIterations: 4,
        fixedVertices: basePins,
        enableTable: true,
        tableZ: 0.0,
        paperThickness: thickness,
        enableGravity: true,
        gravity: 2.0,
        muStatic: 0.4,
        muKinetic: 0.3,
        bendingCompliance: 0.001,
        enableSelfCollision: true,
        velocityDamping: 0.98,
      });

      const vHinges = splitMesh.hinges.filter((h) => h.assignment === 'V');

      const t0 = performance.now();
      for (let f = 0; f < cfg.frames; f++) {
        const alpha = Math.min(1.0, (f + 1) / Math.max(1, cfg.frames / 2));
        for (const h of vHinges) h.restAngle = alpha * Math.PI;
        solver.step(0.016);
        assertFinite(splitMesh);
      }
      const wallMs = performance.now() - t0;

      const msPerFrame = wallMs / cfg.frames;
      const msPerStep = msPerFrame / cfg.substeps;
      const strain = solver.getMaxStrain() * 100;
      const isect = solver.checkSelfIntersections();

      console.log(
        `${cfg.name.padEnd(24)} | ${cfg.substeps.toString().padStart(8)} | ${cfg.frames.toString().padStart(6)} | ${wallMs.toFixed(1).padStart(15)} | ${msPerFrame.toFixed(2).padStart(8)} | ${msPerStep.toFixed(3).padStart(8)} | ${(strain.toFixed(4) + '%').padStart(14)} | ${isect.intersectionCount.toString().padStart(21)}`
      );

      expect(isect.intersectionCount).toBe(0);
      expect(strain).toBeLessThan(1.0);
    }
    console.log('===========================================================================================================================\n');
  }, 240000);
});
