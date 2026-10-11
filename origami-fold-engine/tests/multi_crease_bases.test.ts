import { describe, expect, it } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import {
  createWaterbombBasePattern,
  createPreliminaryBasePattern,
  createMiuraOriPattern,
} from '../../src/engine/fold';
import { createMeshFromFold, rampRestAngles } from '../../src/engine/mesh';
import {
  BarHingeSolver,
  computeMaxBarStrain,
  computeDihedralAngle,
  computeStableTimeStep,
} from '../../src/engine/physics';

export interface TrajectoryDump {
  modelName: string;
  numVertices: number;
  numTriangles: number;
  numBars: number;
  numHinges: number;
  indices: number[];
  alphaFrames: {
    alpha: number;
    positions: number[];
    maxStrain: number;
    creaseAnglesDeg: { id: number; assignment: string; targetDeg: number; currentDeg: number }[];
  }[];
}

describe('Phase 4: Multi-Crease Base Verification & Trajectory Recording', () => {
  const artifactDir = 'c:/Users/Gulraiz/.gemini/antigravity/brain/5eb405bc-ed6f-4994-9e61-977e5c6e7156';

  it('folds Waterbomb Base, Preliminary Base, and Miura-ori with low strain and records 3D trajectory', () => {
    const models = [
      {
        name: 'Waterbomb Base',
        pattern: createWaterbombBasePattern(1),
        fixedVertexIdx: 8, // Center vertex
        seedZ: (pos: Float64Array) => {
          // Center raised slightly
          pos[8 * 3 + 2] = 0.01;
        },
        maxAllowedStrain: 0.005, // < 0.5% strain
      },
      {
        name: 'Preliminary Base',
        pattern: createPreliminaryBasePattern(1),
        fixedVertexIdx: 8, // Center vertex
        seedZ: (pos: Float64Array) => {
          // Center raised slightly
          pos[8 * 3 + 2] = 0.01;
        },
        maxAllowedStrain: 0.005, // < 0.5% strain
      },
      {
        name: 'Miura-ori (2x2)',
        pattern: createMiuraOriPattern(2, 2, 1, 1, 0.15),
        fixedVertexIdx: 4, // Center vertex (col 1, row 1 = 1 * 3 + 1 = 4)
        seedZ: (pos: Float64Array, uvs: Float64Array) => {
          // Seed alternating out-of-plane perturbation according to Miura zigzag
          for (let i = 0; i < uvs.length / 2; i++) {
            const u = uvs[i * 2 + 0];
            const v = uvs[i * 2 + 1];
            pos[i * 3 + 2] = 0.008 * Math.sin(u * Math.PI * 2) * Math.sin(v * Math.PI * 2);
          }
        },
        maxAllowedStrain: 0.01, // < 1% strain
      },
    ];

    const allDumps: TrajectoryDump[] = [];

    for (const m of models) {
      const mesh = createMeshFromFold(m.pattern, {
        axialStiffness: 25000,
        creaseStiffness: 2.5,
        facetStiffness: 60.0,
      });

      const fixed = new Set<number>([m.fixedVertexIdx]);
      m.seedZ(mesh.positions, mesh.uvs);

      const dt = computeStableTimeStep(mesh, 0.4);
      const solver = new BarHingeSolver(mesh, {
        dt,
        damping: 0.93,
        fixedVertices: fixed,
      });

      const dump: TrajectoryDump = {
        modelName: m.name,
        numVertices: mesh.numVertices,
        numTriangles: mesh.numTriangles,
        numBars: mesh.bars.length,
        numHinges: mesh.hinges.length,
        indices: Array.from(mesh.indices),
        alphaFrames: [],
      };

      // Record initial flat frame alpha=0
      dump.alphaFrames.push({
        alpha: 0,
        positions: Array.from(mesh.positions),
        maxStrain: 0,
        creaseAnglesDeg: mesh.hinges
          .filter((h) => h.assignment === 'M' || h.assignment === 'V')
          .map((h) => ({
            id: h.id,
            assignment: h.assignment,
            targetDeg: (h.targetAngle * 180) / Math.PI,
            currentDeg: 0,
          })),
      });

      // Continuation over 10 alpha steps from 0.1 to 1.0
      const numAlphaSteps = 10;
      for (let step = 1; step <= numAlphaSteps; step++) {
        const alpha = step / numAlphaSteps;
        rampRestAngles(mesh, alpha);

        // Equilibrate at this alpha stage
        const res = solver.solveToEquilibrium(600, 1e-5, 0.01);

        const maxStrain = computeMaxBarStrain(mesh.bars, mesh.positions);
        const creaseAngles = mesh.hinges
          .filter((h) => h.assignment === 'M' || h.assignment === 'V')
          .map((h) => ({
            id: h.id,
            assignment: h.assignment,
            targetDeg: ((alpha * h.targetAngle) * 180) / Math.PI,
            currentDeg: (computeDihedralAngle(h, mesh.positions) * 180) / Math.PI,
          }));

        dump.alphaFrames.push({
          alpha,
          positions: Array.from(mesh.positions),
          maxStrain,
          creaseAnglesDeg: creaseAngles,
        });
      }

      allDumps.push(dump);

      const finalFrame = dump.alphaFrames[dump.alphaFrames.length - 1];
      console.log(`\n============================================================`);
      console.log(`[Phase 4 Verification] ${m.name}`);
      console.log(`  Vertices: ${mesh.numVertices}, Triangles: ${mesh.numTriangles}, Bars: ${mesh.bars.length}, Hinges: ${mesh.hinges.length}`);
      console.log(`  Final Max Bar Strain: ${(finalFrame.maxStrain * 100).toFixed(4)}% (Limit: ${(m.maxAllowedStrain * 100).toFixed(2)}%)`);

      // Compute average crease error at alpha=1.0
      let totalErr = 0;
      for (const ca of finalFrame.creaseAnglesDeg) {
        totalErr += Math.abs(ca.currentDeg - ca.targetDeg);
      }
      const avgCreaseErr = totalErr / finalFrame.creaseAnglesDeg.length;
      console.log(`  Avg Crease Angle Discrepancy: ${avgCreaseErr.toFixed(2)}° across ${finalFrame.creaseAnglesDeg.length} creases`);
      console.log(`============================================================`);

      expect(finalFrame.maxStrain).toBeLessThan(m.maxAllowedStrain);
    }

    // Save JSON trajectory dump
    const dumpPath = path.join(artifactDir, 'phase4_trajectory_dump.json');
    fs.writeFileSync(dumpPath, JSON.stringify(allDumps, null, 2), 'utf-8');
    console.log(`\n✓ Successfully saved trajectory dump to: ${dumpPath}`);
  });
});
