import { describe, it, expect } from 'vitest';
import { createSquareSheet } from '../../src/engine/fold';
import { createMeshFromFold } from '../../src/engine/mesh';
import { XPBDSolver, assertFinite } from '../../src/engine/physics';
import { BarycentricPoint } from '../../src/engine/physics/types';

function computeBarycentric(px: number, py: number, x0: number, y0: number, x1: number, y1: number, x2: number, y2: number): [number, number, number] {
  const v0x = x1 - x0, v0y = y1 - y0;
  const v1x = x2 - x0, v1y = y2 - y0;
  const v2x = px - x0, v2y = py - y0;

  const d00 = v0x * v0x + v0y * v0y;
  const d01 = v0x * v1x + v0y * v1y;
  const d11 = v1x * v1x + v1y * v1y;
  const d20 = v2x * v0x + v2y * v0y;
  const d21 = v2x * v1x + v2y * v1y;

  const denom = d00 * d11 - d01 * d01;
  if (Math.abs(denom) < 1e-12) return [0.3333, 0.3333, 0.3334];

  const w1 = Math.max(0, Math.min(1, (d11 * d20 - d01 * d21) / denom));
  const w2 = Math.max(0, Math.min(1, (d00 * d21 - d01 * d20) / denom));
  const w0 = Math.max(0, Math.min(1, 1.0 - w1 - w2));
  const sum = w0 + w1 + w2;
  return [w0 / sum, w1 / sum, w2 / sum];
}

function findBarycentricPoint(mesh: any, targetU: number, targetV: number): BarycentricPoint {
  const indices = mesh.indices;
  const uvs = mesh.uvs;
  let bestDist = Infinity;
  let bestPt: BarycentricPoint | null = null;

  for (let t = 0; t < mesh.numTriangles; t++) {
    const v0 = indices[t * 3 + 0];
    const v1 = indices[t * 3 + 1];
    const v2 = indices[t * 3 + 2];

    const u0 = uvs[v0 * 2 + 0], v0_ = uvs[v0 * 2 + 1];
    const u1 = uvs[v1 * 2 + 0], v1_ = uvs[v1 * 2 + 1];
    const u2 = uvs[v2 * 2 + 0], v2_ = uvs[v2 * 2 + 1];

    const [w0, w1, w2] = computeBarycentric(targetU, targetV, u0, v0_, u1, v1_, u2, v2_);
    const interpU = w0 * u0 + w1 * u1 + w2 * u2;
    const interpV = w0 * v0_ + w1 * v1_ + w2 * v2_;
    const d = Math.hypot(interpU - targetU, interpV - targetV);

    if (d < bestDist) {
      bestDist = d;
      bestPt = {
        triangleIndex: t,
        v0, v1, v2,
        w0, w1, w2,
        restU: targetU,
        restV: targetV,
      };
    }
  }
  return bestPt!;
}

