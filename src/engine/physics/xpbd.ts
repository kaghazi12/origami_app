import { TriMesh } from '../types';
import { accumulateBarForces, computeMaxBarStrain } from './bars';
import { accumulateHingeForces, computeDihedralAngle } from './hinges';
import { FoldSolver, SolveResult, BarycentricPoint, BarycentricAttachment } from './types';
import { assertFinite, isMeshFinite } from './validation';
import {
  SpatialHash,
  SelfContactGenerator,
  solveContactsXPBD,
  ContactData,
  countMeshIntersections,
} from './collision';

export interface XPBDSolverOptions {
  substeps?: number;
  iterations?: number;
  distanceIterations?: number;
  velocityDamping?: number;
  fixedVertices?: Set<number> | number[];
  
  // Phase 6: Table contact & real paper behavior
  enableTable?: boolean;
  tableZ?: number;
  paperThickness?: number;
  enableGravity?: boolean;
  gravity?: number;
  muStatic?: number;
  muKinetic?: number;
  bendingCompliance?: number;
  contactDamping?: number;
  maxDragSpeed?: number;

  // Phase 8: Plastic hinge settings
  yieldAngle?: number;
  springbackFactor?: number;
  enablePlasticity?: boolean;

  // Phase 9: Self-collision via XPBD
  enableSelfCollision?: boolean;
  selfCollisionMargin?: number;

  /**
   * Remove net linear and angular momentum each substep when nothing external acts on the paper
   * (no table, gravity, pins or drag). Internal constraints conserve momentum, so any net drift is
   * numerical error (mostly from contacts in jammed layers) and would send the model flying.
   * Default true.
   */
  removeRigidMotion?: boolean;

  /**
   * Fast motion gets more substeps: when any vertex moved more than ~2 paper thicknesses per
   * substep in the last frame (a twist snapping flat, a hard drag), the next frame is split into
   * up to maxSubstepFactor times the substeps, so layers can't jump past each other between
   * contact checks. Slow folding stays at `substeps`. Default 4 (1 turns it off).
   */
  maxSubstepFactor?: number;
}

/**
 * High-Performance Extended Position Based Dynamics (XPBD) Origami Fold Solver
 * 
 * Features:
 * - Small-Step XPBD (Macklin et al. 2019): High substep frequency with 1 iteration per substep
 *   replaces stiff iteration loops, accelerating convergence while eliminating iteration artifacts.
 * - Flat Typed Arrays: Zero object allocations, zero hash lookups (Set.has/Map.has replaced by Float64Array invMass).
 * - Consolidated Dihedral Constraint: Unified dihedral angle & gradient calculation in a single pass.
 * - Exact Inextensibility: Final bar distance projection guarantees max bar strain < 0.01% (compliance alpha = 0).
 * - Phase 6 Real Paper Physics: One-sided table plane contact constraint (z >= paperThickness/2),
 *   Coulomb position-based static & kinetic friction, gravity, and tunable facet bending compliance.
 * - Phase 7: Arbitrary barycentric attachment (P) and soft drag (Q) constraints with reach clamping.
 * - Phase 8: Drag target slew limit capping target displacement per frame (maxDragSpeed).
 */
export class XPBDSolver implements FoldSolver {
  readonly mesh: TriMesh;
  readonly fixedVertices: Set<number>;
  readonly dragTargets: Map<number, [number, number, number]>;
  barycentricPins: BarycentricAttachment[] = [];
  barycentricDrag: BarycentricAttachment | null = null;
  maxDragSpeed: number;
  private effectiveDragTarget: [number, number, number] | null = null;
  substeps: number;
  iterations: number;
  distanceIterations: number;
  velocityDamping: number;

  // Phase 6 properties
  enableTable: boolean;
  tableZ: number;
  paperThickness: number;
  enableGravity: boolean;
  gravity: number;
  muStatic: number;
  muKinetic: number;
  bendingCompliance: number | undefined;
  contactDamping: number;

  // Phase 8: Plastic hinge settings
  yieldAngle: number;
  springbackFactor: number;
  enablePlasticity: boolean;

  // Phase 9: Self-collision via XPBD
  enableSelfCollision: boolean;
  removeRigidMotion: boolean;
  maxSubstepFactor: number;
  /** Largest vertex displacement during the last step() (for adaptive substeps). */
  private lastStepMaxMove = 0;
  private stepStart: Float64Array;
  private spatialHash: SpatialHash;
  private selfContacts: ContactData[] = [];
  private selfCollisionMargin: number;
  private contactGen = new SelfContactGenerator();

  // Flattened constraint topology arrays for cache-friendly execution
  private numBars: number;
  private barV0: Int32Array;
  private barV1: Int32Array;
  private barRestLen: Float64Array;

  private numHinges: number;
  private hingeV0: Int32Array;
  private hingeV1: Int32Array;
  private hingeV2: Int32Array;
  private hingeV3: Int32Array;
  private hingeStiffness: Float64Array;
  private hingeRestAngle: Float64Array;
  private hingeIsFacet: Uint8Array;

  // Precomputed inverse nodal masses (0 for pinned/dragged vertices)
  private invMass: Float64Array;

  // Solver internal buffers
  private posStar: Float64Array;
  private lambdaBars: Float64Array;
  private lambdaHinges: Float64Array;
  private forcesBuffer: Float64Array;

