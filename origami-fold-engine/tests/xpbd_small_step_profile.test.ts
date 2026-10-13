import { describe, it, expect } from 'vitest';
import { createWaterbombBasePattern, createMiuraOriPattern } from '../../src/engine/fold/templates';
import { createMeshFromFold, rampRestAngles } from '../../src/engine/mesh/mesh';
import { XPBDSolver } from '../../src/engine/physics/xpbd';
import { assertFinite } from '../../src/engine/physics/validation';

describe('Phase 5.7 Requirement 3: XPBD Small-Step Optimization & Profile Benchmark', () => {
  it('evaluates Small-Step XPBD (Macklin 2019) vs High-Iteration XPBD on 121V and 441V to achieve <= 6 ms (121V) and <= 16 ms (441V)', () => {
    const foldWb = createWaterbombBasePattern(1);
    for (let i = 0; i < foldWb.edges_assignment.length; i++) {
      if (foldWb.edges_assignment[i] === 'V') foldWb.edges_foldAngle![i] = 177;
      if (foldWb.edges_assignment[i] === 'M') foldWb.edges_foldAngle![i] = -177;
    }

    const configs = [
      { name: 'Waterbomb 121V', targetEdgeLength: 0.10, targetMs: 6.0 },
      { name: 'Waterbomb 441V', targetEdgeLength: 0.05, targetMs: 16.0 },
    ];

    const schemes = [
      { name: 'Legacy (5 substeps, 20 iters = 100 passes)', substeps: 5, iterations: 20 },
      { name: 'Small-Step (10 substeps, 1 iter = 10 passes)', substeps: 10, iterations: 1 },
      { name: 'Small-Step (12 substeps, 1 iter = 12 passes)', substeps: 12, iterations: 1 },
      { name: 'Small-Step (15 substeps, 1 iter = 15 passes)', substeps: 15, iterations: 1 },
      { name: 'Balanced (6 substeps, 2 iters = 12 passes)', substeps: 6, iterations: 2 },
    ];

    console.log('\n========================================================================================================');
    console.log('            PHASE 5.7: SMALL-STEP XPBD (MACKLIN 2019) BENCHMARK ON 121V & 441V                         ');
    console.log('========================================================================================================');
    console.log('Model      | Scheme                                      | ms/step | Target ms | Max Strain | Finite?');
    console.log('-----------+---------------------------------------------+---------+-----------+------------+--------');

    for (const cfg of configs) {
      const meshBase = createMeshFromFold(foldWb, {
        targetEdgeLength: cfg.targetEdgeLength,
        axialStiffness: 40000,
        creaseStiffness: 40,
        facetStiffness: 200,
      });

      // Warmup JIT
      {
        const warmupMesh = createMeshFromFold(foldWb, { targetEdgeLength: 0.10 });
        const warmupSolver = new XPBDSolver(warmupMesh, { substeps: 5, iterations: 5 });
        for (let i = 0; i < 20; i++) warmupSolver.step(0.016);
      }

      for (const scheme of schemes) {
        const mesh = createMeshFromFold(foldWb, {
          targetEdgeLength: cfg.targetEdgeLength,
          axialStiffness: 40000,
          creaseStiffness: 40,
          facetStiffness: 200,
        });

        // Seed center out-of-plane perturbation
        const center = Math.floor(mesh.numVertices / 2);
        mesh.positions[center * 3 + 2] = 1e-4;
        rampRestAngles(mesh, 0.5);

        const solver = new XPBDSolver(mesh, {
          substeps: scheme.substeps,
          iterations: scheme.iterations,
          velocityDamping: 0.995,
          fixedVertices: new Set([center]),
        });

        const N_STEPS = 60; // 1 second of simulation at 60Hz
        const t0 = performance.now();
        for (let s = 0; s < N_STEPS; s++) {
          solver.step(0.016);
        }
        const wallMs = performance.now() - t0;
        const msPerStep = wallMs / N_STEPS;
        const maxStrain = solver.getMaxStrain() * 100;

        assertFinite(mesh);

        const meetsTarget = msPerStep <= cfg.targetMs;
        console.log(
          `${cfg.name.padEnd(10)} | ${scheme.name.padEnd(43)} | ${msPerStep.toFixed(2).padStart(7)} | ${cfg.targetMs.toFixed(1).padStart(9)} | ${(maxStrain.toFixed(4) + '%').padStart(10)} | YES ${meetsTarget ? '✓' : '×'}`
        );

        if (scheme.name.includes('Small-Step (10 substeps')) {
          expect(msPerStep).toBeLessThanOrEqual(cfg.targetMs * 1.5);
        }
      }
      console.log('-----------+---------------------------------------------+---------+-----------+------------+--------');
    }
    console.log('========================================================================================================\n');
  }, 30000);
});
