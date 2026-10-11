import { HingeElement } from '../types';

/**
 * Computes the current dihedral angle (in radians) across a hinge
 */
export function computeDihedralAngle(hinge: HingeElement, positions: Float64Array): number {
  const i0 = hinge.v0 * 3;
  const i1 = hinge.v1 * 3;
  const i2 = hinge.v2 * 3;
  const i3 = hinge.v3 * 3;

  // e = x1 - x0
  const ex = positions[i1 + 0] - positions[i0 + 0];
  const ey = positions[i1 + 1] - positions[i0 + 1];
  const ez = positions[i1 + 2] - positions[i0 + 2];
  const eLen = Math.hypot(ex, ey, ez);
  if (eLen < 1e-12) return 0;

  // u2 = x2 - x0
  const u2x = positions[i2 + 0] - positions[i0 + 0];
  const u2y = positions[i2 + 1] - positions[i0 + 1];
  const u2z = positions[i2 + 2] - positions[i0 + 2];

  // n1 = e x u2
  const n1x = ey * u2z - ez * u2y;
  const n1y = ez * u2x - ex * u2z;
  const n1z = ex * u2y - ey * u2x;
  const a1 = Math.hypot(n1x, n1y, n1z);
  if (a1 < 1e-12) return 0;

  // u3 = x3 - x0
  const u3x = positions[i3 + 0] - positions[i0 + 0];
  const u3y = positions[i3 + 1] - positions[i0 + 1];
  const u3z = positions[i3 + 2] - positions[i0 + 2];

  // n2 = u3 x e
  const n2x = u3y * ez - u3z * ey;
  const n2y = u3z * ex - u3x * ez;
  const n2z = u3x * ey - u3y * ex;
  const a2 = Math.hypot(n2x, n2y, n2z);
  if (a2 < 1e-12) return 0;

  // Normalize n1 and n2
  const un1x = n1x / a1;
  const un1y = n1y / a1;
  const un1z = n1z / a1;

  const un2x = n2x / a2;
  const un2y = n2y / a2;
  const un2z = n2z / a2;

  // cosTheta = un1 . un2
  const cosTheta = un1x * un2x + un1y * un2y + un1z * un2z;

  // crossN = un1 x un2
  const cnx = un1y * un2z - un1z * un2y;
  const cny = un1z * un2x - un1x * un2z;
  const cnz = un1x * un2y - un1y * un2x;

  // sinTheta = -(crossN . e_hat) so valley folds (lifted toward +z) yield positive theta
  const sinTheta = -(cnx * ex + cny * ey + cnz * ez) / eLen;

  const rawTheta = Math.atan2(sinTheta, Math.max(-1, Math.min(1, cosTheta)));
  let theta = rawTheta;
  if (hinge.previousAngle !== undefined) {
    const k = Math.round((hinge.previousAngle - rawTheta) / (2 * Math.PI));
    theta = rawTheta + k * 2 * Math.PI;
  }
  hinge.previousAngle = theta;
  return theta;
}

/**
 * Computes torsional hinge forces for all hinges and accumulates them into forces Float64Array.
 * Returns total hinge bending potential energy.
 */
