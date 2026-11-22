import { createMeshFromFold, rampRestAngles } from '../mesh/mesh';
import { splitMeshAlongPolylines } from '../mesh/split';
import { bakeCreasesToFold } from '../mesh/creaseSlice';
import { BarHingeSolver, computeStableTimeStep, seedFromFlat } from '../physics/solver';
import { XPBDSolver } from '../physics/xpbd';
import { FoldSolver } from '../physics/types';
import { TriMesh, FoldFormat } from '../types';
import { CreaseEdgeInfo, WorkerFrameStats, WorkerRequest, WorkerResponse } from './types';

// State in Worker
let mesh: TriMesh | null = null;
let solver: FoldSolver | null = null;
let currentFold: FoldFormat | null = null;
let currentMeshOptions: any = null;
let currentPhysicsParams: any = {};
const undoStack: { mesh: TriMesh; fold: FoldFormat }[] = [];
const redoStack: { mesh: TriMesh; fold: FoldFormat }[] = [];

function cloneTriMesh(m: TriMesh): TriMesh {
  return {
    numVertices: m.numVertices,
    numTriangles: m.numTriangles,
    uvs: new Float64Array(m.uvs),
    positions: new Float64Array(m.positions),
    velocities: new Float64Array(m.velocities),
    masses: new Float64Array(m.masses),
    indices: new Uint32Array(m.indices),
    bars: m.bars.map((b) => ({ ...b })),
    hinges: m.hinges.map((h) => ({ ...h })),
  };
}

let isPaused = false;
let isConverged = false;
let currentAlpha = 0;
let targetAlpha = 0;
let stepCounter = 0;
let lastPostTime = 0;
let loopTimer: any = null;
let isAwaitingBuffer = false; // Drop-stale / backpressure gate

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

let restFrameCount = 0;
let isSleeping = false;

function wakeFromSleep() {
  restFrameCount = 0;
  isSleeping = false;
  isConverged = false;
  startLoop();
}

function stopLoop() {
  if (loopTimer !== null) {
    clearTimeout(loopTimer);
    loopTimer = null;
  }
}

function startLoop() {
  if (loopTimer !== null || isPaused || isSleeping || !mesh || !solver) return;
  scheduleNextTick();
}

function scheduleNextTick() {
  if (isSleeping || isPaused) return;
  loopTimer = setTimeout(runPhysicsTick, 8); // 8 ms interval (~120 Hz maximum physics frequency)
}

