import { TriMesh } from '../types';
import { accumulateBarForces, computeMaxBarStrain } from './bars';
import { accumulateHingeForces, computeDihedralAngle } from './hinges';
import { FoldSolver, SolveResult } from './types';

export interface XPBDSolverOptions {
  substeps?: number;
  iterations?: number;
  velocityDamping?: number;
  fixedVertices?: Set<number>;
}

export class XPBDSolver implements FoldSolver {
  readonly mesh: TriMesh;
  readonly fixedVertices: Set<number>;
  readonly dragTargets: Map<number, [number, number, number]>;
  substeps: number;
  iterations: number;
  velocityDamping: number;

  private posStar: Float64Array;
  private lambdaBars: Float64Array;
  private lambdaHinges: Float64Array;
  private forcesBuffer: Float64Array;

  constructor(mesh: TriMesh, options: XPBDSolverOptions = {}) {
    this.mesh = mesh;
    this.fixedVertices = options.fixedVertices ?? new Set<number>();
    this.dragTargets = new Map<number, [number, number, number]>();
    this.substeps = options.substeps ?? 5;
    this.iterations = options.iterations ?? 20;
    this.velocityDamping = options.velocityDamping ?? 0.995;

    this.posStar = new Float64Array(mesh.numVertices * 3);
    this.lambdaBars = new Float64Array(mesh.bars.length);
    this.lambdaHinges = new Float64Array(mesh.hinges.length);
    this.forcesBuffer = new Float64Array(mesh.numVertices * 3);
  }

  setFixedVertices(pins: Set<number>): void {
    this.fixedVertices.clear();
    for (const p of pins) this.fixedVertices.add(p);
  }

  setDragTarget(vertexIndex: number, targetPos: [number, number, number] | null): void {
    if (targetPos === null) {
      this.dragTargets.delete(vertexIndex);
    } else {
      this.dragTargets.set(vertexIndex, targetPos);
      this.mesh.positions[vertexIndex * 3 + 0] = targetPos[0];
      this.mesh.positions[vertexIndex * 3 + 1] = targetPos[1];
      this.mesh.positions[vertexIndex * 3 + 2] = targetPos[2];
      this.mesh.velocities[vertexIndex * 3 + 0] = 0;
      this.mesh.velocities[vertexIndex * 3 + 1] = 0;
      this.mesh.velocities[vertexIndex * 3 + 2] = 0;
    }
  }

  isConstrained(v: number): boolean {
    return this.fixedVertices.has(v) || this.dragTargets.has(v);
  }

