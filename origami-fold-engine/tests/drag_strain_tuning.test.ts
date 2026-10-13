import { describe, it } from 'vitest';
import { createWaterbombBasePattern } from '../../src/engine/fold';
import { createMeshFromFold } from '../../src/engine/mesh';
import { XPBDSolver, assertFinite } from '../../src/engine/physics';

describe('Phase 6.5: Strain Under Drag Diagnosis and Tuning', () => {
  it('benchmarks drag strain vs ms/frame across configurations at 121V and 441V', () => {
    const meshConfigs = [
      { name: '121 Vertices', targetEdgeLength: 0.10 },
      { name: '441 Vertices', targetEdgeLength: 0.05 },
    ];

    const solverConfigs = [
      { name: 'Cfg 1: 10 sub, 1 iter, 4 dist', substeps: 10, iterations: 1, distanceIterations: 4 },
      { name: 'Cfg 2: 10 sub, 1 iter, 6 dist', substeps: 10, iterations: 1, distanceIterations: 6 },
      { name: 'Cfg 3: 10 sub, 1 iter, 8 dist', substeps: 10, iterations: 1, distanceIterations: 8 },
      { name: 'Cfg 4: 12 sub, 1 iter, 6 dist', substeps: 12, iterations: 1, distanceIterations: 6 },
      { name: 'Cfg 5: 12 sub, 1 iter, 8 dist', substeps: 12, iterations: 1, distanceIterations: 8 },
    ];

    console.log('\n===========================================================================================================');
    console.log('       PHASE 6.5 REQ 2: STRAIN VS MS/FRAME TUNING UNDER DRAG LOAD (441V < 1% Strain & < 16 ms/frame)       ');
    console.log('===========================================================================================================');
    console.log('Mesh         | Configuration                 | ms/frame | Substep ms | Max Strain (%) | Finite? | Pass (<1% & <16ms)');
    console.log('-------------+-------------------------------+----------+------------+----------------+---------+-------------------');

    for (const mCfg of meshConfigs) {
      for (const sCfg of solverConfigs) {
        const fold = createWaterbombBasePattern(1);
        const mesh = createMeshFromFold(fold, { targetEdgeLength: mCfg.targetEdgeLength });

        const solver = new XPBDSolver(mesh, {
          substeps: sCfg.substeps,
          iterations: sCfg.iterations,
          distanceIterations: sCfg.distanceIterations,
          fixedVertices: [0], // Pin P = vertex 0 at (0,0)
        });

        // Corner drag Q = vertex at (1, 0)
        let vQ = -1;
        let minD = Infinity;
        for (let i = 0; i < mesh.numVertices; i++) {
          const u = mesh.uvs[i * 2 + 0];
          const v = mesh.uvs[i * 2 + 1];
          const d = Math.hypot(u - 1, v - 0);
          if (d < minD) { minD = d; vQ = i; }
        }

        // Drag target at 0.90 of rest distance with slight lift
        const qTarget: [number, number, number] = [0.90, 0.0, 0.05];
        solver.setDragTarget(vQ, qTarget);

        // Warm up JIT
        for (let f = 0; f < 5; f++) solver.step(0.016);

        // Measure 40 frames of drag simulation
        const N_FRAMES = 40;
        const t0 = performance.now();
        for (let f = 0; f < N_FRAMES; f++) {
          solver.step(0.016);
        }
        const totalMs = performance.now() - t0;
        const msPerFrame = totalMs / N_FRAMES;
        const msPerSubstep = msPerFrame / sCfg.substeps;
        const maxStrain = solver.getMaxStrain() * 100;

        assertFinite(mesh);
        const pass = (maxStrain < 1.0 && msPerFrame < 16.0) ? 'PASS ✓' : 'FAIL ✗';

        console.log(
          `${mCfg.name.padEnd(12)} | ${sCfg.name.padEnd(29)} | ${msPerFrame.toFixed(2).padStart(8)} | ${msPerSubstep.toFixed(3).padStart(10)} | ${(maxStrain.toFixed(4) + '%').padStart(14)} | YES ✓   | ${pass}`
        );
      }
    }
    console.log('===========================================================================================================\n');
  });
});
