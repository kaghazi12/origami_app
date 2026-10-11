import {
  EPS,
  mat4Apply,
  mat4Identity,
  mat4Mul,
  mat4RotateAboutLine,
  signedArea,
  type Mat4,
  type Vec2,
  type Vec3,
} from './math';
import { sideOf, splitConvexPolygon } from './split';
import { FoldError, type Face, type FoldModel, type FoldStep, type PosedFace } from './types';
import { parseModel } from './model';

/** Vertical gap between stacked layers, in paper units (paper is 1 unit wide). */
export const DEFAULT_LAYER_GAP = 0.004;

export interface EngineOptions {
  layerGap?: number;
}

/** Everything needed to animate one step, computed once up front. */
interface StepRecord {
  step: FoldStep;
  /** Faces after cutting along the crease, still at rest (this is what step k starts from). */
  split: Face[];
  /** Faces after the fold is committed. Same ids as `split`. */
  after: Face[];
  moved: Set<string>;
  axisPoint: Vec3;
  axisDir: Vec3;
  /** +1 / -1: direction of rotation about axisDir (right-hand rule). */
  rotationSign: 1 | -1;
  angle: number;
  isUnfold?: boolean;
}

export interface Locator {
  /** Index of the step being animated; equals stepCount once everything is folded. */
  stepIndex: number;
  /** 0..1 progress inside that step. */
  t: number;
  step: FoldStep | null;
}

/** Paper-space polygon mapped into the world and projected to the table plane. */
export function worldPolygon(face: Pick<Face, 'polygon' | 'matrix'>): Vec2[] {
  return face.polygon.map(([u, v]) => {
    const p = mat4Apply(face.matrix, [u, v, 0]);
    return [p[0], p[1]] as Vec2;
  });
}

/** Paper-space polygon mapped into 3D. */
export function worldVertices(face: Pick<Face, 'polygon' | 'matrix'>): Vec3[] {
  return face.polygon.map(([u, v]) => mat4Apply(face.matrix, [u, v, 0]));
}

/** Direction the paper's front side faces. +z = front toward the viewer, -z = flipped over. */
export function faceNormal(face: Pick<Face, 'matrix'>): Vec3 {
  return [face.matrix[8], face.matrix[9], face.matrix[10]];
}

export function polygonArea(polygon: readonly Vec2[]): number {
  return Math.abs(signedArea(polygon));
}

/** Triangle indices for a convex polygon (fan from vertex 0). */
export function triangulateFan(vertexCount: number): number[] {
  const indices: number[] = [];
  for (let i = 1; i < vertexCount - 1; i++) indices.push(0, i, i + 1);
  return indices;
}

export class FoldEngine {
  readonly model: FoldModel;
  readonly layerGap: number;
  /** states[k] = the flat-folded paper after k steps. states[0] is the blank sheet. */
  private readonly states: Face[][] = [];
  private readonly records: StepRecord[] = [];

  constructor(model: FoldModel, options: EngineOptions = {}) {
    this.model = model;
    this.layerGap = options.layerGap ?? DEFAULT_LAYER_GAP;

    const { width, height } = model.paper;
    let faces: Face[] = [
      {
        id: 'f0',
        polygon: [
          [0, 0],
          [width, 0],
          [width, height],
          [0, height],
        ],
        creaseEdges: [false, false, false, false],
        matrix: mat4Identity(),
        layer: 0,
      },
    ];
    this.states.push(faces);

    const foldStack: StepRecord[] = [];
    model.steps.forEach((step, index) => {
      let record: StepRecord;
      if (step.kind === 'unfold') {
        const targetRecord = foldStack.pop();
        if (!targetRecord) {
          throw new FoldError(`Step ${index + 1}: cannot unfold, no previous fold to unfold`);
        }
        record = this.applyUnfoldStep(faces, step, index, targetRecord);
      } else {
        record = this.applyStep(faces, step, index);
        foldStack.push(record);
      }
      this.records.push(record);
      faces = record.after;
      this.states.push(faces);
    });
  }

  /** Validate untrusted JSON and build an engine from it. */
  static fromJSON(json: unknown, options?: EngineOptions): FoldEngine {
    return new FoldEngine(parseModel(json), options);
  }

  get stepCount(): number {
    return this.records.length;
  }

  /** Flat-folded paper after `stepIndex` completed steps (0 = blank sheet). */
  stateAt(stepIndex: number): readonly Face[] {
    const state = this.states[stepIndex];
    if (!state) throw new RangeError(`No state ${stepIndex}; model has ${this.stepCount} steps`);
    return state;
  }