  constructor(mesh: TriMesh, options: XPBDSolverOptions = {}) {
    this.mesh = mesh;
    this.fixedVertices = new Set<number>(options.fixedVertices ?? []);
    this.dragTargets = new Map<number, [number, number, number]>();
    
    // Default to Small-Step XPBD: 10 substeps with 1 iteration each (Macklin 2019)
    this.substeps = options.substeps ?? 10;
    this.iterations = options.iterations ?? 1;
    this.distanceIterations = options.distanceIterations ?? (this.iterations === 1 ? 4 : 1);
    this.velocityDamping = options.velocityDamping ?? 0.995;

    // Phase 6: Real paper table contact, friction, gravity and bending compliance
    this.enableTable = options.enableTable ?? false;
    this.tableZ = options.tableZ ?? 0.0;

    const numV = mesh.numVertices;
    let minX = Infinity, maxX = -Infinity;
    for (let i = 0; i < numV; i++) {
      const x = mesh.positions[i * 3 + 0];
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
    }
    const sheetWidth = (maxX > minX && Number.isFinite(maxX - minX)) ? (maxX - minX) : 1.0;
    this.paperThickness = options.paperThickness ?? (sheetWidth * 0.002);

    this.enableGravity = options.enableGravity ?? false;
    this.gravity = options.gravity ?? 1.0;
    this.muStatic = options.muStatic ?? 0.5;
    this.muKinetic = options.muKinetic ?? 0.4;
    this.bendingCompliance = options.bendingCompliance;
    this.contactDamping = options.contactDamping ?? 0.2;
    this.maxDragSpeed = options.maxDragSpeed ?? 1.5;

    // Phase 8 Plasticity defaults
    this.yieldAngle = options.yieldAngle ?? (2.86 * Math.PI / 180); // ~0.05 rad
    this.springbackFactor = options.springbackFactor ?? 0.05;
    this.enablePlasticity = options.enablePlasticity ?? false;

    // Phase 9: Self-collision via XPBD
    this.enableSelfCollision = options.enableSelfCollision ?? false;
    this.removeRigidMotion = options.removeRigidMotion ?? true;
    this.maxSubstepFactor = options.maxSubstepFactor ?? 4;
    this.stepStart = new Float64Array(mesh.numVertices * 3);
    const margin = options.selfCollisionMargin ?? Math.max(0.05, this.paperThickness * 2);
    this.selfCollisionMargin = margin;
    this.spatialHash = new SpatialHash(margin);
    // Exclude only triangles sharing a vertex. The old rest-UV distance filter (1.4 edge lengths)
    // excluded exactly the pairs that meet when the sheet folds over a crease.
    this.spatialHash.initTopology(this.mesh.indices, this.mesh.numTriangles);
    this.contactGen.init(this.mesh.indices, this.mesh.numTriangles, this.mesh.numVertices);

    this.posStar = new Float64Array(numV * 3);
    this.forcesBuffer = new Float64Array(numV * 3);
    this.invMass = new Float64Array(numV);

    // 1. Flatten Bars
    this.numBars = mesh.bars.length;
    this.barV0 = new Int32Array(this.numBars);
    this.barV1 = new Int32Array(this.numBars);
    this.barRestLen = new Float64Array(this.numBars);
    this.lambdaBars = new Float64Array(this.numBars);

    for (let b = 0; b < this.numBars; b++) {
      this.barV0[b] = mesh.bars[b].v0;
      this.barV1[b] = mesh.bars[b].v1;
      this.barRestLen[b] = mesh.bars[b].restLength;
    }

    // 2. Flatten Hinges
    this.numHinges = mesh.hinges.length;
    this.hingeV0 = new Int32Array(this.numHinges);
    this.hingeV1 = new Int32Array(this.numHinges);
    this.hingeV2 = new Int32Array(this.numHinges);
    this.hingeV3 = new Int32Array(this.numHinges);
    this.hingeStiffness = new Float64Array(this.numHinges);
    this.hingeRestAngle = new Float64Array(this.numHinges);
    this.hingeIsFacet = new Uint8Array(this.numHinges);
    this.lambdaHinges = new Float64Array(this.numHinges);

    for (let h = 0; h < this.numHinges; h++) {
      const hinge = mesh.hinges[h];
      this.hingeV0[h] = hinge.v0;
      this.hingeV1[h] = hinge.v1;
      this.hingeV2[h] = hinge.v2;
      this.hingeV3[h] = hinge.v3;
      this.hingeStiffness[h] = hinge.stiffness;
      this.hingeRestAngle[h] = hinge.restAngle;
      const assign = hinge.assignment;
      this.hingeIsFacet[h] = (assign === 'F' || assign === 'U') ? 1 : 0;
    }

    this.rebuildInverseMasses();
  }

  /**
   * Recomputes flattened inverse masses array from mesh masses and pin/drag state.
   * Completely avoids Set/Map lookups during constraint projection inner loops.
   */
  private rebuildInverseMasses(): void {
    const numV = this.mesh.numVertices;
    const masses = this.mesh.masses;
    for (let i = 0; i < numV; i++) {
      if (this.fixedVertices.has(i) || this.dragTargets.has(i)) {
        this.invMass[i] = 0.0;
      } else {
        const m = masses[i];
        this.invMass[i] = m > 0 ? 1.0 / m : 1.0;
      }
    }
  }

  setFixedVertices(pins: Set<number>): void {
    this.fixedVertices.clear();
    for (const p of pins) this.fixedVertices.add(p);
    this.rebuildInverseMasses();
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
    this.rebuildInverseMasses();
  }

  isConstrained(v: number): boolean {
    return this.invMass[v] === 0.0;
  }

  setTable(enable: boolean, thickness?: number, tableZ?: number): void {
    this.enableTable = enable;
    if (thickness !== undefined) this.paperThickness = thickness;
    if (tableZ !== undefined) this.tableZ = tableZ;
  }

  setFriction(muStatic: number, muKinetic: number, contactDamping?: number): void {
    this.muStatic = muStatic;
    this.muKinetic = muKinetic;
    if (contactDamping !== undefined) this.contactDamping = contactDamping;
  }

  setGravity(enable: boolean, g?: number): void {
    this.enableGravity = enable;
    if (g !== undefined) this.gravity = g;
  }

  setBendingCompliance(compliance: number | undefined): void {
    this.bendingCompliance = compliance;
  }

