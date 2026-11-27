import { createMeshFromFold, rampRestAngles } from '../mesh/mesh';
import { splitMeshAlongPolylines } from '../mesh/split';
import { bakeCreasesToFold } from '../mesh/creaseSlice';
import { BarHingeSolver, computeStableTimeStep, seedFromFlat } from '../physics/solver';
import { XPBDSolver } from '../physics/xpbd';
import { FoldSolver } from '../physics/types';
import { TriMesh, FoldFormat } from '../types';
import { CreaseEdgeInfo, ExactFoldInfo, ExactFoldMode, WorkerFrameStats, WorkerRequest, WorkerResponse } from './types';
import { extractPlanarFaces } from '../fold/faces';
import { ExactFoldPlayer, foldCreasePattern, withLayerGap } from '../design/creasePattern';
import { computeDihedralAngle } from '../physics/hinges';
import { FoldDriver } from '../physics/foldDriver';
import { countMeshIntersections } from '../physics/collision';

/** Patterns with more folded creases than this are folded exactly in 'auto' mode. */
const EXACT_AUTO_MIN_CREASES = 24;
let exactPlayer: ExactFoldPlayer | null = null;
let exactInfo: ExactFoldInfo | undefined;
let lastLoadRequest: Extract<WorkerRequest, { type: 'LOAD' }> | null = null;
/** Total thickness of the exactly folded stack (100%), as a fraction of the sheet size. */
let layerSpacing = 0.12;
let exactLayerCount = 1;
let exactSheetSize = 1;
function exactLayerGap() {
  return (layerSpacing * exactSheetSize) / Math.max(1, exactLayerCount);
}

/**
 * Open the exact folded form slightly with physics (creases to 97%, 94%, ... 85%) and keep the
 * shapes as keyframes. Starting from the correct folded shape keeps physics on the right branch,
 * and slightly opened folds splay the flaps apart so the model is readable. Stops early if the
 * paper starts to stretch, or if a keyframe pushes paper through paper: the relaxation has no
 * collisions, and on many patterns layers sank through the ones above them, so a second after
 * loading the model near 100% showed the back colour where the front should be. A keyframe may
 * not cross more triangles than the exact fold (whose stacked layers touch). Runs in the
 * background so loading is not delayed.
 */
function createRelaxBake(player: ExactFoldPlayer, base: TriMesh): () => boolean {
  const m = cloneTriMesh(base);
  player.pose(1, m.positions);
  m.velocities.fill(0);
  for (const h of m.hinges) h.previousAngle = h.assignment === 'M' || h.assignment === 'V' ? h.targetAngle : 0;
  const relax = new XPBDSolver(m, {
    substeps: 10,
    iterations: 2,
    velocityDamping: 0.9,
    enableTable: false,
    enableGravity: false,
    enablePlasticity: false,
    enableSelfCollision: false,
    bendingCompliance: 0.0005,
  });
  const crossings = (pos: Float64Array) => countMeshIntersections(pos, m.indices, m.numTriangles).intersectionCount;
  const allowed = crossings(m.positions);
  const levels = [0.97, 0.94, 0.91, 0.88, 0.85];
  const RAMP = 8, SETTLE = 4;
  const alphas = [1];
  const poses = [Float64Array.from(m.positions)];
  let level = 0, tick = 0, from = 1;
  /** Advance a few physics ticks; returns true when the bake is finished. */
  return () => {
    for (let n = 0; n < 3; n++) {
      if (level >= levels.length) break;
      const to = levels[level];
      tick++;
      if (tick <= RAMP) rampRestAngles(m, from + (to - from) * (tick / RAMP));
      relax.step(0.016);
      relax.getMaxResidualForce();
      if (tick < RAMP + SETTLE) continue;
      let finite = true;
      for (let i = 0; i < m.positions.length && finite; i++) finite = Number.isFinite(m.positions[i]);
      if (!finite || relax.getMaxStrain() > 0.06 || crossings(m.positions) > allowed) { level = levels.length; break; }
      alphas.push(to);
      poses.push(Float64Array.from(m.positions));
      from = to; tick = 0; level++;
    }
    if (level >= levels.length) {
      if (alphas.length > 1) player.setRelaxedKeyframes(alphas, poses);
      return true;
    }
    return false;
  };
}

/**
 * Paper strain at which a pattern that can't fold flat counts as jammed (FoldDriver.jamStrain).
 * Valid patterns stay under 5% (fold_files_robustness.test.ts), so they never hit it.
 */
