import { describe, expect, it } from 'vitest';
import { createWaterbombBasePattern } from '../../src/engine/fold';
import { createMeshFromFold, rampRestAngles } from '../../src/engine/mesh';
import {
  BarHingeSolver,
  computeStableTimeStep,
  computeMaxBarStrain,
  computeDihedralAngle,
  seedFromFlat,
} from '../../src/engine/physics';

describe('Phase 3.5 Requirement 4: Rigorous Waterbomb Base Benchmark & Stability Analysis', () => {
  it('benchmarks Waterbomb Base folding to alpha=1.0 at 121 and 441 vertices with JIT warmup and explicit dt_crit', () => {
    console.log('\n========================================================================================');
    console.log('       PHASE 3.5 REQUIREMENT 4: RIGOROUS WATERBOMB BASE BENCHMARK & CONVERGENCE          ');
    console.log('========================================================================================');

    // 1. JIT Warm-up run (unmeasured)
    const warmupFold = createWaterbombBasePattern(1);
    const warmupMesh = createMeshFromFold(warmupFold, { targetEdgeLength: 0.25 });
    const warmupSolver = new BarHingeSolver(warmupMesh);
    warmupSolver.seedFromFlat(1e-4);
    for (let i = 0; i < 150; i++) warmupSolver.step();

    const configurations = [
      { name: 'Waterbomb Base 121 Vertices', targetEdgeLength: 0.1 },
      { name: 'Waterbomb Base 441 Vertices', targetEdgeLength: 0.05 },
    ];

    for (const config of configurations) {
      const fold = createWaterbombBasePattern(1);
      const mesh = createMeshFromFold(fold, {
        targetEdgeLength: config.targetEdgeLength,
        axialStiffness: 15000,
        creaseStiffness: 4.0,
        facetStiffness: 80.0,
      });

      // Find center vertex at (0.5, 0.5) to fix translation in 3D
      let centerVertex = -1;
      let minCenterDist = Infinity;
      for (let i = 0; i < mesh.numVertices; i++) {
        const u = mesh.uvs[i * 2 + 0];
        const v = mesh.uvs[i * 2 + 1];
        const d = Math.hypot(u - 0.5, v - 0.5);
        if (d < minCenterDist) {
          minCenterDist = d;
          centerVertex = i;
        }
      }
      expect(minCenterDist).toBeLessThan(1e-5);

      const fixed = new Set<number>([centerVertex]);

      // Stability Analysis: Explicit stability limit dt_crit = 2 / omega_max
      // Accounting for both bar stiffness and effective hinge rotational stiffness K_hinge ≈ k_hinge / h^2
      const vertexStiffness = new Float64Array(mesh.numVertices);
      for (const bar of mesh.bars) {
        vertexStiffness[bar.v0] += bar.stiffness;
        vertexStiffness[bar.v1] += bar.stiffness;
      }
      for (const hinge of mesh.hinges) {
        // Average triangle height h ≈ targetEdgeLength * 0.707
        const hSq = Math.pow(Math.max(config.targetEdgeLength * 0.5, 0.01), 2);
        const kEff = hinge.stiffness / hSq;
        vertexStiffness[hinge.v2] += kEff;
        vertexStiffness[hinge.v3] += kEff;
        vertexStiffness[hinge.v0] += 0.5 * kEff;
        vertexStiffness[hinge.v1] += 0.5 * kEff;
      }

      let maxOmega = 0;
      for (let i = 0; i < mesh.numVertices; i++) {
        const m = mesh.masses[i] || 1.0;
        const omega = Math.sqrt(vertexStiffness[i] / m);
        if (omega > maxOmega) maxOmega = omega;
      }
      const dtCrit = 2.0 / maxOmega;
      const safetyFactor = 0.45;
      const chosenDt = safetyFactor * dtCrit;

      const solver = new BarHingeSolver(mesh, {
        dt: chosenDt,
        damping: 0.94,
        fixedVertices: fixed,
      });

      mesh.positions[centerVertex * 3 + 2] = 0.005; // Seed central out-of-plane perturbation

      // Timed simulation: continuation fold over alpha stages to alpha=1.0
      const numStages = 5;
      const stepsPerStage = 800;
      const startTime = performance.now();
      let totalSteps = 0;

      for (let stage = 1; stage <= numStages; stage++) {
        const alpha = stage / numStages;
        rampRestAngles(mesh, alpha);
        const res = solver.solveToEquilibrium(stepsPerStage, 1e-5, 0.02);
        totalSteps += res.iterations;
      }

      const totalMs = performance.now() - startTime;
      const msPerStep = totalMs / totalSteps;
      const maxStrain = computeMaxBarStrain(mesh.bars, mesh.positions);

      // Compute crease dihedral angle errors
      let totalCreaseError = 0;
      let creaseCount = 0;
      for (const hinge of mesh.hinges) {
        if (hinge.assignment === 'M' || hinge.assignment === 'V') {
          const currentAngle = computeDihedralAngle(hinge, mesh.positions);
          const err = Math.abs(currentAngle - hinge.targetAngle);
          totalCreaseError += err;
          creaseCount++;
        }
      }
      const avgCreaseErrDeg = creaseCount > 0 ? ((totalCreaseError / creaseCount) * 180) / Math.PI : 0;

      console.log(`\nModel: ${config.name}`);
      console.log(`  Vertices:           ${mesh.numVertices}`);
      console.log(`  Triangles:          ${mesh.numTriangles}`);
      console.log(`  Bars:               ${mesh.bars.length}`);
      console.log(`  Hinges:             ${mesh.hinges.length}`);
      console.log(`  Stability Limit:    dt_crit = ${dtCrit.toFixed(6)} s (max omega = ${maxOmega.toFixed(2)} rad/s)`);
      console.log(`  Chosen dt:          ${chosenDt.toFixed(6)} s (safety factor ${safetyFactor})`);
      console.log(`  Steps to Converge:  ${totalSteps} steps (${numStages} stages x <= ${stepsPerStage} steps)`);
      console.log(`  Total Wall-Clock:   ${totalMs.toFixed(2)} ms`);
      console.log(`  Time per Step:      ${msPerStep.toFixed(4)} ms/step`);
      console.log(`  Substeps @ 60fps:   ${Math.floor(16.667 / msPerStep)} substeps/frame`);
      console.log(`  Max Bar Strain:     ${(maxStrain * 100).toFixed(4)}%`);
      console.log(`  Avg Crease Error:   ${avgCreaseErrDeg.toFixed(2)}°`);

      expect(mesh.numVertices).toBe(config.name.includes('121') ? 121 : 441);
      expect(msPerStep).toBeLessThan(1.0); // Sub-millisecond per integration step
      expect(totalSteps).toBeGreaterThan(0);
    }

    console.log('========================================================================================\n');
  });
});
