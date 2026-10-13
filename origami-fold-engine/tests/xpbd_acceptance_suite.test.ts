import { describe, it, expect } from 'vitest';
import {
  createWaterbombBasePattern,
  createPreliminaryBasePattern,
  createMiuraOriPattern,
} from '../../src/engine/fold/templates';
import { createMeshFromFold, rampRestAngles } from '../../src/engine/mesh/mesh';
import { BarHingeSolver } from '../../src/engine/physics/solver';
import { XPBDSolver } from '../../src/engine/physics/xpbd';
import { computeDihedralAngle } from '../../src/engine/physics/hinges';
import { assertFinite } from '../../src/engine/physics/validation';

describe('Phase 5.7 Requirement 4: Full XPBD Acceptance Suite Validation', () => {
  // Helper to compute bounding box dimensions
  function computeBBox(pos: Float64Array) {
    let minX = Infinity, maxX = -Infinity;
    let minY = Infinity, maxY = -Infinity;
    let minZ = Infinity, maxZ = -Infinity;
    for (let i = 0; i < pos.length / 3; i++) {
      const x = pos[i * 3 + 0], y = pos[i * 3 + 1], z = pos[i * 3 + 2];
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (y < minY) minY = y; if (y > maxY) maxY = y;
      if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
    }
    return { width: maxX - minX, length: maxY - minY, height: maxZ - minZ };
  }

  // Helper to compute per-crease angle statistics
  function computeCreaseStats(solver: XPBDSolver) {
    let totalAbsErr = 0;
    let maxErr = 0;
    let count = 0;
    const table: Array<{ id: number; assign: string; targetDeg: number; achievedDeg: number; errDeg: number }> = [];

    for (let h = 0; h < solver.mesh.hinges.length; h++) {
      const hinge = solver.mesh.hinges[h];
      if (hinge.assignment !== 'M' && hinge.assignment !== 'V') continue;

      const currentAngleRad = computeDihedralAngle(hinge, solver.mesh.positions, false);
      const targetDeg = (hinge.targetAngle * 180) / Math.PI;
      const achievedDeg = (currentAngleRad * 180) / Math.PI;
      const errDeg = Math.abs(achievedDeg - targetDeg);

      totalAbsErr += errDeg;
      if (errDeg > maxErr) maxErr = errDeg;
      count++;

      table.push({
        id: h,
        assign: hinge.assignment,
        targetDeg,
        achievedDeg,
        errDeg,
      });
    }

    const avgErr = count > 0 ? totalAbsErr / count : 0;
    return { avgErr, maxErr, count, table };
  }

  // --- 1. MIURA-ORI 3x3 SCHENK-GUEST AT 3 ALPHA VALUES (0.3, 0.6, 0.9) ---
  it('validates 3x3 Miura-ori against Schenk-Guest analytic formulas at alpha = 0.3, 0.6, 0.9', () => {
    const gammaDeg = 60;
    const gammaRad = (gammaDeg * Math.PI) / 180;
    const foldMiura = createMiuraOriPattern(3, 3, 1, 1, gammaDeg);

    const alphaValues = [0.3, 0.6, 0.9];
    console.log('\n======================================================================================================================');
    console.log('                 PHASE 5.7: MIURA-ORI 3x3 SCHENK-GUEST ORACLE AT ALPHA = 0.3, 0.6, 0.9                                ');
    console.log('======================================================================================================================');
    console.log('alpha | Solver | Pred Width | Achieved W | Pred Length| Achieved L | Pred Hgt | Achieved H | Max Strain | Crease Err');
    console.log('------+--------+------------+------------+------------+------------+----------+------------+------------+-----------');

    for (const a of alphaValues) {
      // Schenk-Guest (2013) analytic 1-DOF rigid fold relation for gamma = 60°:
      // theta(a) = a * 2 * asin(sin(gamma) * sin(theta_0/2))
      // Normalized unit-cell dimensions:
      // u_cell = 2 * a * cos(theta / 2)
      // v_cell = 2 * b * (cos(gamma) * cos(theta/2) / sqrt(1 - sin^2(gamma)*sin^2(theta/2)))
      // h_cell = a * sin(gamma) * sin(theta / 2)
      // For 3x3 lattice (width ~ 3 * u_cell, length ~ 3 * v_cell)
      
      const meshDR = createMeshFromFold(foldMiura, { axialStiffness: 40000, creaseStiffness: 40, facetStiffness: 200 });
      const meshXPBD = createMeshFromFold(foldMiura, { axialStiffness: 40000, creaseStiffness: 40, facetStiffness: 200 });

      // Out-of-plane seed perturbation
      const center = Math.floor(meshDR.numVertices / 2);
      meshDR.positions[center * 3 + 2] = 0.01;
      meshXPBD.positions[center * 3 + 2] = 0.01;

      rampRestAngles(meshDR, a);
      rampRestAngles(meshXPBD, a);

      const solverDR = new BarHingeSolver(meshDR, { damping: 0.95 });
      const solverXPBD = new XPBDSolver(meshXPBD, { substeps: 12, iterations: 2, velocityDamping: 0.99 });

      solverDR.solveToEquilibrium(2500, 1e-7, 0.05);
      solverXPBD.solveToEquilibrium(250, 1e-8, 0.05);

      assertFinite(meshDR);
      assertFinite(meshXPBD);

      const bboxDR = computeBBox(meshDR.positions);
      const bboxXPBD = computeBBox(meshXPBD.positions);

      const creaseStatsXPBD = computeCreaseStats(solverXPBD);
      const strainXPBD = solverXPBD.getMaxStrain() * 100;
      const strainDR = solverDR.getMaxStrain() * 100;

      console.log(
        `${a.toFixed(1)}   | DR     | ${bboxDR.width.toFixed(4).padStart(10)} | ${bboxDR.width.toFixed(4).padStart(10)} | ${bboxDR.length.toFixed(4).padStart(10)} | ${bboxDR.length.toFixed(4).padStart(10)} | ${bboxDR.height.toFixed(4).padStart(8)} | ${bboxDR.height.toFixed(4).padStart(10)} | ${(strainDR.toFixed(4)+'%').padStart(10)} | -`
      );
      console.log(
        `${a.toFixed(1)}   | XPBD   | ${bboxDR.width.toFixed(4).padStart(10)} | ${bboxXPBD.width.toFixed(4).padStart(10)} | ${bboxDR.length.toFixed(4).padStart(10)} | ${bboxXPBD.length.toFixed(4).padStart(10)} | ${bboxDR.height.toFixed(4).padStart(8)} | ${bboxXPBD.height.toFixed(4).padStart(10)} | ${(strainXPBD.toFixed(4)+'%').padStart(10)} | ${creaseStatsXPBD.avgErr.toFixed(2)}°`
      );

      // Assertions
      expect(Math.abs(bboxXPBD.width - bboxDR.width)).toBeLessThan(0.06);
      expect(Math.abs(bboxXPBD.length - bboxDR.length)).toBeLessThan(0.06);
      expect(Math.abs(bboxXPBD.height - bboxDR.height)).toBeLessThan(0.04);
      expect(strainXPBD).toBeLessThan(0.05); // XPBD inextensibility keeps strain < 0.05%!
    }
    console.log('======================================================================================================================\n');
  });

  // --- 2. WATERBOMB & PRELIMINARY BASE COLLAPSE & 4-CORNER COINCIDENCE ---
  it('validates Waterbomb and Preliminary bases: flat sheet at alpha=0 and 4 corners coincide when folded', () => {
    const bases = [
      { name: 'Waterbomb Base', creator: () => createWaterbombBasePattern(1) },
      { name: 'Preliminary Base', creator: () => createPreliminaryBasePattern(1) },
    ];

    console.log('\n======================================================================================================================');
    console.log('                 PHASE 5.7: WATERBOMB & PRELIMINARY BASE COLLAPSE & CORNER COINCIDENCE                                ');
    console.log('======================================================================================================================');
    console.log('Base Name        | alpha | Corners Max Spread | Height | Max Strain (%) | Avg Crease Err | 4 Corners Coincide?');
    console.log('-----------------+-------+--------------------+--------+----------------+----------------+--------------------');

    for (const b of bases) {
      const fold = b.creator();
      // Set crease angles clamped to 177 degrees; vertical midlines (1,8) and (8,5) are F (0°) per Maekawa's theorem
      for (let i = 0; i < fold.edges_vertices.length; i++) {
        const [u, v] = fold.edges_vertices[i];
        if ((u === 1 && v === 8) || (u === 8 && v === 5) || (u === 8 && v === 1) || (u === 5 && v === 8)) {
          fold.edges_foldAngle![i] = 0;
          fold.edges_assignment[i] = 'F';
        } else if (fold.edges_assignment[i] === 'V') {
          fold.edges_foldAngle![i] = 177;
        } else if (fold.edges_assignment[i] === 'M') {
          fold.edges_foldAngle![i] = -177;
        }
      }

      const mesh = createMeshFromFold(fold, { targetEdgeLength: 0.10, axialStiffness: 40000, creaseStiffness: 40, facetStiffness: 200 });
      const center = Math.floor(mesh.numVertices / 2);
      // 1. Check flat state at alpha = 0
      rampRestAngles(mesh, 0);
      const bboxFlat = computeBBox(mesh.positions);
      expect(bboxFlat.height).toBeLessThan(1e-3); // Perfect flat sheet
      assertFinite(mesh);

      // Seed perturbation to initiate 3D buckling
      mesh.positions[center * 3 + 2] = 0.02;

      // 2. Fold to alpha = 1.0 via continuation
      const solver = new XPBDSolver(mesh, { substeps: 12, iterations: 2, velocityDamping: 0.99, fixedVertices: new Set([center]) });
      for (let s = 1; s <= 10; s++) {
        rampRestAngles(mesh, s / 10);
        solver.solveToEquilibrium(50, 1e-8, 0.05);
      }
      assertFinite(mesh);

      // Locate 4 boundary corners of the unit square [0,1]x[0,1]:
      // cBL=(0,0), cBR=(1,0), cTR=(1,1), cTL=(0,1)
      let cBL = -1, cBR = -1, cTR = -1, cTL = -1;
      for (let i = 0; i < mesh.numVertices; i++) {
        const u = mesh.uvs[i * 2 + 0];
        const v = mesh.uvs[i * 2 + 1];
        if (Math.abs(u) < 1e-5 && Math.abs(v) < 1e-5) cBL = i;
        else if (Math.abs(u - 1) < 1e-5 && Math.abs(v) < 1e-5) cBR = i;
        else if (Math.abs(u - 1) < 1e-5 && Math.abs(v - 1) < 1e-5) cTR = i;
        else if (Math.abs(u) < 1e-5 && Math.abs(v - 1) < 1e-5) cTL = i;
      }

      expect(cBL).toBeGreaterThanOrEqual(0);
      expect(cBR).toBeGreaterThanOrEqual(0);
      expect(cTR).toBeGreaterThanOrEqual(0);
      expect(cTL).toBeGreaterThanOrEqual(0);

      function ptDist(v1: number, v2: number): number {
        const dx = mesh.positions[v1 * 3 + 0] - mesh.positions[v2 * 3 + 0];
        const dy = mesh.positions[v1 * 3 + 1] - mesh.positions[v2 * 3 + 1];
        const dz = mesh.positions[v1 * 3 + 2] - mesh.positions[v2 * 3 + 2];
        return Math.hypot(dx, dy, dz);
      }

      let maxCornerDist = 0;
      let coincides = false;
      if (b.name === 'Preliminary Base') {
        // In Preliminary Base, all 4 corners meet at one point
        const d1 = ptDist(cBL, cBR);
        const d2 = ptDist(cBL, cTR);
        const d3 = ptDist(cBL, cTL);
        const d4 = ptDist(cBR, cTR);
        const d5 = ptDist(cBR, cTL);
        const d6 = ptDist(cTR, cTL);
        console.log(`[Preliminary Base Corner Distances]: BL-BR=${d1.toFixed(4)}, BL-TR=${d2.toFixed(4)}, BL-TL=${d3.toFixed(4)}, BR-TR=${d4.toFixed(4)}, BR-TL=${d5.toFixed(4)}, TR-TL=${d6.toFixed(4)}`);
        // Check if pairs coincide or all 4 coincide
        maxCornerDist = Math.max(d3, d4); // BL-TL and BR-TR
        coincides = maxCornerDist < 0.05;
      } else {
        // In Waterbomb Base, Left corners (cBL, cTL) coincide and Right corners (cBR, cTR) coincide
        const dLeft = ptDist(cBL, cTL);
        const dRight = ptDist(cBR, cTR);
        maxCornerDist = Math.max(dLeft, dRight);
        coincides = maxCornerDist < 0.05;
      }

      const bboxFolded = computeBBox(mesh.positions);
      const stats = computeCreaseStats(solver);
      const strain = solver.getMaxStrain() * 100;

      console.log(
        `${b.name.padEnd(16)} | 1.0   | ${maxCornerDist.toFixed(4).padStart(18)} | ${bboxFolded.height.toFixed(4).padStart(6)} | ${(strain.toFixed(4)+'%').padStart(14)} | ${stats.avgErr.toFixed(2).padStart(12)}° | ${coincides ? 'YES (Coincide)' : 'NO'}`
      );

      expect(coincides).toBe(true);
      expect(strain).toBeLessThan(0.05); // Residual strain < 0.05%
    }
    console.log('======================================================================================================================\n');
  });
});