  /**
   * Continuous progress: 2.4 means step 3 (index 2) is 40% done. Values are clamped to
   * [0, stepCount]. The UI scrubber, autoplay, and any adaptive slow-down can all drive this
   * single number.
   */
  locate(progress: number): Locator {
    const n = this.stepCount;
    const p = Math.min(Math.max(progress, 0), n);
    if (p >= n) return { stepIndex: n, t: 0, step: null };
    const stepIndex = Math.floor(p);
    return { stepIndex, t: p - stepIndex, step: this.records[stepIndex].step };
  }

  /** The 3D pose of every face at the given progress. */
  poseAt(progress: number): PosedFace[] {
    const { stepIndex, t } = this.locate(progress);
    if (stepIndex >= this.stepCount) return this.states[this.stepCount].map((f) => rest(f, false));

    const record = this.records[stepIndex];
    const targetAngle = record.angle ?? Math.PI;
    const isFlatFold = Math.abs(targetAngle - Math.PI) < 1e-4;

    if (record.isUnfold) {
      const afterById = new Map(record.after.map((f) => [f.id, f]));
      const rotation = mat4RotateAboutLine(
        record.axisPoint,
        record.axisDir,
        record.rotationSign * targetAngle * (1 - t),
      );

      return record.split.map((face) => {
        const fromZ = face.matrix[14];
        const flatFace = afterById.get(face.id)!;
        const toZ = flatFace.matrix[14];
        const isMoving = record.moved.has(face.id);

        if (!isMoving) {
          if (isFlatFold) {
            const matrix = face.matrix.slice();
            matrix[14] = fromZ + (toZ - fromZ) * t;
            return { ...pick(face), matrix, moving: false };
          }
          return { ...pick(face), matrix: face.matrix, moving: false };
        }

        if (isFlatFold) {
          const base = flatFace.matrix.slice();
          base[14] = -fromZ + (toZ + fromZ) * t;
          return { ...pick(face), matrix: mat4Mul(rotation, base), moving: true };
        }

        return { ...pick(face), matrix: mat4Mul(rotation, flatFace.matrix), moving: true };
      });
    }

    const afterById = new Map(record.after.map((f) => [f.id, f]));
    const rotation = mat4RotateAboutLine(
      record.axisPoint,
      record.axisDir,
      record.rotationSign * targetAngle * t,
    );

    return record.split.map((face) => {
      const fromZ = face.matrix[14];
      const toZ = afterById.get(face.id)!.matrix[14];
      const isMoving = record.moved.has(face.id);

      if (!isMoving) {
        if (isFlatFold) {
          const matrix = face.matrix.slice();
          matrix[14] = fromZ + (toZ - fromZ) * t;
          return { ...pick(face), matrix, moving: false };
        }
        return { ...pick(face), matrix: face.matrix, moving: false };
      }

      if (isFlatFold) {
        const base = face.matrix.slice();
        base[14] = fromZ + (-toZ - fromZ) * t;
        return { ...pick(face), matrix: mat4Mul(rotation, base), moving: true };
      }

      return { ...pick(face), matrix: mat4Mul(rotation, face.matrix), moving: true };
    });
  }

  private applyUnfoldStep(
    faces: Face[],
    step: FoldStep,
    index: number,
    targetRecord: StepRecord,
  ): StepRecord {
    const effectiveStep: FoldStep = {
      ...step,
      crease: step.crease ?? targetRecord.step.crease,
      moving: step.moving ?? targetRecord.step.moving,
      angle: step.angle ?? targetRecord.step.angle,
    };

    return {
      step: effectiveStep,
      split: faces,
      after: targetRecord.split,
      moved: targetRecord.moved,
      axisPoint: targetRecord.axisPoint,
      axisDir: targetRecord.axisDir,
      rotationSign: targetRecord.rotationSign,
      angle: targetRecord.angle,
      isUnfold: true,
    };
  }