function runPhysicsTick() {
  loopTimer = null;
  if (isPaused || isSleeping || !mesh || !solver) return;

  const tickStart = performance.now();
  let substeps = 0;
  let pe = 0;
  let ke = 0;

  // Adaptive Continuation: advance currentAlpha only as fast as solver keeps strain strictly below 4%
  const currentStrain = solver.getMaxStrain();

  if (Math.abs(currentAlpha - targetAlpha) > 1e-5) {
    const strainThreshold = 0.04;
    if (currentStrain < strainThreshold) {
      const strainMargin = Math.max(0.1, 1.0 - currentStrain / strainThreshold);
      const alphaSlewRate = 0.025 * strainMargin;
      if (currentAlpha < targetAlpha) {
        currentAlpha = Math.min(targetAlpha, currentAlpha + alphaSlewRate);
      } else {
        currentAlpha = Math.max(targetAlpha, currentAlpha - alphaSlewRate);
      }
      rampRestAngles(mesh, currentAlpha);
    }
  }

  // Run physics steps for this tick
  const tStep0 = performance.now();
  const stepResult = solver.step(0.016);
  pe = stepResult.potentialEnergy;
  ke = stepResult.kineticEnergy;
  substeps = 1;
  stepCounter++;
  const stepDurationMs = performance.now() - tStep0;

  // Max vertex speed across mesh
  let maxSpeed = 0;
  const vel = mesh.velocities;
  for (let i = 0; i < mesh.numVertices; i++) {
    const vx = vel[i * 3 + 0];
    const vy = vel[i * 3 + 1];
    const vz = vel[i * 3 + 2];
    const s = Math.hypot(vx, vy, vz);
    if (s > maxSpeed) maxSpeed = s;
  }

  const maxResForce = solver.getMaxResidualForce();
  const maxStrain = solver.getMaxStrain();
  const targetReached = Math.abs(currentAlpha - targetAlpha) < 1e-4;

  if (targetReached && maxResForce < 0.05 && ke < 1e-7) {
    isConverged = true;
  }

  // Sleep at rest: when speed < 1e-4 m/s, strain < 0.01, and target alpha reached for N=10 frames
  // (Never sleep while an active drag or pin manipulation is in progress)
  const anySolver = solver as any;
  const hasActiveDrag = (anySolver.barycentricDrag !== null && anySolver.barycentricDrag !== undefined) ||
                        (anySolver.dragTargets && anySolver.dragTargets.size > 0);
  const isResting = !hasActiveDrag && targetReached && maxSpeed < 1e-4 && maxStrain < 0.01;
  if (isResting) {
    restFrameCount++;
  } else {
    restFrameCount = 0;
  }

  if (restFrameCount >= 10) {
    isSleeping = true;
    isConverged = true;
  }

  const tickDurationMs = performance.now() - tickStart;
  const now = performance.now();
  const timeBetweenPostsMs = lastPostTime > 0 ? (now - lastPostTime) : 0;

  // Drop-Stale Backpressure: only post if main thread has returned previous buffer
  if (!isAwaitingBuffer) {
    lastPostTime = now;
    const numCoords = mesh.numVertices * 3;
    const byteLength = numCoords * 4;
    const ab = getRecycledBuffer(byteLength);
    const posF32 = new Float32Array(ab);

    for (let i = 0; i < numCoords; i++) {
      posF32[i] = mesh.positions[i];
    }

    const stats: WorkerFrameStats = {
      potentialEnergy: pe,
      kineticEnergy: ke,
      maxResidualForce: maxResForce,
      maxStrain,
      converged: isConverged,
      alpha: currentAlpha,
      targetAlpha,
      stepCount: stepCounter,
      substepsInTick: substeps,
      iterationsPerTick: 20,
      tickDurationMs,
      stepDurationMs,
      postTimestamp: (typeof performance !== 'undefined' && performance.timeOrigin)
        ? (performance.timeOrigin + now)
        : Date.now(),
      timeBetweenPostsMs,
    };

    const response: WorkerResponse = {
      type: 'FRAME',
      positions: posF32,
      stats,
    };

    isAwaitingBuffer = true;
    // Zero-copy transfer of positions buffer
    (self as unknown as Worker).postMessage(response, [posF32.buffer]);
  }

  // Keep looping only if not sleeping and not fully settled, or if actively dragged
  if (!isSleeping && (!isConverged || !targetReached || hasActiveDrag)) {
    scheduleNextTick();
  }
}