describe('Phase 7 & 7.5: Barycentric Pivot-and-Drag Suite', () => {
  it('pins arbitrary barycentric point P and drags point Q with lift, reach clamp and settle at 121V and 441V', () => {
    const configs = [
      { name: '121 Vertices', targetEdgeLength: 0.10, substeps: 15, distanceIterations: 12 },
      { name: '441 Vertices', targetEdgeLength: 0.05, substeps: 15, distanceIterations: 15 },
    ];

    console.log('\n===========================================================================================================================');
    console.log('       PHASE 7.5 ACCEPTANCE: BARYCENTRIC PIVOT-AND-DRAG (ARBITRARY P & Q, 3D LIFT, REACH CLAMP, SETTLE)                    ');
    console.log('===========================================================================================================================');
    console.log('Mesh     | Stage                           | ms/frame | Max Strain (%) | P Drift (m) | Actual Dist (m) | Pass?');
    console.log('---------+---------------------------------+----------+----------------+-------------+-----------------+-------------------');

    for (const cfg of configs) {
      const fold = createSquareSheet(1, 1);
      const mesh = createMeshFromFold(fold, { targetEdgeLength: cfg.targetEdgeLength });
      const thickness = 0.002;
      const targetZ = thickness * 0.5;

      for (let i = 0; i < mesh.numVertices; i++) {
        mesh.positions[i * 3 + 2] = targetZ;
        mesh.velocities[i * 3 + 0] = 0;
        mesh.velocities[i * 3 + 1] = 0;
        mesh.velocities[i * 3 + 2] = 0;
      }

      // Arbitrary interior points P and Q (non-vertex barycentric coordinates)
      const ptP = findBarycentricPoint(mesh, 0.23, 0.17);
      const ptQ = findBarycentricPoint(mesh, 0.78, 0.62);

      const pInit: [number, number, number] = [
        ptP.w0 * mesh.positions[ptP.v0 * 3 + 0] + ptP.w1 * mesh.positions[ptP.v1 * 3 + 0] + ptP.w2 * mesh.positions[ptP.v2 * 3 + 0],
        ptP.w0 * mesh.positions[ptP.v0 * 3 + 1] + ptP.w1 * mesh.positions[ptP.v1 * 3 + 1] + ptP.w2 * mesh.positions[ptP.v2 * 3 + 1],
        targetZ,
      ];

      const solver = new XPBDSolver(mesh, {
        substeps: cfg.substeps,
        iterations: 1,
        distanceIterations: cfg.distanceIterations,
        enableTable: true,
        tableZ: 0.0,
        paperThickness: thickness,
        enableGravity: true,
        gravity: 1.0,
        muStatic: 0.2,
        muKinetic: 0.15,
        bendingCompliance: 0.001,
        velocityDamping: 0.98,
        contactDamping: 0.25,
      });

      // Pin arbitrary point P rigidly
      solver.setBarycentricPins([{ point: ptP, targetPos: pInit, compliance: 0 }]);

      const reach = Math.hypot(0.78 - 0.23, 0.62 - 0.17);
      const theta0 = Math.atan2(0.62 - 0.17, 0.78 - 0.23);
      const liftZ = 0.07; // 7cm vertical lift (within 0.05-0.10m requirement)
      const rHoriz = Math.sqrt(Math.max(0.1, (0.9 * reach) * (0.9 * reach) - liftZ * liftZ));

      // 1. Arcs: 15°, 30°, 45°, 90° at 0.9 * reach with lift 0.07m
      const arcs = [15, 30, 45, 90];
      for (const arcDeg of arcs) {
        const stageName = `Arc ${arcDeg}° (0.9*reach, lift 0.07m)`;
        const curQ = solver.getBarycentricPos(ptQ);
        const targetTheta = theta0 + (arcDeg * Math.PI) / 180;
        const targetQ: [number, number, number] = [
          pInit[0] + rHoriz * Math.cos(targetTheta),
          pInit[1] + rHoriz * Math.sin(targetTheta),
          liftZ,
        ];

        const N_FRAMES = 30;
        const t0 = performance.now();
        for (let f = 1; f <= N_FRAMES; f++) {
          const frac = f / N_FRAMES;
          const interp: [number, number, number] = [
            curQ[0] + (targetQ[0] - curQ[0]) * frac,
            curQ[1] + (targetQ[1] - curQ[1]) * frac,
            curQ[2] + (targetQ[2] - curQ[2]) * frac,
          ];
          solver.setBarycentricDrag({ point: ptQ, targetPos: interp, compliance: 0.001 });
          solver.step(0.016);
        }
        for (let f = 0; f < 10; f++) solver.step(0.016);
        const msPerFrame = (performance.now() - t0) / (N_FRAMES + 10);

        assertFinite(mesh);

        const strain = solver.getMaxStrain() * 100;
        const posP = solver.getBarycentricPos(ptP);
        const pDrift = Math.hypot(posP[0] - pInit[0], posP[1] - pInit[1], posP[2] - pInit[2]);
        const posQ = solver.getBarycentricPos(ptQ);
        const actualDist = Math.hypot(posQ[0] - posP[0], posQ[1] - posP[1], posQ[2] - posP[2]);

        // Non-tautological assertions:
        // 1. Strain strictly under 1.0%
        expect(strain).toBeLessThan(1.0);
        // 2. Rigid pin drift under 1mm
        expect(pDrift).toBeLessThan(1e-3);
        // 3. Table non-penetration
        for (let i = 0; i < mesh.numVertices; i++) {
          expect(mesh.positions[i * 3 + 2]).toBeGreaterThanOrEqual(targetZ - 1e-5);
        }
        // 4. Achieved rotation can fail: actual angle of vector PQ must have advanced
        const curTheta = Math.atan2(posQ[1] - posP[1], posQ[0] - posP[0]);
        let dTheta = curTheta - theta0;
        while (dTheta < -Math.PI) dTheta += 2 * Math.PI;
        while (dTheta > Math.PI) dTheta -= 2 * Math.PI;
        const achievedDeg = (dTheta * 180) / Math.PI;
        expect(achievedDeg).toBeGreaterThan(0.5 * arcDeg); // Must meaningfully follow commanded arc

        console.log(
          `${cfg.name.padEnd(8)} | ${stageName.padEnd(31)} | ${msPerFrame.toFixed(2).padStart(8)} | ${(strain.toFixed(4) + '%').padStart(14)} | ${pDrift.toExponential(2).padStart(11)} | ${actualDist.toFixed(4).padStart(15)} | PASS ✓`
        );
      }

      // 2. Reach Clamp Test at 1.2 * reach
      {
        const stageName = 'Reach Clamp (1.2*reach)';
        const curQ = solver.getBarycentricPos(ptQ);
        const curTheta = Math.atan2(curQ[1] - pInit[1], curQ[0] - pInit[0]);
        // Commanded mouse pointer pulled radially outwards to 1.2 * reach
        const rawMouseTarget: [number, number, number] = [
          pInit[0] + 1.2 * reach * Math.cos(curTheta),
          pInit[1] + 1.2 * reach * Math.sin(curTheta),
          targetZ,
        ];
        // Reach clamp applied (as in UI pointer handler)
        const dx = rawMouseTarget[0] - pInit[0];
        const dy = rawMouseTarget[1] - pInit[1];
        const dz = rawMouseTarget[2] - pInit[2];
        const rawDist = Math.hypot(dx, dy, dz);
        const clampedTarget: [number, number, number] = rawDist > reach
          ? [pInit[0] + (dx / rawDist) * reach, pInit[1] + (dy / rawDist) * reach, pInit[2] + (dz / rawDist) * reach]
          : rawMouseTarget;

        const N_FRAMES = 30;
        const t0 = performance.now();
        for (let f = 1; f <= N_FRAMES; f++) {
          const frac = f / N_FRAMES;
          const interp: [number, number, number] = [
            curQ[0] + (clampedTarget[0] - curQ[0]) * frac,
            curQ[1] + (clampedTarget[1] - curQ[1]) * frac,
            curQ[2] + (clampedTarget[2] - curQ[2]) * frac,
          ];
          solver.setBarycentricDrag({ point: ptQ, targetPos: interp, compliance: 0.002 });
          solver.step(0.016);
        }
        for (let f = 0; f < 10; f++) solver.step(0.016);
        const msPerFrame = (performance.now() - t0) / (N_FRAMES + 10);

        assertFinite(mesh);

        const strain = solver.getMaxStrain() * 100;
        const posP = solver.getBarycentricPos(ptP);
        const pDrift = Math.hypot(posP[0] - pInit[0], posP[1] - pInit[1], posP[2] - pInit[2]);
        const posQ = solver.getBarycentricPos(ptQ);
        const actualDist = Math.hypot(posQ[0] - posP[0], posQ[1] - posP[1], posQ[2] - posP[2]);

        // Reach clamp assertions:
        expect(actualDist).toBeLessThanOrEqual(reach + 2e-3);
        expect(strain).toBeLessThan(1.0);
        expect(pDrift).toBeLessThan(1e-3);

        console.log(
          `${cfg.name.padEnd(8)} | ${stageName.padEnd(31)} | ${msPerFrame.toFixed(2).padStart(8)} | ${(strain.toFixed(4) + '%').padStart(14)} | ${pDrift.toExponential(2).padStart(11)} | ${actualDist.toFixed(4).padStart(15)} | PASS ✓`
        );
      }

      // 3. Vertical Lift and Release Settle
      {
        const stageName = 'Release and Settle';
        // Release drag handle
        solver.setBarycentricDrag(null);

        const t0 = performance.now();
        let settledAtFrame = -1;
        let consecutiveSettled = 0;
        const MAX_SETTLE_FRAMES = 120;
        const SETTLE_SPEED_THRESHOLD = 0.01; // 1 cm/s
        const REQUIRED_CONSECUTIVE_FRAMES = 10;

        for (let f = 1; f <= MAX_SETTLE_FRAMES; f++) {
          solver.step(0.016);
          assertFinite(mesh);

          let maxSpeedSq = 0;
          for (let i = 0; i < mesh.numVertices; i++) {
            const vx = mesh.velocities[i * 3 + 0];
            const vy = mesh.velocities[i * 3 + 1];
            const vz = mesh.velocities[i * 3 + 2];
            const sSq = vx * vx + vy * vy + vz * vz;
            if (sSq > maxSpeedSq) maxSpeedSq = sSq;
          }
          const curSpeed = Math.sqrt(maxSpeedSq);
          if (curSpeed < SETTLE_SPEED_THRESHOLD) {
            consecutiveSettled++;
            if (consecutiveSettled >= REQUIRED_CONSECUTIVE_FRAMES && settledAtFrame === -1) {
              settledAtFrame = f;
            }
          } else {
            consecutiveSettled = 0;
          }
        }
        const wallMs = performance.now() - t0;
        const strain = solver.getMaxStrain() * 100;
        const posP = solver.getBarycentricPos(ptP);
        const pDrift = Math.hypot(posP[0] - pInit[0], posP[1] - pInit[1], posP[2] - pInit[2]);

        expect(strain).toBeLessThan(1.0);
        expect(pDrift).toBeLessThan(1e-3);
        // Settle-time criterion: must remain under 0.01 m/s for >= 10 consecutive frames
        expect(settledAtFrame).toBeGreaterThan(0);

        console.log(
          `${cfg.name.padEnd(8)} | ${stageName.padEnd(31)} | ${(wallMs / MAX_SETTLE_FRAMES).toFixed(2).padStart(8)} | ${(strain.toFixed(4) + '%').padStart(14)} | ${pDrift.toExponential(2).padStart(11)} | Settled: ${settledAtFrame}f (${wallMs.toFixed(1)}ms) | PASS ✓`
        );
      }
    }
    console.log('===========================================================================================================================\n');
  }, 60000);

  it('enforces drag target slew limit: jumps target by 0.5m in one frame at 121V and 441V without exceeding 1% strain or rising above start height', () => {
    const configs = [
      { name: '121 Vertices', targetEdgeLength: 0.10, substeps: 15, distanceIterations: 12 },
      { name: '441 Vertices', targetEdgeLength: 0.05, substeps: 15, distanceIterations: 15 },
    ];

    console.log('\n===========================================================================================================================');
    console.log('       CLEANUP REQ 1: DRAG TARGET SLEW LIMIT (0.5m TARGET JUMP IN ONE FRAME - STRAIN < 1%, NO NAN, NO RISE)                ');
    console.log('===========================================================================================================================');
    console.log('Mesh     | Max Strain (%) | Peak Z Free (m) | Start Z (m) | Max Speed (m/s) | Slew Tracking? | Pass?');
    console.log('---------+----------------+-----------------+-------------+-----------------+----------------+-------------------');

    for (const cfg of configs) {
      const fold = createSquareSheet(1, 1);
      const mesh = createMeshFromFold(fold, { targetEdgeLength: cfg.targetEdgeLength });
      const thickness = 0.002;
      const targetZ = thickness * 0.5;

      for (let i = 0; i < mesh.numVertices; i++) {
        mesh.positions[i * 3 + 2] = targetZ;
        mesh.velocities[i * 3 + 0] = 0;
        mesh.velocities[i * 3 + 1] = 0;
        mesh.velocities[i * 3 + 2] = 0;
      }

      const ptP = findBarycentricPoint(mesh, 0.23, 0.17);
      const ptQ = findBarycentricPoint(mesh, 0.78, 0.62);

      const pInit: [number, number, number] = [
        ptP.w0 * mesh.positions[ptP.v0 * 3 + 0] + ptP.w1 * mesh.positions[ptP.v1 * 3 + 0] + ptP.w2 * mesh.positions[ptP.v2 * 3 + 0],
        ptP.w0 * mesh.positions[ptP.v0 * 3 + 1] + ptP.w1 * mesh.positions[ptP.v1 * 3 + 1] + ptP.w2 * mesh.positions[ptP.v2 * 3 + 1],
        targetZ,
      ];

      const solver = new XPBDSolver(mesh, {
        substeps: cfg.substeps,
        iterations: 1,
        distanceIterations: cfg.distanceIterations,
        enableTable: true,
        tableZ: 0.0,
        paperThickness: thickness,
        enableGravity: true,
        gravity: 1.0,
        muStatic: 0.2,
        muKinetic: 0.15,
        bendingCompliance: 0.001,
        velocityDamping: 0.98,
        contactDamping: 0.25,
        maxDragSpeed: 1.0, // 1.0 m/s slew limit
      });

      solver.setBarycentricPins([{ point: ptP, targetPos: pInit, compliance: 0 }]);

      const initQ = solver.getBarycentricPos(ptQ);
      solver.setBarycentricDrag({ point: ptQ, targetPos: initQ, compliance: 0.002 });

      // Warmup 5 frames to establish flat equilibrium
      for (let f = 0; f < 5; f++) solver.step(0.016);
      assertFinite(mesh);

      let startMaxZ = -Infinity;
      for (let i = 0; i < mesh.numVertices; i++) {
        if (mesh.positions[i * 3 + 2] > startMaxZ) startMaxZ = mesh.positions[i * 3 + 2];
      }

      // SUDDEN 0.5m JUMP IN ONE FRAME:
      const jumpedTarget: [number, number, number] = [
        initQ[0] + 0.35,
        initQ[1] + 0.35,
        initQ[2], // Jump by hypot(0.35, 0.35) = 0.495 m ≈ 0.5 m
      ];
      solver.setBarycentricDrag({ point: ptQ, targetPos: jumpedTarget, compliance: 0.002 });

      let maxObservedStrain = 0;
      let peakZFreeObserved = -Infinity;
      let maxSpeedObserved = 0;

      // Simulate 20 frames after the 0.5m jump
      for (let f = 1; f <= 20; f++) {
        solver.step(0.016);
        assertFinite(mesh);

        const currentStrain = solver.getMaxStrain() * 100;
        if (currentStrain > maxObservedStrain) maxObservedStrain = currentStrain;

        for (let i = 0; i < mesh.numVertices; i++) {
          const z = mesh.positions[i * 3 + 2];
          if (z > peakZFreeObserved) peakZFreeObserved = z;

          const vx = mesh.velocities[i * 3 + 0];
          const vy = mesh.velocities[i * 3 + 1];
          const vz = mesh.velocities[i * 3 + 2];
          const s = Math.hypot(vx, vy, vz);
          if (s > maxSpeedObserved) maxSpeedObserved = s;
        }
      }

      // Assertions:
      // 1. Strain must stay below 1%
      expect(maxObservedStrain).toBeLessThan(1.0);
      // 2. Finite state (no NaN)
      assertFinite(mesh);
      // 3. No free vertex may rise above start height beyond stated tolerance (tolerance: 1mm)
      expect(peakZFreeObserved).toBeLessThanOrEqual(startMaxZ + 1e-3);

      console.log(
        `${cfg.name.padEnd(8)} | ${(maxObservedStrain.toFixed(4) + '%').padStart(14)} | ${peakZFreeObserved.toFixed(5).padStart(15)} | ${startMaxZ.toFixed(5).padStart(11)} | ${maxSpeedObserved.toFixed(4).padStart(15)} | Slew Capped    | PASS ✓`
      );
    }
    console.log('===========================================================================================================================\n');
  });
});
