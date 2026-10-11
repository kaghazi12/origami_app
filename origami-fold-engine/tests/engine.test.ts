import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  FoldEngine,
  FoldError,
  faceNormal,
  parseModel,
  polygonArea,
  triangulateFan,
  worldPolygon,
  worldVertices,
  type Face,
  type FoldModel,
  type FoldStep,
  type PosedFace,
  type Vec2,
} from '../src';

const step = (s: Pick<FoldStep, 'crease' | 'moving' | 'kind'> & Partial<FoldStep>): FoldStep => ({
  title: 'Fold',
  ...s,
});
const model = (steps: FoldStep[], paper = { width: 1, height: 1 }): FoldModel => ({
  version: 1,
  id: 'test',
  name: 'test',
  paper,
  steps,
});
const bbox = (poly: Vec2[]) => ({
  minX: Math.min(...poly.map((p) => p[0])),
  maxX: Math.max(...poly.map((p) => p[0])),
  minY: Math.min(...poly.map((p) => p[1])),
  maxY: Math.max(...poly.map((p) => p[1])),
});
const byId = <T extends { id: string }>(faces: readonly T[], id: string): T => {
  const face = faces.find((f) => f.id === id);
  if (!face) throw new Error(`no face ${id} in [${faces.map((f) => f.id).join(', ')}]`);
  return face;
};

const halfFold = step({ crease: { from: [0.5, 0], to: [0.5, 1] }, moving: 'left', kind: 'valley' });

describe('blank sheet', () => {
  it('is one face covering the paper', () => {
    const engine = new FoldEngine(model([], { width: 2, height: 3 }));
    const [face, ...rest] = engine.stateAt(0);
    expect(rest).toHaveLength(0);
    expect(polygonArea(face.polygon)).toBeCloseTo(6);
    expect(faceNormal(face)).toEqual([0, 0, 1]);
    expect(engine.poseAt(0)).toHaveLength(1);
  });
});

describe('a single fold', () => {
  it('valley fold in half puts the left half on top of the right half, flipped', () => {
    const engine = new FoldEngine(model([halfFold]));
    const state = engine.stateAt(1);
    expect(state).toHaveLength(2);

    const moved = byId(state, 'f0.l');
    const fixed = byId(state, 'f0.r');

    const box = bbox(worldPolygon(moved));
    expect(box.minX).toBeCloseTo(0.5);
    expect(box.maxX).toBeCloseTo(1);
    expect(box.minY).toBeCloseTo(0);
    expect(box.maxY).toBeCloseTo(1);

    expect(polygonArea(moved.polygon)).toBeCloseTo(0.5);
    expect(polygonArea(fixed.polygon)).toBeCloseTo(0.5);
    expect(moved.layer).toBeGreaterThan(fixed.layer);
    expect(faceNormal(moved)[2]).toBeCloseTo(-1);
    expect(faceNormal(fixed)[2]).toBeCloseTo(1);
    // The raw left edge of the paper (paper x = 0) lands on the right edge (world x = 1).
    const rawEdge = worldVertices(moved).filter((_, i) => moved.polygon[i][0] === 0);
    expect(rawEdge).toHaveLength(2);
    rawEdge.forEach((v) => expect(v[0]).toBeCloseTo(1));
  });

  it('mountain fold sends the moving half underneath', () => {
    const engine = new FoldEngine(model([{ ...halfFold, kind: 'mountain' }]));
    const moved = byId(engine.stateAt(1), 'f0.l');
    const fixed = byId(engine.stateAt(1), 'f0.r');
    expect(moved.layer).toBeLessThan(fixed.layer);
    expect(moved.matrix[14]).toBeLessThan(fixed.matrix[14]);
    expect(faceNormal(moved)[2]).toBeCloseTo(-1);
  });

  it('diagonal fold lands the triangle on the other triangle', () => {
    const engine = new FoldEngine(
      model([step({ crease: { from: [0, 0], to: [1, 1] }, moving: 'left', kind: 'valley' })]),
    );
    const moved = byId(engine.stateAt(1), 'f0.l');
    const poly = worldPolygon(moved);
    expect(poly).toHaveLength(3);
    expect(polygonArea(poly)).toBeCloseTo(0.5);
    const cx = poly.reduce((s, p) => s + p[0], 0) / 3;
    const cy = poly.reduce((s, p) => s + p[1], 0) / 3;
    expect(cx).toBeCloseTo(2 / 3);
    expect(cy).toBeCloseTo(1 / 3);
  });

  it('marks exactly the cut as a crease edge, on both halves', () => {
    const engine = new FoldEngine(model([halfFold]));
    for (const face of engine.stateAt(1)) {
      const flagged = face.creaseEdges.flatMap((flag, i) => (flag ? [i] : []));
      expect(flagged).toHaveLength(1);
      const verts = worldVertices(face);
      const i = flagged[0];
      expect(verts[i][0]).toBeCloseTo(0.5);
      expect(verts[(i + 1) % verts.length][0]).toBeCloseTo(0.5);
    }
  });

  it('works on non-square paper', () => {
    const engine = new FoldEngine(
      model([step({ crease: { from: [0, 1], to: [2, 1] }, moving: 'right', kind: 'valley' })], {
        width: 2,
        height: 2,
      }),
    );
    // right of a left-to-right line is below it: the bottom half folds up over the top half
    const moved = byId(engine.stateAt(1), 'f0.r');
    const box = bbox(worldPolygon(moved));
    expect(box.minY).toBeCloseTo(1);
    expect(box.maxY).toBeCloseTo(2);
  });
});

