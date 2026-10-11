import { describe, expect, it } from 'vitest';
import {
  FoldEngine,
  worldPolygon,
  type Face,
  type FoldModel,
} from '../src';
import { PRELIMINARY_FOLD_MODEL } from '../../src/models/presets';

describe('Deep inspection of Preliminary Base flaps', () => {
  it('tests moving triangle ABD to the spine', () => {
    const testModel: FoldModel = {
      ...PRELIMINARY_FOLD_MODEL,
      steps: [
        ...PRELIMINARY_FOLD_MODEL.steps,
        {
          title: 'Fold right flap edge to spine',
          crease: { from: [0.5, 0.5], to: [1, 0.70710678] },
          moving: 'right',
          kind: 'valley',
          select: { faces: ['f0.r.r.r'] },
        },
        {
          title: 'Fold left flap edge to spine',
          crease: { from: [0.5, 0.5], to: [0.70710678, 1] },
          moving: 'left',
          kind: 'valley',
          select: { faces: ['f0.r.r.l'] },
        },
      ],
    };

    const engine = new FoldEngine(testModel);
    expect(engine.stepCount).toBe(6);

    // 1. Total paper area conservation: the 1x1 sheet must never lose or gain area
    const finalFaces = engine.stateAt(6);
    let totalPaperArea = 0;
    for (const f of finalFaces) {
      // Shoelace formula on f.polygon
      let a = 0;
      for (let i = 0; i < f.polygon.length; i++) {
        const j = (i + 1) % f.polygon.length;
        a += f.polygon[i][0] * f.polygon[j][1] - f.polygon[j][0] * f.polygon[i][1];
      }
      totalPaperArea += Math.abs(a) / 2;
    }
    expect(totalPaperArea).toBeCloseTo(1.0, 6);

    // 2. Smooth animation pose coverage across all steps (0 to 6)
    for (let p = 0; p <= 6; p += 0.25) {
      const posed = engine.poseAt(p);
      expect(posed.length).toBeGreaterThan(0);
      for (const pf of posed) {
        expect(pf.matrix.length).toBe(16);
      }
    }

    // 3. Inspect final kite vertices
    const kiteFaces = finalFaces.filter((f) => f.id.startsWith('f0.r.r.'));
    expect(kiteFaces.length).toBe(4);

    const fRightMoved = finalFaces.find((f) => f.id === 'f0.r.r.r.r')!;
    const fLeftMoved = finalFaces.find((f) => f.id === 'f0.r.r.l.l')!;

    const wpRight = worldPolygon(fRightMoved);
    const wpLeft = worldPolygon(fLeftMoved);

    // Both moved corners must land exactly on the spine at (0.85355, 0.85355)
    const spinePointRight = wpRight.find(
      (p) => Math.abs(p[0] - 0.853553) < 0.001 && Math.abs(p[1] - 0.853553) < 0.001
    );
    const spinePointLeft = wpLeft.find(
      (p) => Math.abs(p[0] - 0.853553) < 0.001 && Math.abs(p[1] - 0.853553) < 0.001
    );
    expect(spinePointRight).toBeDefined();
    expect(spinePointLeft).toBeDefined();

    console.log('✓ All physical origami checks passed: Area = 1.0, Perfect Symmetrical Kite');
  });
});


