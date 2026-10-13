import { describe, it, expect } from 'vitest';
import { createSquareSheet } from '../../src/engine/fold';
import { createMeshFromFold } from '../../src/engine/mesh';
import { XPBDSolver, computeDihedralAngle, assertFinite } from '../../src/engine/physics';

describe('Phase 6: Table Contact, Coulomb Friction, Gravity & Paper Bending Physics', () => {
  it('A flat sheet dropped from height 0.3 settles on the table, flat, no penetration, strain < 0.5%, no NaN', () => {
    const fold = createSquareSheet(1, 1);
    const mesh = createMeshFromFold(fold, { targetEdgeLength: 0.10 });

    const thickness = 0.002; // 0.2% of 1.0m sheet width
    const targetZ = thickness / 2; // 0.001m
    const initialHeight = 0.3;

    // Drop all vertices from height 0.3
    for (let i = 0; i < mesh.numVertices; i++) {
      mesh.positions[i * 3 + 2] = initialHeight;
      mesh.velocities[i * 3 + 0] = 0;
      mesh.velocities[i * 3 + 1] = 0;
      mesh.velocities[i * 3 + 2] = 0;
    }

    const solver = new XPBDSolver(mesh, {
      substeps: 10,
      iterations: 2,
      enableTable: true,
      tableZ: 0.0,
      paperThickness: thickness,
      enableGravity: true,
      gravity: 4.0, // Clean downward gravity acceleration
      muStatic: 0.5,
      muKinetic: 0.4,
      velocityDamping: 0.99,
      contactDamping: 0.3,
    });

    // Simulate drop for 120 frames (1.92s simulated time)
    const dt = 0.016;
    for (let f = 0; f < 120; f++) {
      solver.step(dt);
    }

    assertFinite(mesh);

    // 1. No penetration below table plane z=0
    let minZ = Infinity;
    let maxZ = -Infinity;
    for (let i = 0; i < mesh.numVertices; i++) {
      const z = mesh.positions[i * 3 + 2];
      if (z < minZ) minZ = z;
      if (z > maxZ) maxZ = z;
    }
    expect(minZ).toBeGreaterThanOrEqual(0.0);

    // 2. Max Z deviation below stated tolerance (flat on table at z = targetZ)
    const maxDeviation = Math.max(Math.abs(minZ - targetZ), Math.abs(maxZ - targetZ));
    console.log(`[Drop Test] Settled minZ = ${minZ.toFixed(6)}, maxZ = ${maxZ.toFixed(6)}, targetZ = ${targetZ.toFixed(6)}, maxDev = ${maxDeviation.toExponential(3)} m`);
    expect(maxDeviation).toBeLessThan(1e-4);

    // 3. Inextensibility strain < 0.5%
    const maxStrain = solver.getMaxStrain();
    console.log(`[Drop Test] Final Max Strain = ${(maxStrain * 100).toFixed(4)}%`);
    expect(maxStrain).toBeLessThan(0.005);

    // 4. Kinetic energy decayed
    expect(solver.getKineticEnergy()).toBeLessThan(1e-4);
  });

  it('A sheet with one edge held 0.1 above the table with the rest free curls and settles smoothly (no kinks, strain bounded)', () => {
    const fold = createSquareSheet(1, 1);
    const mesh = createMeshFromFold(fold, { targetEdgeLength: 0.10 });

    const thickness = 0.002;
    const targetZ = thickness / 2; // 0.001
    const heldHeight = 0.10;

    // Pin left edge (x <= 1e-4) at heldHeight = 0.10
    const fixedPins = new Set<number>();
    for (let i = 0; i < mesh.numVertices; i++) {
      const x = mesh.positions[i * 3 + 0];
      if (x <= 1e-4) {
        fixedPins.add(i);
        mesh.positions[i * 3 + 2] = heldHeight;
      } else {
        mesh.positions[i * 3 + 2] = heldHeight;
      }
    }

    const solver = new XPBDSolver(mesh, {
      substeps: 12,
      iterations: 2,
      enableTable: true,
      tableZ: 0.0,
      paperThickness: thickness,
      enableGravity: true,
      gravity: 2.0,
      bendingCompliance: 0.001, // Standard paper bending compliance
      fixedVertices: fixedPins,
      velocityDamping: 0.98,
      contactDamping: 0.25,
    });

    // Simulate 200 frames until curl settles on table
    for (let f = 0; f < 200; f++) {
      solver.step(0.016);
    }

    assertFinite(mesh);

    // 1. Verify fixed edge remained at held height 0.10
    for (const p of fixedPins) {
      expect(mesh.positions[p * 3 + 2]).toBeCloseTo(heldHeight, 4);
    }

    // 2. Free edge (x >= 0.99) rests on table at targetZ
    let freeEdgeMaxZ = -Infinity;
    let freeEdgeMinZ = Infinity;
    for (let i = 0; i < mesh.numVertices; i++) {
      const x = mesh.positions[i * 3 + 0];
      if (x >= 0.99) {
        const z = mesh.positions[i * 3 + 2];
        if (z > freeEdgeMaxZ) freeEdgeMaxZ = z;
        if (z < freeEdgeMinZ) freeEdgeMinZ = z;
      }
    }
    console.log(`[Curl Test] Free edge settled Z: [${freeEdgeMinZ.toFixed(5)}, ${freeEdgeMaxZ.toFixed(5)}] (table target: ${targetZ})`);
    expect(freeEdgeMinZ).toBeGreaterThanOrEqual(targetZ - 1e-5);
    expect(freeEdgeMaxZ).toBeLessThan(targetZ + 5e-3);

    // 3. Smooth developable curl without kinks: check all facet hinge dihedral angles
    let maxDihedralDeg = 0;
    for (const h of mesh.hinges) {
      const angle = (computeDihedralAngle(h, mesh.positions) * 180) / Math.PI;
      if (Math.abs(angle) > maxDihedralDeg) maxDihedralDeg = Math.abs(angle);
    }
    console.log(`[Curl Test] Max Hinge Dihedral Angle = ${maxDihedralDeg.toFixed(2)}° (smooth curl, no sharp kinks)`);
    // For a smooth curve spanning 10 segments over height 0.1m, average angle is ~10-15° per segment. No sharp kink > 60°
    expect(maxDihedralDeg).toBeLessThan(45.0);

    // 4. Strain bounded < 0.5%
    const maxStrain = solver.getMaxStrain();
    console.log(`[Curl Test] Max Strain = ${(maxStrain * 100).toFixed(4)}%`);
    expect(maxStrain).toBeLessThan(0.005);
  });

  it('Friction: a sheet given a sideways velocity stops, and a high-mu sheet stops sooner than a low-mu sheet', () => {
    const foldA = createSquareSheet(1, 1);
    const meshA = createMeshFromFold(foldA, { targetEdgeLength: 0.10 });
    const foldB = createSquareSheet(1, 1);
    const meshB = createMeshFromFold(foldB, { targetEdgeLength: 0.10 });

    const thickness = 0.002;
    const targetZ = thickness / 2;

    // Place both flat on table
    for (let i = 0; i < meshA.numVertices; i++) {
      meshA.positions[i * 3 + 2] = targetZ;
      meshB.positions[i * 3 + 2] = targetZ;
      // Sideways initial velocity v_x = 0.6 m/s
      meshA.velocities[i * 3 + 0] = 0.6;
      meshB.velocities[i * 3 + 0] = 0.6;
    }

    // Low friction solver
    const solverLow = new XPBDSolver(meshA, {
      substeps: 10,
      iterations: 2,
      enableTable: true,
      paperThickness: thickness,
      enableGravity: true,
      gravity: 2.0,
      muStatic: 0.1,
      muKinetic: 0.05,
      contactDamping: 0.05,
      velocityDamping: 0.999,
    });

    // High friction solver
    const solverHigh = new XPBDSolver(meshB, {
      substeps: 10,
      iterations: 2,
      enableTable: true,
      paperThickness: thickness,
      enableGravity: true,
      gravity: 2.0,
      muStatic: 0.8,
      muKinetic: 0.6,
      contactDamping: 0.35,
      velocityDamping: 0.999,
    });

    let stopFrameLow = -1;
    let stopFrameHigh = -1;
    const initialXA = meshA.positions[0];
    const initialXB = meshB.positions[0];

    for (let f = 0; f < 150; f++) {
      solverLow.step(0.016);
      solverHigh.step(0.016);

      const vxA = Math.abs(meshA.velocities[0]);
      const vxB = Math.abs(meshB.velocities[0]);

      if (stopFrameHigh === -1 && vxB < 1e-3) {
        stopFrameHigh = f;
      }
      if (stopFrameLow === -1 && vxA < 1e-3) {
        stopFrameLow = f;
      }
    }

    assertFinite(meshA);
    assertFinite(meshB);

    const distA = meshA.positions[0] - initialXA;
    const distB = meshB.positions[0] - initialXB;

    console.log(`[Friction Test] Low-Mu: stopped at frame ${stopFrameLow}, distance = ${distA.toFixed(4)} m`);
    console.log(`[Friction Test] High-Mu: stopped at frame ${stopFrameHigh}, distance = ${distB.toFixed(4)} m`);

    // High-mu must stop sooner and travel shorter distance than low-mu
    expect(stopFrameHigh).toBeGreaterThan(0);
    expect(stopFrameLow).toBeGreaterThan(0);
    expect(stopFrameHigh).toBeLessThan(stopFrameLow);
    expect(distB).toBeLessThan(distA);
  });

  it('Stability: 60 s of simulated time resting gives no drift (max vertex speed below threshold), assertFinite called', () => {
    const fold = createSquareSheet(1, 1);
    const mesh = createMeshFromFold(fold, { targetEdgeLength: 0.10 });

    const thickness = 0.002;
    const targetZ = thickness / 2;

    // Place resting on table
    for (let i = 0; i < mesh.numVertices; i++) {
      mesh.positions[i * 3 + 2] = targetZ;
      mesh.velocities[i * 3 + 0] = 0;
      mesh.velocities[i * 3 + 1] = 0;
      mesh.velocities[i * 3 + 2] = 0;
    }

    const solver = new XPBDSolver(mesh, {
      substeps: 10,
      iterations: 2,
      enableTable: true,
      paperThickness: thickness,
      enableGravity: true,
      gravity: 1.0,
      muStatic: 0.5,
      muKinetic: 0.4,
      velocityDamping: 0.995,
      contactDamping: 0.2,
    });

    const initX0 = mesh.positions[0];
    const initY0 = mesh.positions[1];

    // 60 seconds simulated time at dt = 0.016 s = 3750 frames
    const N_FRAMES = 3750;
    const t0 = performance.now();
    for (let f = 0; f < N_FRAMES; f++) {
      solver.step(0.016);
    }
    const elapsedWallMs = performance.now() - t0;

    assertFinite(mesh);

    // Compute max vertex speed
    let maxSpeed = 0;
    for (let i = 0; i < mesh.numVertices; i++) {
      const vx = mesh.velocities[i * 3 + 0];
      const vy = mesh.velocities[i * 3 + 1];
      const vz = mesh.velocities[i * 3 + 2];
      const speed = Math.hypot(vx, vy, vz);
      if (speed > maxSpeed) maxSpeed = speed;
    }

    const driftX = Math.abs(mesh.positions[0] - initX0);
    const driftY = Math.abs(mesh.positions[1] - initY0);
    const finalZ = mesh.positions[2];

    console.log(`[60s Stability Test] 3750 frames executed in ${elapsedWallMs.toFixed(1)} ms (${(elapsedWallMs / N_FRAMES).toFixed(2)} ms/frame)`);
    console.log(`  Max vertex speed: ${maxSpeed.toExponential(3)} m/s (Limit: 1e-4 m/s)`);
    console.log(`  Drift: dx = ${driftX.toExponential(3)} m, dy = ${driftY.toExponential(3)} m`);
    console.log(`  Table Z: ${finalZ.toFixed(6)} m (target: ${targetZ})`);

    expect(maxSpeed).toBeLessThan(1e-4);
    expect(driftX).toBeLessThan(1e-4);
    expect(driftY).toBeLessThan(1e-4);
    expect(Math.abs(finalZ - targetZ)).toBeLessThan(1e-4);
    expect(solver.getMaxStrain()).toBeLessThan(0.001);
  }, 30000); // 30s timeout
});