  /**
   * Executes a single XPBD integration step across substeps and Gauss-Seidel iterations
   */
  step(dt = 0.016): { potentialEnergy: number; kineticEnergy: number } {
    const substepCount = Math.max(1, this.substeps);
    const h = dt / substepCount;
    const hSq = h * h;
    const numV = this.mesh.numVertices;
    const pos = this.mesh.positions;
    const vel = this.mesh.velocities;
    const masses = this.mesh.masses;

    for (let s = 0; s < substepCount; s++) {
      // 1. Predict unconstrained positions
      for (let i = 0; i < numV; i++) {
        const i3 = i * 3;
        if (this.fixedVertices.has(i)) {
          this.posStar[i3 + 0] = pos[i3 + 0];
          this.posStar[i3 + 1] = pos[i3 + 1];
          this.posStar[i3 + 2] = pos[i3 + 2];
          vel[i3 + 0] = 0;
          vel[i3 + 1] = 0;
          vel[i3 + 2] = 0;
        } else if (this.dragTargets.has(i)) {
          const t = this.dragTargets.get(i)!;
          this.posStar[i3 + 0] = t[0];
          this.posStar[i3 + 1] = t[1];
          this.posStar[i3 + 2] = t[2];
          vel[i3 + 0] = 0;
          vel[i3 + 1] = 0;
          vel[i3 + 2] = 0;
        } else {
          this.posStar[i3 + 0] = pos[i3 + 0] + h * vel[i3 + 0];
          this.posStar[i3 + 1] = pos[i3 + 1] + h * vel[i3 + 1];
          this.posStar[i3 + 2] = pos[i3 + 2] + h * vel[i3 + 2];
        }
      }

      // Reset Lagrange multipliers
      this.lambdaBars.fill(0);
      this.lambdaHinges.fill(0);

      // 2. Gauss-Seidel Constraint Projection Loop
      for (let iter = 0; iter < this.iterations; iter++) {
        // --- A. Distance Constraints (Axial Bars - exact inextensibility alpha = 0) ---
        for (let b = 0; b < this.mesh.bars.length; b++) {
          const bar = this.mesh.bars[b];
          const v0 = bar.v0;
          const v1 = bar.v1;
          const w0 = this.isConstrained(v0) ? 0 : 1 / (masses[v0] || 1);
          const w1 = this.isConstrained(v1) ? 0 : 1 / (masses[v1] || 1);
          const wSum = w0 + w1;
          if (wSum < 1e-12) continue;

          const p0 = v0 * 3;
          const p1 = v1 * 3;
          const dx = this.posStar[p0 + 0] - this.posStar[p1 + 0];
          const dy = this.posStar[p0 + 1] - this.posStar[p1 + 1];
          const dz = this.posStar[p0 + 2] - this.posStar[p1 + 2];
          const dist = Math.hypot(dx, dy, dz);
          if (dist < 1e-12) continue;

          const C = dist - bar.restLength;
          // Inextensible paper: compliance alpha = 0 -> exact PBD projection
          const deltaLambda = -C / wSum;
          this.lambdaBars[b] += deltaLambda;

          const corr = deltaLambda / dist;
          if (w0 > 0) {
            const f0 = w0 * corr;
            this.posStar[p0 + 0] += dx * f0;
            this.posStar[p0 + 1] += dy * f0;
            this.posStar[p0 + 2] += dz * f0;
          }
          if (w1 > 0) {
            const f1 = w1 * corr;
            this.posStar[p1 + 0] -= dx * f1;
            this.posStar[p1 + 1] -= dy * f1;
            this.posStar[p1 + 2] -= dz * f1;
          }
        }

        // --- B. Dihedral Bending Constraints (Hinges - compliant XPBD) ---
        for (let hi = 0; hi < this.mesh.hinges.length; hi++) {
          const hinge = this.mesh.hinges[hi];
          if (hinge.stiffness <= 0) continue;

          const i0 = hinge.v0, i1 = hinge.v1, i2 = hinge.v2, i3 = hinge.v3;
          const w0 = this.isConstrained(i0) ? 0 : 1 / (masses[i0] || 1);
          const w1 = this.isConstrained(i1) ? 0 : 1 / (masses[i1] || 1);
          const w2 = this.isConstrained(i2) ? 0 : 1 / (masses[i2] || 1);
          const w3 = this.isConstrained(i3) ? 0 : 1 / (masses[i3] || 1);
          if (w0 + w1 + w2 + w3 < 1e-12) continue;

          const theta = computeDihedralAngle(hinge, this.posStar, false);
          const C = theta - hinge.restAngle;
          if (Math.abs(C) < 1e-7) continue;

          // Compute analytical dihedral angle gradients
          const p0 = i0 * 3, p1 = i1 * 3, p2 = i2 * 3, p3 = i3 * 3;
          const ex = this.posStar[p1 + 0] - this.posStar[p0 + 0];
          const ey = this.posStar[p1 + 1] - this.posStar[p0 + 1];
          const ez = this.posStar[p1 + 2] - this.posStar[p0 + 2];
          const eLenSq = ex * ex + ey * ey + ez * ez;
          if (eLenSq < 1e-14) continue;
          const eLen = Math.sqrt(eLenSq);

          const u2x = this.posStar[p2 + 0] - this.posStar[p0 + 0];
          const u2y = this.posStar[p2 + 1] - this.posStar[p0 + 1];
          const u2z = this.posStar[p2 + 2] - this.posStar[p0 + 2];

          const n1x = ey * u2z - ez * u2y;
          const n1y = ez * u2x - ex * u2z;
          const n1z = ex * u2y - ey * u2x;
          const a1Sq = n1x * n1x + n1y * n1y + n1z * n1z;
          if (a1Sq < 1e-14) continue;

          const u3x = this.posStar[p3 + 0] - this.posStar[p0 + 0];
          const u3y = this.posStar[p3 + 1] - this.posStar[p0 + 1];
          const u3z = this.posStar[p3 + 2] - this.posStar[p0 + 2];

          const n2x = u3y * ez - u3z * ey;
          const n2y = u3z * ex - u3x * ez;
          const n2z = u3x * ey - u3y * ex;
          const a2Sq = n2x * n2x + n2y * n2y + n2z * n2z;
          if (a2Sq < 1e-14) continue;

          const minASq = eLenSq * 1e-6;
          const regA1Sq = Math.max(a1Sq, minASq);
          const regA2Sq = Math.max(a2Sq, minASq);

          const q2Factor = eLen / regA1Sq;
          const q2x = q2Factor * n1x, q2y = q2Factor * n1y, q2z = q2Factor * n1z;

          const q3Factor = eLen / regA2Sq;
          const q3x = q3Factor * n2x, q3y = q3Factor * n2y, q3z = q3Factor * n2z;

          const t2 = (u2x * ex + u2y * ey + u2z * ez) / eLenSq;
          const t3 = (u3x * ex + u3y * ey + u3z * ez) / eLenSq;

          const q0x = -(1 - t2) * q2x - (1 - t3) * q3x;
          const q0y = -(1 - t2) * q2y - (1 - t3) * q3y;
          const q0z = -(1 - t2) * q2z - (1 - t3) * q3z;

          const q1x = -t2 * q2x - t3 * q3x;
          const q1y = -t2 * q2y - t3 * q3y;
          const q1z = -t2 * q2z - t3 * q3z;

          const gradLenSq0 = q0x * q0x + q0y * q0y + q0z * q0z;
          const gradLenSq1 = q1x * q1x + q1y * q1y + q1z * q1z;
          const gradLenSq2 = q2x * q2x + q2y * q2y + q2z * q2z;
          const gradLenSq3 = q3x * q3x + q3y * q3y + q3z * q3z;

          const wGradSum = w0 * gradLenSq0 + w1 * gradLenSq1 + w2 * gradLenSq2 + w3 * gradLenSq3;
          if (wGradSum < 1e-12) continue;

          // XPBD Compliance alpha = 1 / stiffness
          const alphaCompliance = 1.0 / hinge.stiffness;
          const alphaTilde = alphaCompliance / hSq;

          const deltaLambda = (-C - alphaTilde * this.lambdaHinges[hi]) / (wGradSum + alphaTilde);
          this.lambdaHinges[hi] += deltaLambda;

          if (w0 > 0) {
            this.posStar[p0 + 0] += w0 * q0x * deltaLambda;
            this.posStar[p0 + 1] += w0 * q0y * deltaLambda;
            this.posStar[p0 + 2] += w0 * q0z * deltaLambda;
          }
          if (w1 > 0) {
            this.posStar[p1 + 0] += w1 * q1x * deltaLambda;
            this.posStar[p1 + 1] += w1 * q1y * deltaLambda;
            this.posStar[p1 + 2] += w1 * q1z * deltaLambda;
          }
          if (w2 > 0) {
            this.posStar[p2 + 0] += w2 * q2x * deltaLambda;
            this.posStar[p2 + 1] += w2 * q2y * deltaLambda;
            this.posStar[p2 + 2] += w2 * q2z * deltaLambda;
          }
          if (w3 > 0) {
            this.posStar[p3 + 0] += w3 * q3x * deltaLambda;
            this.posStar[p3 + 1] += w3 * q3y * deltaLambda;
            this.posStar[p3 + 2] += w3 * q3z * deltaLambda;
          }
        }
      }

      // 3. Update velocities and commit positions
      const invH = 1.0 / h;
      for (let i = 0; i < numV; i++) {
        const i3 = i * 3;
        if (this.isConstrained(i)) {
          pos[i3 + 0] = this.posStar[i3 + 0];
          pos[i3 + 1] = this.posStar[i3 + 1];
          pos[i3 + 2] = this.posStar[i3 + 2];
          vel[i3 + 0] = 0;
          vel[i3 + 1] = 0;
          vel[i3 + 2] = 0;
        } else {
          vel[i3 + 0] = (this.posStar[i3 + 0] - pos[i3 + 0]) * invH * this.velocityDamping;
          vel[i3 + 1] = (this.posStar[i3 + 1] - pos[i3 + 1]) * invH * this.velocityDamping;
          vel[i3 + 2] = (this.posStar[i3 + 2] - pos[i3 + 2]) * invH * this.velocityDamping;
          pos[i3 + 0] = this.posStar[i3 + 0];
          pos[i3 + 1] = this.posStar[i3 + 1];
          pos[i3 + 2] = this.posStar[i3 + 2];
        }
      }
    }

    return {
      potentialEnergy: this.getPotentialEnergy(),
      kineticEnergy: this.getKineticEnergy(),
    };
  }