  setPaperStiffness(preset: 'tissue' | 'standard' | 'card' | number): void {
    if (preset === 'tissue') {
      this.bendingCompliance = 0.05;
    } else if (preset === 'standard') {
      this.bendingCompliance = 0.001;
    } else if (preset === 'card') {
      this.bendingCompliance = 0.00001;
    } else if (typeof preset === 'number') {
      const clamped = Math.max(0, Math.min(100, preset));
      this.bendingCompliance = 0.05 * Math.pow(10, -4 * (clamped / 100));
    }
  }

  setSelfCollision(enable: boolean, margin?: number): void {
    this.enableSelfCollision = enable;
    if (margin !== undefined) {
      this.selfCollisionMargin = margin;
      this.spatialHash.setCellSize(margin);
    }
  }

  checkSelfIntersections(): { intersectionCount: number; intersectingPairs: [number, number][] } {
    // Strict: only triangles sharing a vertex are exempt. (Passing UVs would also exempt every pair
    // within ~1.4 rest edge lengths, hiding interpenetration right next to folded creases.)
    return countMeshIntersections(this.mesh.positions, this.mesh.indices, this.mesh.numTriangles);
  }

  setBarycentricPins(pins: BarycentricAttachment[]): void {
    this.barycentricPins = pins;
  }

  setMaxDragSpeed(speed: number): void {
    this.maxDragSpeed = Math.max(0.01, speed);
  }

  getEffectiveDragTarget(): [number, number, number] | null {
    return this.effectiveDragTarget ? [...this.effectiveDragTarget] : null;
  }

  setBarycentricDrag(drag: BarycentricAttachment | null): void {
    this.barycentricDrag = drag;
    if (!drag) {
      this.effectiveDragTarget = null;
    } else if (!this.effectiveDragTarget) {
      this.effectiveDragTarget = [drag.targetPos[0], drag.targetPos[1], drag.targetPos[2]];
    }
  }

  getBarycentricPos(pt: BarycentricPoint): [number, number, number] {
    const p0 = pt.v0 * 3, p1 = pt.v1 * 3, p2 = pt.v2 * 3;
    const pos = this.mesh.positions;
    return [
      pt.w0 * pos[p0 + 0] + pt.w1 * pos[p1 + 0] + pt.w2 * pos[p2 + 0],
      pt.w0 * pos[p0 + 1] + pt.w1 * pos[p1 + 1] + pt.w2 * pos[p2 + 1],
      pt.w0 * pos[p0 + 2] + pt.w1 * pos[p1 + 2] + pt.w2 * pos[p2 + 2],
    ];
  }

  private projectBarycentric(posStar: Float64Array | Float32Array, hSq: number): void {
    for (let pi = 0; pi < this.barycentricPins.length; pi++) {
      const pin = this.barycentricPins[pi];
      this.projectAttachment(posStar, pin.point, pin.targetPos, pin.compliance ?? 0.0, hSq);
    }
    if (this.barycentricDrag) {
      const drag = this.barycentricDrag;
      this.projectAttachment(posStar, drag.point, this.effectiveDragTarget ?? drag.targetPos, drag.compliance ?? 0.0, hSq);
    }
  }

  /**
   * XPBD attachment of a barycentric surface point to a world target.
   * Correction is distributed by w_i * invMass_i (standard XPBD), so fixed vertices are never moved
   * and the point lands exactly on target when compliance is 0.
   */
  private projectAttachment(
    posStar: Float64Array | Float32Array,
    pt: BarycentricAttachment['point'],
    target: ArrayLike<number>,
    compliance: number,
    hSq: number
  ): void {
    const invMass = this.invMass;
    const v0 = pt.v0, v1 = pt.v1, v2 = pt.v2;
    const w0 = pt.w0, w1 = pt.w1, w2 = pt.w2;
    const im0 = invMass[v0], im1 = invMass[v1], im2 = invMass[v2];
    const wEff = w0 * w0 * im0 + w1 * w1 * im1 + w2 * w2 * im2;
    if (wEff < 1e-12) return;

    const p0 = v0 * 3, p1 = v1 * 3, p2 = v2 * 3;
    const cx = w0 * posStar[p0 + 0] + w1 * posStar[p1 + 0] + w2 * posStar[p2 + 0] - target[0];
    const cy = w0 * posStar[p0 + 1] + w1 * posStar[p1 + 1] + w2 * posStar[p2 + 1] - target[1];
    const cz = w0 * posStar[p0 + 2] + w1 * posStar[p1 + 2] + w2 * posStar[p2 + 2] - target[2];

    // Same effective point stiffness as before (dp = -C / (1 + alphaTilde)), distributed by mass
    const s = -1.0 / (wEff * (1.0 + compliance / hSq));
    const k0 = s * w0 * im0, k1 = s * w1 * im1, k2 = s * w2 * im2;
    posStar[p0 + 0] += k0 * cx; posStar[p0 + 1] += k0 * cy; posStar[p0 + 2] += k0 * cz;
    posStar[p1 + 0] += k1 * cx; posStar[p1 + 1] += k1 * cy; posStar[p1 + 2] += k1 * cz;
    posStar[p2 + 0] += k2 * cx; posStar[p2 + 1] += k2 * cy; posStar[p2 + 2] += k2 * cz;
  }

  /** Contact-only passes at the end of each substep (non-penetration has priority over stretch). */
  finalContactPasses = 3;

  /** Max allowed bar strain at the end of a substep before extra bar-only sweeps kick in. */
  strainLimit = 0.01;
  strainLimitSweeps = 30;

  /** Hard table non-penetration (contact plane at z = tableZ + paperThickness / 2). */
  private enforceTable(posStar: Float64Array): void {
    if (!this.enableTable) return;
    const zContact = this.tableZ + this.paperThickness * 0.5;
    const invMass = this.invMass;
    for (let i = 0, n = this.mesh.numVertices; i < n; i++) {
      if (invMass[i] > 0.0 && posStar[i * 3 + 2] < zContact) posStar[i * 3 + 2] = zContact;
    }
  }