const JAM_STRAIN = 0.05;
/** The open pattern can't fold flat (the exact folder found it impossible): limit the fold where it jams. */
let foldIsImpossible = false;
function newDriver(m: TriMesh, s: FoldSolver): FoldDriver {
  return new FoldDriver(m, s, { jamStrain: foldIsImpossible ? JAM_STRAIN : null });
}

/** Background bake of the relaxed keyframes (runs a slice per loop iteration). */
let relaxBake: (() => boolean) | null = null;

/** Exact fold parked while the user grabs the paper (physics runs from the exact shape). */
let parkedExactPlayer: ExactFoldPlayer | null = null;

/**
 * The user grabbed or pinned the exactly folded paper: hand the current shape to the physics
 * solver as its rest shape so dragging bends the paper around it. Contacts, table and gravity are
 * switched off for this (hundreds of stacked layers at paper thickness would push apart). Moving
 * the fold slider again goes back to the exact fold.
 */
function releaseExactToPhysics() {
  if (!exactPlayer || !mesh || !solver) return;
  // Frames between flat and folded are computed, not real paper (flipping faces squash flat on the
  // way), so physics cannot start there. Settle at the nearest real state first and tell the page.
  // (The relaxed keyframes near the folded end are real paper shapes and need no settling.)
  if (currentAlpha > 1e-6 && currentAlpha < exactPlayer.relaxedFrom - 1e-6) {
    currentAlpha = currentAlpha >= exactPlayer.relaxedFrom / 2 ? exactPlayer.relaxedFrom : 0;
    exactPlayer.pose(currentAlpha, mesh.positions);
    const changed: WorkerResponse = { type: 'STATE_CHANGED', paused: false, alpha: currentAlpha };
    (self as unknown as Worker).postMessage(changed);
  }
  for (const h of mesh.hinges) {
    const folded = h.assignment === 'M' || h.assignment === 'V';
    h.previousAngle = folded ? h.targetAngle * currentAlpha : 0;
    h.restAngle = computeDihedralAngle(h, mesh.positions, true);
  }
  mesh.velocities.fill(0);
  targetAlpha = currentAlpha;
  driver?.jumpTo(currentAlpha);
  if (solver instanceof XPBDSolver) {
    // Keep self-collision on, so grabbed layers can't pass through each other. The stacked layers
    // of the exact fold sit one layer gap apart, so the contact thickness must fit inside that gap
    // or every layer would be pushed apart at once.
    solver.paperThickness = Math.min(solver.paperThickness, exactLayerGap() * 0.8);
    // Search for contacts only a few thicknesses out. The default radius (0.05 of the sheet) is
    // deeper than a whole stack of hundreds of layers, so every triangle was tested against
    // nearly every other (seconds per frame on large patterns).
    solver.setSelfCollision(true, Math.max(solver.paperThickness * 4, 1e-4));
    solver.setTable(false);
    solver.setGravity(false);
  }
  parkedExactPlayer = exactPlayer;
  exactPlayer = null;
}

/** The solver's default paper thickness for a mesh: 0.2% of the sheet width. */
function defaultThickness(m: TriMesh): number {
  let x0 = Infinity, x1 = -Infinity;
  for (let i = 0; i < m.numVertices; i++) { x0 = Math.min(x0, m.positions[i * 3]); x1 = Math.max(x1, m.positions[i * 3]); }
  return (x1 > x0 ? x1 - x0 : 1) * 0.002;
}

/** Back from grabbing to the exact fold (restores the user's physics settings for later). */
function resumeExactFold() {
  if (!parkedExactPlayer || !solver) return;
  exactPlayer = parkedExactPlayer;
  parkedExactPlayer = null;
  solver.setBarycentricDrag?.(null);
  solver.setBarycentricPins?.([]);
  solver.setFixedVertices?.(new Set());
  if (solver instanceof XPBDSolver) {
    const p = currentPhysicsParams ?? {};
    solver.paperThickness = p.paperThickness ?? (solver.mesh.numVertices ? defaultThickness(solver.mesh) : solver.paperThickness);
    solver.setSelfCollision(p.enableSelfCollision ?? true, Math.max(0.05, solver.paperThickness * 2));
    solver.setTable(p.enableTable ?? false, p.paperThickness ?? solver.paperThickness, p.tableZ ?? 0);
    solver.setGravity(p.enableGravity ?? false, p.gravity ?? solver.gravity);
  }
}

