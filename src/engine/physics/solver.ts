import { TriMesh } from '../types';
import { accumulateBarForces, computeMaxBarStrain } from './bars';
import { accumulateHingeForces, computeDihedralAngle } from './hinges';

export interface SolverOptions {
  dt?: number;
  damping?: number;
  fixedVertices?: Set<number>;
  kineticDamping?: boolean; // Barnes kinetic damping: zeroes velocities at each kinetic energy peak
  massScaling?: boolean;    // Barnes fictitious mass scaling: scales node mass proportional to node stiffness
}

export interface SolveResult {
  iterations: number;
  converged: boolean;
  kineticEnergy: number;
  maxResidualForce: number;
  maxStrain: number;
}

/**
 * Computes total effective nodal translational stiffness (N/m) across both
 * axial bars (k_bar) and dihedral hinges (K_hinge ≈ k_hinge / h_altitude^2).
 */
export function computeNodalStiffness(mesh: TriMesh): Float64Array {
  const numV = mesh.numVertices;
  const nodalStiffness = new Float64Array(numV);

  // 1. Axial bar stiffness
  for (const bar of mesh.bars) {
    nodalStiffness[bar.v0] += bar.stiffness;
    nodalStiffness[bar.v1] += bar.stiffness;
  }

  // 2. Dihedral hinge rotational stiffness converted to transverse nodal stiffness
  const uvs = mesh.uvs;
  const hasUVs = uvs && uvs.length >= numV * 2;

  for (const hinge of mesh.hinges) {
    if (hinge.stiffness <= 0) continue;

    let h2 = 0.05;
    let h3 = 0.05;

    if (hasUVs) {
      const u0 = uvs[hinge.v0 * 2], v0 = uvs[hinge.v0 * 2 + 1];
      const u1 = uvs[hinge.v1 * 2], v1 = uvs[hinge.v1 * 2 + 1];
      const ex = u1 - u0, ey = v1 - v0;
      const edgeLen = Math.hypot(ex, ey) || 1e-4;

      const u2 = uvs[hinge.v2 * 2], v2 = uvs[hinge.v2 * 2 + 1];
      const cross2 = Math.abs(ex * (v2 - v0) - ey * (u2 - u0));
      h2 = Math.max(1e-4, cross2 / edgeLen);

      const u3 = uvs[hinge.v3 * 2], v3 = uvs[hinge.v3 * 2 + 1];
      const cross3 = Math.abs(ex * (v3 - v0) - ey * (u3 - u0));
      h3 = Math.max(1e-4, cross3 / edgeLen);
    }

    const kEff2 = hinge.stiffness / (h2 * h2);
    const kEff3 = hinge.stiffness / (h3 * h3);

    nodalStiffness[hinge.v2] += kEff2;
    nodalStiffness[hinge.v3] += kEff3;
    nodalStiffness[hinge.v0] += 0.5 * (kEff2 + kEff3);
    nodalStiffness[hinge.v1] += 0.5 * (kEff2 + kEff3);
  }

  return nodalStiffness;
}

/**
 * Computes Barnes fictitious nodal mass scaling from direct nodal stiffness:
 * m_i = max(m_min, S_i / omega_target^2), equalizing local resonant frequencies
 * across both axial and hinge degrees of freedom.
 */
export function computeBarnesMassScaling(mesh: TriMesh, targetOmega = 500): Float64Array {
  const numV = mesh.numVertices;
  const nodalStiffness = computeNodalStiffness(mesh);
  const scaledMasses = new Float64Array(numV);
  const factor = 1.0 / (targetOmega * targetOmega);
  for (let i = 0; i < numV; i++) {
    scaledMasses[i] = Math.max(0.01, nodalStiffness[i] * factor);
  }
  return scaledMasses;
}

/**
 * Computes the critical explicit time step limit dt_crit = 2 / omega_max, where
 * omega_i = sqrt(S_i / m_i) with S_i accounting for both axial bars and dihedral hinges.
 * Returns dt = safetyFactor * dt_crit.
 */
