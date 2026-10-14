import { TriMesh } from '../types';

export interface SolveResult {
  iterations: number;
  converged: boolean;
  kineticEnergy: number;
  maxResidualForce: number;
  maxStrain: number;
}

export interface BarycentricPoint {
  triangleIndex: number;
  v0: number;
  v1: number;
  v2: number;
  w0: number;
  w1: number;
  w2: number;
  restU?: number;
  restV?: number;
}

export interface BarycentricAttachment {
  point: BarycentricPoint;
  targetPos: [number, number, number];
  compliance?: number;
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
  setBarycentricPins?(pins: BarycentricAttachment[]): void;
  setBarycentricDrag?(drag: BarycentricAttachment | null): void;
  getBarycentricPos?(pt: BarycentricPoint): [number, number, number];
}
