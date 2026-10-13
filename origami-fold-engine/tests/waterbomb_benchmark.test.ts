import { describe, expect, it } from 'vitest';
import { createWaterbombBasePattern } from '../../src/engine/fold';
import { createMeshFromFold, rampRestAngles } from '../../src/engine/mesh';
import {
  BarHingeSolver,
  computeMaxBarStrain,
  computeDihedralAngle,
  assertFinite,
} from '../../src/engine/physics';

/**
 * Computes explicit critical time step dt_crit = 2 / omega_max,
 * rigorously accounting for both axial bar springs and effective hinge rotational stiffness K_hinge ≈ k_hinge / h^2
 */
function computeRigorousDt(mesh: any, targetEdgeLength: number, safetyFactor = 0.45) {
  const vertexStiffness = new Float64Array(mesh.numVertices);
  for (const bar of mesh.bars) {
    vertexStiffness[bar.v0] += bar.stiffness;
    vertexStiffness[bar.v1] += bar.stiffness;
  }
  for (const hinge of mesh.hinges) {
    const hSq = Math.pow(Math.max(targetEdgeLength * 0.5, 0.01), 2);
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
  return { dtCrit, chosenDt: safetyFactor * dtCrit, maxOmega };
}

describe('Phase 4.5 Requirement 6: Rigorous Waterbomb Benchmark & Warm-Start Interaction Analysis', () => {
  it(
    'benchmarks Waterbomb Base at 121 and 441 vertices with actual convergence steps and warm-start increments',
    () => {
    console.log('\n========================================================================================');
    console.log('       PHASE 4.5 REQUIREMENT 6: RIGOROUS WATERBOMB BENCHMARK & WARM-START METRICS        ');
    console.log('========================================================================================');

    // 1. JIT Warm-up run (unmeasured)
    const warmupFold = createWaterbombBasePattern(1);
    const warmupMesh = createMeshFromFold(warmupFold, { targetEdgeLength: 0.25 });
    const warmupSolver = new BarHingeSolver(warmupMesh);
    warmupSolver.seedFromFlat(1e-4);
    for (let i = 0; i < 200; i++) warmupSolver.step();

    const configurations = [
      { name: 'Waterbomb Base 121 Vertices', targetEdgeLength: 0.1, expectedVerts: 121 },
      { name: 'Waterbomb Base 441 Vertices', targetEdgeLength: 0.05, expectedVerts: 441 },
    ];

    for (const config of configurations) {
      const fold = createWaterbombBasePattern(1);
      const mesh = createMeshFromFold(fold, {
        targetEdgeLength: config.targetEdgeLength,
        axialStiffness: 15000,
        creaseStiffness: 4.0,
        facetStiffness: 80.0,
      });

      // Pin center vertex
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

      // Stability Analysis
      const { dtCrit, chosenDt, maxOmega } = computeRigorousDt(mesh, config.targetEdgeLength, 0.45);

      const solver = new BarHingeSolver(mesh, {
        dt: chosenDt,
        damping: 0.94,
        fixedVertices: fixed,
      });

      mesh.positions[centerVertex * 3 + 2] = 0.005;

      // 1. Continuation fold: Measure actual steps until residual force drops below threshold
      const numStages = 5;
      const stageSteps: number[] = [];
      const startTime = performance.now();

      for (let stage = 1; stage <= numStages; stage++) {
        const alpha = stage / numStages;
        rampRestAngles(mesh, alpha);
        // solveToEquilibrium without artificial small budget; large cap 6000 steps
        const res = solver.solveToEquilibrium(6000, 1e-6, 0.05);
        stageSteps.push(res.iterations);
        assertFinite(mesh);
      }

      const totalMs = performance.now() - startTime;
      const totalSteps = stageSteps.reduce((a, b) => a + b, 0);
      const msPerStep = totalMs / totalSteps;
      const maxStrain = computeMaxBarStrain(mesh.bars, mesh.positions);
      const finalResForce = solver.getMaxResidualForce();

      console.log(`\nModel: ${config.name}`);
      console.log(`  Vertices:           ${mesh.numVertices}`);
      console.log(`  Triangles:          ${mesh.numTriangles}`);
      console.log(`  Bars:               ${mesh.bars.length}`);
      console.log(`  Hinges:             ${mesh.hinges.length}`);
      console.log(`  Stability Limit:    dt_crit = ${dtCrit.toFixed(6)} s (max omega = ${maxOmega.toFixed(2)} rad/s)`);
      console.log(`  Chosen dt:          ${chosenDt.toFixed(6)} s (safety factor 0.45)`);
      console.log(`  Continuation Steps: ${totalSteps} actual steps across ${numStages} stages: [${stageSteps.join(', ')}]`);
      console.log(`  Total Wall-Clock:   ${totalMs.toFixed(2)} ms`);
      console.log(`  Time per Step:      ${msPerStep.toFixed(4)} ms/step`);
      console.log(`  Substeps @ 60fps:   ${Math.floor(16.667 / msPerStep)} substeps/frame`);
      console.log(`  Final Res Force:    ${finalResForce.toExponential(4)} N`);
      console.log(`  Max Bar Strain:     ${(maxStrain * 100).toFixed(4)}%`);

      // 2. Warm-start Interaction Benchmark:
      // Starting from converged state at alpha = 0.50, measure steps and time for deltaAlpha = 0.01 and 0.05
      rampRestAngles(mesh, 0.50);
      solver.solveToEquilibrium(6000, 1e-6, 0.05);
      assertFinite(mesh);

      // Warm start deltaAlpha = 0.01 (0.50 -> 0.51)
      const t01 = performance.now();
      rampRestAngles(mesh, 0.51);
      const res01 = solver.solveToEquilibrium(4000, 1e-6, 0.05);
      const ms01 = performance.now() - t01;
      assertFinite(mesh);

      // Reset to 0.50
      rampRestAngles(mesh, 0.50);
      solver.solveToEquilibrium(4000, 1e-6, 0.05);
      assertFinite(mesh);

      // Warm start deltaAlpha = 0.05 (0.50 -> 0.55)
      const t05 = performance.now();
      rampRestAngles(mesh, 0.55);
      const res05 = solver.solveToEquilibrium(4000, 1e-6, 0.05);
      const ms05 = performance.now() - t05;

      console.log(`  --------------------------------------------------------------------------`);
      console.log(`  [Warm-Start Interaction Metrics at alpha=0.50]:`);
      console.log(`    deltaAlpha = 0.01: ${res01.iterations} actual steps in ${ms01.toFixed(2)} ms (${(ms01 / res01.iterations).toFixed(4)} ms/step, resForce: ${res01.maxResidualForce.toExponential(3)} N)`);
      console.log(`    deltaAlpha = 0.05: ${res05.iterations} actual steps in ${ms05.toFixed(2)} ms (${(ms05 / res05.iterations).toFixed(4)} ms/step, resForce: ${res05.maxResidualForce.toExponential(3)} N)`);
      console.log(`  --------------------------------------------------------------------------`);

      expect(mesh.numVertices).toBe(config.expectedVerts);
      expect(msPerStep).toBeLessThan(1.0);
      expect(totalSteps).toBeGreaterThan(0);
      expect(res01.iterations).toBeGreaterThan(0);
      expect(res05.iterations).toBeGreaterThan(0);
    }

    console.log('========================================================================================\n');
  }, 60000);
});
