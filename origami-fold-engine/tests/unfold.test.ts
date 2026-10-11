import { describe, it, expect } from 'vitest';
import { FoldEngine, faceNormal, polygonArea, worldPolygon, worldVertices } from '../src';

describe('unfold step', () => {
  it('folds in half and then unfolds back completely with crease preserved', () => {
    const model = {
      version: 1 as const,
      id: 'fold-and-unfold',
      name: 'Fold and Unfold',
      paper: { width: 1, height: 1 },
      steps: [
        {
          title: 'Fold left half over right half',
          crease: { from: [0.5, 0] as [number, number], to: [0.5, 1] as [number, number] },
          moving: 'left' as const,
          kind: 'valley' as const,
        },
        {
          title: 'Unfold back to square',
          kind: 'unfold' as const, // simply undoes the last fold completely!
        },
      ],
    };

    const engine = new FoldEngine(model);
    expect(engine.stepCount).toBe(2);

    // After step 1: 2 faces, both in [0.5, 1]
    const state1 = engine.stateAt(1);
    expect(state1).toHaveLength(2);
    expect(faceNormal(state1.find((f) => f.id === 'f0.l')!)[2]).toBeCloseTo(-1);

    // After step 2 (unfold): 2 faces, one in [0, 0.5] and one in [0.5, 1]
    const state2 = engine.stateAt(2);
    expect(state2).toHaveLength(2);

    const left = state2.find((f) => f.id === 'f0.l')!;
    const right = state2.find((f) => f.id === 'f0.r')!;

    // Both faces are face-up
    expect(faceNormal(left)[2]).toBeCloseTo(1);
    expect(faceNormal(right)[2]).toBeCloseTo(1);

    // Both faces are flat on table at height 0
    expect(left.matrix[14]).toBeCloseTo(0);
    expect(right.matrix[14]).toBeCloseTo(0);

    // Area of each half is 0.5
    expect(polygonArea(left.polygon)).toBeCloseTo(0.5);
    expect(polygonArea(right.polygon)).toBeCloseTo(0.5);

    // Total area is 1
    const totalArea = polygonArea(left.polygon) + polygonArea(right.polygon);
    expect(totalArea).toBeCloseTo(1);

    // Both faces retain the crease edge along x = 0.5!
    expect(left.creaseEdges.some((e) => e)).toBe(true);
    expect(right.creaseEdges.some((e) => e)).toBe(true);

    // Animation at t = 0 (progress 1.0) matches folded state exactly
    const poseStart = engine.poseAt(1.0);
    const movingStart = poseStart.find((f) => f.id === 'f0.l')!;
    expect(worldVertices(movingStart)[0][0]).toBeCloseTo(1); // landed on right

    // Mid-animation at progress 1.5: the moving flap is lifted straight up
    const poseMid = engine.poseAt(1.5);
    const movingMid = poseMid.find((f) => f.id === 'f0.l')!;
    expect(movingMid.moving).toBe(true);
    const verts = worldVertices(movingMid);
    const maxZ = Math.max(...verts.map((v) => v[2]));
    expect(maxZ).toBeCloseTo(0.5, 2);

    // Animation at t = 1 (progress 2.0) matches flat state exactly
    const poseEnd = engine.poseAt(2.0);
    const movingEnd = poseEnd.find((f) => f.id === 'f0.l')!;
    expect(worldVertices(movingEnd)[0][0]).toBeCloseTo(0); // returned to left edge
  });

  it('can fold again across the crease after unfolding', () => {
    const model = {
      version: 1 as const,
      id: 'precrease-and-fold-again',
      name: 'Precrease and fold again',
      paper: { width: 1, height: 1 },
      steps: [
        {
          title: 'Fold in half',
          crease: { from: [0.5, 0] as [number, number], to: [0.5, 1] as [number, number] },
          moving: 'left' as const,
          kind: 'valley' as const,
        },
        {
          title: 'Unfold',
          kind: 'unfold' as const,
        },
        {
          title: 'Fold horizontally across the crease',
          crease: { from: [0, 0.5] as [number, number], to: [1, 0.5] as [number, number] },
          moving: 'left' as const,
          kind: 'valley' as const,
        },
      ],
    };

    const engine = new FoldEngine(model);
    expect(engine.stepCount).toBe(3);
    const state3 = engine.stateAt(3);
    expect(state3.length).toBe(4); // 4 quarter pieces with crease lines!
  });
});
