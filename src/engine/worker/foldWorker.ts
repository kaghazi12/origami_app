import { createMeshFromFold, rampRestAngles } from '../mesh/mesh';
import { BarHingeSolver, computeStableTimeStep, seedFromFlat } from '../physics/solver';
import { TriMesh } from '../types';
import { CreaseEdgeInfo, WorkerFrameStats, WorkerRequest, WorkerResponse } from './types';

// State in Worker
let mesh: TriMesh | null = null;
let solver: BarHingeSolver | null = null;
let isPaused = false;
let currentAlpha = 0;
let targetAlpha = 0;
let stepCounter = 0;
let loopTimer: any = null;
const TIME_BUDGET_MS = 8.0; // ~8 ms substep budget per tick (~120Hz physics tick)

// Double-buffering recycling pool
const bufferPool: ArrayBuffer[] = [];

function getRecycledBuffer(byteLength: number): ArrayBuffer {
  for (let i = 0; i < bufferPool.length; i++) {
    if (bufferPool[i].byteLength === byteLength) {
      return bufferPool.splice(i, 1)[0];
    }
  }
  return new ArrayBuffer(byteLength);
}

function stopLoop() {
  if (loopTimer !== null) {
    clearTimeout(loopTimer);
    loopTimer = null;
  }
}

function startLoop() {
  if (loopTimer !== null || isPaused || !mesh || !solver) return;
  scheduleNextTick();
}

function scheduleNextTick() {
  loopTimer = setTimeout(runPhysicsTick, 4);
}

function runPhysicsTick() {
  loopTimer = null;
  if (isPaused || !mesh || !solver) return;

  const tickStart = performance.now();
  let substeps = 0;
  let pe = 0;
  let ke = 0;
  let isConverged = false;

  // Continuation ramping: smoothly slew currentAlpha toward targetAlpha to preserve physical equilibrium branch
  if (Math.abs(currentAlpha - targetAlpha) > 1e-5) {
    const alphaSlewRate = 0.02; // max deltaAlpha per tick (~300ms for full 0 -> 1 travel)
    if (currentAlpha < targetAlpha) {
      currentAlpha = Math.min(targetAlpha, currentAlpha + alphaSlewRate);
    } else {
      currentAlpha = Math.max(targetAlpha, currentAlpha - alphaSlewRate);
    }
    rampRestAngles(mesh, currentAlpha);
  }

  // Run dynamic relaxation substeps until time budget is consumed
  while (performance.now() - tickStart < TIME_BUDGET_MS) {
    const stepResult = solver.step();
    pe = stepResult.potentialEnergy;
    ke = stepResult.kineticEnergy;
    substeps++;
    stepCounter++;

    const maxResForce = solver.getMaxResidualForce();
    const targetReached = Math.abs(currentAlpha - targetAlpha) < 1e-4;
    if (targetReached && maxResForce < 0.005 && ke < 1e-6) {
      isConverged = true;
      break;
    }
  }

  const tickDurationMs = performance.now() - tickStart;

  // Prepare Float32 transfer buffer
  const numCoords = mesh.numVertices * 3;
  const byteLength = numCoords * 4;
  const ab = getRecycledBuffer(byteLength);
  const posF32 = new Float32Array(ab);

  // Copy Float64 simulation positions into Float32 render buffer
  for (let i = 0; i < numCoords; i++) {
    posF32[i] = mesh.positions[i];
  }

  const stats: WorkerFrameStats = {
    potentialEnergy: pe,
    kineticEnergy: ke,
    maxResidualForce: solver.getMaxResidualForce(),
    maxStrain: solver.getMaxStrain(),
    converged: isConverged,
    alpha: currentAlpha,
    stepCount: stepCounter,
    substepsInTick: substeps,
    tickDurationMs,
  };

  const response: WorkerResponse = {
    type: 'FRAME',
    positions: posF32,
    stats,
  };

  // Zero-copy transfer of the positions buffer
  (self as unknown as Worker).postMessage(response, [posF32.buffer]);

  // Keep looping if not fully converged or still slewing alpha
  const targetReached = Math.abs(currentAlpha - targetAlpha) < 1e-4;
  if (!isConverged || !targetReached) {
    scheduleNextTick();
  }
}