  private applyStep(faces: Face[], step: FoldStep, index: number): StepRecord {
    const label = `Step ${index + 1}`;
    if (!step.crease || !step.moving) {
      throw new FoldError(`${label}: fold step requires a crease and moving side`);
    }
    const [p0, p1] = [step.crease.from, step.crease.to];
    const dx = p1[0] - p0[0];
    const dy = p1[1] - p0[1];
    const length = Math.hypot(dx, dy);
    if (length < EPS) throw new FoldError(`${label}: crease has zero length`);

    const dir: Vec2 = [dx / length, dy / length];
    const leftNormal: Vec2 = [-dir[1], dir[0]];
    const signedDistance = (w: Vec2) => (w[0] - p0[0]) * leftNormal[0] + (w[1] - p0[1]) * leftNormal[1];

    const selected = step.select ? new Set(step.select.faces) : null;
    if (selected) {
      for (const id of selected) {
        if (!faces.some((f) => f.id === id)) throw new FoldError(`${label}: unknown face "${id}"`);
      }
    }

    const movesLeft = step.moving === 'left';
    const split: Face[] = [];
    const moved = new Set<string>();

    for (const face of faces) {
      if (selected && !selected.has(face.id)) {
        split.push(face);
        continue;
      }
      const dist = worldPolygon(face).map(signedDistance);
      const sides = dist.map(sideOf);
      const hasLeft = sides.some((s) => s > 0);
      const hasRight = sides.some((s) => s < 0);

      if (hasLeft && hasRight) {
        const { left, right } = splitConvexPolygon(face.polygon, face.creaseEdges, dist);
        const leftFace: Face = { ...face, id: `${face.id}.l`, ...left };
        const rightFace: Face = { ...face, id: `${face.id}.r`, ...right };
        split.push(leftFace, rightFace);
        moved.add(movesLeft ? leftFace.id : rightFace.id);
      } else {
        split.push(face);
        if (hasLeft === movesLeft && (hasLeft || hasRight)) moved.add(face.id);
      }
    }

    const movedFaces = split.filter((f) => moved.has(f.id));
    const fixedFaces = split.filter((f) => !moved.has(f.id));
    if (movedFaces.length === 0) {
      throw new FoldError(`${label}: the crease does not cross any paper on its ${step.moving} side, so nothing would move`);
    }
    const targetDegrees = step.angle !== undefined ? step.angle : 180;
    const targetAngle = (Math.abs(targetDegrees) * Math.PI) / 180;
    const isFlatFold = Math.abs(targetAngle - Math.PI) < 1e-4;

    if (fixedFaces.length === 0 && isFlatFold) {
      throw new FoldError(`${label}: all selected paper is on the moving side, so nothing is left to fold against`);
    }

    const axisPoint: Vec3 = [p0[0], p0[1], 0];
    const axisDir: Vec3 = [dir[0], dir[1], 0];

    // Rotation direction: +angle about the crease direction lifts the LEFT side toward the viewer.
    const baseLiftsTowardViewer = step.kind === 'valley';
    const angleSign = targetDegrees < 0 ? -1 : 1;
    const rotationSign = (((baseLiftsTowardViewer === movesLeft ? 1 : -1) * angleSign) as 1 | -1);

    const turn = mat4RotateAboutLine(axisPoint, axisDir, rotationSign * targetAngle);

    // Layer bookkeeping (for flat folds)
    const fixedLayers = fixedFaces.map((f) => f.layer);
    const maxFixed = fixedLayers.length > 0 ? Math.max(...fixedLayers) : 0;
    const minFixed = fixedLayers.length > 0 ? Math.min(...fixedLayers) : 0;
    const movedLayers = [...new Set(movedFaces.map((f) => f.layer))].sort((a, b) => a - b);
    const count = movedLayers.length;
    const newLayer = (old: number) => {
      const rank = movedLayers.indexOf(old);
      return step.kind === 'valley' ? maxFixed + 1 + (count - 1 - rank) : minFixed - 1 - rank;
    };

    const flipped = split.map<Face>((face) =>
      moved.has(face.id)
        ? { ...face, matrix: mat4Mul(turn, face.matrix), layer: newLayer(face.layer) }
        : face,
    );

    let after: Face[];
    if (isFlatFold) {
      // Compact layers to 0..N-1 (equal layers stay equal) and set each face's resting height.
      const ranks = new Map<number, number>();
      [...new Set(flipped.map((f) => f.layer))].sort((a, b) => a - b).forEach((value, i) => ranks.set(value, i));
      after = flipped.map<Face>((face) => {
        const layer = ranks.get(face.layer)!;
        const matrix = face.matrix.slice();
        matrix[14] = layer * this.layerGap;
        return { ...face, layer, matrix };
      });
    } else {
      // 3D fold: retains 3D rotated matrix
      after = flipped;
    }

    return { step, split, after, moved, axisPoint, axisDir, rotationSign, angle: targetAngle };
  }
}

function pick(face: Face) {
  return { id: face.id, polygon: face.polygon, creaseEdges: face.creaseEdges, layer: face.layer };
}

function rest(face: Face, moving: boolean): PosedFace {
  return { ...pick(face), matrix: face.matrix, moving };
}
