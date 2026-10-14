import { describe, it, expect } from 'vitest';
import { createSquareSheet } from '../../src/engine/fold';
import { createMeshFromFold } from '../../src/engine/mesh';
import { XPBDSolver, computeDihedralAngle, assertFinite } from '../../src/engine/physics';

describe('Held Edge Profile: Tissue, Standard, Card Comparison', () => {
  it('measures z-profile, max dihedral, and lift-off for tissue, standard, card presets', { timeout: 60000 }, () => {
    // We compare presets under:
    // 1) Simple hinge support (pinning x=0): sheet pivots like an inclined ramp with gravity sag
    // 2) Clamped horizontal support (pinning x <= 0.10 at z=0.10 horizontal): forces elastica cantilever curl

    const presets = [
      { name: 'Tissue', compliance: 0.05, stiffnessNm: 20 },
      { name: 'Standard', compliance: 0.001, stiffnessNm: 1000 },
      { name: 'Card', compliance: 0.00001, stiffnessNm: 100000 },
    ];

    console.log('\n========================================================================================');
    console.log('       PHASE 6.5 REQ 3: HELD-EDGE TEST PROFILE & PRESETS COMPARISON                      ');
    console.log('========================================================================================');

    for (const mode of ['Simple-Hinge (x=0 pinned)', 'Clamped-Horizontal (x<=0.10 pinned)']) {
      console.log(`\n--- MODE: ${mode} ---`);
      console.log('Preset   | Held(0%) | 10%    | 25%    | 50%    | 75%    | Free(100%) | Max Dihedral | Lift-off Distance');
      console.log('---------+----------+--------+--------+--------+--------+------------+--------------+------------------');

      for (const p of presets) {
        // Use a fine mesh targetEdgeLength=0.05 to capture exact 10%, 25%, 50%, 75%, 100%
        const fold = createSquareSheet(1, 1);
        const mesh = createMeshFromFold(fold, { targetEdgeLength: 0.05 });

        const thickness = 0.002;
        const targetZ = thickness / 2; // 0.001m
        const heldHeight = 0.10;

        const fixedPins = new Set<number>();
        for (let i = 0; i < mesh.numVertices; i++) {
          const x = mesh.positions[i * 3 + 0];
          if (mode.startsWith('Simple-Hinge')) {
            if (x <= 1e-4) {
              fixedPins.add(i);
              mesh.positions[i * 3 + 2] = heldHeight;
            }
          } else {
            if (x <= 0.10 + 1e-4) {
              fixedPins.add(i);
              mesh.positions[i * 3 + 2] = heldHeight;
            }
          }
        }

        const solver = new XPBDSolver(mesh, {
          substeps: 6,
          iterations: 1,
          distanceIterations: 3,
          enableTable: true,
          tableZ: 0.0,
          paperThickness: thickness,
          enableGravity: true,
          gravity: 4.0,
          bendingCompliance: p.compliance,
          fixedVertices: fixedPins,
          velocityDamping: 0.98,
          contactDamping: 0.3,
        });

        // Initialize sheet resting flat on table
        for (let i = 0; i < mesh.numVertices; i++) {
          mesh.positions[i * 3 + 2] = targetZ;
        }

        // Quasistatic smooth lift of held edge to avoid unphysical 123% tensile shock wave
        const LIFT_FRAMES = 30;
        const SETTLE_FRAMES = 50;
        let peakZFreeDuringSim = -Infinity;
        let peakSpeedDuringSim = 0;

        for (let f = 0; f < LIFT_FRAMES + SETTLE_FRAMES; f++) {
          if (f < LIFT_FRAMES) {
            const curHeldZ = targetZ + (heldHeight - targetZ) * ((f + 1) / LIFT_FRAMES);
            for (const pin of fixedPins) {
              mesh.positions[pin * 3 + 2] = curHeldZ;
            }
          }

          solver.step(0.016);

          for (let i = 0; i < mesh.numVertices; i++) {
            const z = mesh.positions[i * 3 + 2];
            const vx = mesh.velocities[i * 3 + 0];
            const vy = mesh.velocities[i * 3 + 1];
            const vz = mesh.velocities[i * 3 + 2];
            const spd = Math.hypot(vx, vy, vz);
            if (spd > peakSpeedDuringSim) peakSpeedDuringSim = spd;
            if (!fixedPins.has(i)) {
              if (z > peakZFreeDuringSim) peakZFreeDuringSim = z;
            }
          }
        }
        assertFinite(mesh);

        // Core Physical Assertion: No free vertex may rise above held height under downward gravity
        expect(peakZFreeDuringSim).toBeLessThanOrEqual(heldHeight + 1e-4);

        // Compute Z profile at exact percentage buckets along sheet material coordinates
        function getAvgZ(targetFrac: number): number {
          let sum = 0, count = 0;
          for (let i = 0; i < mesh.numVertices; i++) {
            const u = mesh.uvs[i * 2 + 0];
            if (Math.abs(u - targetFrac) < 0.026) {
              sum += mesh.positions[i * 3 + 2];
              count++;
            }
          }
          return count > 0 ? sum / count : 0.001;
        }

        const z0 = getAvgZ(0.0);
        const z10 = getAvgZ(0.10);
        const z25 = getAvgZ(0.25);
        const z50 = getAvgZ(0.50);
        const z75 = getAvgZ(0.75);
        const z100 = getAvgZ(1.0);

        // Max facet dihedral angle
        let maxDihedralDeg = 0;
        for (const h of mesh.hinges) {
          const angle = (computeDihedralAngle(h, mesh.positions) * 180) / Math.PI;
          if (Math.abs(angle) > maxDihedralDeg) maxDihedralDeg = Math.abs(angle);
        }

        // Lift-off distance: distance from held edge where paper touches table (z <= targetZ + 0.001m)
        let liftOffX = 1.0;
        for (let i = 0; i < mesh.numVertices; i++) {
          const x = mesh.positions[i * 3 + 0];
          const z = mesh.positions[i * 3 + 2];
          if (z <= targetZ + 0.001) {
            if (x < liftOffX) liftOffX = x;
          }
        }
        const liftOffDistFromHeld = liftOffX;

        // In Mode A (Simple Hinge), compare against rigid-ramp height z_ramp(x) = heldHeight - (heldHeight - targetZ)*(x/liftOffX)
        if (mode.startsWith('Simple-Hinge')) {
          const rigidRampZ10 = heldHeight - (heldHeight - targetZ) * (0.10 / liftOffDistFromHeld);
          const rigidRampZ25 = heldHeight - (heldHeight - targetZ) * (0.25 / liftOffDistFromHeld);
          // Due to downward gravity catenary sag, actual z must be <= rigid ramp
          expect(z10).toBeLessThanOrEqual(rigidRampZ10 + 1e-3);
          expect(z25).toBeLessThanOrEqual(rigidRampZ25 + 1e-3);
        }

        console.log(
          `${p.name.padEnd(8)} | ${z0.toFixed(4)}   | ${z10.toFixed(4)} | ${z25.toFixed(4)} | ${z50.toFixed(4)} | ${z75.toFixed(4)} | ${z100.toFixed(4)}     | ${(maxDihedralDeg.toFixed(2) + '°').padStart(12)} | ${liftOffDistFromHeld.toFixed(3)} m`
        );
      }
    }
    console.log('========================================================================================\n');
  });
});