  /**
   * Bar-only sweeps (interleaved with the table plane) until every bar is within `strainLimit`.
   * Always finishes with table enforcement, replacing the old post-bar table pass.
   */
  private limitStrain(posStar: Float64Array): void {
    const lim = this.strainLimit;
    if (!(lim > 0)) { this.enforceTable(posStar); return; }
    const invMass = this.invMass;
    const barV0 = this.barV0, barV1 = this.barV1, rest = this.barRestLen;
    let prevWorst = Infinity;
    for (let sweep = 0; sweep < this.strainLimitSweeps; sweep++) {
      let worst = 0;
      for (let b = 0; b < this.numBars; b++) {
        const v0 = barV0[b], v1 = barV1[b];
        const w0 = invMass[v0], w1 = invMass[v1];
        const wSum = w0 + w1;
        if (wSum === 0.0) continue;
        const p0 = v0 * 3, p1 = v1 * 3;
        const dx = posStar[p0] - posStar[p1], dy = posStar[p0 + 1] - posStar[p1 + 1], dz = posStar[p0 + 2] - posStar[p1 + 2];
        const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
        const L0 = rest[b];
        if (dist < 1e-12 || L0 < 1e-12) continue;
        const strain = Math.abs(dist - L0) / L0;
        if (strain > worst) worst = strain;
        if (sweep > 0 || strain > lim) {
          const corr = -(dist - L0) / (wSum * dist);
          const f0 = w0 * corr, f1 = w1 * corr;
          posStar[p0] += dx * f0; posStar[p0 + 1] += dy * f0; posStar[p0 + 2] += dz * f0;
          posStar[p1] -= dx * f1; posStar[p1 + 1] -= dy * f1; posStar[p1 + 2] -= dz * f1;
        }
      }
      // Contacts and table are re-enforced inside the sweeps; otherwise bar-only sweeps can drag
      // layers back through each other (and a crossed layer stays crossed in the next substep).
      if (this.enableSelfCollision && this.selfContacts.length > 0) {
        solveContactsXPBD(this.selfContacts, posStar, this.mesh.positions, invMass, this.muStatic, this.muKinetic);
      }
      this.enforceTable(posStar);
      if (worst <= lim) return;
      // Stalled (e.g. contacts and bars balanced in a thick stack): further sweeps are wasted work
      if (worst > 0.95 * prevWorst) return;
      prevWorst = worst;
    }
  }

  /**
   * Synchronizes hinge rest angles from mesh elements if modified externally
   */
  private syncHingeRestAngles(): void {
    for (let h = 0; h < this.numHinges; h++) {
      this.hingeRestAngle[h] = this.mesh.hinges[h].restAngle;
    }
  }