function postLoadedResponse(fold?: FoldFormat | null) {
  if (!mesh) return;
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
    bakedFold: fold ?? undefined,
  };
  (self as unknown as Worker).postMessage(loadedResp);
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
        const sOpts = req.solverOptions ?? {};
        solver = new XPBDSolver(mesh, {
          substeps: sOpts.substeps ?? 10,
          iterations: 2,
          velocityDamping: 0.995,
          enableTable: sOpts.enableTable ?? false,
          tableZ: sOpts.tableZ ?? 0.0,
          paperThickness: sOpts.paperThickness,
          enableGravity: sOpts.enableGravity ?? false,
          gravity: sOpts.gravity ?? 1.0,
          muStatic: sOpts.muStatic ?? 0.5,
          muKinetic: sOpts.muKinetic ?? 0.4,
          bendingCompliance: sOpts.bendingCompliance,
          enablePlasticity: true,
          enableSelfCollision: sOpts.enableSelfCollision ?? false,
        });

        // Seed microscopic out-of-plane perturbation at center
        const center = Math.floor(mesh.numVertices / 2);
        mesh.positions[center * 3 + 2] = 0.01;

        currentFold = req.fold;
        currentMeshOptions = options;
        currentPhysicsParams = sOpts;
        undoStack.length = 0;
        redoStack.length = 0;

        currentAlpha = 0;
        targetAlpha = 0;
        stepCounter = 0;
        isPaused = false;
        isSleeping = false;
        restFrameCount = 0;
        isAwaitingBuffer = false;
        bufferPool.length = 0;

        postLoadedResponse(currentFold);
        startLoop();
        break;
      }

      case 'SET_ALPHA': {
        if (!mesh) return;
        targetAlpha = Math.max(0, Math.min(1, req.alpha));
        if (isPaused) {
          isPaused = false;
        }
        wakeFromSleep();
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
        wakeFromSleep();
        break;
      }

      case 'SET_PHYSICS_PARAMS': {
        if (!solver || !(solver instanceof XPBDSolver)) return;
        if (req.enableTable !== undefined || req.paperThickness !== undefined || req.tableZ !== undefined) {
          solver.setTable(
            req.enableTable ?? solver.enableTable,
            req.paperThickness ?? solver.paperThickness,
            req.tableZ ?? solver.tableZ
          );
        }
        if (req.muStatic !== undefined || req.muKinetic !== undefined) {
          solver.setFriction(
            req.muStatic ?? solver.muStatic,
            req.muKinetic ?? solver.muKinetic
          );
        }
        if (req.enableGravity !== undefined || req.gravity !== undefined) {
          solver.setGravity(
            req.enableGravity ?? solver.enableGravity,
            req.gravity ?? solver.gravity
          );
        }
        if (req.bendingCompliance !== undefined) {
          solver.setBendingCompliance(req.bendingCompliance);
        }
        if (req.substeps !== undefined) {
          solver.substeps = req.substeps;
        }
        if (req.enableSelfCollision !== undefined) {
          solver.setSelfCollision(req.enableSelfCollision);
        }
        // Keep the latest params so solvers rebuilt by COMMIT_CREASE / UNDO / REDO inherit them
        currentPhysicsParams = { ...currentPhysicsParams, ...req };
        delete currentPhysicsParams.type;
        wakeFromSleep();
        break;
      }

      case 'SET_PINS': {
        if (!solver) return;
        solver.setFixedVertices?.(new Set(req.pins));
        wakeFromSleep();
        break;
      }

      case 'SET_DRAG': {
        if (!solver) return;
        solver.setDragTarget?.(req.vertexIndex, req.targetPos);
        wakeFromSleep();
        break;
      }

      case 'SET_BARYCENTRIC_PINS': {
        if (!solver) return;
        solver.setBarycentricPins?.(req.pins);
        wakeFromSleep();
        break;
      }

      case 'SET_BARYCENTRIC_DRAG': {
        if (!solver) return;
        solver.setBarycentricDrag?.(req.drag);
        wakeFromSleep();
        break;
      }

      case 'SET_MAX_DRAG_SPEED': {
        if (!solver || !(solver instanceof XPBDSolver)) return;
        solver.setMaxDragSpeed(req.speed);
        break;
      }

      case 'SEED_FROM_FLAT': {
        if (!mesh || !solver) return;
        seedFromFlat(mesh, req.eps ?? 1e-3);
        wakeFromSleep();
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
        isAwaitingBuffer = false;
        wakeFromSleep();
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
        wakeFromSleep();
        break;
      }

      case 'RETURN_BUFFER': {
        // Recycle returned array buffer for double-buffering
        if (req.buffer && req.buffer.byteLength > 0 && bufferPool.length < 3) {
          bufferPool.push(req.buffer as ArrayBuffer);
        }
        isAwaitingBuffer = false;
        // If simulation loop was waiting and NOT sleeping, schedule immediately
        if (loopTimer === null && (!isPaused && !isSleeping && mesh && solver)) {
          scheduleNextTick();
        }
        break;
      }

      case 'COMMIT_CREASE': {
        if (!mesh || !currentFold) return;
        undoStack.push({
          mesh: cloneTriMesh(mesh),
          fold: JSON.parse(JSON.stringify(currentFold)),
        });
        redoStack.length = 0;

        const newMesh = splitMeshAlongPolylines(mesh, req.polylinesUV, {
          assignment: req.assignment ?? 'V',
          targetAngleDeg: req.foldAngleDeg ?? 177,
          creaseStiffness: req.creaseStiffness ?? 500,
        });
        mesh = newMesh;

        // Update currentFold with newly added creases
        currentFold = bakeCreasesToFold(
          currentFold,
          req.polylinesUV,
          req.assignment ?? 'V',
          req.foldAngleDeg ?? 177
        );

        // Recreate solver with new mesh
        const sOpts = currentPhysicsParams ?? {};
        solver = new XPBDSolver(newMesh, {
          substeps: sOpts.substeps ?? 10,
          iterations: 2,
          velocityDamping: 0.995,
          enableTable: sOpts.enableTable ?? false,
          tableZ: sOpts.tableZ ?? 0.0,
          paperThickness: sOpts.paperThickness,
          enableGravity: sOpts.enableGravity ?? false,
          gravity: sOpts.gravity ?? 1.0,
          muStatic: sOpts.muStatic ?? 0.5,
          muKinetic: sOpts.muKinetic ?? 0.4,
          bendingCompliance: sOpts.bendingCompliance,
          enablePlasticity: true,
          enableSelfCollision: sOpts.enableSelfCollision ?? false,
        });

        isAwaitingBuffer = false;
        bufferPool.length = 0;
        postLoadedResponse(currentFold);
        wakeFromSleep();
        break;
      }

      case 'PRESS_FLAT': {
        if (solver && solver instanceof XPBDSolver) {
          solver.pressFlat(req.deltaDeg ?? 3.0);
          wakeFromSleep();
        }
        break;
      }

      case 'UNDO': {
        if (undoStack.length > 0 && mesh && currentFold) {
          redoStack.push({
            mesh: cloneTriMesh(mesh),
            fold: JSON.parse(JSON.stringify(currentFold)),
          });
          const prev = undoStack.pop()!;
          mesh = prev.mesh;
          currentFold = prev.fold;

          const sOpts = currentPhysicsParams ?? {};
          solver = new XPBDSolver(mesh, {
            substeps: sOpts.substeps ?? 10,
            iterations: 2,
            velocityDamping: 0.995,
            enableTable: sOpts.enableTable ?? false,
            tableZ: sOpts.tableZ ?? 0.0,
            paperThickness: sOpts.paperThickness,
            enableGravity: sOpts.enableGravity ?? false,
            gravity: sOpts.gravity ?? 1.0,
            muStatic: sOpts.muStatic ?? 0.5,
            muKinetic: sOpts.muKinetic ?? 0.4,
            bendingCompliance: sOpts.bendingCompliance,
            enablePlasticity: true,
            enableSelfCollision: sOpts.enableSelfCollision ?? false,
          });

          isAwaitingBuffer = false;
          bufferPool.length = 0;
          postLoadedResponse(currentFold);
          wakeFromSleep();
        }
        break;
      }

      case 'REDO': {
        if (redoStack.length > 0 && mesh && currentFold) {
          undoStack.push({
            mesh: cloneTriMesh(mesh),
            fold: JSON.parse(JSON.stringify(currentFold)),
          });
          const next = redoStack.pop()!;
          mesh = next.mesh;
          currentFold = next.fold;

          const sOpts = currentPhysicsParams ?? {};
          solver = new XPBDSolver(mesh, {
            substeps: sOpts.substeps ?? 10,
            iterations: 2,
            velocityDamping: 0.995,
            enableTable: sOpts.enableTable ?? false,
            tableZ: sOpts.tableZ ?? 0.0,
            paperThickness: sOpts.paperThickness,
            enableGravity: sOpts.enableGravity ?? false,
            gravity: sOpts.gravity ?? 1.0,
            muStatic: sOpts.muStatic ?? 0.5,
            muKinetic: sOpts.muKinetic ?? 0.4,
            bendingCompliance: sOpts.bendingCompliance,
            enablePlasticity: true,
            enableSelfCollision: sOpts.enableSelfCollision ?? false,
          });

          isAwaitingBuffer = false;
          bufferPool.length = 0;
          postLoadedResponse(currentFold);
          wakeFromSleep();
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