export function computeStableTimeStep(mesh: TriMesh, safetyFactor = 0.45): number {
  const vertexStiffness = computeNodalStiffness(mesh);

  let maxOmega = 0;
  for (let i = 0; i < mesh.numVertices; i++) {
    const m = mesh.masses[i] || 1.0;
    const omega = Math.sqrt(vertexStiffness[i] / m);
    if (omega > maxOmega) maxOmega = omega;
  }

  if (maxOmega < 1e-12) return 0.005;
  const dtCrit = 2.0 / maxOmega;
  return safetyFactor * dtCrit;
}

/**
 * Explicit one-time seed perturbation to break planar symmetry from flat sheet (Requirement 6).
 * Never triggered automatically during step() or interactive manipulation.
 */
export function seedFromFlat(mesh: TriMesh, eps = 1e-4): void {
  let hasOutPlane = false;
  for (let i = 0; i < mesh.numVertices; i++) {
    if (Math.abs(mesh.positions[i * 3 + 2]) > 1e-6) {
      hasOutPlane = true;
      break;
    }
  }
  if (hasOutPlane) return;

  for (const hinge of mesh.hinges) {
    if (Math.abs(hinge.targetAngle) > 1e-4 || Math.abs(hinge.restAngle) > 1e-4) {
      const angle = hinge.targetAngle !== 0 ? hinge.targetAngle : hinge.restAngle;
      const sign = angle >= 0 ? 1 : -1;
      mesh.positions[hinge.v2 * 3 + 2] += sign * eps;
      mesh.positions[hinge.v3 * 3 + 2] += sign * eps;
    }
  }
}

export class BarHingeSolver {
  readonly mesh: TriMesh;
  readonly forces: Float64Array;
  readonly fixedVertices: Set<number>;
  dt: number;
  damping: number;
  kineticDamping: boolean;
  massScaling: boolean;
  prevKineticEnergy: number;

  constructor(mesh: TriMesh, options: SolverOptions = {}) {
    this.mesh = mesh;
    this.forces = new Float64Array(mesh.numVertices * 3);
    this.fixedVertices = options.fixedVertices ?? new Set<number>();
    this.kineticDamping = options.kineticDamping ?? false;
    this.massScaling = options.massScaling ?? false;
    this.prevKineticEnergy = 0;

    if (this.massScaling) {
      const scaled = computeBarnesMassScaling(mesh);
      mesh.masses.set(scaled);
    }

    this.dt = options.dt ?? computeStableTimeStep(mesh, 0.4);
    // If kinetic damping is active without explicit damping set, default to 0.98 (light viscous background damping
    // to suppress high-frequency local mode chattering while kinetic peak resets eliminate fundamental mode ringing)
    this.damping = options.damping ?? (this.kineticDamping ? 0.98 : 0.95);
  }

  /**
   * One-time explicit option to seed out-of-plane perturbation from flat state (Requirement 6).
   */
  seedFromFlat(eps = 1e-4): void {
    seedFromFlat(this.mesh, eps);
  }

  /**
   * Alias for backward compatibility
   */
  applySeedPerturbation(eps = 1e-4): void {
    this.seedFromFlat(eps);
  }

