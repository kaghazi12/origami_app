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
  maxStrain: number;
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
    this.dt = options.dt ?? 0.005;
    this.damping = options.damping ?? 0.95;
  }

  /**
   * Applies an infinitesimal out-of-plane displacement (1e-4) to break flat planar symmetry
   * along the direction of active creases so 3D folding initiates smoothly.
   */
  applySeedPerturbation(eps = 1e-4): void {
    let hasOutPlane = false;
    for (let i = 0; i < this.mesh.numVertices; i++) {
      if (Math.abs(this.mesh.positions[i * 3 + 2]) > 1e-6) {
        hasOutPlane = true;
        break;
      }
    }
    if (hasOutPlane) return;

    for (const hinge of this.mesh.hinges) {
      if (Math.abs(hinge.targetAngle) > 1e-4 || Math.abs(hinge.restAngle) > 1e-4) {
        const sign = hinge.targetAngle >= 0 ? 1 : -1;
        // Perturb opposing vertices v2 and v3
        this.mesh.positions[hinge.v2 * 3 + 2] += sign * eps;
        this.mesh.positions[hinge.v3 * 3 + 2] += sign * eps;
      }
    }
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
   * Iterates Dynamic Relaxation until kinetic energy drops below tolerance or maxIterations reached
   */
  solveToEquilibrium(
    maxIterations = 1000,
    kineticTol = 1e-6,
    dt = this.dt,
    damping = this.damping
  ): SolveResult {
    let converged = false;
    let finalKe = 0;

    for (let iter = 0; iter < maxIterations; iter++) {
      const { kineticEnergy } = this.step(dt, damping);
      finalKe = kineticEnergy;

      if (kineticEnergy < kineticTol && iter > 20) {
        converged = true;
        return {
          iterations: iter + 1,
          converged: true,
          kineticEnergy,
          maxStrain: this.getMaxStrain(),
        };
      }
    }

    return {
      iterations: maxIterations,
      converged,
      kineticEnergy: finalKe,
      maxStrain: this.getMaxStrain(),
    };
  }
}
