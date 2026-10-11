import { describe, expect, it } from 'vitest';
import {
  FoldEngine,
  worldPolygon,
} from '../src';
import { SQUASH_FOLD_MODEL } from '../../src/models/presets';

describe('Squash Fold on Preliminary Base', () => {
  it('tests symmetrical squash fold on preliminary base', () => {
    const engine = new FoldEngine(SQUASH_FOLD_MODEL);
    expect(engine.stepCount).toBe(6);

    // Verify paper conservation
    const finalFaces = engine.stateAt(6);
    let totalPaperArea = 0;
    for (const f of finalFaces) {
      let a = 0;
      for (let i = 0; i < f.polygon.length; i++) {
        const j = (i + 1) % f.polygon.length;
        a += f.polygon[i][0] * f.polygon[j][1] - f.polygon[j][0] * f.polygon[i][1];
      }
      totalPaperArea += Math.abs(a) / 2;
    }
    expect(totalPaperArea).toBeCloseTo(1.0, 6);

    // Verify right and left squashed faces
    const fRight = finalFaces.find((f) => f.id === 'f0.r.r.r.r')!;
    const fLeft = finalFaces.find((f) => f.id === 'f0.r.r.l.l')!;
    expect(fRight).toBeDefined();
    expect(fLeft).toBeDefined();

    const wpRight = worldPolygon(fRight);
    const wpLeft = worldPolygon(fLeft);

    // Symmetrical point on the spine (0.85355, 0.85355)
    const spineR = wpRight.find(
      (p) => Math.abs(p[0] - 0.853553) < 0.001 && Math.abs(p[1] - 0.853553) < 0.001
    );
    const spineL = wpLeft.find(
      (p) => Math.abs(p[0] - 0.853553) < 0.001 && Math.abs(p[1] - 0.853553) < 0.001
    );
    expect(spineR).toBeDefined();
    expect(spineL).toBeDefined();

    // Symmetrical wingtips at (1, ~0.7071) and (~0.7071, 1)
    const wingtipR = wpRight.find(
      (p) => Math.abs(p[0] - 1.0) < 0.001 && Math.abs(p[1] - 0.707106) < 0.001
    );
    const wingtipL = wpLeft.find(
      (p) => Math.abs(p[0] - 0.707106) < 0.001 && Math.abs(p[1] - 1.0) < 0.001
    );
    expect(wingtipR).toBeDefined();
    expect(wingtipL).toBeDefined();

    // Verify all steps animate smoothly
    for (let p = 0; p <= 6; p += 0.5) {
      const posed = engine.poseAt(p);
      expect(posed.length).toBeGreaterThan(0);
    }
  });
});
