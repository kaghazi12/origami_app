import { FoldFormat, MeshOptions } from '../types';
import { CreaseEdgeInfo, WorkerFrameStats, WorkerRequest, WorkerResponse } from './types';

export interface LoadedMeshInfo {
  numVertices: number;
  numTriangles: number;
  indices: Uint32Array;
  uvs: Float32Array;
  creaseEdges: CreaseEdgeInfo[];
  bounds: { minX: number; maxX: number; minY: number; maxY: number };
}

export interface FrameEvent {
  positions: Float32Array;
  stats: WorkerFrameStats;
  latencyMs: number;
}

export type LoadedCallback = (info: LoadedMeshInfo) => void;
export type FrameCallback = (event: FrameEvent) => void;
export type ErrorCallback = (error: string) => void;

export class OrigamiWorkerClient {
  private worker: Worker | null = null;
  private onLoadedCb?: LoadedCallback;
  private onFrameCb?: FrameCallback;
  private onErrorCb?: ErrorCallback;
  private lastAlphaSentTime = 0;
  private measuredLatencyMs = 0;

  constructor(customWorker?: Worker) {
    if (customWorker) {
      this.worker = customWorker;
    } else if (typeof window !== 'undefined') {
      // In Vite, new Worker(new URL(..., import.meta.url), { type: 'module' }) bundles the worker cleanly
      this.worker = new Worker(new URL('./foldWorker.ts', import.meta.url), {
        type: 'module',
      });
    }

    if (this.worker) {
      this.worker.onmessage = this.handleMessage.bind(this);
      this.worker.onerror = (err) => {
        console.error('OrigamiWorkerClient Error:', err);
        this.onErrorCb?.(err.message || 'Worker error');
      };
    }
  }

  onLoaded(cb: LoadedCallback): void {
    this.onLoadedCb = cb;
  }

  onFrame(cb: FrameCallback): void {
    this.onFrameCb = cb;
  }

  onError(cb: ErrorCallback): void {
    this.onErrorCb = cb;
  }

  private handleMessage(e: MessageEvent<WorkerResponse>): void {
    const data = e.data;
    switch (data.type) {
      case 'LOADED': {
        this.onLoadedCb?.({
          numVertices: data.numVertices,
          numTriangles: data.numTriangles,
          indices: data.indices,
          uvs: data.uvs,
          creaseEdges: data.creaseEdges,
          bounds: data.bounds,
        });
        break;
      }

      case 'FRAME': {
        if (this.lastAlphaSentTime > 0) {
          this.measuredLatencyMs = performance.now() - this.lastAlphaSentTime;
          this.lastAlphaSentTime = 0;
        }

        this.onFrameCb?.({
          positions: data.positions,
          stats: data.stats,
          latencyMs: this.measuredLatencyMs,
        });
        break;
      }

      case 'ERROR': {
        this.onErrorCb?.(data.message);
        break;
      }
    }
  }

  load(
    fold: FoldFormat,
    meshOptions?: MeshOptions,
    solverOptions?: {
      enableTable?: boolean;
      tableZ?: number;
      paperThickness?: number;
      enableGravity?: boolean;
      gravity?: number;
      muStatic?: number;
      muKinetic?: number;
      bendingCompliance?: number;
      substeps?: number;
    }
  ): void {
    this.postMessage({
      type: 'LOAD',
      fold,
      meshOptions,
      solverOptions,
    });
  }

  setPhysicsParams(params: {
    enableTable?: boolean;
    tableZ?: number;
    paperThickness?: number;
    enableGravity?: boolean;
    gravity?: number;
    muStatic?: number;
    muKinetic?: number;
    bendingCompliance?: number;
    substeps?: number;
  }): void {
    this.postMessage({
      type: 'SET_PHYSICS_PARAMS',
      ...params,
    });
  }

  setAlpha(alpha: number): void {
    this.lastAlphaSentTime = performance.now();
    this.postMessage({
      type: 'SET_ALPHA',
      alpha,
    });
  }

  setStiffness(stiffness: {
    axialStiffness?: number;
    creaseStiffness?: number;
    facetStiffness?: number;
  }): void {
    this.postMessage({
      type: 'SET_STIFFNESS',
      ...stiffness,
    });
  }

  seedFromFlat(eps = 1e-3): void {
    this.postMessage({
      type: 'SEED_FROM_FLAT',
      eps,
    });
  }

  reset(): void {
    this.postMessage({
      type: 'RESET',
    });
  }

  pause(): void {
    this.postMessage({
      type: 'PAUSE',
    });
  }

  resume(): void {
    this.postMessage({
      type: 'RESUME',
    });
  }

  /**
   * Recycles the position ArrayBuffer back to the worker for zero-allocation double-buffering
   */
  returnBuffer(buffer: ArrayBufferLike): void {
    if (this.worker && buffer && buffer.byteLength > 0) {
      this.worker.postMessage(
        {
          type: 'RETURN_BUFFER',
          buffer: buffer as ArrayBuffer,
        },
        [buffer as ArrayBuffer]
      );
    }
  }

  private postMessage(req: WorkerRequest): void {
    if (this.worker) {
      this.worker.postMessage(req);
    }
  }

  terminate(): void {
    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
    }
  }
}