describe('animation pose', () => {
  it('rotates the moving half through vertical at 50% and keeps the fixed half still', () => {
    const engine = new FoldEngine(model([halfFold]));
    const pose = engine.poseAt(0.5);
    const moving = byId(pose, 'f0.l');
    const fixed = byId(pose, 'f0.r');
    expect(moving.moving).toBe(true);
    expect(fixed.moving).toBe(false);

    // halfway through a valley fold the free edge hangs straight up, half a sheet above the table
    const free = worldVertices(moving).filter((_, i) => moving.polygon[i][0] === 0);
    free.forEach((v) => {
      expect(v[0]).toBeCloseTo(0.5, 2);
      expect(v[2]).toBeCloseTo(0.5, 2);
    });
    expect(faceNormal(moving)[0]).toBeCloseTo(1);
    expect(faceNormal(fixed)).toEqual([0, 0, 1]);
  });

  it('a mountain fold swings the other way', () => {
    const engine = new FoldEngine(model([{ ...halfFold, kind: 'mountain' }]));
    const moving = byId(engine.poseAt(0.5), 'f0.l');
    worldVertices(moving)
      .filter((_, i) => moving.polygon[i][0] === 0)
      .forEach((v) => expect(v[2]).toBeCloseTo(-0.5, 2));
  });

  it('moving="right" valley folds toward the viewer too', () => {
    const engine = new FoldEngine(model([{ ...halfFold, moving: 'right' }]));
    const moving = byId(engine.poseAt(0.5), 'f0.r');
    worldVertices(moving)
      .filter((_, i) => moving.polygon[i][0] === 1)
      .forEach((v) => expect(v[2]).toBeCloseTo(0.5, 2));
  });

  it('clamps progress and reports where it is', () => {
    const engine = new FoldEngine(model([halfFold, { ...halfFold, crease: { from: [0.5, 0.5], to: [1, 0.5] } }]));
    expect(engine.locate(-3)).toMatchObject({ stepIndex: 0, t: 0 });
    expect(engine.locate(1.25)).toMatchObject({ stepIndex: 1 });
    expect(engine.locate(1.25).t).toBeCloseTo(0.25);
    expect(engine.locate(99)).toMatchObject({ stepIndex: 2, t: 0, step: null });
    expect(engine.poseAt(99)).toHaveLength(engine.stateAt(2).length);
  });
});

