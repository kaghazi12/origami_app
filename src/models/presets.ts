import type { FoldModel } from '../engine';

export const HALF_FOLD_MODEL: FoldModel = {
  version: 1,
  id: 'half-fold',
  name: 'Half Fold (Valley Fold)',
  paper: { width: 1, height: 1 },
  steps: [
    {
      title: 'Fold the left half over the right half',
      hint: 'A fundamental valley fold bringing the left edge to the right edge.',
      crease: { from: [0.5, 0], to: [0.5, 1] },
      moving: 'left',
      kind: 'valley',
    },
  ],
};

export const FOLD_AND_UNFOLD_MODEL: FoldModel = {
  version: 1,
  id: 'fold-and-unfold',
  name: 'Precrease (Fold & Unfold)',
  paper: { width: 1, height: 1 },
  steps: [
    {
      title: 'Fold the left half over the right half',
      hint: 'Valley fold along the vertical center line to create a crease.',
      crease: { from: [0.5, 0], to: [0.5, 1] },
      moving: 'left',
      kind: 'valley',
    },
    {
      title: 'Unfold back flat to square',
      hint: 'Open the paper flat again — notice the crisp crease mark remains preserved!',
      kind: 'unfold',
    },
    {
      title: 'Fold diagonally across the crease',
      hint: 'Now fold along the diagonal while the precrease line remains visible.',
      crease: { from: [0, 0], to: [1, 1] },
      moving: 'left',
      kind: 'valley',
    },
  ],
};

export const LETTER_FOLD_MODEL: FoldModel = {
  version: 1,
  id: 'letter-fold',
  name: 'Letter Fold (Tri-fold)',
  paper: { width: 1, height: 1 },
  steps: [
    {
      title: 'Fold the left third over the middle',
      hint: 'Valley fold along the first one-third mark toward the center.',
      crease: { from: [0.3333333333333333, 0], to: [0.3333333333333333, 1] },
      moving: 'left',
      kind: 'valley',
    },
    {
      title: 'Fold the right third behind the middle',
      hint: 'Mountain fold along the two-thirds mark backwards.',
      crease: { from: [0.6666666666666666, 0], to: [0.6666666666666666, 1] },
      moving: 'right',
      kind: 'mountain',
    },
  ],
};

export const DIAGONAL_TRIANGLE_MODEL: FoldModel = {
  version: 1,
  id: 'diagonal-triangle',
  name: 'Diagonal Triangle Fold',
  paper: { width: 1, height: 1 },
  steps: [
    {
      title: 'Fold the top-left corner down to the bottom-right corner',
      hint: 'Crease along the diagonal line from (0,0) to (1,1).',
      crease: { from: [0, 0], to: [1, 1] },
      moving: 'left',
      kind: 'valley',
    },
  ],
};

export const QUARTER_SQUARE_MODEL: FoldModel = {
  version: 1,
  id: 'quarter-square',
  name: 'Quarter Square (Double Fold)',
  paper: { width: 1, height: 1 },
  steps: [
    {
      title: 'Fold the left half over the right half',
      hint: 'Valley fold along vertical center line.',
      crease: { from: [0.5, 0], to: [0.5, 1] },
      moving: 'left',
      kind: 'valley',
    },
    {
      title: 'Fold the top half down over the bottom half',
      hint: 'Both layers fold together along horizontal line.',
      crease: { from: [0.5, 0.5], to: [1, 0.5] },
      moving: 'left',
      kind: 'valley',
    },
  ],
};

export const CUP_MODEL: FoldModel = {
  version: 1,
  id: 'origami-cup',
  name: 'Traditional Origami Cup',
  paper: { width: 1, height: 1 },
  steps: [
    {
      title: 'Fold diagonally in half',
      hint: 'Bring bottom-left to top-right to create a triangle.',
      crease: { from: [0, 0], to: [1, 1] },
      moving: 'left',
      kind: 'valley',
    },
    {
      title: 'Fold bottom corner up to opposite edge',
      hint: 'Fold the left corner across to the right edge.',
      crease: { from: [0.35, 0.35], to: [1, 0.35] },
      moving: 'right',
      kind: 'valley',
    },
  ],
};

export const PRELIMINARY_FOLD_MODEL: FoldModel = {
  version: 1,
  id: 'preliminary-fold',
  name: 'Preliminary Fold (Preliminary Base)',
  paper: { width: 1, height: 1 },
  steps: [
    {
      title: 'Fold in half vertically',
      hint: 'Valley fold along the vertical center line bringing the left half over the right half.',
      crease: { from: [0.5, 0], to: [0.5, 1] },
      moving: 'left',
      kind: 'valley',
    },
    {
      title: 'Fold in half horizontally',
      hint: 'Valley fold along the horizontal center line bringing the bottom half up over the top half.',
      crease: { from: [0.5, 0.5], to: [1, 0.5] },
      moving: 'right',
      kind: 'valley',
    },
    {
      title: 'Fold diagonally in half',
      hint: 'Crease diagonally from the closed center (0.5, 0.5) to the open outer corner (1, 1).',
      crease: { from: [0.5, 0.5], to: [1, 1] },
      moving: 'left',
      kind: 'valley',
    },
    {
      title: 'Open flaps into symmetrical Preliminary Base',
      hint: 'Swing the upper flaps across the diagonal axis to form the finished 4-flap Square Base.',
      crease: { from: [0.5, 0.5], to: [1, 1] },
      moving: 'right',
      kind: 'valley',
      select: { faces: ['f0.r.r.l', 'f0.l.r.l', 'f0.l.l.l', 'f0.r.l.l'] },
    },
  ],
};

export const SQUASH_FOLD_MODEL: FoldModel = {
  version: 1,
  id: 'squash-fold',
  name: 'Squash Fold (from Preliminary Base)',
  paper: { width: 1, height: 1 },
  steps: [
    ...PRELIMINARY_FOLD_MODEL.steps,
    {
      title: 'Squash fold: Crease right flap to center spine',
      hint: 'Valley fold the outer edge of the front-right flap along the 22.5° angle bisector onto the center spine.',
      crease: { from: [0.5, 0.5], to: [1, 0.70710678] },
      moving: 'right',
      kind: 'valley',
      select: { faces: ['f0.r.r.r'] },
    },
    {
      title: 'Squash fold: Crease left flap to center spine',
      hint: 'Valley fold the outer edge of the front-left flap along the matching angle bisector onto the center spine, completing the symmetrical kite.',
      crease: { from: [0.5, 0.5], to: [0.70710678, 1] },
      moving: 'left',
      kind: 'valley',
      select: { faces: ['f0.r.r.l'] },
    },
  ],
};



