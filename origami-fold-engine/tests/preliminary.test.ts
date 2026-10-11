import { describe, expect, it } from 'vitest';
import {
  FoldEngine,
  worldPolygon,
  type FoldModel,
} from '../src';

describe('Preliminary Base folding sequences', () => {
  it('tests full 4-step preliminary base model', () => {
    const model: FoldModel = {
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

    const engine = new FoldEngine(model);
    expect(engine.stepCount).toBe(4);

    // Verify all steps produce valid poses
    for (let s = 0; s <= 4; s++) {
      const pose = engine.poseAt(s);
      expect(pose.length).toBeGreaterThan(0);
    }

    // Step 4 final state has 8 faces: 4 on the left and 4 on the right
    const finalState = engine.stateAt(4);
    expect(finalState).toHaveLength(8);

    let leftFaces = 0;
    let rightFaces = 0;
    for (const face of finalState) {
      const poly = worldPolygon(face);
      const isLeft = poly.some(p => Math.abs(p[0] - 0.5) < 1e-4 && Math.abs(p[1] - 1) < 1e-4);
      if (isLeft) leftFaces++;
      else rightFaces++;
    }
    expect(leftFaces).toBe(4);
    expect(rightFaces).toBe(4);
  });
});
