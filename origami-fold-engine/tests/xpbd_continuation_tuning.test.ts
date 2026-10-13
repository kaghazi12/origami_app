import { describe, it, expect } from 'vitest';
import { createWaterbombBasePattern } from '../../src/engine/fold/templates';
import { createMeshFromFold, rampRestAngles } from '../../src/engine/mesh/mesh';
import { XPBDSolver } from '../../src/engine/physics/xpbd';
import { assertFinite } from '../../src/engine/physics/validation';

describe('Phase 5.7 Requirement 5: Adaptive Continuation Tuning for XPBD', () => {
  it('measures time (ms and frames) to reach alpha=1 from alpha=0 on an instant 0->1 jump for XPBD at 121V and 441V, ensuring <= 1.5s', () => {
    const foldWb = createWaterbombBasePattern(1);
    for (let i = 0; i < foldWb.edges_vertices.length; i++) {
      const [u, v] = foldWb.edges_vertices[i];
      if ((u === 1 && v === 8) || (u === 8 && v === 5) || (u === 8 && v === 1) || (u === 5 && v === 8)) {
        foldWb.edges_foldAngle![i] = 0;
        foldWb.edges_assignment[i] = 'F';
      } else if (foldWb.edges_assignment[i] === 'V') {
        foldWb.edges_foldAngle![i] = 177;
      } else if (foldWb.edges_assignment[i] === 'M') {
        foldWb.edges_foldAngle![i] = -177;
      }
    }

    const testConfigs = [
      { name: '121 Vertices', targetLen: 0.10, maxAllowedWallMs: 1500 },
      { name: '441 Vertices', targetLen: 0.05, maxAllowedWallMs: 1500 },
    ];

    console.log('\n======================================================================================================================');
    console.log('                 PHASE 5.7: ADAPTIVE CONTINUATION TUNING (INSTANT 0 -> 1.0 JUMP)                                      ');
    console.log('======================================================================================================================');
    console.log('Model & Vertices | Frames to alpha=1 | Sim Time (s) | Wall-Clock (ms) | Max Transient Strain | Target Met? (<= 1.5s)');
    console.log('-----------------+-------------------+--------------+-----------------+----------------------+----------------------');

    for (const cfg of testConfigs) {
      const mesh = createMeshFromFold(foldWb, {
        targetEdgeLength: cfg.targetLen,
        axialStiffness: 40000,
        creaseStiffness: 40,
        facetStiffness: 200,
      });

      const center = Math.floor(mesh.numVertices / 2);
      mesh.positions[center * 3 + 2] = 0.02; // Out-of-plane perturbation

      const solver = new XPBDSolver(mesh, {
        substeps: 10,
        iterations: 2, // 2 iterations per substep enables fast distance relaxation
        velocityDamping: 0.995,
        fixedVertices: new Set([center]),
      });

      // Target alpha = 1.0 (Instant jump)
      let currentAlpha = 0;
      const targetAlpha = 1.0;
      let frameCount = 0;
      let maxTransientStrain = 0;
      const maxFramesBudget = 300; // max 5 seconds at 60fps
      const strainThreshold = 0.04; // 4.0% strain gate allows passing through 3D bifurcation smoothly
      const baseAlphaStep = 0.025;  // 2.5% alpha increment per frame (~40 frames / ~0.67s ideal)

      const t0 = performance.now();

      while (currentAlpha < targetAlpha - 1e-4 && frameCount < maxFramesBudget) {
        frameCount++;

        const currentStrain = solver.getMaxStrain();
        if (currentStrain > maxTransientStrain) maxTransientStrain = currentStrain;

        // Adaptive Continuation: advance alpha only if strain is strictly below gate
        if (currentStrain < strainThreshold) {
          const strainMargin = Math.max(0.1, 1.0 - currentStrain / strainThreshold);
          const alphaIncrement = baseAlphaStep * strainMargin;
          currentAlpha = Math.min(targetAlpha, currentAlpha + alphaIncrement);
          rampRestAngles(mesh, currentAlpha);
        }

        // Run frame simulation step
        solver.step(0.016);
      }

      const wallMs = performance.now() - t0;
      const simTimeSec = frameCount * 0.016;

      assertFinite(mesh);

      const meetsTarget = wallMs <= cfg.maxAllowedWallMs;
      console.log(
        `${cfg.name.padEnd(16)} | ${String(frameCount).padStart(17)} | ${(simTimeSec.toFixed(3) + ' s').padStart(12)} | ${(wallMs.toFixed(1) + ' ms').padStart(15)} | ${((maxTransientStrain * 100).toFixed(4) + '%').padStart(20)} | ${meetsTarget ? 'YES (<= 1.5s) ✓' : 'NO ×'}`
      );

      expect(currentAlpha).toBeGreaterThanOrEqual(0.99);
      expect(wallMs).toBeLessThanOrEqual(cfg.maxAllowedWallMs);
      expect(maxTransientStrain).toBeLessThan(0.10); // Strain bounded strictly below 10% (vs DR's 52-66%)
    }
    console.log('======================================================================================================================\n');
  });
});
