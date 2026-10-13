import { describe, it } from 'vitest';
import {
  createWaterbombBasePattern,
  createPreliminaryBasePattern,
  createMiuraOriPattern,
} from '../../src/engine/fold';
import { createMeshFromFold, rampRestAngles } from '../../src/engine/mesh';
import {
  BarHingeSolver,
  XPBDSolver,
  computeDihedralAngle,
  assertFinite,
} from '../../src/engine/physics';
import { TriMesh } from '../../src/engine/types';

describe('Phase 5.8 Audit & Verification', () => {
  it('measures XPBD drag timing per frame at 121V and 441V', () => {
    const configs = [
      { name: '121 Vertices', targetEdgeLength: 0.10 },
      { name: '441 Vertices', targetEdgeLength: 0.05 },
    ];

    console.log('\n========================================================================================');
    console.log('       PHASE 5.8 REQ 1: XPBD TIMING PER FRAME DURING DRAG (dt=0.016s, 10 substeps)      ');
    console.log('========================================================================================');
    console.log('Model      | Substeps/Frame | Iters/Substep | ms/frame | Substep ms | Max Strain | Finite?');
    console.log('-----------+----------------+---------------+----------+------------+------------+--------');

    for (const cfg of configs) {
      const fold = createWaterbombBasePattern(1);
      const mesh = createMeshFromFold(fold, { targetEdgeLength: cfg.targetEdgeLength });
      
      const solver = new XPBDSolver(mesh, {
        substeps: 10,
        iterations: 2,
        fixedVertices: [0], // Pin P = vertex 0
      });

      // Drag vertex Q (center vertex)
      const qIndex = Math.floor(mesh.numVertices / 2);
      const qTarget: [number, number, number] = [
        mesh.positions[qIndex * 3 + 0] * 0.8,
        mesh.positions[qIndex * 3 + 1] * 0.8,
        0.05,
      ];
      solver.setDragTarget(qIndex, qTarget);

      // Warm up JIT
      for (let f = 0; f < 5; f++) solver.step(0.016);

      // Measure 60 frames of drag simulation
      const N_FRAMES = 60;
      const t0 = performance.now();
      for (let f = 0; f < N_FRAMES; f++) {
        solver.step(0.016);
      }
      const totalMs = performance.now() - t0;
      const msPerFrame = totalMs / N_FRAMES;
      const msPerSubstep = msPerFrame / 10;
      const maxStrain = solver.getMaxStrain() * 100;

      assertFinite(mesh);

      console.log(
        `${cfg.name.padEnd(10)} | ${'10'.padStart(14)} | ${'2'.padStart(13)} | ${msPerFrame.toFixed(2).padStart(8)} | ${msPerSubstep.toFixed(3).padStart(10)} | ${(maxStrain.toFixed(4) + '%').padStart(10)} | YES ✓`
      );
    }
    console.log('========================================================================================\n');
  });

  it('generates per-crease target vs achieved angle table and max strain for XPBD vs DR reference', () => {
    function createDual8LineBases(size = 1): { wb: any; pb: any } {
      const half = size / 2;
      const vertices_coords: [number, number][] = [
        [0, 0], [half, 0], [size, 0], [size, half],
        [size, size], [half, size], [0, size], [0, half],
        [half, half],
      ];
      const boundary_edges: [number, number][] = [
        [0, 1], [1, 2], [2, 3], [3, 4], [4, 5], [5, 6], [6, 7], [7, 0],
      ];
      const interior_edges: [number, number][] = [
        [7, 8], [8, 3], [1, 8], [8, 5], [0, 8], [8, 4], [6, 8], [8, 2],
      ];
      const faces_vertices: number[][] = [
        [0, 1, 8], [1, 2, 8], [2, 3, 8], [3, 4, 8],
        [4, 5, 8], [5, 6, 8], [6, 7, 8], [7, 0, 8],
      ];

      const wb = {
        file_spec: 1.1,
        file_creator: 'origami-fold-engine',
        file_title: 'Waterbomb Base (Dual 8-Line)',
        vertices_coords,
        edges_vertices: [...boundary_edges, ...interior_edges],
        edges_assignment: ['B', 'B', 'B', 'B', 'B', 'B', 'B', 'B', 'M', 'M', 'F', 'F', 'V', 'V', 'V', 'V'],
        edges_foldAngle: [0, 0, 0, 0, 0, 0, 0, 0, -180, -180, 0, 0, 180, 180, 180, 180],
        faces_vertices,
      };

      const pb = {
        file_spec: 1.1,
        file_creator: 'origami-fold-engine',
        file_title: 'Preliminary Base (Dual 8-Line)',
        vertices_coords,
        edges_vertices: [...boundary_edges, ...interior_edges],
        edges_assignment: ['B', 'B', 'B', 'B', 'B', 'B', 'B', 'B', 'V', 'V', 'F', 'F', 'M', 'M', 'M', 'M'],
        edges_foldAngle: [0, 0, 0, 0, 0, 0, 0, 0, 180, 180, 0, 0, -180, -180, -180, -180],
        faces_vertices,
      };

      return { wb, pb };
    }

    const { wb, pb } = createDual8LineBases(1);
    const gammaRad = (60 * Math.PI) / 180;
    const miura = createMiuraOriPattern(3, 3, 1, 1, 60);
    const miuraThetaVRad = (45 * Math.PI) / 180;
    const miuraThetaHRad = 2 * Math.asin(Math.tan(gammaRad / 2) * Math.sin(miuraThetaVRad / 2));
    const clampRad = (177 * Math.PI) / 180;

    const models = [
      {
        name: 'Waterbomb Base (Dual 8-Line)',
        fold: wb,
        fixedVertex: 8,
        seedZ: (pos: Float64Array) => {
          pos[8 * 3 + 2] = 0.05;
          pos[7 * 3 + 2] = 0.02;
          pos[3 * 3 + 2] = 0.02;
        },
        setupTargets: (mesh: TriMesh) => {
          for (const h of mesh.hinges) {
            if (h.assignment === 'V') h.targetAngle = clampRad;
            if (h.assignment === 'M') h.targetAngle = -clampRad;
            h.restAngle = h.targetAngle;
          }
        },
      },
      {
        name: 'Preliminary Base (Dual 8-Line)',
        fold: pb,
        fixedVertex: 8,
        seedZ: (pos: Float64Array) => {
          pos[8 * 3 + 2] = -0.05;
          pos[7 * 3 + 2] = -0.02;
          pos[3 * 3 + 2] = -0.02;
        },
        setupTargets: (mesh: TriMesh) => {
          for (const h of mesh.hinges) {
            if (h.assignment === 'V') h.targetAngle = clampRad;
            if (h.assignment === 'M') h.targetAngle = -clampRad;
            h.restAngle = h.targetAngle;
          }
        },
      },
      {
        name: 'Miura-ori (3x3)',
        fold: miura,
        fixedVertex: 0,
        seedZ: (pos: Float64Array, uvs: Float64Array) => {
          for (let i = 0; i < pos.length / 3; i++) {
            const u = uvs[i * 2 + 0];
            const v = uvs[i * 2 + 1];
            pos[i * 3 + 2] = 0.05 * Math.sin(u * Math.PI * 2) * Math.sin(v * Math.PI * 2);
          }
        },
        setupTargets: (mesh: TriMesh) => {
          for (const h of mesh.hinges) {
            if (h.assignment === 'M' || h.assignment === 'V') {
              const v0 = mesh.uvs[h.v0 * 2 + 1];
              const v1 = mesh.uvs[h.v1 * 2 + 1];
              const isHorizontal = Math.abs(v1 - v0) < 1e-4;
              const sign = h.assignment === 'V' ? 1 : -1;
              h.targetAngle = isHorizontal ? sign * miuraThetaHRad : sign * miuraThetaVRad;
              h.restAngle = h.targetAngle;
            }
          }
        },
      },
    ];

    console.log('\n============================================================================================================');
    console.log('       PHASE 5.8 REQ 2: PER-CREASE TARGET VS ACHIEVED ANGLE & MAX STRAIN (XPBD vs REFERENCE)                ');
    console.log('============================================================================================================');

    for (const m of models) {
      console.log(`\n--- MODEL: ${m.name} ---`);
      console.log('Crease ID | Assign | Target (deg) | DR Achieved | DR Error | XPBD Achieved | XPBD Error');
      console.log('----------+--------+--------------+-------------+----------+---------------+-----------');

      // 1. DR Reference
      const meshDR = createMeshFromFold(m.fold, {
        axialStiffness: 40000,
        creaseStiffness: 40,
        facetStiffness: 80,
      });
      m.setupTargets(meshDR);
      m.seedZ(meshDR.positions, meshDR.uvs);
      const solverDR = new BarHingeSolver(meshDR, { damping: 0.93, fixedVertices: new Set([m.fixedVertex]) });
      solverDR.solveToEquilibrium(8000, 1e-8, 0.005);
      assertFinite(meshDR);

      // 2. XPBD Solver
      const meshXPBD = createMeshFromFold(m.fold, {
        axialStiffness: 40000,
        creaseStiffness: 40,
        facetStiffness: 80,
      });
      m.setupTargets(meshXPBD);
      m.seedZ(meshXPBD.positions, meshXPBD.uvs);
      const solverXPBD = new XPBDSolver(meshXPBD, {
        substeps: 12,
        iterations: 1,
        distanceIterations: 8,
        fixedVertices: [m.fixedVertex],
      });
      solverXPBD.solveToEquilibrium(800, 1e-8, 0.005);
      assertFinite(meshXPBD);

      let maxErrDR = 0;
      let maxErrXPBD = 0;

      for (let hIdx = 0; hIdx < meshDR.hinges.length; hIdx++) {
        const hDR = meshDR.hinges[hIdx];
        const hXPBD = meshXPBD.hinges[hIdx];
        if (hDR.assignment !== 'M' && hDR.assignment !== 'V') continue;

        const targetDeg = (hDR.targetAngle * 180) / Math.PI;
        const angDR = (computeDihedralAngle(hDR, meshDR.positions) * 180) / Math.PI;
        const angXPBD = (computeDihedralAngle(hXPBD, meshXPBD.positions) * 180) / Math.PI;

        const errDR = Math.abs(angDR - targetDeg);
        const errXPBD = Math.abs(angXPBD - targetDeg);

        if (errDR > maxErrDR) maxErrDR = errDR;
        if (errXPBD > maxErrXPBD) maxErrXPBD = errXPBD;

        console.log(
          `${hIdx.toString().padStart(9)} | ${hDR.assignment.padStart(6)} | ${targetDeg.toFixed(2).padStart(12)} | ${angDR.toFixed(2).padStart(11)} | ${errDR.toFixed(2).padStart(8)} | ${angXPBD.toFixed(2).padStart(13)} | ${errXPBD.toFixed(2).padStart(9)}`
        );
      }

      console.log('----------+--------+--------------+-------------+----------+---------------+-----------');
      console.log(`[Summary for ${m.name}]:`);
      console.log(`  DR Reference: Max Crease Error = ${maxErrDR.toFixed(2)}°, Max Bar Strain = ${(solverDR.getMaxStrain() * 100).toFixed(4)}%`);
      console.log(`  XPBD Solver:  Max Crease Error = ${maxErrXPBD.toFixed(2)}°, Max Bar Strain = ${(solverXPBD.getMaxStrain() * 100).toFixed(4)}%`);
    }
    console.log('============================================================================================================\n');
  });
});