/** Try to fold the crease pattern exactly. Returns the player (when it should drive the fold) and info. */
function prepareExactFold(input: FoldFormat, mode: ExactFoldMode): { player: ExactFoldPlayer | null; info: ExactFoldInfo; fold: FoldFormat } {
  let fold = input;
  const creases = fold.edges_assignment.filter((a) => a === 'M' || a === 'V').length;
  const info: ExactFoldInfo = { available: false, active: false, mode, creases };
  if (creases === 0) return { player: null, info: { ...info, reason: 'no mountain/valley creases' }, fold };

  try {
    const faces = fold.faces_vertices && fold.faces_vertices.length ? fold.faces_vertices : extractPlanarFaces(fold);
    const cp = {
      vertices_coords: fold.vertices_coords as number[][],
      edges_vertices: fold.edges_vertices,
      edges_assignment: fold.edges_assignment,
      edges_foldAngle: fold.edges_foldAngle,
      faces_vertices: faces,
    };
    const first = foldCreasePattern(cp, { layerGap: 0 });
    if (!first.ok) return { player: null, info: { ...info, reason: first.reason, timeMs: first.timeMs }, fold };
    if (first.reassigned.length) {
      // the file's mountains and valleys can't stack; fold (and show) the nearest assignment that can
      const asg = fold.edges_assignment.slice();
      const ang = (fold.edges_foldAngle ?? asg.map((a) => (a === 'V' ? 180 : a === 'M' ? -180 : 0))).slice();
      for (const e of first.reassigned) {
        asg[e] = asg[e] === 'M' ? 'V' : 'M';
        ang[e] = -(ang[e] ?? 0);
      }
      fold = { ...fold, edges_assignment: asg, edges_foldAngle: ang };
      cp.edges_assignment = asg;
      cp.edges_foldAngle = ang;
    }
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (const v of cp.vertices_coords) { x0 = Math.min(x0, v[0]); x1 = Math.max(x1, v[0]); y0 = Math.min(y0, v[1]); y1 = Math.max(y1, v[1]); }
    exactSheetSize = Math.max(x1 - x0, y1 - y0) || 1;
    exactLayerCount = first.layerCount;
    const active = mode === 'on' || (mode === 'auto' && creases > EXACT_AUTO_MIN_CREASES);
    let player: ExactFoldPlayer | null = null;
    if (active) {
      player = new ExactFoldPlayer(cp, first.flatVertices, first.vertexRanks);
      player.setLayerGap(exactLayerGap());
    }
    return {
      player,
      info: { ...info, available: true, active, layers: first.layerCount, timeMs: first.timeMs, reassigned: first.reassigned.length || undefined },
      fold,
    };
  } catch (e) {
    return { player: null, info: { ...info, reason: (e as Error).message }, fold };
  }
}

/**
 * The physics solver for a crease pattern. Plasticity is off: it moved every crease's rest angle
 * toward wherever the paper happened to be, so folds drifted away from the file's angles and kept
 * moving after 100%. 20 substeps keep stacked layers from crossing (10 let a few through).
 */
function buildSolver(m: TriMesh, p: any): XPBDSolver {
  return new XPBDSolver(m, {
    substeps: p.substeps ?? 20,
    iterations: 2,
    velocityDamping: 0.995,
    enableTable: p.enableTable ?? false,
    tableZ: p.tableZ ?? 0.0,
    paperThickness: p.paperThickness,
    enableGravity: p.enableGravity ?? false,
    gravity: p.gravity ?? 1.0,
    muStatic: p.muStatic ?? 0.5,
    muKinetic: p.muKinetic ?? 0.4,
    bendingCompliance: p.bendingCompliance,
    enablePlasticity: false,
    enableSelfCollision: p.enableSelfCollision ?? true,
  });
}

// State in Worker
let mesh: TriMesh | null = null;
let solver: FoldSolver | null = null;
/** Moves the fold toward the slider, then settles and stops the paper (physics mode). */
let driver: FoldDriver | null = null;
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
/** The last frame before the paper stopped wasn't sent (backpressure); send it on RETURN_BUFFER. */
let finalFramePending = false;

