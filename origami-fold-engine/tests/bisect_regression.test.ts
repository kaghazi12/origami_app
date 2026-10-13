import { describe, it } from 'vitest';
import { createWaterbombBasePattern } from '../../src/engine/fold';
import { createMeshFromFold } from '../../src/engine/mesh';
import { BarHingeSolver, computeStableTimeStep } from '../../src/engine/physics';
import { TriMesh } from '../../src/engine/types';

describe('Phase 5.6 Requirement 2: Regression Bisect & Divergence Audit', () => {
  it('runs bisect matrix on 121-vertex Waterbomb Base comparing dt, damping, and regularization', { timeout: 30000 }, () => {
    const foldWb = createWaterbombBasePattern(1);
    const clampRad = (177 * Math.PI) / 180;
    for (let i = 0; i < foldWb.edges_assignment.length; i++) {
      if (foldWb.edges_assignment[i] === 'V') foldWb.edges_foldAngle![i] = 177;
      if (foldWb.edges_assignment[i] === 'M') foldWb.edges_foldAngle![i] = -177;
    }

    // Reference bar-only dt (Phase 4.6 formula)
    function computeBarOnlyDt(mesh: TriMesh, safetyFactor = 0.4): number {
      const vertexStiffness = new Float64Array(mesh.numVertices);
      for (const bar of mesh.bars) {
        vertexStiffness[bar.v0] += bar.stiffness;
        vertexStiffness[bar.v1] += bar.stiffness;
      }
      let maxOmega = 0;
      for (let i = 0; i < mesh.numVertices; i++) {
        const m = mesh.masses[i] || 1.0;
        const omega = Math.sqrt(vertexStiffness[i] / m);
        if (omega > maxOmega) maxOmega = omega;
      }
      return safetyFactor * (2.0 / maxOmega);
    }

    const meshOpts = { targetEdgeLength: 0.1, axialStiffness: 20000, creaseStiffness: 20, facetStiffness: 200 };

    interface RunResult {
      name: string;
      dt: number;
      damping: number;
      kd: boolean;
      steps: number;
      ms: number;
      msPerStep: number;
      resForce: number;
      maxV: number;
      ke: number;
      pe: number;
      converged: boolean;
    }

    const runs: RunResult[] = [];

    function testConfig(name: string, customDt: number | undefined, damping: number, kd: boolean) {
      const mesh = createMeshFromFold(foldWb, meshOpts);
      const center = Math.floor(mesh.numVertices / 2);
      mesh.positions[center * 3 + 2] = 0.05;

      for (const h of mesh.hinges) {
        if (h.assignment === 'V') h.restAngle = clampRad;
        if (h.assignment === 'M') h.restAngle = -clampRad;
      }

      const effectiveDt = customDt ?? computeStableTimeStep(mesh, 0.4);
      const solver = new BarHingeSolver(mesh, {
        dt: effectiveDt,
        damping,
        kineticDamping: kd,
        fixedVertices: new Set([center]),
      });

      let maxV = 0;
      const t0 = performance.now();
      let steps = 0;
      let converged = false;

      for (let i = 0; i < 15000; i++) {
        const { potentialEnergy, kineticEnergy } = solver.step();
        steps++;

        // Track max velocity
        for (let v = 0; v < mesh.numVertices; v++) {
          const vx = mesh.velocities[v * 3 + 0];
          const vy = mesh.velocities[v * 3 + 1];
          const vz = mesh.velocities[v * 3 + 2];
          const speed = Math.hypot(vx, vy, vz);
          if (speed > maxV) maxV = speed;
        }

        const rf = solver.getMaxResidualForce();
        if (rf < 0.01 && i > 5) {
          converged = true;
          console.log(`[Bisect Log - ${name}] Converged at step ${i+1}: resForce = ${rf}, ke = ${kineticEnergy}, maxV = ${maxV}, pe = ${potentialEnergy}, pos0 = [${mesh.positions[0]}, ${mesh.positions[1]}, ${mesh.positions[2]}]`);
          break;
        }
      }
      const wallMs = performance.now() - t0;
      const rfFinal = solver.getMaxResidualForce();

      runs.push({
        name,
        dt: effectiveDt,
        damping,
        kd,
        steps,
        ms: wallMs,
        msPerStep: wallMs / steps,
        resForce: rfFinal,
        maxV,
        ke: solver.getKineticEnergy(),
        pe: 0,
        converged,
      });
    }

    const sampleMesh = createMeshFromFold(foldWb, meshOpts);
    const dtBarOnly = computeBarOnlyDt(sampleMesh, 0.4);
    const dtInclusive = computeStableTimeStep(sampleMesh, 0.4);

    // 1. Phase 4.6 Baseline Viscous (bar-only dt ~0.0029s, damping=0.95)
    testConfig('Phase 4.6 Baseline (bar-only dt, damping=0.95)', dtBarOnly, 0.95, false);

    // 2. Phase 5.5 Baseline Viscous (hinge-inclusive dt ~0.0012s, damping=0.95)
    testConfig('Phase 5.5 Baseline (hinge-inclusive dt, damping=0.95)', dtInclusive, 0.95, false);

    // 3. Phase 4.6 Kinetic Damping (bar-only dt ~0.0029s, damping=1.0)
    testConfig('Phase 4.6 KD (bar-only dt, damping=1.0)', dtBarOnly, 1.0, true);

    // 4. Phase 5.5 KD with damping=1.0 (hinge-inclusive dt)
    testConfig('Phase 5.5 KD with damping=1.0 (hinge-inclusive dt)', dtInclusive, 1.0, true);

    // 5. Phase 5.5 KD with damping=0.98 (hinge-inclusive dt)
    testConfig('Phase 5.5 KD with damping=0.98 (hinge-inclusive dt)', dtInclusive, 0.98, true);

    // 6. KD with bar-only dt and damping=0.98
    testConfig('KD (bar-only dt, damping=0.98)', dtBarOnly, 0.98, true);

    console.log('\n======================================================================================================================');
    console.log('                          PHASE 5.6 REGRESSION BISECT & DIVERGENCE AUDIT TABLE                                          ');
    console.log('======================================================================================================================');
    console.log('Configuration                                | dt (s)   | Damp | KD  | Steps | Time (ms) | ms/step | Res Force (N) | Max |v|');
    console.log('---------------------------------------------+----------+------+-----+-------+-----------+---------+---------------+---------');
    for (const r of runs) {
      console.log(
        `${r.name.padEnd(44)} | ${r.dt.toFixed(5)} | ${r.damping.toFixed(2)} | ${r.kd ? 'Yes' : 'No '} | ${String(r.steps).padStart(5)} | ${r.ms.toFixed(1).padStart(9)} | ${r.msPerStep.toFixed(4)} | ${r.resForce.toExponential(3).padStart(13)} | ${r.maxV.toFixed(2)}`
      );
    }
    console.log('======================================================================================================================\n');
  });
});