describe('layers across several folds', () => {
  it('folding every layer twice stacks four faces in a reversed-then-reversed order', () => {
    const engine = new FoldEngine(
      model([halfFold, step({ crease: { from: [0.5, 0.5], to: [1, 0.5] }, moving: 'left', kind: 'valley' })]),
    );
    const state = engine.stateAt(2);
    expect(state).toHaveLength(4);
    state.forEach((f) => {
      const box = bbox(worldPolygon(f));
      expect(box.minX).toBeCloseTo(0.5);
      expect(box.maxX).toBeCloseTo(1);
      expect(box.minY).toBeCloseTo(0);
      expect(box.maxY).toBeCloseTo(0.5);
      expect(polygonArea(f.polygon)).toBeCloseTo(0.25);
    });
    // before the 2nd fold the stack was f0.r (bottom), f0.l (top); the flipped halves reverse that
    const layer = (id: string) => byId(state, id).layer;
    expect(layer('f0.r.r')).toBeLessThan(layer('f0.l.r'));
    expect(layer('f0.l.r')).toBeLessThan(layer('f0.l.l'));
    expect(layer('f0.l.l')).toBeLessThan(layer('f0.r.l'));
  });

  it('letter fold: left third in front, right third behind (a Z shape)', () => {
    const json = JSON.parse(readFileSync(new URL('../examples/letter-fold.json', import.meta.url), 'utf8'));
    const engine = FoldEngine.fromJSON(json);
    const state = engine.stateAt(2);
    expect(state.map((f) => f.id).sort()).toEqual(['f0.l', 'f0.r.l', 'f0.r.r']);
    state.forEach((f) => {
      const box = bbox(worldPolygon(f));
      expect(box.minX).toBeCloseTo(1 / 3, 6);
      expect(box.maxX).toBeCloseTo(2 / 3, 6);
    });
    const left = byId(state, 'f0.l');
    const middle = byId(state, 'f0.r.l');
    const right = byId(state, 'f0.r.r');
    expect(right.layer).toBeLessThan(middle.layer);
    expect(middle.layer).toBeLessThan(left.layer);
    expect(faceNormal(left)[2]).toBeCloseTo(-1);
    expect(faceNormal(middle)[2]).toBeCloseTo(1);
    expect(faceNormal(right)[2]).toBeCloseTo(-1);
    // layers are compacted
    expect(state.map((f) => f.layer).sort()).toEqual([0, 1, 2]);
  });

  it('select.faces folds only the chosen layer', () => {
    const second = step({
      crease: { from: [0.5, 0.5], to: [1, 0.5] },
      moving: 'left',
      kind: 'valley',
      select: { faces: ['f0.l'] },
    });
    const engine = new FoldEngine(model([halfFold, second]));
    const state = engine.stateAt(2);
    expect(state.map((f) => f.id).sort()).toEqual(['f0.l.l', 'f0.l.r', 'f0.r']);
    expect(polygonArea(byId(state, 'f0.r').polygon)).toBeCloseTo(0.5); // untouched
    const topFlap = byId(state, 'f0.l.l');
    expect(topFlap.layer).toBe(Math.max(...state.map((f) => f.layer)));
    const box = bbox(worldPolygon(topFlap));
    expect(box.minY).toBeCloseTo(0);
    expect(box.maxY).toBeCloseTo(0.5);
  });
});

describe('invariants over every example model', () => {
  const dir = new URL('../examples/', import.meta.url);
  const files = readdirSync(dir).filter((f) => f.endsWith('.json'));
  expect(files.length).toBeGreaterThan(0);

  const area = (faces: readonly (Face | PosedFace)[]) =>
    faces.reduce((sum, f) => sum + polygonArea(f.polygon), 0);

  for (const file of files) {
    describe(file, () => {
      const engine = FoldEngine.fromJSON(JSON.parse(readFileSync(new URL(file, dir), 'utf8')));
      const paperArea = engine.model.paper.width * engine.model.paper.height;

      it('never loses or gains paper', () => {
        for (let k = 0; k <= engine.stepCount; k++) {
          expect(area(engine.stateAt(k))).toBeCloseTo(paperArea, 9);
          expect(area(engine.poseAt(k))).toBeCloseTo(paperArea, 9);
          expect(area(engine.poseAt(k + 0.37))).toBeCloseTo(paperArea, 9);
        }
      });

      it('animation ends exactly where the next committed state begins', () => {
        for (let k = 0; k < engine.stepCount; k++) {
          const pose = engine.poseAt(k + 1 - 1e-9);
          const next = engine.stateAt(k + 1);
          expect(new Set(pose.map((f) => f.id))).toEqual(new Set(next.map((f) => f.id)));
          for (const face of next) {
            const a = worldVertices(byId(pose, face.id));
            const b = worldVertices(face);
            a.forEach((v, i) => v.forEach((c, axis) => expect(c).toBeCloseTo(b[i][axis], 6)));
          }
        }
      });

      it('animation starts exactly where the previous committed state ended', () => {
        for (let k = 0; k < engine.stepCount; k++) {
          const pose = engine.poseAt(k);
          const prev = engine.stateAt(k);
          // split faces are pieces of the previous faces; compare total footprint instead of ids
          expect(area(pose)).toBeCloseTo(area(prev), 9);
          const prevTop = Math.max(...prev.map((f) => f.matrix[14]));
          const poseTop = Math.max(...pose.map((f) => f.matrix[14]));
          expect(poseTop).toBeCloseTo(prevTop, 9);
        }
      });

      it('fan triangulation covers each convex face exactly', () => {
        for (const face of engine.stateAt(engine.stepCount)) {
          const tris = triangulateFan(face.polygon.length);
          let total = 0;
          for (let i = 0; i < tris.length; i += 3) {
            total += polygonArea([face.polygon[tris[i]], face.polygon[tris[i + 1]], face.polygon[tris[i + 2]]]);
          }
          expect(total).toBeCloseTo(polygonArea(face.polygon), 9);
        }
      });
    });
  }
});

