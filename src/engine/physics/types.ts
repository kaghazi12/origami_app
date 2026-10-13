import { TriMesh } from '../types';

export interface SolveResult {
  iterations: number;
  converged: boolean;
  kineticEnergy: number;
  maxResidualForce: number;
  maxStrain: number;
}

export interface FoldSolver {
  readonly mesh: TriMesh;
  step(dt?: number): { potentialEnergy: number; kineticEnergy: number };
  solveToEquilibrium(
    maxIterations?: number,
    kineticTol?: number,
    residualForceTol?: number
  ): SolveResult;
  getMaxResidualForce(): number;
  getMaxStrain(): number;
  getKineticEnergy(): number;
  setFixedVertices?(pins: Set<number>): void;
  setDragTarget?(vertexIndex: number, targetPos: [number, number, number] | null): void;
}
