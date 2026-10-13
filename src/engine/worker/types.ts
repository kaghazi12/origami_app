import { FoldFormat, MeshOptions } from '../types';

/**
 * Messages from Main Thread -> Web Worker
 */
export type WorkerRequest =
  | {
      type: 'LOAD';
      fold: FoldFormat;
      meshOptions?: MeshOptions;
    }
  | {
      type: 'SET_ALPHA';
      alpha: number;
    }
  | {
      type: 'SET_STIFFNESS';
      axialStiffness?: number;
      creaseStiffness?: number;
      facetStiffness?: number;
    }
  | {
      type: 'SEED_FROM_FLAT';
      eps?: number;
    }
  | {
      type: 'RESET';
    }
  | {
      type: 'PAUSE';
    }
  | {
      type: 'RESUME';
    }
  | {
      type: 'RETURN_BUFFER';
      buffer: ArrayBufferLike;
    };

export interface WorkerFrameStats {
  potentialEnergy: number;
  kineticEnergy: number;
  maxResidualForce: number;
  maxStrain: number;
  converged: boolean;
  alpha: number;
  stepCount: number;
  substepsInTick: number;
  tickDurationMs: number;
}

export interface CreaseEdgeInfo {
  v0: number;
  v1: number;
  assignment: 'B' | 'M' | 'V' | 'F' | 'U';
}

/**
 * Messages from Web Worker -> Main Thread
 */
export type WorkerResponse =
  | {
      type: 'LOADED';
      numVertices: number;
      numTriangles: number;
      indices: Uint32Array;
      uvs: Float32Array;
      creaseEdges: CreaseEdgeInfo[];
      bounds: { minX: number; maxX: number; minY: number; maxY: number };
    }
  | {
      type: 'FRAME';
      positions: Float32Array; // Transferred with zero-copy
      stats: WorkerFrameStats;
    }
  | {
      type: 'STATE_CHANGED';
      paused: boolean;
      alpha: number;
    }
  | {
      type: 'ERROR';
      message: string;
    };
