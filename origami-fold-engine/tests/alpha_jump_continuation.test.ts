import { describe, expect, it } from 'vitest';
import { createWaterbombBasePattern } from '../../src/engine/fold';
import { createMeshFromFold, rampRestAngles } from '../../src/engine/mesh';
import { BarHingeSolver } from '../../src/engine/physics';
import { TriMesh } from '../../src/engine/types';

describe('Phase 5.5 Requirement 3: Alpha Jumps & Rapid Scrubbing Continuation Tests', () => {
  function verifyNoNaN(mesh: TriMesh): boolean {
    for (let i = 0; i < mesh.numVertices * 3; i++) {
      if (Number.isNaN(mesh.positions[i]) || !Number.isFinite(mesh.positions[i])) return false;
      if (Number.isNaN(mesh.velocities[i]) || !Number.isFinite(mesh.velocities[i])) return false;
    }
    return true;
  }

  it(
    'tests instant jumps (0 -> 1, 1 -> 0) and rapid scrubbing on 121- and 441-vertex meshes',
    { timeout: 30000 },
    () => {
      const fold = createWaterbombBasePattern(1);

      const testMeshes = [
        { name: '121 Vertices', targetLen: 0.1 },
        { name: '441 Vertices', targetLen: 0.05 },
      ];

      for (const tm of testMeshes) {
        const mesh = createMeshFromFold(fold, {
          targetEdgeLength: tm.targetLen,
          axialStiffness: 20000,
          creaseStiffness: 20,
          facetStiffness: 100,
        });

        // Pin center vertex
        const center = Math.floor(mesh.numVertices / 2);
        mesh.positions[center * 3 + 2] = 0.01; // initial seed

        const solver = new BarHingeSolver(mesh, {
          damping: 0.95,
          fixedVertices: new Set([center]),
        });

        let currentAlpha = 0;
        let targetAlpha = 0;
        const alphaSlewRate = 0.02; // max deltaAlpha per tick

        function slewAndStep(ticks: number, newTarget: number) {
          targetAlpha = newTarget;
          let maxObservedStrain = 0;
          let maxObservedForce = 0;

          for (let t = 0; t < ticks; t++) {
            // Continuation ramping
            if (Math.abs(currentAlpha - targetAlpha) > 1e-5) {
              if (currentAlpha < targetAlpha) {
                currentAlpha = Math.min(targetAlpha, currentAlpha + alphaSlewRate);
              } else {
                currentAlpha = Math.max(targetAlpha, currentAlpha - alphaSlewRate);
              }
              rampRestAngles(mesh, currentAlpha);
            }

            // Substeps within tick
            for (let sub = 0; sub < 15; sub++) {
              solver.step();
            }

            expect(verifyNoNaN(mesh)).toBe(true);
            const strain = solver.getMaxStrain();
            const force = solver.getMaxResidualForce();
            if (strain > maxObservedStrain) maxObservedStrain = strain;
            if (force > maxObservedForce) maxObservedForce = force;
          }

          return { maxObservedStrain, maxObservedForce, finalAlpha: currentAlpha };
        }

        // 1. Instant jump 0 -> 1
        const resJump0to1 = slewAndStep(60, 1.0);
        expect(resJump0to1.finalAlpha).toBeCloseTo(1.0, 2);
        expect(resJump0to1.maxObservedStrain).toBeLessThan(1.0); // Transient strain bounded (< 100%), no NaN
        expect(resJump0to1.maxObservedForce).toBeLessThan(25000); // Bounded forces (< 25000 N), no NaN/explosion
        expect(verifyNoNaN(mesh)).toBe(true);

        // 2. Instant jump 1 -> 0
        const resJump1to0 = slewAndStep(60, 0.0);
        expect(resJump1to0.finalAlpha).toBeCloseTo(0.0, 2);
        expect(resJump1to0.maxObservedStrain).toBeLessThan(1.0);
        expect(verifyNoNaN(mesh)).toBe(true);

        // 3. Rapid back-and-forth scrubbing: 0 -> 0.8 -> 0.2 -> 1.0 -> 0.1 -> 0.7
        const scrubTargets = [0.8, 0.2, 1.0, 0.1, 0.7];
        for (const scrubTarget of scrubTargets) {
          const resScrub = slewAndStep(20, scrubTarget);
          expect(resScrub.maxObservedStrain).toBeLessThan(1.0);
          expect(verifyNoNaN(mesh)).toBe(true);
        }

        console.log(`[Alpha Jump & Continuation Test - ${tm.name}] Passed without NaN: Max Transient Strain = ${(resJump0to1.maxObservedStrain * 100).toFixed(2)}%, Force = ${resJump0to1.maxObservedForce.toFixed(2)} N.`);
      }
    }
  );
});
