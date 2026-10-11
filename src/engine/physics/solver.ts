import { TriMesh } from '../types';
import { accumulateBarForces, computeMaxBarStrain } from './bars';
import { accumulateHingeForces, computeDihedralAngle } from './hinges';

export interface SolverOptions {
  dt?: number;
  damping?: number;
  fixedVertices?: Set<number>;
}

export interface SolveResult {
  iterations: number;
  converged: boolean;
  kineticEnergy: number;
  maxResidualForce: number;
  maxStrain: number;
}

/**
 * Computes the critical explicit time step limit dt_crit = 2 / omega_max, where
 * omega_i = sqrt(sum(k_bar) / m_i).
 * Returns dt = safetyFactor * dt_crit.
 */
export function computeStableTimeStep(mesh: TriMesh, safetyFactor = 0.5): number {
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

  constructor(mesh: TriMesh, options: SolverOptions = {}) {
    this.mesh = mesh;
    this.forces = new Float64Array(mesh.numVertices * 3);
    this.fixedVertices = options.fixedVertices ?? new Set<number>();
    this.dt = options.dt ?? computeStableTimeStep(mesh, 0.4);
    this.damping = options.damping ?? 0.95;
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
      finalKe = kineticEnergy;

      const maxResForce = this.getMaxResidualForce();
      const keConverged = kineticEnergy < kineticTol;
      const forceConverged = residualForceTol === undefined || maxResForce < residualForceTol;

      // Convergence check: both kinetic energy and residual force (if specified) must be satisfied
      if (iter > 20 && keConverged && forceConverged) {
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
