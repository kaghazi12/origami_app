import type { FoldModel } from '../engine';

export const CRANE_MODEL: FoldModel = {
  version: 1,
  id: 'origami-crane',
  name: 'Origami Crane (Orizuru)',
  paper: { width: 1, height: 1 },
  steps: [
    {
      title: 'Fold diagonally in half',
      hint: 'Crease along diagonal from (0,0) to (1,1) bringing top-left to bottom-right.',
      crease: { from: [0, 0], to: [1, 1] },
      moving: 'left',
      kind: 'valley',
    },
    {
      title: 'Fold in half along the center crease',
      hint: 'Fold the left corner across to the right corner.',
      crease: { from: [0.5, 0.5], to: [1, 0] },
      moving: 'left',
      kind: 'valley',
    },
    {
      title: 'Fold top apex flap downwards',
      hint: 'Fold the front flap down to define the body and wing base.',
      crease: { from: [0.25, 0.25], to: [0.75, 0.25] },
      moving: 'left',
      kind: 'valley',
      select: { faces: ['f0.r.l'] },
    },
    {
      title: 'Fold the neck upward',
      hint: 'Fold the lower-left flap upward at an angle to create the crane neck.',
      crease: { from: [0.15, 0.15], to: [0.5, 0] },
      moving: 'right',
      kind: 'valley',
    },
    {
      title: 'Fold the tail upward',
      hint: 'Fold the lower-right flap upward at an angle for the tail.',
      crease: { from: [0.5, 0], to: [0.85, 0.15] },
      moving: 'right',
      kind: 'valley',
    },
    {
      title: 'Fold the head downward',
      hint: 'Fold the tip of the neck forward to shape the crane beak and head.',
      crease: { from: [0.25, 0.35], to: [0.35, 0.45] },
      moving: 'left',
      kind: 'valley',
    },
    {
      title: 'Spread the wings down',
      hint: 'Fold the top body wings gently outward into flight position.',
      crease: { from: [0.3, 0.2], to: [0.7, 0.2] },
      moving: 'left',
      kind: 'valley',
    },
  ],
};