  /**
   * Executes a single XPBD integration step across substeps and Gauss-Seidel iterations
   */
  step(dt = 0.016): { potentialEnergy: number; kineticEnergy: number } {
    this.syncHingeRestAngles();

    // Slew limit for barycentric drag target: cap how far target moves per second
    if (this.barycentricDrag) {
      if (!this.effectiveDragTarget) {
        this.effectiveDragTarget = [
          this.barycentricDrag.targetPos[0],
          this.barycentricDrag.targetPos[1],
          this.barycentricDrag.targetPos[2],
        ];
      } else {
        const dx = this.barycentricDrag.targetPos[0] - this.effectiveDragTarget[0];
        const dy = this.barycentricDrag.targetPos[1] - this.effectiveDragTarget[1];
        const dz = this.barycentricDrag.targetPos[2] - this.effectiveDragTarget[2];
        const dist = Math.hypot(dx, dy, dz);
        const maxStepDist = this.maxDragSpeed * dt;
        if (dist > maxStepDist && dist > 1e-12) {
          const factor = maxStepDist / dist;
          this.effectiveDragTarget[0] += dx * factor;
          this.effectiveDragTarget[1] += dy * factor;
          this.effectiveDragTarget[2] += dz * factor;
        } else {
          this.effectiveDragTarget[0] = this.barycentricDrag.targetPos[0];
          this.effectiveDragTarget[1] = this.barycentricDrag.targetPos[1];
          this.effectiveDragTarget[2] = this.barycentricDrag.targetPos[2];
        }
      }
    }

    // Fast motion gets more substeps (see maxSubstepFactor): start from what the last frame
    // needed, and if this frame moves too far per substep anyway (a snap that starts now), undo
    // it and run it again finer.
    const perSubstep = 2 * this.paperThickness;
    const base = Math.max(1, this.substeps);
    const maxSub = base * Math.max(1, this.maxSubstepFactor);
    const adaptive = this.enableSelfCollision && this.maxSubstepFactor > 1;
    let substepCount = adaptive
      ? Math.min(maxSub, Math.max(base, Math.ceil(this.lastStepMaxMove / Math.max(perSubstep, 1e-9))))
      : base;
    const hinges0 = this.mesh.hinges;
    const startPos = this.stepStart;
    startPos.set(this.mesh.positions);
    const startVel = Float64Array.from(this.mesh.velocities);
    const startPrev = hinges0.map((hh) => hh.previousAngle);
    const maxMove = () => {
      let mm = 0;
      const p = this.mesh.positions;
      for (let i = 0; i < p.length; i += 3) {
        const dx = p[i] - startPos[i], dy = p[i + 1] - startPos[i + 1], dz = p[i + 2] - startPos[i + 2];
        const d = dx * dx + dy * dy + dz * dz;
        if (d > mm) mm = d;
      }
      return Math.sqrt(mm);
    };

    const runSubsteps = (substepCount: number) => {
      const h = dt / substepCount;
      const hSq = h * h;
      const invH = 1.0 / h;
      const numV = this.mesh.numVertices;
      const pos = this.mesh.positions;
      const vel = this.mesh.velocities;
      const invMass = this.invMass;
      const posStar = this.posStar;

      const numBars = this.numBars;
      const barV0 = this.barV0;
      const barV1 = this.barV1;
      const barRestLen = this.barRestLen;

      const numHinges = this.numHinges;
      const hingeV0 = this.hingeV0;
      const hingeV1 = this.hingeV1;
      const hingeV2 = this.hingeV2;
      const hingeV3 = this.hingeV3;
      const hingeStiffness = this.hingeStiffness;
      const hingeRestAngle = this.hingeRestAngle;

      for (let s = 0; s < substepCount; s++) {
        // 1. Predict unconstrained positions (with gravity external force if enabled)
        const gAcc = this.enableGravity ? this.gravity : 0.0;

        for (let i = 0; i < numV; i++) {
          const i3 = i * 3;
          const w = invMass[i];
          if (w === 0.0) {
            if (this.dragTargets.has(i)) {
              const t = this.dragTargets.get(i)!;
              posStar[i3 + 0] = t[0];
              posStar[i3 + 1] = t[1];
              posStar[i3 + 2] = t[2];
            } else {
              posStar[i3 + 0] = pos[i3 + 0];
              posStar[i3 + 1] = pos[i3 + 1];
              posStar[i3 + 2] = pos[i3 + 2];
            }
            vel[i3 + 0] = 0;
            vel[i3 + 1] = 0;
            vel[i3 + 2] = 0;
          } else {
            posStar[i3 + 0] = pos[i3 + 0] + h * vel[i3 + 0];
            posStar[i3 + 1] = pos[i3 + 1] + h * vel[i3 + 1];
            posStar[i3 + 2] = pos[i3 + 2] + h * vel[i3 + 2] - gAcc * hSq;
          }
        }

        // Self-collision detection, once per substep, on the committed (non-penetrating) positions.
        // The proximity radius is padded by this substep's predicted motion so that features which
        // will meet during the step are caught before they cross (prevents tunnelling).
        if (this.enableSelfCollision) {
          let maxDispSq = 0;
          for (let i = 0; i < numV * 3; i += 3) {
            const dx = posStar[i] - pos[i], dy = posStar[i + 1] - pos[i + 1], dz = posStar[i + 2] - pos[i + 2];
            const d2 = dx * dx + dy * dy + dz * dz;
            if (d2 > maxDispSq) maxDispSq = d2;
          }
          const t = this.paperThickness;
          const radius = Math.min(this.selfCollisionMargin, Math.max(2 * t, t + 2 * Math.sqrt(maxDispSq)));
          this.spatialHash.build(pos, this.mesh.indices, this.mesh.numTriangles, radius);
          const pairs = this.spatialHash.queryCandidatePairs();
          this.contactGen.generate(pairs, pos, t, radius, this.selfContacts);
        } else if (this.selfContacts.length > 0) {
          this.selfContacts.length = 0;
        }

        // Reset Lagrange multipliers for this substep
        this.lambdaBars.fill(0);
        this.lambdaHinges.fill(0);

        // 2. Constraint Projection Loop
        for (let iter = 0; iter < this.iterations; iter++) {
          // --- 0. Barycentric Pin & Drag Constraints ---
          this.projectBarycentric(posStar, hSq);

          // --- A. Dihedral Bending Constraints (Hinges - compliant XPBD) ---
          // Projected first so that distance constraints enforce strict inextensibility at the end
          for (let hi = 0; hi < numHinges; hi++) {
            const kH = hingeStiffness[hi];
            if (kH <= 0 && this.bendingCompliance === undefined) continue;

            const i0 = hingeV0[hi];
            const i1 = hingeV1[hi];
            const i2 = hingeV2[hi];
            const i3 = hingeV3[hi];

            const w0 = invMass[i0];
            const w1 = invMass[i1];
            const w2 = invMass[i2];
            const w3 = invMass[i3];
            if (w0 + w1 + w2 + w3 === 0.0) continue;

            const p0 = i0 * 3, p1 = i1 * 3, p2 = i2 * 3, p3 = i3 * 3;

            const ex = posStar[p1 + 0] - posStar[p0 + 0];
            const ey = posStar[p1 + 1] - posStar[p0 + 1];
            const ez = posStar[p1 + 2] - posStar[p0 + 2];
            const eLenSq = ex * ex + ey * ey + ez * ez;
            if (eLenSq < 1e-14) continue;
            const eLen = Math.sqrt(eLenSq);

            const u2x = posStar[p2 + 0] - posStar[p0 + 0];
            const u2y = posStar[p2 + 1] - posStar[p0 + 1];
            const u2z = posStar[p2 + 2] - posStar[p0 + 2];

            const n1x = ey * u2z - ez * u2y;
            const n1y = ez * u2x - ex * u2z;
            const n1z = ex * u2y - ey * u2x;
            const a1Sq = n1x * n1x + n1y * n1y + n1z * n1z;
            if (a1Sq < 1e-14) continue;

            const u3x = posStar[p3 + 0] - posStar[p0 + 0];
            const u3y = posStar[p3 + 1] - posStar[p0 + 1];
            const u3z = posStar[p3 + 2] - posStar[p0 + 2];

            const n2x = u3y * ez - u3z * ey;
            const n2y = u3z * ex - u3x * ez;
            const n2z = u3x * ey - u3y * ex;
            const a2Sq = n2x * n2x + n2y * n2y + n2z * n2z;
            if (a2Sq < 1e-14) continue;

            const theta = computeDihedralAngle(this.mesh.hinges[hi], posStar, false);

            const target = hingeRestAngle[hi];
            const C = theta - target;
            if (Math.abs(C) < 1e-7) continue;

            // Regularized gradients
            const minASq = eLenSq * 1e-6;
            const regA1Sq = a1Sq < minASq ? minASq : a1Sq;
            const regA2Sq = a2Sq < minASq ? minASq : a2Sq;

            const q2Factor = eLen / regA1Sq;
            const q2x = q2Factor * n1x, q2y = q2Factor * n1y, q2z = q2Factor * n1z;

            const q3Factor = eLen / regA2Sq;
            const q3x = q3Factor * n2x, q3y = q3Factor * n2y, q3z = q3Factor * n2z;

            const invELenSq = 1.0 / eLenSq;
            const t2 = (u2x * ex + u2y * ey + u2z * ez) * invELenSq;
            const t3 = (u3x * ex + u3y * ey + u3z * ez) * invELenSq;

            const omt2 = -(1.0 - t2);
            const omt3 = -(1.0 - t3);
            const q0x = omt2 * q2x + omt3 * q3x;
            const q0y = omt2 * q2y + omt3 * q3y;
            const q0z = omt2 * q2z + omt3 * q3z;

            const mt2 = -t2;
            const mt3 = -t3;
            const q1x = mt2 * q2x + mt3 * q3x;
            const q1y = mt2 * q2y + mt3 * q3y;
            const q1z = mt2 * q2z + mt3 * q3z;

            const gradLenSq0 = q0x * q0x + q0y * q0y + q0z * q0z;
            const gradLenSq1 = q1x * q1x + q1y * q1y + q1z * q1z;
            const gradLenSq2 = q2x * q2x + q2y * q2y + q2z * q2z;
            const gradLenSq3 = q3x * q3x + q3y * q3y + q3z * q3z;

            const wGradSum = w0 * gradLenSq0 + w1 * gradLenSq1 + w2 * gradLenSq2 + w3 * gradLenSq3;
            if (wGradSum < 1e-12) continue;

            // XPBD compliance: alphaTilde = alpha / h^2
            const alphaTilde = (this.bendingCompliance !== undefined && this.hingeIsFacet[hi] === 1)
              ? (this.bendingCompliance / hSq)
              : ((1.0 / kH) / hSq);

            const deltaLambda = (-C - alphaTilde * this.lambdaHinges[hi]) / (wGradSum + alphaTilde);
            this.lambdaHinges[hi] += deltaLambda;

            if (w0 > 0) {
              const f0 = w0 * deltaLambda;
              posStar[p0 + 0] += f0 * q0x;
              posStar[p0 + 1] += f0 * q0y;
              posStar[p0 + 2] += f0 * q0z;
            }
            if (w1 > 0) {
              const f1 = w1 * deltaLambda;
              posStar[p1 + 0] += f1 * q1x;
              posStar[p1 + 1] += f1 * q1y;
              posStar[p1 + 2] += f1 * q1z;
            }
            if (w2 > 0) {
              const f2 = w2 * deltaLambda;
              posStar[p2 + 0] += f2 * q2x;
              posStar[p2 + 1] += f2 * q2y;
              posStar[p2 + 2] += f2 * q2z;
            }
            if (w3 > 0) {
              const f3 = w3 * deltaLambda;
              posStar[p3 + 0] += f3 * q3x;
              posStar[p3 + 1] += f3 * q3y;
              posStar[p3 + 2] += f3 * q3z;
            }
          }

          // --- B. Table Plane Contact & Coulomb Friction Constraint (contact is at z >= tableZ + paperThickness / 2) ---
          if (this.enableTable) {
            const zContact = this.tableZ + this.paperThickness * 0.5;
            for (let i = 0; i < numV; i++) {
              const w = invMass[i];
              if (w === 0.0) continue;
              const i3 = i * 3;
              const zPred = posStar[i3 + 2];
              if (zPred < zContact) {
                const deltaZ = zContact - zPred;
                posStar[i3 + 2] = zContact;

                // Tangential motion over this substep
                const dx = posStar[i3 + 0] - pos[i3 + 0];
                const dy = posStar[i3 + 1] - pos[i3 + 1];
                const dTangent = Math.hypot(dx, dy);

                if (dTangent > 1e-12) {
                  if (dTangent <= this.muStatic * deltaZ) {
                    // Static friction arrest
                    posStar[i3 + 0] = pos[i3 + 0];
                    posStar[i3 + 1] = pos[i3 + 1];
                  } else {
                    // Kinetic friction reduction in proportion to contact normal correction
                    const reduction = Math.min(1.0, (this.muKinetic * deltaZ) / dTangent);
                    posStar[i3 + 0] -= dx * reduction;
                    posStar[i3 + 1] -= dy * reduction;
                  }
                }
              }
            }
          }

          // --- C. Phase 9: Self-Collision XPBD Constraint (Vertex-Triangle & Edge-Edge) ---
          // Contacts were detected once for this substep from the committed state (see below).
          if (this.enableSelfCollision && this.selfContacts.length > 0) {
            solveContactsXPBD(this.selfContacts, posStar, pos, invMass, this.muStatic, this.muKinetic);
          }

          // --- D. Distance Constraints (Axial Bars - exact inextensibility alpha = 0) ---
          // Running bars last with dedicated distance iterations eliminates residual strain under drag
          for (let dIter = 0; dIter < this.distanceIterations; dIter++) {
            for (let b = 0; b < numBars; b++) {
              const v0 = barV0[b];
              const v1 = barV1[b];
              const w0 = invMass[v0];
              const w1 = invMass[v1];
              const wSum = w0 + w1;
              if (wSum === 0.0) continue;

              const p0 = v0 * 3;
              const p1 = v1 * 3;
              const dx = posStar[p0 + 0] - posStar[p1 + 0];
              const dy = posStar[p0 + 1] - posStar[p1 + 1];
              const dz = posStar[p0 + 2] - posStar[p1 + 2];
              const distSq = dx * dx + dy * dy + dz * dz;
              if (distSq < 1e-14) continue;
              const dist = Math.sqrt(distSq);

              const C = dist - barRestLen[b];
              const deltaLambda = -C / wSum;
              this.lambdaBars[b] += deltaLambda;

              const corr = deltaLambda / dist;
              if (w0 > 0) {
                const f0 = w0 * corr;
                posStar[p0 + 0] += dx * f0;
                posStar[p0 + 1] += dy * f0;
                posStar[p0 + 2] += dz * f0;
              }
              if (w1 > 0) {
                const f1 = w1 * corr;
                posStar[p1 + 0] -= dx * f1;
                posStar[p1 + 1] -= dy * f1;
                posStar[p1 + 2] -= dz * f1;
              }
            }
            this.projectBarycentric(posStar, hSq);
          }
          this.projectBarycentric(posStar, hSq);
        }

        // --- Strain limiting ---
        // Attachments are projected after the bars, so an unreachable pin/drag combination (or a
        // violent collapse) can leave bars stretched far past their rest length. Unchecked, that
        // stretch becomes velocity and the sheet explodes. When any bar exceeds the limit, run extra
        // bar-only sweeps; no cost when the sheet is already near-inextensible.
        this.limitStrain(posStar);

        // Contacts get the last word before positions are committed: bars and hinges run after the
        // contact pass inside the iterations and, when crease targets fight each other, they push
        // layers back through one another. A few extra contact passes here cost little and keep
        // layers on the side they were on.
        if (this.enableSelfCollision && this.selfContacts.length > 0) {
          for (let k = 0; k < this.finalContactPasses; k++) {
            solveContactsXPBD(this.selfContacts, posStar, pos, invMass, this.muStatic, this.muKinetic);
          }
          // pull any stretch the contacts introduced back under the limit (its sweeps end on contacts)
          this.limitStrain(posStar);
        }


        // 3. Update velocities and commit positions
        const damp = this.velocityDamping;
        const zContact = this.enableTable ? (this.tableZ + this.paperThickness * 0.5) : -Infinity;

        for (let i = 0; i < numV; i++) {
          const i3 = i * 3;
          if (invMass[i] === 0.0) {
            vel[i3 + 0] = 0;
            vel[i3 + 1] = 0;
            vel[i3 + 2] = 0;
            pos[i3 + 0] = posStar[i3 + 0];
            pos[i3 + 1] = posStar[i3 + 1];
            pos[i3 + 2] = posStar[i3 + 2];
          } else {
            vel[i3 + 0] = (posStar[i3 + 0] - pos[i3 + 0]) * invH * damp;
            vel[i3 + 1] = (posStar[i3 + 1] - pos[i3 + 1]) * invH * damp;
            vel[i3 + 2] = (posStar[i3 + 2] - pos[i3 + 2]) * invH * damp;

            // Contact velocity damping and non-penetration enforcement
            if (this.enableTable && posStar[i3 + 2] <= zContact + 1e-7) {
              if (vel[i3 + 2] < 0) {
                vel[i3 + 2] = 0; // Inelastic normal collision
              }
              vel[i3 + 0] *= (1.0 - this.contactDamping);
              vel[i3 + 1] *= (1.0 - this.contactDamping);
            }

            pos[i3 + 0] = posStar[i3 + 0];
            pos[i3 + 1] = posStar[i3 + 1];
            pos[i3 + 2] = posStar[i3 + 2];
          }
        }

        if (this.removeRigidMotion && this.isFree()) this.cancelRigidVelocity();

        // Track every hinge's angle continuously. computeDihedralAngle unwraps against previousAngle;
        // without this update a crease nudged past ±180° reads as ∓180° and the constraint folds it
        // violently back the other way (wrong-way creases, endless motion, paper through paper).
        const hinges = this.mesh.hinges;
        for (let hi = 0; hi < numHinges; hi++) computeDihedralAngle(hinges[hi], pos, true);
      }

    };

    runSubsteps(substepCount);
    let moved = maxMove();
    if (adaptive && substepCount < maxSub && moved / substepCount > perSubstep) {
      this.mesh.positions.set(startPos);
      this.mesh.velocities.set(startVel);
      hinges0.forEach((hh, i) => (hh.previousAngle = startPrev[i]));
      substepCount = Math.min(maxSub, Math.ceil(moved / perSubstep));
      runSubsteps(substepCount);
      moved = maxMove();
    }
    this.lastStepMaxMove = moved;

    // Phase 8: Plastic hinge yield & springback update
    if (this.enablePlasticity) {
      const maxAngle = Math.PI - (3.0 * Math.PI / 180);
      for (let hi = 0; hi < this.numHinges; hi++) {
        if (this.hingeIsFacet[hi] === 0) {
          const hinge = this.mesh.hinges[hi];
          const theta = computeDihedralAngle(hinge, this.mesh.positions, false);
          const rest = this.hingeRestAngle[hi];
          const diff = theta - rest;
          if (Math.abs(diff) > this.yieldAngle) {
            const plasticAmount = (Math.abs(diff) - this.yieldAngle) * (1.0 - this.springbackFactor);
            let newRest = rest + Math.sign(diff) * plasticAmount;
            newRest = Math.max(-maxAngle, Math.min(maxAngle, newRest));
            this.hingeRestAngle[hi] = newRest;
            hinge.restAngle = newRest;
          }
        }
      }
    }

    return {
      potentialEnergy: 0,
      kineticEnergy: this.getKineticEnergy(),
    };
  }