function wakeFromSleep() {
  restFrameCount = 0;
  isSleeping = false;
  driver?.wake();
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

  if (exactPlayer) {
    runExactTick(tickStart);
    return;
  }

  // The user is holding the paper: never damp extra or freeze while they drag or pin.
  const anySolver = solver as any;
  const hasActiveDrag =
    (anySolver.barycentricDrag !== null && anySolver.barycentricDrag !== undefined) ||
    (anySolver.dragTargets && anySolver.dragTargets.size > 0) ||
    (anySolver.barycentricPins && anySolver.barycentricPins.length > 0) ||
    (anySolver.fixedVertices && anySolver.fixedVertices.size > 0);

  if (!driver || driver.mesh !== mesh) {
    driver = newDriver(mesh, solver);
    driver.jumpTo(currentAlpha);
  }
  driver.setSolver(solver);
  if (Math.abs(driver.target - targetAlpha) > 1e-9) driver.setTarget(targetAlpha);

  const tStep0 = performance.now();
  driver.tick(0.016, hasActiveDrag);
  currentAlpha = driver.alpha;
  stepCounter++;
  substeps = 1;
  ke = solver.getKineticEnergy();
  const stepDurationMs = performance.now() - tStep0;

  const maxResForce = solver.getMaxResidualForce();
  const maxStrain = solver.getMaxStrain();
  const targetReached = driver.atTargetAlpha;
  // Stopped: settled on its own or after the settle timeout. Nothing moves until the slider or
  // the paper is touched again (SET_ALPHA / drag / pin wake it).
  isConverged = driver.frozen;
  if (driver.frozen) isSleeping = true;

  const tickDurationMs = performance.now() - tickStart;
  const now = performance.now();
  const timeBetweenPostsMs = lastPostTime > 0 ? (now - lastPostTime) : 0;

  // Drop-Stale Backpressure: only post if main thread has returned previous buffer
  if (isAwaitingBuffer) {
    // the paper just stopped on a frame we couldn't send: send it when the buffer comes back
    if (isSleeping) finalFramePending = true;
  } else {
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
      foldLimit: driver.limit,
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

  // Keep looping until the driver stops the paper (it never stops while the paper is held)
  if (!isSleeping) scheduleNextTick();
}

/** One frame of the exact fold: move alpha toward the target and pose the pattern directly. */
function runExactTick(tickStart: number) {
  if (!mesh || !exactPlayer) return;
  if (relaxBake && relaxBake()) {
    relaxBake = null;
    isAwaitingBuffer = false; // re-post the current frame with the finished keyframes
  }
  const rate = 0.02;
  if (currentAlpha < targetAlpha) currentAlpha = Math.min(targetAlpha, currentAlpha + rate);
  else if (currentAlpha > targetAlpha) currentAlpha = Math.max(targetAlpha, currentAlpha - rate);
  exactPlayer.pose(currentAlpha, mesh.positions);
  mesh.velocities.fill(0);
  stepCounter++;
  const reached = Math.abs(currentAlpha - targetAlpha) < 1e-9;

  if (!isAwaitingBuffer) {
    const now = performance.now();
    const timeBetweenPostsMs = lastPostTime > 0 ? now - lastPostTime : 0;
    lastPostTime = now;
    const numCoords = mesh.numVertices * 3;
    const posF32 = new Float32Array(getRecycledBuffer(numCoords * 4));
    for (let i = 0; i < numCoords; i++) posF32[i] = mesh.positions[i];
    const stats: WorkerFrameStats = {
      potentialEnergy: 0,
      kineticEnergy: 0,
      maxResidualForce: 0,
      maxStrain: 0,
      converged: reached,
      alpha: currentAlpha,
      targetAlpha,
      stepCount: stepCounter,
      substepsInTick: 0,
      iterationsPerTick: 0,
      tickDurationMs: now - tickStart,
      stepDurationMs: 0,
      postTimestamp: typeof performance !== 'undefined' && performance.timeOrigin ? performance.timeOrigin + now : Date.now(),
      timeBetweenPostsMs,
    };
    isAwaitingBuffer = true;
    const response: WorkerResponse = { type: 'FRAME', positions: posF32, stats };
    (self as unknown as Worker).postMessage(response, [posF32.buffer]);
    if (reached && !relaxBake) {
      isConverged = true;
      isSleeping = true; // nothing moves until the slider changes (SET_ALPHA wakes us)
      return;
    }
  }
  scheduleNextTick();
}

function postLoadedResponse(fold?: FoldFormat | null) {
  if (!mesh) return;
  // Extract crease edges for 3D visualization
  const creaseEdges: CreaseEdgeInfo[] = [];
  for (const h of mesh.hinges) {
    const isRealCrease = h.assignment === 'M' || h.assignment === 'V' || h.assignment === 'B' || (h.assignment === 'F' && h.edgeIndex !== undefined);
    if (isRealCrease) {
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
    exact: exactInfo,
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

        lastLoadRequest = req;
        parkedExactPlayer = null;
        const exact = prepareExactFold(req.fold, req.exactFold ?? 'auto');
        // possibly with mountains/valleys swapped so it folds flat (exact.info.reassigned)
        const loaded = exact.fold;
        // The exact fold moves the crease-pattern vertices, so build the mesh on them directly.
        mesh = createMeshFromFold(loaded, exact.player ? { ...options, targetEdgeLength: undefined } : options);
        exactPlayer = exact.player && mesh.numVertices === loaded.vertices_coords.length ? exact.player : null;
        exactInfo = exactPlayer ? exact.info : { ...exact.info, active: false };
        foldIsImpossible = !exact.info.available && !!exact.info.reason && /stacking|tear/.test(exact.info.reason);
        relaxBake = exactPlayer ? createRelaxBake(exactPlayer, mesh) : null;
        const sOpts = req.solverOptions ?? {};
        solver = buildSolver(mesh, sOpts);
        driver = newDriver(mesh, solver);

        // Seed microscopic out-of-plane perturbation at center (physics only)
        if (!exactPlayer) {
          const center = Math.floor(mesh.numVertices / 2);
          mesh.positions[center * 3 + 2] = 0.01;
        }

        currentFold = loaded;
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

      case 'SET_EXACT_FOLD': {
        if (!lastLoadRequest || !currentFold) return;
        const reload = { ...lastLoadRequest, fold: currentFold, exactFold: req.mode };
        (self.onmessage as (ev: MessageEvent<WorkerRequest>) => void)({ data: reload } as MessageEvent<WorkerRequest>);
        break;
      }

      case 'SET_ALPHA': {
        if (!mesh) return;
        if (parkedExactPlayer) resumeExactFold();
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
        if (exactPlayer && req.pins.length > 0) releaseExactToPhysics();
        solver.setFixedVertices?.(new Set(req.pins));
        wakeFromSleep();
        break;
      }

      case 'SET_DRAG': {
        if (!solver) return;
        if (exactPlayer && req.targetPos) releaseExactToPhysics();
        solver.setDragTarget?.(req.vertexIndex, req.targetPos);
        wakeFromSleep();
        break;
      }

      case 'SET_BARYCENTRIC_PINS': {
        if (!solver) return;
        if (exactPlayer && req.pins.length > 0) releaseExactToPhysics();
        solver.setBarycentricPins?.(req.pins);
        wakeFromSleep();
        break;
      }

      case 'SET_BARYCENTRIC_DRAG': {
        if (!solver) return;
        if (exactPlayer && req.drag) releaseExactToPhysics();
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
        driver?.jumpTo(0);
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
        if (finalFramePending && isSleeping && mesh && solver && !exactPlayer) {
          // re-run one (frozen, motionless) tick just to post the final pose
          finalFramePending = false;
          isSleeping = false;
          runPhysicsTick();
          break;
        }
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
        relaxBake = null;
        parkedExactPlayer = null;
        exactPlayer = null;
        if (exactInfo) exactInfo = { ...exactInfo, active: false, available: false, reason: 'pattern edited' };

        // Update currentFold with newly added creases
        currentFold = bakeCreasesToFold(
          currentFold,
          req.polylinesUV,
          req.assignment ?? 'V',
          req.foldAngleDeg ?? 177
        );

        // Recreate solver with new mesh
        solver = buildSolver(newMesh, currentPhysicsParams ?? {});
        driver = newDriver(newMesh, solver);
        driver.jumpTo(currentAlpha);

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
          relaxBake = null;
          parkedExactPlayer = null;
          exactPlayer = null;
          if (exactInfo) exactInfo = { ...exactInfo, active: false, available: false, reason: 'pattern edited' };
          currentFold = prev.fold;

          solver = buildSolver(mesh, currentPhysicsParams ?? {});
          driver = newDriver(mesh, solver);
          driver.jumpTo(currentAlpha);

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
          relaxBake = null;
          parkedExactPlayer = null;
          exactPlayer = null;
          if (exactInfo) exactInfo = { ...exactInfo, active: false, available: false, reason: 'pattern edited' };
          currentFold = next.fold;

          solver = buildSolver(mesh, currentPhysicsParams ?? {});
          driver = newDriver(mesh, solver);
          driver.jumpTo(currentAlpha);

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