  getPotentialEnergy(): number {
    this.forcesBuffer.fill(0);
    const barE = accumulateBarForces(this.mesh.bars, this.mesh.positions, this.forcesBuffer);
    const hingeE = accumulateHingeForces(this.mesh.hinges, this.mesh.positions, this.forcesBuffer);
    return barE + hingeE;
  }

  getKineticEnergy(): number {
    let ke = 0;
    const numV = this.mesh.numVertices;
    const vel = this.mesh.velocities;
    const masses = this.mesh.masses;
    for (let i = 0; i < numV; i++) {
      const vx = vel[i * 3 + 0];
      const vy = vel[i * 3 + 1];
      const vz = vel[i * 3 + 2];
      ke += 0.5 * (masses[i] || 1) * (vx * vx + vy * vy + vz * vz);
    }
    return ke;
  }

  getMaxStrain(): number {
    return computeMaxBarStrain(this.mesh.bars, this.mesh.positions);
  }

  getMaxResidualForce(): number {
    this.forcesBuffer.fill(0);
    accumulateBarForces(this.mesh.bars, this.mesh.positions, this.forcesBuffer);
    accumulateHingeForces(this.mesh.hinges, this.mesh.positions, this.forcesBuffer);

    let maxForce = 0;
    for (let i = 0; i < this.mesh.numVertices; i++) {
      if (this.isConstrained(i)) continue;
      const fx = this.forcesBuffer[i * 3 + 0];
      const fy = this.forcesBuffer[i * 3 + 1];
      const fz = this.forcesBuffer[i * 3 + 2];
      const fMag = Math.hypot(fx, fy, fz);
      if (Number.isNaN(fMag) || !Number.isFinite(fMag)) return Infinity;
      if (fMag > maxForce) maxForce = fMag;
    }
    return maxForce;
  }

  solveToEquilibrium(
    maxIterations = 500,
    kineticTol = 1e-8,
    residualForceTol?: number
  ): SolveResult {
    let converged = false;

    for (let iter = 0; iter < maxIterations; iter++) {
      const { kineticEnergy } = this.step(0.016);
      const resForce = this.getMaxResidualForce();
      const keConverged = kineticEnergy < kineticTol;
      const forceConverged = residualForceTol !== undefined && resForce < residualForceTol;

      if (residualForceTol !== undefined ? forceConverged : (iter > 2 && keConverged)) {
        converged = true;
        return {
          iterations: iter + 1,
          converged: true,
          kineticEnergy,
          maxResidualForce: resForce,
          maxStrain: this.getMaxStrain(),
        };
      }
    }

    return {
      iterations: maxIterations,
      converged,
      kineticEnergy: this.getKineticEnergy(),
      maxResidualForce: this.getMaxResidualForce(),
      maxStrain: this.getMaxStrain(),
    };
  }
}