self.onmessage = (e: MessageEvent<WorkerRequest>) => {
  const req = e.data;

  try {
    switch (req.type) {
      case 'LOAD': {
        stopLoop();
        const options = req.meshOptions ?? {
          axialStiffness: 40000,
          creaseStiffness: 40,
          facetStiffness: 200,
        };

        mesh = createMeshFromFold(req.fold, options);
        solver = new BarHingeSolver(mesh, {
          kineticDamping: true,
          massScaling: true,
          dt: computeStableTimeStep(mesh, 0.4),
        });

        currentAlpha = 0;
        targetAlpha = 0;
        stepCounter = 0;
        isPaused = false;
        bufferPool.length = 0; // reset buffer pool

        // Extract crease edges for 3D visualization
        const creaseEdges: CreaseEdgeInfo[] = [];
        for (const h of mesh.hinges) {
          if (h.assignment === 'M' || h.assignment === 'V' || h.assignment === 'B' || h.assignment === 'F') {
            creaseEdges.push({
              v0: h.v0,
              v1: h.v1,
              assignment: h.assignment,
            });
          }
        }

        // Bounding box of 2D pattern
        let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
        for (let i = 0; i < mesh.numVertices; i++) {
          const u = mesh.uvs[i * 2 + 0];
          const v = mesh.uvs[i * 2 + 1];
          if (u < minX) minX = u;
          if (u > maxX) maxX = u;
          if (v < minY) minY = v;
          if (v > maxY) maxY = v;
        }

        const uvsF32 = new Float32Array(mesh.uvs.length);
        for (let i = 0; i < mesh.uvs.length; i++) uvsF32[i] = mesh.uvs[i];

        const loadedResp: WorkerResponse = {
          type: 'LOADED',
          numVertices: mesh.numVertices,
          numTriangles: mesh.numTriangles,
          indices: new Uint32Array(mesh.indices),
          uvs: uvsF32,
          creaseEdges,
          bounds: { minX, maxX, minY, maxY },
        };
        (self as unknown as Worker).postMessage(loadedResp);

        startLoop();
        break;
      }

      case 'SET_ALPHA': {
        if (!mesh) return;
        targetAlpha = Math.max(0, Math.min(1, req.alpha));
        if (isPaused) {
          isPaused = false;
        }
        startLoop();
        break;
      }

      case 'SET_STIFFNESS': {
        if (!mesh) return;
        if (req.axialStiffness !== undefined) {
          for (const b of mesh.bars) b.stiffness = req.axialStiffness;
        }
        if (req.creaseStiffness !== undefined) {
          for (const h of mesh.hinges) {
            if (h.assignment === 'M' || h.assignment === 'V') h.stiffness = req.creaseStiffness;
          }
        }
        if (req.facetStiffness !== undefined) {
          for (const h of mesh.hinges) {
            if (h.assignment === 'F' || h.assignment === 'U') h.stiffness = req.facetStiffness;
          }
        }
        if (solver) {
          solver.dt = computeStableTimeStep(mesh, 0.4);
        }
        break;
      }

      case 'SEED_FROM_FLAT': {
        if (!mesh || !solver) return;
        seedFromFlat(mesh, req.eps ?? 1e-3);
        startLoop();
        break;
      }

      case 'RESET': {
        if (!mesh) return;
        currentAlpha = 0;
        targetAlpha = 0;
        rampRestAngles(mesh, 0);
        for (let i = 0; i < mesh.numVertices; i++) {
          mesh.positions[i * 3 + 0] = mesh.uvs[i * 2 + 0];
          mesh.positions[i * 3 + 1] = mesh.uvs[i * 2 + 1];
          mesh.positions[i * 3 + 2] = 0;
          mesh.velocities[i * 3 + 0] = 0;
          mesh.velocities[i * 3 + 1] = 0;
          mesh.velocities[i * 3 + 2] = 0;
        }
        startLoop();
        break;
      }

      case 'PAUSE': {
        isPaused = true;
        stopLoop();
        (self as unknown as Worker).postMessage({
          type: 'STATE_CHANGED',
          paused: true,
          alpha: currentAlpha,
        });
        break;
      }

      case 'RESUME': {
        isPaused = false;
        (self as unknown as Worker).postMessage({
          type: 'STATE_CHANGED',
          paused: false,
          alpha: currentAlpha,
        });
        startLoop();
        break;
      }

      case 'RETURN_BUFFER': {
        // Recycle returned array buffer for double-buffering
        if (req.buffer && req.buffer.byteLength > 0 && bufferPool.length < 3) {
          bufferPool.push(req.buffer as ArrayBuffer);
        }
        break;
      }
    }
  } catch (err: any) {
    (self as unknown as Worker).postMessage({
      type: 'ERROR',
      message: err?.message || String(err),
    });
  }
};