  /**
   * Applies "Press Flat" action to all crease hinges:
   * Sets target and rest angles to +-(180 - deltaDeg) with deltaDeg = 3 degrees.
   * State clearly: layers WILL interpenetrate until the collision phase.
   */
  pressFlat(deltaDeg = 3.0): void {
    const deltaRad = (deltaDeg * Math.PI) / 180;
    const flatValley = Math.PI - deltaRad;
    const flatMountain = -(Math.PI - deltaRad);

    for (let h = 0; h < this.mesh.hinges.length; h++) {
      const hinge = this.mesh.hinges[h];
      if (hinge.assignment === 'V' || hinge.assignment === 'M') {
        const curAngle = computeDihedralAngle(hinge, this.mesh.positions, false);
        const target = (hinge.assignment === 'M' || curAngle < 0) ? flatMountain : flatValley;
        hinge.targetAngle = target;
        hinge.restAngle = target;
        if (h < this.numHinges) {
          this.hingeRestAngle[h] = target;
        }
      }
    }
  }


  /** Nothing external acts on the paper: no table, gravity, pins or drag. */
  private isFree(): boolean {
    return (
      !this.enableTable &&
      !this.enableGravity &&
      this.fixedVertices.size === 0 &&
      this.dragTargets.size === 0 &&
      this.barycentricPins.length === 0 &&
      !this.barycentricDrag
    );
  }