export function accumulateHingeForces(
  hinges: HingeElement[],
  positions: Float64Array,
  forces: Float64Array
): number {
  let totalEnergy = 0;

  for (let h = 0; h < hinges.length; h++) {
    const hinge = hinges[h];
    const i0 = hinge.v0 * 3;
    const i1 = hinge.v1 * 3;
    const i2 = hinge.v2 * 3;
    const i3 = hinge.v3 * 3;

    // e = x1 - x0
    const ex = positions[i1 + 0] - positions[i0 + 0];
    const ey = positions[i1 + 1] - positions[i0 + 1];
    const ez = positions[i1 + 2] - positions[i0 + 2];
    const eLenSq = ex * ex + ey * ey + ez * ez;
    if (eLenSq < 1e-14) continue;
    const eLen = Math.sqrt(eLenSq);

    // u2 = x2 - x0
    const u2x = positions[i2 + 0] - positions[i0 + 0];
    const u2y = positions[i2 + 1] - positions[i0 + 1];
    const u2z = positions[i2 + 2] - positions[i0 + 2];

    // n1 = e x u2
    const n1x = ey * u2z - ez * u2y;
    const n1y = ez * u2x - ex * u2z;
    const n1z = ex * u2y - ey * u2x;
    const a1Sq = n1x * n1x + n1y * n1y + n1z * n1z;
    if (a1Sq < 1e-14) continue;
    const a1 = Math.sqrt(a1Sq);

    // u3 = x3 - x0
    const u3x = positions[i3 + 0] - positions[i0 + 0];
    const u3y = positions[i3 + 1] - positions[i0 + 1];
    const u3z = positions[i3 + 2] - positions[i0 + 2];

    // n2 = u3 x e
    const n2x = u3y * ez - u3z * ey;
    const n2y = u3z * ex - u3x * ez;
    const n2z = u3x * ey - u3y * ex;
    const a2Sq = n2x * n2x + n2y * n2y + n2z * n2z;
    if (a2Sq < 1e-14) continue;
    const a2 = Math.sqrt(a2Sq);

    // cosTheta = (n1 . n2) / (a1 * a2)
    const dotN = n1x * n2x + n1y * n2y + n1z * n2z;
    const cosTheta = dotN / (a1 * a2);

    // crossN = n1 x n2
    const cnx = n1y * n2z - n1z * n2y;
    const cny = n1z * n2x - n1x * n2z;
    const cnz = n1x * n2y - n1y * n2x;
    const sinTheta = -(cnx * ex + cny * ey + cnz * ez) / (a1 * a2 * eLen);

    const rawTheta = Math.atan2(sinTheta, Math.max(-1, Math.min(1, cosTheta)));
    let theta = rawTheta;
    if (hinge.previousAngle !== undefined) {
      const k = Math.round((hinge.previousAngle - rawTheta) / (2 * Math.PI));
      theta = rawTheta + k * 2 * Math.PI;
    }
    hinge.previousAngle = theta;
    const deltaTheta = theta - hinge.restAngle;

    totalEnergy += 0.5 * hinge.stiffness * deltaTheta * deltaTheta;

    // Torque magnitude
    const tau = -hinge.stiffness * deltaTheta;

    // Forces on opposing vertices
    const f2Mag = (tau * eLen) / a1Sq;
    const f2x = f2Mag * n1x;
    const f2y = f2Mag * n1y;
    const f2z = f2Mag * n1z;

    const f3Mag = (tau * eLen) / a2Sq;
    const f3x = f3Mag * n2x;
    const f3y = f3Mag * n2y;
    const f3z = f3Mag * n2z;

    // Projections onto e
    const t2 = (u2x * ex + u2y * ey + u2z * ez) / eLenSq;
    const t3 = (u3x * ex + u3y * ey + u3z * ez) / eLenSq;

    const f0x = -(1 - t2) * f2x - (1 - t3) * f3x;
    const f0y = -(1 - t2) * f2y - (1 - t3) * f3y;
    const f0z = -(1 - t2) * f2z - (1 - t3) * f3z;

    const f1x = -t2 * f2x - t3 * f3x;
    const f1y = -t2 * f2y - t3 * f3y;
    const f1z = -t2 * f2z - t3 * f3z;

    // Accumulate
    forces[i0 + 0] += f0x;
    forces[i0 + 1] += f0y;
    forces[i0 + 2] += f0z;

    forces[i1 + 0] += f1x;
    forces[i1 + 1] += f1y;
    forces[i1 + 2] += f1z;

    forces[i2 + 0] += f2x;
    forces[i2 + 1] += f2y;
    forces[i2 + 2] += f2z;

    forces[i3 + 0] += f3x;
    forces[i3 + 1] += f3y;
    forces[i3 + 2] += f3z;
  }

  return totalEnergy;
}