  /**
   * Executes a single Dynamic Relaxation integration substep
   */
  step(dt = this.dt, damping = this.damping): { potentialEnergy: number; kineticEnergy: number } {
    this.forces.fill(0);

    const barEnergy = accumulateBarForces(this.mesh.bars, this.mesh.positions, this.forces);
    const hingeEnergy = accumulateHingeForces(this.mesh.hinges, this.mesh.positions, this.forces);

    let kineticEnergy = 0;

    for (let i = 0; i < this.mesh.numVertices; i++) {
      if (this.fixedVertices.has(i)) {
        this.mesh.velocities[i * 3 + 0] = 0;
        this.mesh.velocities[i * 3 + 1] = 0;
        this.mesh.velocities[i * 3 + 2] = 0;
        continue;
      }

      const m = this.mesh.masses[i];
      const invM = 1 / m;

      const fx = this.forces[i * 3 + 0];
      const fy = this.forces[i * 3 + 1];
      const fz = this.forces[i * 3 + 2];

      let vx = (this.mesh.velocities[i * 3 + 0] + fx * invM * dt) * damping;
      let vy = (this.mesh.velocities[i * 3 + 1] + fy * invM * dt) * damping;
      let vz = (this.mesh.velocities[i * 3 + 2] + fz * invM * dt) * damping;

      this.mesh.velocities[i * 3 + 0] = vx;
      this.mesh.velocities[i * 3 + 1] = vy;
      this.mesh.velocities[i * 3 + 2] = vz;

      this.mesh.positions[i * 3 + 0] += vx * dt;
      this.mesh.positions[i * 3 + 1] += vy * dt;
      this.mesh.positions[i * 3 + 2] += vz * dt;

      kineticEnergy += 0.5 * m * (vx * vx + vy * vy + vz * vz);
    }

    // Barnes Kinetic Damping: detect KE peak (current KE < previous KE)
    if (this.kineticDamping && kineticEnergy < this.prevKineticEnergy && this.prevKineticEnergy > 1e-12) {
      this.mesh.velocities.fill(0);
      kineticEnergy = 0;
    }
    this.prevKineticEnergy = kineticEnergy;

    return {
      potentialEnergy: barEnergy + hingeEnergy,
      kineticEnergy,
    };
  }

  getKineticEnergy(): number {
    let ke = 0;
    for (let i = 0; i < this.mesh.numVertices; i++) {
      const vx = this.mesh.velocities[i * 3 + 0];
      const vy = this.mesh.velocities[i * 3 + 1];
      const vz = this.mesh.velocities[i * 3 + 2];
      ke += 0.5 * this.mesh.masses[i] * (vx * vx + vy * vy + vz * vz);
    }
    return ke;
  }

  getMaxStrain(): number {
    return computeMaxBarStrain(this.mesh.bars, this.mesh.positions);
  }

  /**
   * Computes maximum residual force magnitude among unpinned (free) vertices
   */
  getMaxResidualForce(): number {
    let maxForce = 0;
    for (let i = 0; i < this.mesh.numVertices; i++) {
      if (this.fixedVertices.has(i)) continue;
      const fx = this.forces[i * 3 + 0];
      const fy = this.forces[i * 3 + 1];
      const fz = this.forces[i * 3 + 2];
      const fMag = Math.hypot(fx, fy, fz);
      if (fMag > maxForce) maxForce = fMag;
    }
    return maxForce;
  }

  /**
   * Iterates Dynamic Relaxation until both kinetic energy AND residual force drop
   * below their tolerances (true static equilibrium), or maxIterations is reached.
   */
  solveToEquilibrium(
    maxIterations = 2000,
    kineticTol = 1e-6,
    residualForceTol?: number,
    dt = this.dt,
    damping = this.damping
  ): SolveResult {
    let converged = false;
    let finalKe = 0;

    for (let iter = 0; iter < maxIterations; iter++) {
      const { kineticEnergy } = this.step(dt, damping);
      const maxResForce = this.getMaxResidualForce();
      const forceConverged = residualForceTol !== undefined && maxResForce < residualForceTol;
      const keConverged = kineticEnergy < kineticTol;

      // Convergence check: if residualForceTol is specified, static equilibrium is reached when forces balance.
      // Otherwise, falls back to kinetic energy decay (requiring iter > 2 to avoid false-positive at rest).
      if (residualForceTol !== undefined ? forceConverged : (iter > 2 && keConverged)) {
        converged = true;
        return {
          iterations: iter + 1,
          converged: true,
          kineticEnergy,
          maxResidualForce: maxResForce,
          maxStrain: this.getMaxStrain(),
        };
      }
    }

    return {
      iterations: maxIterations,
      converged,
      kineticEnergy: finalKe,
      maxResidualForce: this.getMaxResidualForce(),
      maxStrain: this.getMaxStrain(),
    };
  }
}
