import { BarElement } from '../types';

/**
 * Computes axial spring forces for all bars and accumulates them into forces Float64Array.
 * Returns total axial strain energy.
 */
export function accumulateBarForces(
  bars: BarElement[],
  positions: Float64Array,
  forces: Float64Array
): number {
  let totalEnergy = 0;

  for (let i = 0; i < bars.length; i++) {
    const bar = bars[i];
    const i0 = bar.v0 * 3;
    const i1 = bar.v1 * 3;

    const dx = positions[i1 + 0] - positions[i0 + 0];
    const dy = positions[i1 + 1] - positions[i0 + 1];
    const dz = positions[i1 + 2] - positions[i0 + 2];

    const len = Math.hypot(dx, dy, dz);
    if (len < 1e-12) continue;

    const deltaL = len - bar.restLength;
    totalEnergy += 0.5 * bar.stiffness * deltaL * deltaL;

    const fMag = bar.stiffness * deltaL;
    const fx = (fMag * dx) / len;
    const fy = (fMag * dy) / len;
    const fz = (fMag * dz) / len;

    // Force on v0 is + (toward v1)
    forces[i0 + 0] += fx;
    forces[i0 + 1] += fy;
    forces[i0 + 2] += fz;

    // Force on v1 is - (toward v0)
    forces[i1 + 0] -= fx;
    forces[i1 + 1] -= fy;
    forces[i1 + 2] -= fz;
  }

  return totalEnergy;
}

/**
 * Computes maximum absolute strain across all bars: max(|L - L0| / L0)
 */
export function computeMaxBarStrain(bars: BarElement[], positions: Float64Array): number {
  let maxStrain = 0;

  for (let i = 0; i < bars.length; i++) {
    const bar = bars[i];
    if (bar.restLength < 1e-12) continue;

    const i0 = bar.v0 * 3;
    const i1 = bar.v1 * 3;

    const dx = positions[i1 + 0] - positions[i0 + 0];
    const dy = positions[i1 + 1] - positions[i0 + 1];
    const dz = positions[i1 + 2] - positions[i0 + 2];

    const len = Math.hypot(dx, dy, dz);
    const strain = Math.abs(len - bar.restLength) / bar.restLength;
    if (strain > maxStrain) maxStrain = strain;
  }

  return maxStrain;
}
