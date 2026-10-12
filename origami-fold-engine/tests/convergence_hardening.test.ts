import { describe, expect, it } from 'vitest';
import { createWaterbombBasePattern } from '../../src/engine/fold';
import { createMeshFromFold, rampRestAngles } from '../../src/engine/mesh';
import { BarHingeSolver, computeStableTimeStep } from '../../src/engine/physics';
import { TriMesh } from '../../src/engine/types';

describe('Phase 4.6 Requirement 4: Convergence Hardening (Kinetic Damping & Barnes DR)', () => {
  function cloneMesh(m: TriMesh): TriMesh {
    return {
      numVertices: m.numVertices,
      numTriangles: m.numTriangles,
      positions: new Float64Array(m.positions),
      velocities: new Float64Array(m.velocities),
      masses: new Float64Array(m.masses),
      uvs: new Float64Array(m.uvs),
      indices: new Uint32Array(m.indices),
      bars: m.bars.map((b) => ({ ...b })),
      hinges: m.hinges.map((h) => ({ ...h })),
    };
  }

  it(
    'evaluates actual convergence steps for baseline viscous damping vs kinetic damping and mass scaling at 121 and 441 vertices',
    { timeout: 35000 },
    () => {
      const foldWb = createWaterbombBasePattern(1);
      const clampRad = (177 * Math.PI) / 180;
      for (let i = 0; i < foldWb.edges_assignment.length; i++) {
        if (foldWb.edges_assignment[i] === 'V') foldWb.edges_foldAngle![i] = 177;
        if (foldWb.edges_assignment[i] === 'M') foldWb.edges_foldAngle![i] = -177;
      }

      const configs = [
        { name: '121 Vertices (h=0.10)', targetLen: 0.1, expectedV: 121 },
        { name: '441 Vertices (h=0.05)', targetLen: 0.05, expectedV: 441 },
      ];

      console.log('\n========================================================================================');
      console.log('       PHASE 4.6 REQUIREMENT 4: CONVERGENCE HARDENING & DYNAMIC RELAXATION BENCHMARK      ');
      console.log('========================================================================================');

      for (const cfg of configs) {
        console.log(`\n----------------------------------------------------------------------------------------`);
        console.log(`MODEL: ${cfg.name}`);
        console.log(`----------------------------------------------------------------------------------------`);

        // --- (1) COLD START (flat alpha=0 -> alpha=1.0) ---
        // A. Baseline Viscous Damping (damping=0.95, constant mass)
        let coldBaseSteps = 0, coldBaseMs = 0, coldBaseForce = 0;
        {
          const mesh = createMeshFromFold(foldWb, { targetEdgeLength: cfg.targetLen, axialStiffness: 20000, creaseStiffness: 20, facetStiffness: 200 });
          const center = Math.floor(mesh.numVertices / 2);
          mesh.positions[center * 3 + 2] = 0.05; // seed out-of-plane

          for (const h of mesh.hinges) {
            if (h.assignment === 'V') h.restAngle = clampRad;
            if (h.assignment === 'M') h.restAngle = -clampRad;
          }

          const solver = new BarHingeSolver(mesh, { damping: 0.95, kineticDamping: false, fixedVertices: new Set([center]) });
          const t0 = performance.now();
          const res = solver.solveToEquilibrium(15000, 1e-6, 0.01);
          coldBaseMs = performance.now() - t0;
          coldBaseSteps = res.iterations;
          coldBaseForce = res.maxResidualForce;
        }

        // B. Barnes Kinetic Damping (peak zeroing)
        let coldKdSteps = 0, coldKdMs = 0, coldKdForce = 0;
        {
          const mesh = createMeshFromFold(foldWb, { targetEdgeLength: cfg.targetLen, axialStiffness: 20000, creaseStiffness: 20, facetStiffness: 200 });
          const center = Math.floor(mesh.numVertices / 2);
          mesh.positions[center * 3 + 2] = 0.05;

          for (const h of mesh.hinges) {
            if (h.assignment === 'V') h.restAngle = clampRad;
            if (h.assignment === 'M') h.restAngle = -clampRad;
          }

          const solver = new BarHingeSolver(mesh, { damping: 1.0, kineticDamping: true, fixedVertices: new Set([center]) });
          const t0 = performance.now();
          const res = solver.solveToEquilibrium(15000, 1e-6, 0.01);
          coldKdMs = performance.now() - t0;
          coldKdSteps = res.iterations;
          coldKdForce = res.maxResidualForce;
        }

        console.log(`[Cold Start: Flat -> alpha=1.0 (resForce < 0.01 N)]:`);
        console.log(`  Baseline Viscous:  ${coldBaseSteps} steps in ${coldBaseMs.toFixed(2)} ms (resForce: ${coldBaseForce.toExponential(3)} N)`);
        console.log(`  Kinetic Damping:   ${coldKdSteps} steps in ${coldKdMs.toFixed(2)} ms (resForce: ${coldKdForce.toExponential(3)} N)`);

        // --- (2) WARM-START (alpha=0.50 -> alpha=0.51, deltaAlpha = 0.01) ---
        // First establish converged state at alpha = 0.50
        const meshBaseAlpha = createMeshFromFold(foldWb, { targetEdgeLength: cfg.targetLen, axialStiffness: 20000, creaseStiffness: 20, facetStiffness: 200 });
        const centerV = Math.floor(meshBaseAlpha.numVertices / 2);
        meshBaseAlpha.positions[centerV * 3 + 2] = 0.05;

        for (const h of meshBaseAlpha.hinges) {
          if (h.assignment === 'V') h.restAngle = 0.50 * clampRad;
          if (h.assignment === 'M') h.restAngle = -0.50 * clampRad;
        }
        const prepSolver = new BarHingeSolver(meshBaseAlpha, { damping: 1.0, kineticDamping: true, fixedVertices: new Set([centerV]) });
        prepSolver.solveToEquilibrium(6000, 1e-6, 0.01);

        // A. Baseline Viscous Warm-Start deltaAlpha = 0.01
        let warmBaseSteps = 0, warmBaseMs = 0, warmBaseForce = 0;
        {
          const m = cloneMesh(meshBaseAlpha);
          for (const h of m.hinges) {
            if (h.assignment === 'V') h.restAngle = 0.51 * clampRad;
            if (h.assignment === 'M') h.restAngle = -0.51 * clampRad;
          }
          const s = new BarHingeSolver(m, { damping: 0.95, kineticDamping: false, fixedVertices: new Set([centerV]) });
          const t0 = performance.now();
          const res = s.solveToEquilibrium(6000, 1e-6, 0.01);
          warmBaseMs = performance.now() - t0;
          warmBaseSteps = res.iterations;
          warmBaseForce = res.maxResidualForce;
        }

        // B. Kinetic Damping Warm-Start deltaAlpha = 0.01
        let warmKdSteps = 0, warmKdMs = 0, warmKdForce = 0;
        {
          const m = cloneMesh(meshBaseAlpha);
          for (const h of m.hinges) {
            if (h.assignment === 'V') h.restAngle = 0.51 * clampRad;
            if (h.assignment === 'M') h.restAngle = -0.51 * clampRad;
          }
          const s = new BarHingeSolver(m, { damping: 1.0, kineticDamping: true, fixedVertices: new Set([centerV]) });
          const t0 = performance.now();
          const res = s.solveToEquilibrium(6000, 1e-6, 0.01);
          warmKdMs = performance.now() - t0;
          warmKdSteps = res.iterations;
          warmKdForce = res.maxResidualForce;
        }

        // C. Kinetic Damping + Mass Scaling (Barnes Dynamic Relaxation)
        let warmBarnesSteps = 0, warmBarnesMs = 0, warmBarnesForce = 0;
        {
          const m = cloneMesh(meshBaseAlpha);
          for (const h of m.hinges) {
            if (h.assignment === 'V') h.restAngle = 0.51 * clampRad;
            if (h.assignment === 'M') h.restAngle = -0.51 * clampRad;
          }
          const s = new BarHingeSolver(m, { damping: 1.0, kineticDamping: true, massScaling: true, fixedVertices: new Set([centerV]) });
          const t0 = performance.now();
          const res = s.solveToEquilibrium(6000, 1e-6, 0.01);
          warmBarnesMs = performance.now() - t0;
          warmBarnesSteps = res.iterations;
          warmBarnesForce = res.maxResidualForce;
        }

        console.log(`[Warm-Start deltaAlpha=0.01 (0.50 -> 0.51)]:`);
        console.log(`  Baseline Viscous:     ${warmBaseSteps} steps in ${warmBaseMs.toFixed(2)} ms (resForce: ${warmBaseForce.toExponential(3)} N)`);
        console.log(`  Kinetic Damping:      ${warmKdSteps} steps in ${warmKdMs.toFixed(2)} ms (resForce: ${warmKdForce.toExponential(3)} N)`);
        console.log(`  Barnes (KD + Mass):   ${warmBarnesSteps} steps in ${warmBarnesMs.toFixed(2)} ms (resForce: ${warmBarnesForce.toExponential(3)} N)`);

        expect(meshBaseAlpha.numVertices).toBe(cfg.expectedV);
        expect(warmKdMs).toBeLessThan(50); // Hard requirement: warm start settle under 50 ms at 121 vertices!
      }
      console.log('========================================================================================\n');
    }
  );
});