  /** Subtract the mass-weighted mean velocity and the rigid rotation from all vertex velocities. */
  private cancelRigidVelocity(): void {
    const n = this.mesh.numVertices;
    const pos = this.mesh.positions, vel = this.mesh.velocities, m = this.mesh.masses;
    let M = 0, cx = 0, cy = 0, cz = 0, px = 0, py = 0, pz = 0;
    for (let i = 0; i < n; i++) {
      const mi = m[i] > 0 ? m[i] : 1, i3 = i * 3;
      M += mi;
      cx += mi * pos[i3]; cy += mi * pos[i3 + 1]; cz += mi * pos[i3 + 2];
      px += mi * vel[i3]; py += mi * vel[i3 + 1]; pz += mi * vel[i3 + 2];
    }
    if (M <= 0) return;
    cx /= M; cy /= M; cz /= M;
    const vx = px / M, vy = py / M, vz = pz / M;
    // angular momentum L and inertia tensor I about the centre of mass
    let Lx = 0, Ly = 0, Lz = 0;
    let Ixx = 0, Iyy = 0, Izz = 0, Ixy = 0, Ixz = 0, Iyz = 0;
    for (let i = 0; i < n; i++) {
      const mi = m[i] > 0 ? m[i] : 1, i3 = i * 3;
      const rx = pos[i3] - cx, ry = pos[i3 + 1] - cy, rz = pos[i3 + 2] - cz;
      const ux = vel[i3] - vx, uy = vel[i3 + 1] - vy, uz = vel[i3 + 2] - vz;
      Lx += mi * (ry * uz - rz * uy); Ly += mi * (rz * ux - rx * uz); Lz += mi * (rx * uy - ry * ux);
      Ixx += mi * (ry * ry + rz * rz); Iyy += mi * (rx * rx + rz * rz); Izz += mi * (rx * rx + ry * ry);
      Ixy -= mi * rx * ry; Ixz -= mi * rx * rz; Iyz -= mi * ry * rz;
    }
    // omega = I^-1 L (symmetric 3x3 inverse via cofactors; skip rotation if I is singular)
    const a = Ixx, b = Ixy, c = Ixz, d = Iyy, e = Iyz, f = Izz;
    const c00 = d * f - e * e, c01 = c * e - b * f, c02 = b * e - c * d;
    const c11 = a * f - c * c, c12 = b * c - a * e, c22 = a * d - b * b;
    const det = a * c00 + b * c01 + c * c02;
    let wx = 0, wy = 0, wz = 0;
    if (Math.abs(det) > 1e-18) {
      wx = (c00 * Lx + c01 * Ly + c02 * Lz) / det;
      wy = (c01 * Lx + c11 * Ly + c12 * Lz) / det;
      wz = (c02 * Lx + c12 * Ly + c22 * Lz) / det;
    }
    for (let i = 0; i < n; i++) {
      const i3 = i * 3;
      const rx = pos[i3] - cx, ry = pos[i3 + 1] - cy, rz = pos[i3 + 2] - cz;
      vel[i3] -= vx + (wy * rz - wz * ry);
      vel[i3 + 1] -= vy + (wz * rx - wx * rz);
      vel[i3 + 2] -= vz + (wx * ry - wy * rx);
    }
  }

