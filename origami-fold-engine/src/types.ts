import type { Mat4, Vec2 } from './math';

export type FoldKind = 'valley' | 'mountain' | 'unfold';
export type FoldSide = 'left' | 'right';

/**
 * One fold. The crease is given in the coordinates of the paper as it currently lies
 * flat on the table (the paper starts as [0,width] x [0,height], y up), so a step can be
 * authored by clicking two points on what the learner sees right now.
 */
export interface FoldStep {
  /** Instruction shown to the learner, e.g. "Fold the left half over the right half". */
  title: string;
  /** Optional longer tip shown under the title. */
  hint?: string;
  /** Crease line. Optional when kind is 'unfold' (defaults to the crease of the fold being undone). */
  crease?: { from: Vec2; to: Vec2 };
  /** Which side of the directed line from -> to rotates. Optional when kind is 'unfold'. */
  moving?: FoldSide;
  /** valley = moving side comes toward the viewer; mountain = it goes behind; unfold = undoes last fold. */
  kind: FoldKind;
  /** Only fold these faces (ids as they exist before the step). Omit to fold every layer. */
  select?: { faces: string[] };
  /** Angle in degrees to hinge/fold around the axis (e.g. 45, 90, 180, -90). Defaults to 180 for flat folds. */
  angle?: number;
}

export interface FoldModel {
  version: 1;
  id: string;
  name: string;
  paper: { width: number; height: number };
  steps: FoldStep[];
}

/**
 * A convex piece of paper. `polygon` lives in paper space (the flat, unfolded sheet) and is
 * counter-clockwise, so it can be used directly as texture coordinates. `matrix` places the
 * piece in the world; it is a proper rigid transform, so a face that has been flipped over
 * simply has its normal pointing at -z.
 */
export interface Face {
  id: string;
  polygon: Vec2[];
  /** creaseEdges[i] is true when the edge polygon[i] -> polygon[i+1] was made by a fold. */
  creaseEdges: boolean[];
  matrix: Mat4;
  /** Stacking order in the flat state; higher = closer to the viewer. */
  layer: number;
}

/** A face at one instant of the animation. */
export interface PosedFace {
  id: string;
  polygon: Vec2[];
  creaseEdges: boolean[];
  matrix: Mat4;
  layer: number;
  /** True for faces that are rotating in the current step. */
  moving: boolean;
}

export class FoldError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FoldError';
  }
}
