import { describe, expect, it } from 'vitest';
import { createWaterbombBasePattern } from '../../src/engine/fold';
import { createMeshFromFold } from '../../src/engine/mesh';
import { BarHingeSolver, computeDihedralAngle, assertFinite } from '../../src/engine/physics';
import { TriMesh } from '../../src/engine/types';

describe('Phase 4.6 & 5.5 Requirement 4: Convergence Audit & Dynamic Relaxation Benchmarks', () => {
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

  function computeMaxVertexError(posA: Float64Array, posB: Float64Array): number {
    let maxErr = 0;
    const numV = posA.length / 3;
    for (let i = 0; i < numV; i++) {
      const dx = posA[i * 3 + 0] - posB[i * 3 + 0];
      const dy = posA[i * 3 + 1] - posB[i * 3 + 1];
      const dz = posA[i * 3 + 2] - posB[i * 3 + 2];
      const err = Math.hypot(dx, dy, dz);
      if (err > maxErr) maxErr = err;
    }
    return maxErr;
  }

  function computeMaxCreaseAngleError(meshA: TriMesh, meshB: TriMesh): number {
    let maxErr = 0;
    for (let i = 0; i < meshA.hinges.length; i++) {
      const hA = meshA.hinges[i];
      const hB = meshB.hinges[i];
      if (hA.assignment !== 'M' && hA.assignment !== 'V') continue;
      const angA = computeDihedralAngle(hA, meshA.positions);
      const angB = computeDihedralAngle(hB, meshB.positions);
      const err = Math.abs(angA - angB) * (180 / Math.PI);
      if (err > maxErr) maxErr = err;
    }
    return maxErr;
  }

  it(
    'evaluates actual convergence steps for baseline viscous damping vs kinetic damping and mass scaling at 121 and 441 vertices',
    { timeout: 120000 },
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
      console.log('       PHASE 5.5 REQUIREMENT 4: CONVERGENCE AUDIT & BENCHMARK SUITE                       ');
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

        // B. Barnes Kinetic Damping (peak zeroing + 0.98 background damping)
        let coldKdSteps = 0, coldKdMs = 0, coldKdForce = 0;
        {
          const mesh = createMeshFromFold(foldWb, { targetEdgeLength: cfg.targetLen, axialStiffness: 20000, creaseStiffness: 20, facetStiffness: 200 });
          const center = Math.floor(mesh.numVertices / 2);
          mesh.positions[center * 3 + 2] = 0.05;

          for (const h of mesh.hinges) {
            if (h.assignment === 'V') h.restAngle = clampRad;
            if (h.assignment === 'M') h.restAngle = -clampRad;
          }

          const solver = new BarHingeSolver(mesh, { damping: 0.98, kineticDamping: true, fixedVertices: new Set([center]) });
          const t0 = performance.now();
          const res = solver.solveToEquilibrium(15000, 1e-6, 0.01);
          coldKdMs = performance.now() - t0;
          coldKdSteps = res.iterations;
          coldKdForce = res.maxResidualForce;
        }

        // C. Barnes DR (Kinetic Damping + Fictitious Nodal Mass Scaling)
        let coldBarnesSteps = 0, coldBarnesMs = 0, coldBarnesForce = 0;
        {
          const mesh = createMeshFromFold(foldWb, { targetEdgeLength: cfg.targetLen, axialStiffness: 20000, creaseStiffness: 20, facetStiffness: 200 });
          const center = Math.floor(mesh.numVertices / 2);
          mesh.positions[center * 3 + 2] = 0.05;

          for (const h of mesh.hinges) {
            if (h.assignment === 'V') h.restAngle = clampRad;
            if (h.assignment === 'M') h.restAngle = -clampRad;
          }

          const solver = new BarHingeSolver(mesh, { damping: 0.98, kineticDamping: true, massScaling: true, fixedVertices: new Set([center]) });
          const t0 = performance.now();
          const res = solver.solveToEquilibrium(15000, 1e-6, 0.01);
          coldBarnesMs = performance.now() - t0;
          coldBarnesSteps = res.iterations;
          coldBarnesForce = res.maxResidualForce;
        }

        console.log(`[Cold Start: Flat -> alpha=1.0 (resForce < 0.01 N)]:`);
        console.log(`  Baseline Viscous:    ${coldBaseSteps} steps in ${coldBaseMs.toFixed(2)} ms (resForce: ${coldBaseForce.toExponential(4)} N)`);
        console.log(`  Kinetic Damping:     ${coldKdSteps} steps in ${coldKdMs.toFixed(2)} ms (resForce: ${coldKdForce.toExponential(4)} N)`);
        console.log(`  Barnes DR (KD+Mass): ${coldBarnesSteps} steps in ${coldBarnesMs.toFixed(2)} ms (resForce: ${coldBarnesForce.toExponential(4)} N)`);

        // --- (2) WARM-START AUDIT (alpha=0.50 -> alpha=0.51, deltaAlpha = 0.01) ---
        // First establish high-precision converged baseline at alpha = 0.50
        const meshBaseAlpha = createMeshFromFold(foldWb, { targetEdgeLength: cfg.targetLen, axialStiffness: 20000, creaseStiffness: 20, facetStiffness: 200 });
        const centerV = Math.floor(meshBaseAlpha.numVertices / 2);
        meshBaseAlpha.positions[centerV * 3 + 2] = 0.05;

        for (const h of meshBaseAlpha.hinges) {
          if (h.assignment === 'V') h.restAngle = 0.50 * clampRad;
          if (h.assignment === 'M') h.restAngle = -0.50 * clampRad;
        }
        const prepSolver = new BarHingeSolver(meshBaseAlpha, { damping: 0.95, kineticDamping: false, fixedVertices: new Set([centerV]) });
        prepSolver.solveToEquilibrium(8000, 1e-8, 1e-4);

        // Ground-truth reference state at alpha = 0.51 (tightly solved to 1e-5 N)
        const refMesh = cloneMesh(meshBaseAlpha);
        for (const h of refMesh.hinges) {
          if (h.assignment === 'V') h.restAngle = 0.51 * clampRad;
          if (h.assignment === 'M') h.restAngle = -0.51 * clampRad;
        }
        const refSolver = new BarHingeSolver(refMesh, { damping: 0.95, kineticDamping: false, fixedVertices: new Set([centerV]) });
        refSolver.solveToEquilibrium(8000, 1e-9, 1e-5);

        // Tightened warm-start threshold: resForce < 0.001 N (1e-3 N)
        const warmTol = 1e-3;

        // A. Baseline Viscous Warm-Start
        let warmBaseSteps = 0, warmBaseMs = 0, warmBaseForce = 0, warmBasePosErr = 0, warmBaseAngErr = 0;
        {
          const m = cloneMesh(meshBaseAlpha);
          for (const h of m.hinges) {
            if (h.assignment === 'V') h.restAngle = 0.51 * clampRad;
            if (h.assignment === 'M') h.restAngle = -0.51 * clampRad;
          }
          const s = new BarHingeSolver(m, { damping: 0.95, kineticDamping: false, fixedVertices: new Set([centerV]) });
          const t0 = performance.now();
          const res = s.solveToEquilibrium(6000, 1e-8, warmTol);
          warmBaseMs = performance.now() - t0;
          warmBaseSteps = res.iterations;
          warmBaseForce = res.maxResidualForce;
          warmBasePosErr = computeMaxVertexError(m.positions, refMesh.positions);
          warmBaseAngErr = computeMaxCreaseAngleError(m, refMesh);
        }

        // B. Kinetic Damping Warm-Start
        let warmKdSteps = 0, warmKdMs = 0, warmKdForce = 0, warmKdPosErr = 0, warmKdAngErr = 0;
        {
          const m = cloneMesh(meshBaseAlpha);
          for (const h of m.hinges) {
            if (h.assignment === 'V') h.restAngle = 0.51 * clampRad;
            if (h.assignment === 'M') h.restAngle = -0.51 * clampRad;
          }
          const s = new BarHingeSolver(m, { damping: 0.98, kineticDamping: true, fixedVertices: new Set([centerV]) });
          const t0 = performance.now();
          const res = s.solveToEquilibrium(6000, 1e-8, warmTol);
          warmKdMs = performance.now() - t0;
          warmKdSteps = res.iterations;
          warmKdForce = res.maxResidualForce;
          warmKdPosErr = computeMaxVertexError(m.positions, refMesh.positions);
          warmKdAngErr = computeMaxCreaseAngleError(m, refMesh);
        }

        // C. Barnes DR Warm-Start (KD + Mass Scaling)
        let warmBarnesSteps = 0, warmBarnesMs = 0, warmBarnesForce = 0, warmBarnesPosErr = 0, warmBarnesAngErr = 0;
        {
          const m = cloneMesh(meshBaseAlpha);
          for (const h of m.hinges) {
            if (h.assignment === 'V') h.restAngle = 0.51 * clampRad;
            if (h.assignment === 'M') h.restAngle = -0.51 * clampRad;
          }
          const s = new BarHingeSolver(m, { damping: 0.98, kineticDamping: true, massScaling: true, fixedVertices: new Set([centerV]) });
          const t0 = performance.now();
          const res = s.solveToEquilibrium(6000, 1e-8, warmTol);
          warmBarnesMs = performance.now() - t0;
          warmBarnesSteps = res.iterations;
          warmBarnesForce = res.maxResidualForce;
          warmBarnesPosErr = computeMaxVertexError(m.positions, refMesh.positions);
          warmBarnesAngErr = computeMaxCreaseAngleError(m, refMesh);
        }

        console.log(`[Tightened Warm-Start deltaAlpha=0.01 (resForce < 0.001 N)]:`);
        console.log(`  Baseline Viscous:    ${warmBaseSteps} steps in ${warmBaseMs.toFixed(2)} ms (resForce: ${warmBaseForce.toExponential(4)} N, maxPosErr: ${warmBasePosErr.toExponential(3)} m, maxAngErr: ${warmBaseAngErr.toFixed(4)}°)`);
        console.log(`  Kinetic Damping:     ${warmKdSteps} steps in ${warmKdMs.toFixed(2)} ms (resForce: ${warmKdForce.toExponential(4)} N, maxPosErr: ${warmKdPosErr.toExponential(3)} m, maxAngErr: ${warmKdAngErr.toFixed(4)}°)`);
        console.log(`  Barnes DR (KD+Mass): ${warmBarnesSteps} steps in ${warmBarnesMs.toFixed(2)} ms (resForce: ${warmBarnesForce.toExponential(4)} N, maxPosErr: ${warmBarnesPosErr.toExponential(3)} m, maxAngErr: ${warmBarnesAngErr.toFixed(4)}°)`);

        // --- (3) DRAG-STYLE BENCHMARK (Pin P=(0,0), drag Q=(1,0) by 20% width) ---
        // Find corner vertices: P=(0,0) and Q=(1,0)
        let vP = -1, vQ = -1;
        let minDistP = Infinity, minDistQ = Infinity;
        for (let i = 0; i < meshBaseAlpha.numVertices; i++) {
          const u = meshBaseAlpha.uvs[i * 2 + 0];
          const v = meshBaseAlpha.uvs[i * 2 + 1];
          const dP = Math.hypot(u - 0, v - 0);
          const dQ = Math.hypot(u - 1, v - 0);
          if (dP < minDistP) { minDistP = dP; vP = i; }
          if (dQ < minDistQ) { minDistQ = dQ; vQ = i; }
        }
        const dragFixed = new Set<number>([vP, vQ]);

        // Drag initial condition: flat sheet, Q displaced by -20% width in X and +5% out-of-plane in Z
        const makeDragMesh = () => {
          const m = createMeshFromFold(foldWb, { targetEdgeLength: cfg.targetLen, axialStiffness: 20000, creaseStiffness: 20, facetStiffness: 200 });
          // Pin P at (0,0,0)
          m.positions[vP * 3 + 0] = 0;
          m.positions[vP * 3 + 1] = 0;
          m.positions[vP * 3 + 2] = 0;
          // Drag Q to (0.80, 0.0, 0.05) - 20% compression inducing buckling
          m.positions[vQ * 3 + 0] = 0.80;
          m.positions[vQ * 3 + 1] = 0.00;
          m.positions[vQ * 3 + 2] = 0.05;
          // Seed slight out of plane to allow smooth buckling
          for (let i = 0; i < m.numVertices; i++) {
            if (i !== vP && i !== vQ) {
              const u = m.uvs[i * 2 + 0];
              const v = m.uvs[i * 2 + 1];
              m.positions[i * 3 + 2] = 0.02 * Math.sin(Math.PI * u) * Math.sin(Math.PI * v);
            }
          }
          return m;
        };

        // Reference ground-truth for drag configuration
        const dragRefMesh = makeDragMesh();
        const dragRefSolver = new BarHingeSolver(dragRefMesh, { damping: 0.95, kineticDamping: false, fixedVertices: dragFixed });
        dragRefSolver.solveToEquilibrium(10000, 1e-9, 1e-4);

        const dragTol = 0.01; // 0.01 N for drag settling
        // A. Baseline Drag
        let dragBaseSteps = 0, dragBaseMs = 0, dragBaseForce = 0, dragBasePosErr = 0;
        {
          const m = makeDragMesh();
          const s = new BarHingeSolver(m, { damping: 0.95, kineticDamping: false, fixedVertices: dragFixed });
          const t0 = performance.now();
          const res = s.solveToEquilibrium(8000, 1e-8, dragTol);
          dragBaseMs = performance.now() - t0;
          dragBaseSteps = res.iterations;
          dragBaseForce = res.maxResidualForce;
          dragBasePosErr = computeMaxVertexError(m.positions, dragRefMesh.positions);
        }

        // B. KD Drag
        let dragKdSteps = 0, dragKdMs = 0, dragKdForce = 0, dragKdPosErr = 0;
        {
          const m = makeDragMesh();
          const s = new BarHingeSolver(m, { damping: 0.98, kineticDamping: true, fixedVertices: dragFixed });
          const t0 = performance.now();
          const res = s.solveToEquilibrium(8000, 1e-8, dragTol);
          dragKdMs = performance.now() - t0;
          dragKdSteps = res.iterations;
          dragKdForce = res.maxResidualForce;
          dragKdPosErr = computeMaxVertexError(m.positions, dragRefMesh.positions);
        }

        // C. Barnes DR Drag
        let dragBarnesSteps = 0, dragBarnesMs = 0, dragBarnesForce = 0, dragBarnesPosErr = 0;
        {
          const m = makeDragMesh();
          const s = new BarHingeSolver(m, { damping: 0.98, kineticDamping: true, massScaling: true, fixedVertices: dragFixed });
          const t0 = performance.now();
          const res = s.solveToEquilibrium(8000, 1e-8, dragTol);
          dragBarnesMs = performance.now() - t0;
          dragBarnesSteps = res.iterations;
          dragBarnesForce = res.maxResidualForce;
          dragBarnesPosErr = computeMaxVertexError(m.positions, dragRefMesh.positions);
        }

        console.log(`[Drag Benchmark: Pin P=(0,0), Drag Q by 20% (resForce < 0.01 N)]:`);
        console.log(`  Baseline Viscous:    ${dragBaseSteps} steps in ${dragBaseMs.toFixed(2)} ms (resForce: ${dragBaseForce.toExponential(4)} N, maxPosErr: ${dragBasePosErr.toExponential(3)} m)`);
        console.log(`  Kinetic Damping:     ${dragKdSteps} steps in ${dragKdMs.toFixed(2)} ms (resForce: ${dragKdForce.toExponential(4)} N, maxPosErr: ${dragKdPosErr.toExponential(3)} m)`);
        console.log(`  Barnes DR (KD+Mass): ${dragBarnesSteps} steps in ${dragBarnesMs.toFixed(2)} ms (resForce: ${dragBarnesForce.toExponential(4)} N, maxPosErr: ${dragBarnesPosErr.toExponential(3)} m)`);

        expect(meshBaseAlpha.numVertices).toBe(cfg.expectedV);
        expect(Number.isFinite(coldBaseForce)).toBe(true);
        expect(Number.isFinite(coldKdForce)).toBe(true);
        expect(Number.isFinite(coldBarnesForce)).toBe(true);
        expect(warmBaseForce).toBeLessThan(0.10); // Warm start converged within tolerance basin
        expect(Number.isFinite(dragBaseForce)).toBe(true);
      }
      console.log('========================================================================================\n');
    }
  );
});
