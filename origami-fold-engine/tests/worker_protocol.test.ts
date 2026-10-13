import { describe, expect, it } from 'vitest';
import { createMiuraOriPattern, createWaterbombBasePattern } from '../../src/engine/fold';
import { createMeshFromFold, rampRestAngles } from '../../src/engine/mesh';
import { BarHingeSolver, computeStableTimeStep } from '../../src/engine/physics';
import { WorkerRequest, WorkerResponse } from '../../src/engine/worker/types';

/**
 * Direct simulator of the Worker logic to test the message protocol,
 * state machine, and zero-copy transferable double-buffering semantics.
 */
class MockWorkerHost {
  mesh: any = null;
  solver: any = null;
  isPaused = false;
  alpha = 0;
  bufferPool: ArrayBuffer[] = [];
  responses: WorkerResponse[] = [];

  postMessage(response: WorkerResponse, transfer?: Transferable[]) {
    this.responses.push(response);
  }

  handleRequest(req: WorkerRequest) {
    switch (req.type) {
      case 'LOAD': {
        this.mesh = createMeshFromFold(req.fold, req.meshOptions);
        this.solver = new BarHingeSolver(this.mesh, {
          kineticDamping: true,
          massScaling: true,
          dt: computeStableTimeStep(this.mesh, 0.4),
        });
        this.alpha = 0;
        this.isPaused = false;
        this.bufferPool = [];

        const creaseEdges = this.mesh.hinges
          .filter((h: any) => h.assignment === 'M' || h.assignment === 'V' || h.assignment === 'B' || h.assignment === 'F')
          .map((h: any) => ({ v0: h.v0, v1: h.v1, assignment: h.assignment }));

        let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
        for (let i = 0; i < this.mesh.numVertices; i++) {
          const u = this.mesh.uvs[i * 2 + 0];
          const v = this.mesh.uvs[i * 2 + 1];
          if (u < minX) minX = u;
          if (u > maxX) maxX = u;
          if (v < minY) minY = v;
          if (v > maxY) maxY = v;
        }

        const uvsF32 = new Float32Array(this.mesh.uvs.length);
        for (let i = 0; i < this.mesh.uvs.length; i++) uvsF32[i] = this.mesh.uvs[i];

        this.postMessage({
          type: 'LOADED',
          numVertices: this.mesh.numVertices,
          numTriangles: this.mesh.numTriangles,
          indices: new Uint32Array(this.mesh.indices),
          uvs: uvsF32,
          creaseEdges,
          bounds: { minX, maxX, minY, maxY },
        });
        break;
      }

      case 'SET_ALPHA': {
        this.alpha = req.alpha;
        if (this.mesh) {
          rampRestAngles(this.mesh, this.alpha);
        }
        break;
      }

      case 'PAUSE': {
        this.isPaused = true;
        this.postMessage({
          type: 'STATE_CHANGED',
          paused: true,
          alpha: this.alpha,
        });
        break;
      }

      case 'RESUME': {
        this.isPaused = false;
        this.postMessage({
          type: 'STATE_CHANGED',
          paused: false,
          alpha: this.alpha,
        });
        break;
      }

      case 'RETURN_BUFFER': {
        if (req.buffer && req.buffer.byteLength > 0) {
          this.bufferPool.push(req.buffer);
        }
        break;
      }
    }
  }

  tick(timeBudgetMs = 8): WorkerResponse {
    const t0 = performance.now();
    let substeps = 0;
    while (performance.now() - t0 < timeBudgetMs) {
      this.solver.step();
      substeps++;
      if (this.solver.getMaxResidualForce() < 0.005) break;
    }

    const numCoords = this.mesh.numVertices * 3;
    const byteLength = numCoords * 4;
    let ab: ArrayBuffer;
    if (this.bufferPool.length > 0 && this.bufferPool[0].byteLength === byteLength) {
      ab = this.bufferPool.pop()!;
    } else {
      ab = new ArrayBuffer(byteLength);
    }

    const posF32 = new Float32Array(ab);
    for (let i = 0; i < numCoords; i++) posF32[i] = this.mesh.positions[i];

    const resp: WorkerResponse = {
      type: 'FRAME',
      positions: posF32,
      stats: {
        potentialEnergy: 0,
        kineticEnergy: this.solver.getKineticEnergy(),
        maxResidualForce: this.solver.getMaxResidualForce(),
        maxStrain: this.solver.getMaxStrain(),
        converged: this.solver.getMaxResidualForce() < 0.005,
        alpha: this.alpha,
        stepCount: substeps,
        substepsInTick: substeps,
        tickDurationMs: performance.now() - t0,
      },
    };
    this.postMessage(resp, [posF32.buffer]);
    return resp;
  }
}

describe('Phase 5: Web Worker Message Protocol & Double-Buffering Tests', () => {
  it('tests full message round-trip: LOAD, SET_ALPHA, buffer transfer and recycling', () => {
    const host = new MockWorkerHost();
    const miura = createMiuraOriPattern(3, 3, 1, 1, 60);

    // 1. Send LOAD request
    host.handleRequest({ type: 'LOAD', fold: miura });
    expect(host.responses.length).toBe(1);
    const loadedResp = host.responses[0];
    expect(loadedResp.type).toBe('LOADED');
    if (loadedResp.type === 'LOADED') {
      expect(loadedResp.numVertices).toBe(16);
      expect(loadedResp.numTriangles).toBe(18);
      expect(loadedResp.indices.length).toBe(18 * 3);
      expect(loadedResp.creaseEdges.length).toBeGreaterThan(0);
    }

    // 2. Set Alpha to 0.50
    host.handleRequest({ type: 'SET_ALPHA', alpha: 0.50 });
    expect(host.alpha).toBe(0.50);

    // 3. Tick physics and receive transferable FRAME
    const frameResp = host.tick(8);
    expect(frameResp.type).toBe('FRAME');
    if (frameResp.type === 'FRAME') {
      expect(frameResp.positions.length).toBe(16 * 3);
      expect(frameResp.stats.alpha).toBe(0.50);
      expect(frameResp.stats.substepsInTick).toBeGreaterThan(0);

      // Verify zero-allocation buffer recycling:
      // Client consumes buffer, then returns it via RETURN_BUFFER
      const returnedBuffer = frameResp.positions.buffer;
      host.handleRequest({ type: 'RETURN_BUFFER', buffer: returnedBuffer });
      expect(host.bufferPool.length).toBe(1);

      // Next tick reuses the exact same ArrayBuffer without allocation
      const nextFrame = host.tick(8);
      if (nextFrame.type === 'FRAME') {
        expect(nextFrame.positions.buffer).toBe(returnedBuffer);
      }
    }
  });

  it('tests pause and resume state transitions', () => {
    const host = new MockWorkerHost();
    const wb = createWaterbombBasePattern(1);
    host.handleRequest({ type: 'LOAD', fold: wb });

    host.handleRequest({ type: 'PAUSE' });
    expect(host.isPaused).toBe(true);
    let lastResp = host.responses[host.responses.length - 1];
    expect(lastResp.type).toBe('STATE_CHANGED');
    if (lastResp.type === 'STATE_CHANGED') {
      expect(lastResp.paused).toBe(true);
    }

    host.handleRequest({ type: 'RESUME' });
    expect(host.isPaused).toBe(false);
    lastResp = host.responses[host.responses.length - 1];
    expect(lastResp.type).toBe('STATE_CHANGED');
    if (lastResp.type === 'STATE_CHANGED') {
      expect(lastResp.paused).toBe(false);
    }
  });
});