  getKineticEnergy(): number {
    let ke = 0;
    const vel = this.mesh.velocities;
    const masses = this.mesh.masses;
    for (let i = 0; i < this.mesh.numVertices; i++) {
      const vx = vel[i * 3 + 0];
      const vy = vel[i * 3 + 1];
      const vz = vel[i * 3 + 2];
      ke += 0.5 * masses[i] * (vx * vx + vy * vy + vz * vz);
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

    if (this.enableGravity) {
      const zContact = this.enableTable ? (this.tableZ + this.paperThickness * 0.5) : -Infinity;
      for (let i = 0; i < this.mesh.numVertices; i++) {
        if (this.isConstrained(i)) continue;
        const i3 = i * 3;
        if (this.mesh.positions[i3 + 2] > zContact + 1e-5) {
          this.forcesBuffer[i3 + 2] -= this.mesh.masses[i] * this.gravity;
        }
      }
    }

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
      const isFinite =
        Number.isFinite(kineticEnergy) &&
        Number.isFinite(resForce) &&
        resForce < Infinity &&
        isMeshFinite(this.mesh);

      // A convergence flag must NEVER be set on non-finite state.
      if (isFinite && (residualForceTol !== undefined ? forceConverged : (iter > 2 && keConverged))) {
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

    const finalResForce = this.getMaxResidualForce();
    const finalKe = this.getKineticEnergy();
    const isFiniteFinal =
      Number.isFinite(finalKe) &&
      Number.isFinite(finalResForce) &&
      finalResForce < Infinity &&
      isMeshFinite(this.mesh);

    return {
      iterations: maxIterations,
      converged: converged && isFiniteFinal,
      kineticEnergy: finalKe,
      maxResidualForce: finalResForce,
      maxStrain: this.getMaxStrain(),
    };
  }
}
