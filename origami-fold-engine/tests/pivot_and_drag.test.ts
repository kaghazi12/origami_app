import { describe, it, expect } from 'vitest';
import { createSquareSheet } from '../../src/engine/fold';
import { createMeshFromFold } from '../../src/engine/mesh';
import { XPBDSolver, assertFinite } from '../../src/engine/physics';

describe('Phase 7: Pivot-and-Drag Interaction Physics Suite', () => {
  it('pins point P and drags point Q on a table with inextensible, bending-stiff paper (121V and 441V)', () => {
    const configs = [
      { name: '121 Vertices', targetEdgeLength: 0.10, substeps: 15, distanceIterations: 12 },
      { name: '441 Vertices', targetEdgeLength: 0.05, substeps: 15, distanceIterations: 12 },
    ];

    console.log('\n========================================================================================================');
    console.log('       PHASE 7 ACCEPTANCE: PIVOT-AND-DRAG INTERACTION (PIN P, DRAG Q ON TABLE)                          ');
    console.log('========================================================================================================');
    console.log('Mesh         | Stage                        | ms/frame | Max Strain (%) | P Drift (m) | Min Z (m) | Pass?');
    console.log('-------------+------------------------------+----------+----------------+-------------+-----------+------');

    for (const cfg of configs) {
      const fold = createSquareSheet(1, 1);
      const mesh = createMeshFromFold(fold, { targetEdgeLength: cfg.targetEdgeLength });

      const thickness = 0.002;
      const targetZ = thickness * 0.5; // 0.001 m contact boundary

      // Place sheet flat on table at z = targetZ
      for (let i = 0; i < mesh.numVertices; i++) {
        mesh.positions[i * 3 + 2] = targetZ;
        mesh.velocities[i * 3 + 0] = 0;
        mesh.velocities[i * 3 + 1] = 0;
        mesh.velocities[i * 3 + 2] = 0;
      }

      // Find P = (0, 0) and Q = (1, 0)
      let vP = -1, vQ = -1;
      let minP = Infinity, minQ = Infinity;
      for (let i = 0; i < mesh.numVertices; i++) {
        const x = mesh.positions[i * 3 + 0];
        const y = mesh.positions[i * 3 + 1];
        const dP = Math.hypot(x - 0, y - 0);
        const dQ = Math.hypot(x - 1, y - 0);
        if (dP < minP) { minP = dP; vP = i; }
        if (dQ < minQ) { minQ = dQ; vQ = i; }
      }

      const pInitX = mesh.positions[vP * 3 + 0];
      const pInitY = mesh.positions[vP * 3 + 1];
      const pInitZ = mesh.positions[vP * 3 + 2];

      const solver = new XPBDSolver(mesh, {
        substeps: cfg.substeps,
        iterations: 1,
        distanceIterations: cfg.distanceIterations,
        fixedVertices: [vP], // Pin point P
        enableTable: true,
        tableZ: 0.0,
        paperThickness: thickness,
        enableGravity: true,
        gravity: 1.0,
        muStatic: 0.2,
        muKinetic: 0.15,
        bendingCompliance: 0.001, // Standard bending stiffness
        velocityDamping: 0.98,
        contactDamping: 0.25,
      });

      const R = Math.hypot(mesh.positions[vQ * 3 + 0] - pInitX, mesh.positions[vQ * 3 + 1] - pInitY);

      // Stages of drag interaction:
      // Stage 1: Drag Q on table in 20° pivot arc around P at radius R (pure pivot on table)
      // Stage 2: Drag Q on table in 40° pivot arc around P at radius R
      // Stage 3: Lift dragged point Q to height z = 0.08m at radius R (bending the sheet while resting on table)
      const rHorizStage3 = Math.sqrt(Math.max(0.1, R * R - 0.08 * 0.08));
      const stages = [
        {
          name: 'Stage 1: 20° Arc on Table',
          target: [R * Math.cos((20 * Math.PI) / 180), R * Math.sin((20 * Math.PI) / 180), targetZ] as [number, number, number],
        },
        {
          name: 'Stage 2: 40° Arc on Table',
          target: [R * Math.cos((40 * Math.PI) / 180), R * Math.sin((40 * Math.PI) / 180), targetZ] as [number, number, number],
        },
        {
          name: 'Stage 3: Lift Q (z=0.08m)',
          target: [rHorizStage3 * Math.cos((40 * Math.PI) / 180), rHorizStage3 * Math.sin((40 * Math.PI) / 180), 0.08] as [number, number, number],
        },
      ];

      for (const st of stages) {
        const startQ: [number, number, number] = [
          mesh.positions[vQ * 3 + 0],
          mesh.positions[vQ * 3 + 1],
          mesh.positions[vQ * 3 + 2],
        ];

        // Step 50 frames for each stage, interpolating drag target smoothly like real mouse drag
        const N_FRAMES = 50;
        const t0 = performance.now();
        for (let f = 1; f <= N_FRAMES; f++) {
          const frac = f / N_FRAMES;
          const curTarget: [number, number, number] = [
            startQ[0] + (st.target[0] - startQ[0]) * frac,
            startQ[1] + (st.target[1] - startQ[1]) * frac,
            startQ[2] + (st.target[2] - startQ[2]) * frac,
          ];
          solver.setDragTarget(vQ, curTarget);
          solver.step(0.016);
        }
        // Allow paper to settle slightly under friction at target position
        for (let f = 0; f < 10; f++) solver.step(0.016);
        const msPerFrame = (performance.now() - t0) / (N_FRAMES + 10);

        assertFinite(mesh);

        // Find top strained bars
        const strainedBars: { b: number; v0: number; v1: number; rest: number; len: number; strain: number }[] = [];
        for (let b = 0; b < mesh.bars.length; b++) {
          const bar = mesh.bars[b];
          const p0 = bar.v0 * 3, p1 = bar.v1 * 3;
          const dx = mesh.positions[p0 + 0] - mesh.positions[p1 + 0];
          const dy = mesh.positions[p0 + 1] - mesh.positions[p1 + 1];
          const dz = mesh.positions[p0 + 2] - mesh.positions[p1 + 2];
          const len = Math.hypot(dx, dy, dz);
          const strain = Math.abs(len - bar.restLength) / bar.restLength;
          strainedBars.push({ b, v0: bar.v0, v1: bar.v1, rest: bar.restLength, len, strain });
        }
        strainedBars.sort((a, b) => b.strain - a.strain);
        if (cfg.name.includes('441')) {
          console.log(`[Top 3 Strained Bars 441V - ${st.name}]:`);
          for (let i = 0; i < 3; i++) {
            const sb = strainedBars[i];
            console.log(`  Bar ${sb.b} (v${sb.v0}->v${sb.v1}): rest=${sb.rest.toFixed(4)}, cur=${sb.len.toFixed(4)}, strain=${(sb.strain * 100).toFixed(4)}%`);
          }
        }

        // 1. Inextensibility: max strain strictly under 1%
        const maxStrain = solver.getMaxStrain() * 100;
        expect(maxStrain).toBeLessThan(1.0);

        // 2. Pin drift: P must remain rigidly fixed
        const pCurX = mesh.positions[vP * 3 + 0];
        const pCurY = mesh.positions[vP * 3 + 1];
        const pCurZ = mesh.positions[vP * 3 + 2];
        const pDrift = Math.hypot(pCurX - pInitX, pCurY - pInitY, pCurZ - pInitZ);
        expect(pDrift).toBeLessThan(1e-6);

        // 3. Table non-penetration: all vertices satisfy z >= targetZ - 1e-5
        let minZ = Infinity;
        for (let i = 0; i < mesh.numVertices; i++) {
          const z = mesh.positions[i * 3 + 2];
          if (z < minZ) minZ = z;
        }
        expect(minZ).toBeGreaterThanOrEqual(targetZ - 1e-5);

        // 4. Drag target tracking: Q must follow target position
        const qCurX = mesh.positions[vQ * 3 + 0];
        const qCurY = mesh.positions[vQ * 3 + 1];
        const qCurZ = mesh.positions[vQ * 3 + 2];
        const qDistToTarget = Math.hypot(qCurX - st.target[0], qCurY - st.target[1], qCurZ - st.target[2]);
        expect(qDistToTarget).toBeLessThan(1e-5);

        const pass = maxStrain < 1.0 && pDrift < 1e-6 && minZ >= targetZ - 1e-5 ? 'PASS ✓' : 'FAIL ✗';
        console.log(
          `${cfg.name.padEnd(12)} | ${st.name.padEnd(28)} | ${msPerFrame.toFixed(2).padStart(8)} | ${(maxStrain.toFixed(4) + '%').padStart(14)} | ${pDrift.toExponential(2).padStart(11)} | ${minZ.toFixed(4).padStart(9)} | ${pass}`
        );
      }
    }
    console.log('========================================================================================================\n');
  });
});