describe('bad folds are rejected with a useful message', () => {
  it('rejects a zero-length crease', () => {
    const bad = step({ crease: { from: [0.5, 0.5], to: [0.5, 0.5] }, moving: 'left', kind: 'valley' });
    expect(() => new FoldEngine(model([bad]))).toThrow(/Step 1: crease has zero length/);
  });

  it('rejects a crease outside the paper', () => {
    const outside = { from: [5, 0], to: [5, 1] } as FoldStep['crease'];
    expect(() => new FoldEngine(model([step({ crease: outside, moving: 'right', kind: 'valley' })]))).toThrow(
      /nothing would move/,
    );
    expect(() => new FoldEngine(model([step({ crease: outside, moving: 'left', kind: 'valley' })]))).toThrow(
      /nothing is left to fold against/,
    );
  });

  it('rejects unknown face ids and names the step', () => {
    const bad = step({ ...halfFold, select: { faces: ['nope'] } });
    expect(() => new FoldEngine(model([halfFold, bad]))).toThrow(/Step 2: unknown face "nope"/);
  });

  it('throws FoldError instances', () => {
    const bad = step({ crease: { from: [1, 1], to: [1, 1] }, moving: 'left', kind: 'valley' });
    expect(() => new FoldEngine(model([bad]))).toThrow(FoldError);
  });
});

describe('parseModel', () => {
  const valid = () => JSON.parse(JSON.stringify(model([halfFold])));

  it('accepts a valid model and strips unknown fields', () => {
    const json = valid();
    json.extra = 'ignored';
    json.steps[0].junk = 1;
    const parsed = parseModel(json);
    expect(parsed).toEqual(model([{ ...halfFold }]));
  });

  it('points at the exact field that is wrong', () => {
    const cases: [(m: any) => void, RegExp][] = [
      [(m) => (m.version = 2), /^version must be 1/],
      [(m) => (m.paper.width = -1), /^paper must have positive/],
      [(m) => (m.steps[0].moving = 'up'), /^steps\[0\]\.moving must be "left" or "right"/],
      [(m) => (m.steps[0].kind = 'peak'), /^steps\[0\]\.kind/],
      [(m) => (m.steps[0].crease.from = [0]), /^steps\[0\]\.crease/],
      [(m) => (m.steps[0].crease.to = [0, Number.NaN]), /^steps\[0\]\.crease/],
      [(m) => (m.steps[0].title = ''), /^steps\[0\]\.title/],
      [(m) => (m.steps[0].select = { faces: [1] }), /^steps\[0\]\.select/],
      [(m) => (m.steps = 'nope'), /^steps must be an array/],
    ];
    for (const [mutate, message] of cases) {
      const json = valid();
      mutate(json);
      expect(() => parseModel(json)).toThrow(message);
    }
    expect(() => parseModel(null)).toThrow(FoldError);
  });

  it('parses step with custom angle', () => {
    const json = valid();
    json.steps[0].angle = 90;
    const parsed = parseModel(json);
    expect(parsed.steps[0].angle).toBe(90);
  });
});

describe('non-flat 3D folds with custom angle', () => {
  it('folds a flap at 90 degrees standing perpendicular in 3D', () => {
    const fold90 = step({
      crease: { from: [0.5, 0], to: [0.5, 1] },
      moving: 'left',
      kind: 'valley',
      angle: 90,
    });
    const engine = new FoldEngine(model([fold90]));
    const state = engine.stateAt(1);
    expect(state).toHaveLength(2);

    // One face stays flat, one face stands in 3D
    const movingFace = state.find((f) => f.id === 'f0.l')!;
    const normal = faceNormal(movingFace);
    // Valley fold rotating 90 degrees lifts normal towards x
    expect(normal[2]).toBeCloseTo(0, 1); // no longer pointing along z
    expect(Math.abs(normal[0])).toBeCloseTo(1, 1); // points perpendicular along x

    // Test intermediate progress
    const halfPosed = engine.poseAt(0.5);
    expect(halfPosed).toHaveLength(2);
  });
});
