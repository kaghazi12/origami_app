import { describe, expect, it } from 'vitest';
import { accumulateBarForces } from '../../src/engine/physics/bars';
import { accumulateHingeForces, computeDihedralAngle } from '../../src/engine/physics/hinges';
import { BarElement, HingeElement } from '../../src/engine/types';

function cross3D(
  ax: number, ay: number, az: number,
  bx: number, by: number, bz: number
): [number, number, number] {
  return [
    ay * bz - az * by,
    az * bx - ax * bz,
    ax * by - ay * bx,
  ];
}

describe('Phase 3.5: Hardening Pass - Finite-Difference Gradient & Momentum Checks', () => {
  it('axial bar forces match -dE/dx with relative error < 1e-5, zero net force and zero net torque', () => {
    const numTrials = 25;
    const eps = 1e-7;

    for (let trial = 0; trial < numTrials; trial++) {
      // Generate random non-degenerate 2-vertex bar
      const p0 = [
        (Math.random() - 0.5) * 4,
        (Math.random() - 0.5) * 4,
        (Math.random() - 0.5) * 4,
      ];
      // Ensure distance at least 0.2
      const dir = [
        Math.random() - 0.5,
        Math.random() - 0.5,
        Math.random() - 0.5,
      ];
      const dLen = Math.hypot(dir[0], dir[1], dir[2]) || 1;
      const actualLen = 0.2 + Math.random() * 2.0;
      const p1 = [
        p0[0] + (dir[0] / dLen) * actualLen,
        p0[1] + (dir[1] / dLen) * actualLen,
        p0[2] + (dir[2] / dLen) * actualLen,
      ];

      const restLength = 0.2 + Math.random() * 2.0;
      const stiffness = 100 + Math.random() * 5000;

      const bar: BarElement = {
        v0: 0,
        v1: 1,
        restLength,
        stiffness,
      };

      const positions = new Float64Array([...p0, ...p1]);
      const analyticalForces = new Float64Array(6);

      // 1. Analytical energy and forces
      const energy0 = accumulateBarForces([bar], positions, analyticalForces);

      // Energy evaluator helper
      const evalEnergy = (pos: Float64Array): number => {
        const dummyForces = new Float64Array(6);
        return accumulateBarForces([bar], pos, dummyForces);
      };

      // 2. Numerical gradient check via central differences: F_i = -dE/dx_i
      for (let coord = 0; coord < 6; coord++) {
        const originalVal = positions[coord];

        positions[coord] = originalVal + eps;
        const ePlus = evalEnergy(positions);

        positions[coord] = originalVal - eps;
        const eMinus = evalEnergy(positions);

        positions[coord] = originalVal;

        const numericalForce = -(ePlus - eMinus) / (2 * eps);
        const analyticalForce = analyticalForces[coord];

        const denom = Math.max(Math.abs(analyticalForce), 1.0);
        const relError = Math.abs(analyticalForce - numericalForce) / denom;

        expect(relError).toBeLessThan(1e-5);
      }

      // 3. Zero net force (conservation of linear momentum)
      const netFx = analyticalForces[0] + analyticalForces[3];
      const netFy = analyticalForces[1] + analyticalForces[4];
      const netFz = analyticalForces[2] + analyticalForces[5];
      expect(Math.abs(netFx)).toBeLessThan(1e-12);
      expect(Math.abs(netFy)).toBeLessThan(1e-12);
      expect(Math.abs(netFz)).toBeLessThan(1e-12);

      // 4. Zero net torque (conservation of angular momentum): sum(r_i x F_i) = 0
      const t0 = cross3D(
        positions[0], positions[1], positions[2],
        analyticalForces[0], analyticalForces[1], analyticalForces[2]
      );
      const t1 = cross3D(
        positions[3], positions[4], positions[5],
        analyticalForces[3], analyticalForces[4], analyticalForces[5]
      );
      const netTx = t0[0] + t1[0];
      const netTy = t0[1] + t1[1];
      const netTz = t0[2] + t1[2];

      expect(Math.abs(netTx)).toBeLessThan(1e-11);
      expect(Math.abs(netTy)).toBeLessThan(1e-11);
      expect(Math.abs(netTz)).toBeLessThan(1e-11);
    }
  });

  it('torsional hinge forces match -dE/dx with relative error < 1e-5, zero net force and zero net torque', () => {
    const numTrials = 30;
    const eps = 1e-7;

    for (let trial = 0; trial < numTrials; trial++) {
      // Construct non-degenerate 4-vertex hinge:
      // v0 at (0, 0, 0), v1 along x-axis
      const edgeLen = 0.5 + Math.random() * 2.0;
      const v0: [number, number, number] = [
        (Math.random() - 0.5) * 2,
        (Math.random() - 0.5) * 2,
        (Math.random() - 0.5) * 2,
      ];
      // Random direction for e = v1 - v0
      const edir = [Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5];
      const edirLen = Math.hypot(edir[0], edir[1], edir[2]) || 1;
      const ex = (edir[0] / edirLen) * edgeLen;
      const ey = (edir[1] / edirLen) * edgeLen;
      const ez = (edir[2] / edirLen) * edgeLen;
      const v1: [number, number, number] = [v0[0] + ex, v0[1] + ey, v0[2] + ez];

      // Perpendicular vectors to e for triangle 1 and triangle 2
      let perp1 = cross3D(ex, ey, ez, 1, 0, 0);
      if (Math.hypot(perp1[0], perp1[1], perp1[2]) < 0.1) {
        perp1 = cross3D(ex, ey, ez, 0, 1, 0);
      }
      const p1Len = Math.hypot(perp1[0], perp1[1], perp1[2]);
      perp1 = [perp1[0] / p1Len, perp1[1] / p1Len, perp1[2] / p1Len];

      // Second perpendicular vector
      const perp2 = cross3D(ex, ey, ez, perp1[0], perp1[1], perp1[2]);
      const p2Len = Math.hypot(perp2[0], perp2[1], perp2[2]);
      const perp2Norm = [perp2[0] / p2Len, perp2[1] / p2Len, perp2[2] / p2Len];

      // Angle for triangle 1 wing
      const phi1 = (Math.random() - 0.5) * Math.PI * 0.8;
      // Angle for triangle 2 wing (ensure non-flat and non-degenerate)
      const phi2 = phi1 + 0.3 + Math.random() * (Math.PI * 1.4);

      const h1 = 0.4 + Math.random() * 1.5;
      const h2 = 0.4 + Math.random() * 1.5;
      const mid = 0.2 + Math.random() * 0.6;

      // v2 vertex (opposite v3, attached to v0-v1)
      const v2: [number, number, number] = [
        v0[0] + mid * ex + h1 * (Math.cos(phi1) * perp1[0] + Math.sin(phi1) * perp2Norm[0]),
        v0[1] + mid * ey + h1 * (Math.cos(phi1) * perp1[1] + Math.sin(phi1) * perp2Norm[1]),
        v0[2] + mid * ez + h1 * (Math.cos(phi1) * perp1[2] + Math.sin(phi1) * perp2Norm[2]),
      ];

      // v3 vertex
      const v3: [number, number, number] = [
        v0[0] + mid * ex + h2 * (Math.cos(phi2) * perp1[0] + Math.sin(phi2) * perp2Norm[0]),
        v0[1] + mid * ey + h2 * (Math.cos(phi2) * perp1[1] + Math.sin(phi2) * perp2Norm[1]),
        v0[2] + mid * ez + h2 * (Math.cos(phi2) * perp1[2] + Math.sin(phi2) * perp2Norm[2]),
      ];

      const restAngle = (Math.random() - 0.5) * Math.PI; // -90 to +90 deg
      const stiffness = 2 + Math.random() * 50;

      const hinge: HingeElement = {
        id: trial,
        v0: 0,
        v1: 1,
        v2: 2,
        v3: 3,
        assignment: 'V',
        targetAngle: restAngle,
        restAngle,
        stiffness,
      };

      const positions = new Float64Array([...v0, ...v1, ...v2, ...v3]);
      const analyticalForces = new Float64Array(12);

      // Analytical energy and forces
      accumulateHingeForces([hinge], positions, analyticalForces);

      const evalEnergy = (pos: Float64Array): number => {
        const dummyForces = new Float64Array(12);
        // Do not update previousAngle during finite difference queries
        const hCopy = { ...hinge };
        return accumulateHingeForces([hCopy], pos, dummyForces);
      };

      // Numerical gradient checks: F_i = -dE/dx_i
      for (let coord = 0; coord < 12; coord++) {
        const orig = positions[coord];

        positions[coord] = orig + eps;
        const ePlus = evalEnergy(positions);

        positions[coord] = orig - eps;
        const eMinus = evalEnergy(positions);

        positions[coord] = orig;

        const numForce = -(ePlus - eMinus) / (2 * eps);
        const anaForce = analyticalForces[coord];

        const denom = Math.max(Math.abs(anaForce), 1.0);
        const relErr = Math.abs(anaForce - numForce) / denom;

        expect(relErr).toBeLessThan(1e-5);
      }

      // Zero net force: sum(F_i) = 0
      let sumFx = 0, sumFy = 0, sumFz = 0;
      for (let i = 0; i < 4; i++) {
        sumFx += analyticalForces[i * 3 + 0];
        sumFy += analyticalForces[i * 3 + 1];
        sumFz += analyticalForces[i * 3 + 2];
      }
      expect(Math.abs(sumFx)).toBeLessThan(1e-11);
      expect(Math.abs(sumFy)).toBeLessThan(1e-11);
      expect(Math.abs(sumFz)).toBeLessThan(1e-11);

      // Zero net torque: sum(r_i x F_i) = 0
      let sumTx = 0, sumTy = 0, sumTz = 0;
      for (let i = 0; i < 4; i++) {
        const rx = positions[i * 3 + 0];
        const ry = positions[i * 3 + 1];
        const rz = positions[i * 3 + 2];
        const fx = analyticalForces[i * 3 + 0];
        const fy = analyticalForces[i * 3 + 1];
        const fz = analyticalForces[i * 3 + 2];
        const [tx, ty, tz] = cross3D(rx, ry, rz, fx, fy, fz);
        sumTx += tx;
        sumTy += ty;
        sumTz += tz;
      }
      expect(Math.abs(sumTx)).toBeLessThan(1e-11);
      expect(Math.abs(sumTy)).toBeLessThan(1e-11);
      expect(Math.abs(sumTz)).toBeLessThan(1e-11);
    }
  });

  it('continuous dihedral angle unwrapping drives hinge past ±180° to 200° and back without flipping', () => {
    // Hinge along y-axis: v0 = (0, 0, 0), v1 = (0, 1, 0)
    // Triangle 1 fixed on xy-plane: v2 = (-1, 0.5, 0)
    // Triangle 2 rotating around y-axis: v3 = (cos(theta), 0.5, sin(theta))
    const hinge: HingeElement = {
      id: 99,
      v0: 0,
      v1: 1,
      v2: 2,
      v3: 3,
      assignment: 'V',
      targetAngle: 0,
      restAngle: 0,
      previousAngle: 0,
      stiffness: 10,
    };

    const positions = new Float64Array([
      0, 0, 0,    // v0
      0, 1, 0,    // v1
      -1, 0.5, 0, // v2
      1, 0.5, 0,  // v3 initial (flat: angle = 0)
    ]);

    // Track angles as we rotate from 0° to 200° in 1° increments
    const trackedAnglesDeg: number[] = [];

    // Drive 0 -> 200 deg
    for (let deg = 0; deg <= 200; deg++) {
      const rad = (deg * Math.PI) / 180;
      // In our convention: valley fold lifts v2 and v3 towards +z
      // For v2 = (-1, 0.5, 0), normal n1 = e x u2 = (0, 1, 0) x (-1, 0.5, 0) = (0, 0, 1)
      // For v3 with dihedral angle theta: n2 rotated by theta
      // v3 coordinates:
      positions[3 * 3 + 0] = Math.cos(rad);
      positions[3 * 3 + 1] = 0.5;
      positions[3 * 3 + 2] = Math.sin(rad);

      const computedRad = computeDihedralAngle(hinge, positions);
      const computedDeg = (computedRad * 180) / Math.PI;
      trackedAnglesDeg.push(computedDeg);
    }

    // Drive 200 -> 0 deg
    for (let deg = 199; deg >= 0; deg--) {
      const rad = (deg * Math.PI) / 180;
      positions[3 * 3 + 0] = Math.cos(rad);
      positions[3 * 3 + 1] = 0.5;
      positions[3 * 3 + 2] = Math.sin(rad);

      const computedRad = computeDihedralAngle(hinge, positions);
      const computedDeg = (computedRad * 180) / Math.PI;
      trackedAnglesDeg.push(computedDeg);
    }

    // Assert continuity: step difference is always <= 1.5° (no 360° or 180° discontinuous jumps)
    for (let i = 1; i < trackedAnglesDeg.length; i++) {
      const stepDiff = Math.abs(trackedAnglesDeg[i] - trackedAnglesDeg[i - 1]);
      expect(stepDiff).toBeLessThan(1.5);
    }

    // Peak angle reaches 200° (within 0.1°)
    const peakAngle = trackedAnglesDeg[200];
    expect(Math.abs(peakAngle - 200)).toBeLessThan(0.1);

    // Final angle returns to 0°
    const finalAngle = trackedAnglesDeg[trackedAnglesDeg.length - 1];
    expect(Math.abs(finalAngle - 0)).toBeLessThan(0.1);
  });
});
