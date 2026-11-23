import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';
import {
  compileDesign,
  DesignAnimator,
  DesignError,
  parseDesign,
  paperArea,
  worldPolygon,
  type CompiledDesign,
  type PaperState,
} from '../../src/engine/design';
import { containsStrict, overlapArea } from '../../src/engine/design/polygon';
import { planStepPath } from '../../src/engine/design/kinematics';

const DESIGNS = path.resolve(__dirname, '../../src/designs');

const sheet = (steps: unknown[], paper = { width: 1, height: 1 }) => ({
  format: 'origami-design',
  version: 1,
  meta: { id: 't', title: 'test' },
  paper,
  steps,
});

function ok(json: unknown): CompiledDesign {
  const c = compileDesign(json);
  if (c.error) throw new Error(`step ${c.error.step + 1}: ${c.error.message}`);
  return c;
}

/** Faces covering a current-view point, top first. */
function stackAt(s: PaperState, p: [number, number]) {
  return s.topo.faces
    .map((f, i) => ({ f, i }))
    .filter(({ i }) => containsStrict(worldPolygon(s, i), p, 1e-6))
    .sort((a, b) => s.ranks[b.i] - s.ranks[a.i]);
}

/** Every pair of overlapping faces must have different heights, and the order must match. */
function checkStacking(s: PaperState) {
  const n = s.topo.faces.length;
  const polys = s.topo.faces.map((_, i) => worldPolygon(s, i));
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (overlapArea(polys[i], polys[j]) < 1e-7) continue;
      expect(s.ranks[i]).not.toBe(s.ranks[j]);
    }
  }
}

function outlineArea(s: PaperState): number {
  // area covered by the folded model (union), estimated on a grid
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const polys = s.topo.faces.map((_, i) => worldPolygon(s, i));
  for (const p of polys) for (const [x, y] of p) {
    minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y);
  }
  const N = 200;
  let hit = 0;
  for (let a = 0; a < N; a++) for (let b = 0; b < N; b++) {
    const p: [number, number] = [minX + ((a + 0.5) / N) * (maxX - minX), minY + ((b + 0.5) / N) * (maxY - minY)];
    if (polys.some((q) => containsStrict(q, p, 0))) hit++;
  }
  return (hit / (N * N)) * (maxX - minX) * (maxY - minY);
}

describe('format', () => {
  it('rejects bad files with the path of the bad field', () => {
    expect(() => parseDesign({})).toThrow(DesignError);
    expect(() => parseDesign({ ...sheet([]), version: 2 })).toThrow(/version/);
    expect(() =>
      parseDesign(sheet([{ caption: 'x', action: { type: 'fold', line: [[0, 0], [0, 0]], moving: [1, 1], direction: 'valley' } }])),
    ).toThrow(/steps\[0\]\.action\.line/);
    expect(() => parseDesign(sheet([{ caption: 'x', action: { type: 'twist' } }]))).toThrow(/steps\[0\]\.action\.type/);
    expect(() =>
      parseDesign(sheet([{ caption: 'x', action: { type: 'fold', line: [[0, 0], [1, 1]], moving: [0, 1], direction: 'up' } }])),
    ).toThrow(/direction/);
  });

  it('round-trips through JSON', () => {
    const raw = JSON.parse(fs.readFileSync(path.join(DESIGNS, 'crane.json'), 'utf8'));
    const d = parseDesign(raw);
    expect(parseDesign(JSON.parse(JSON.stringify(d)))).toEqual(d);
  });
});

describe('simple folds', () => {
  it('book fold puts the moving half on top, flipped', () => {
    const c = ok(sheet([{ caption: 'half', action: { type: 'fold', line: [[0.5, 0], [0.5, 1]], moving: [0.2, 0.5], direction: 'valley' } }]));
    const s = c.final;
    expect(s.topo.faces).toHaveLength(2);
    const st = stackAt(s, [0.75, 0.5]);
    expect(st).toHaveLength(2);
    expect(Math.sign(s.transforms[st[0].i][10])).toBe(-1); // the folded half shows its back
    expect(Math.sign(s.transforms[st[1].i][10])).toBe(1);
    expect(paperArea(s.topo)).toBeCloseTo(1, 9);
  });

  it('mountain fold sends the flap underneath', () => {
    const c = ok(sheet([{ caption: 'half', action: { type: 'fold', line: [[0.5, 0], [0.5, 1]], moving: [0.2, 0.5], direction: 'mountain' } }]));
    const st = stackAt(c.final, [0.75, 0.5]);
    expect(Math.sign(c.final.transforms[st[0].i][10])).toBe(1); // unmoved half stays on top
  });

  it('a corner at a folded edge takes both layers with it', () => {
    const c = ok(sheet([
      { caption: 'half', action: { type: 'fold', line: [[0, 0.5], [1, 0.5]], moving: [0.5, 0.8], direction: 'valley' } },
      { caption: 'corner', action: { type: 'fold', line: [[0.6, 0.5], [1, 0.1]], moving: [0.95, 0.45], direction: 'valley', layers: 'top' } },
    ]));
    expect(stackAt(c.final, [0.95, 0.45])).toHaveLength(0);
  });

  it('folding "top" moves only the top flap', () => {
    const c = ok(sheet([
      { caption: 'half', action: { type: 'fold', line: [[0, 0.5], [1, 0.5]], moving: [0.5, 0.8], direction: 'valley' } },
      { caption: 'corner', action: { type: 'fold', line: [[0.6, 0], [1, 0.4]], moving: [0.95, 0.05], direction: 'valley', layers: 'top' } },
    ]));
    expect(stackAt(c.final, [0.95, 0.05])).toHaveLength(1); // only the bottom layer is left there
    expect(stackAt(c.final, [0.7, 0.2])).toHaveLength(3); // landed on top of both layers
    checkStacking(c.final);
  });

  it('refuses to fold a flap through a layer that covers it', () => {
    const c = compileDesign(sheet([
      { caption: 'half', action: { type: 'fold', line: [[0, 0.5], [1, 0.5]], moving: [0.5, 0.8], direction: 'valley' } },
      { caption: 'bottom only', action: { type: 'fold', line: [[0.6, 0], [1, 0.4]], moving: [0.95, 0.05], direction: 'valley', layers: 'bottom' } },
    ]));
    expect(c.error?.step).toBe(1);
    expect(c.error?.message).toMatch(/covered/);
    expect(c.steps).toHaveLength(1); // earlier steps still play
  });

  it('unfold restores the previous shape and keeps the crease', () => {
    const c = ok(sheet([
      { caption: 'fold', action: { type: 'fold', line: [[0, 0], [1, 1]], moving: [0.2, 0.8], direction: 'valley' } },
      { caption: 'unfold', action: { type: 'unfold' } },
    ]));
    const s = c.final;
    expect(s.topo.faces).toHaveLength(2);
    expect(s.angles).toEqual([0]);
    for (const m of s.transforms) expect(m[10]).toBeCloseTo(1, 9);
  });

  it('turn over flips every face and reverses the layers', () => {
    const c = ok(sheet([
      { caption: 'half', action: { type: 'fold', line: [[0.5, 0], [0.5, 1]], moving: [0.2, 0.5], direction: 'valley' } },
      { caption: 'turn', action: { type: 'turnOver' } },
    ]));
    const st = stackAt(c.final, [0.75, 0.5]);
    expect(Math.sign(c.final.transforms[st[0].i][10])).toBe(-1); // the sheet that was underneath, now face down on top
    expect(c.final.topo.faces[st[0].i].id).toBe(c.steps[0].record.after.topo.faces[stackAt(c.steps[0].record.after, [0.75, 0.5])[1].i].id);
  });

  it('a partial fold leaves the paper in 3D', () => {
    const c = ok(sheet([{ caption: 'up', action: { type: 'fold', line: [[0.5, 0], [0.5, 1]], moving: [0.2, 0.5], direction: 'valley', angle: 90 } }]));
    expect(c.final.flat).toBe(false);
    const moved = c.final.transforms.find((m) => Math.abs(m[10]) < 1e-9);
    expect(moved).toBeDefined();
  });

  it('snaps typed coordinates onto existing vertices', () => {
    // second fold line ends 1e-5 away from the corner made by the first fold
    const c = ok(sheet([
      { caption: 'a', action: { type: 'fold', line: [[0, 0], [1, 1]], moving: [0.2, 0.8], direction: 'valley' } },
      { caption: 'b', action: { type: 'fold', line: [[1.00001, 0], [0.5, 0.50001]], moving: [0.3, 0.1], direction: 'valley' } },
    ]));
    for (const f of c.final.topo.faces) expect(f.poly.length).toBe(3); // no slivers
    expect(c.final.topo.faces).toHaveLength(4);
  });
});

describe('collapse (crease-pattern coordinates)', () => {
  it('rejects creases that cannot fold together', () => {
    const c = compileDesign(sheet([
      { caption: 'diag', action: { type: 'fold', line: [[0, 0], [1, 1]], moving: [0.2, 0.8], direction: 'valley' } },
      { caption: 'half', action: { type: 'fold', line: [[1, 0], [0.5, 0.5]], moving: [0.3, 0.1], direction: 'valley' } },
      { caption: 'bad squash', action: { type: 'collapse', fixed: [0.9, 0.5], creases: [
        { from: [0.5, 0], to: [0.5, 0.5], fold: 'auto' },
        { from: [0, 0.5], to: [0.5, 0.5], fold: 'auto' },
        { from: [1, 0], to: [0.5, 0.5], fold: 'flat' },
      ] } },
    ]));
    expect(c.error?.step).toBe(2);
    expect(c.error?.message).toMatch(/tear/);
  });

  it('rejects a crease that stops inside the paper', () => {
    const c = compileDesign(sheet([{ caption: 'x', action: { type: 'collapse', creases: [{ from: [0, 0.5], to: [0.5, 0.5], fold: 'valley' }] } }]));
    expect(c.error?.message).toMatch(/stops in the middle/);
  });
});

describe('bundled designs', () => {
  const files = fs.readdirSync(DESIGNS).filter((f) => f.endsWith('.json'));

  it.each(files)('%s folds completely', (file) => {
    const c = ok(JSON.parse(fs.readFileSync(path.join(DESIGNS, file), 'utf8')));
    expect(c.steps.length).toBe(c.design.steps.length);
    expect(paperArea(c.final.topo)).toBeCloseTo(c.design.paper.width * c.design.paper.height * c.scale * c.scale, 9);
    for (const s of c.steps) if (s.record.after.flat) checkStacking(s.record.after);
  });

  it('is deterministic', () => {
    const raw = JSON.parse(fs.readFileSync(path.join(DESIGNS, 'crane.json'), 'utf8'));
    const a = compileDesign(raw);
    const b = compileDesign(raw);
    expect(b.final.transforms).toEqual(a.final.transforms);
    expect(b.final.ranks).toEqual(a.final.ranks);
  });

  it('preliminary base is a real square base', () => {
    const c = ok(JSON.parse(fs.readFileSync(path.join(DESIGNS, 'preliminary-base.json'), 'utf8')));
    const s = c.final;
    // a 0.5 x 0.5 square, four layers everywhere
    expect(outlineArea(s)).toBeCloseTo(0.25, 2);
    for (const p of [[0.6, 0.2], [0.9, 0.3], [0.62, 0.3], [0.88, 0.2]] as [number, number][]) {
      expect(stackAt(s, p)).toHaveLength(4);
    }
    // book creases folded, two opposite diagonal halves folded, the other two flat (Maekawa: 4 vs 2)
    const atCentre = s.topo.creases
      .map((cr, k) => ({ cr, a: s.angles[k] }))
      .filter(({ cr }) => [cr.p0, cr.p1].some((p) => Math.hypot(p[0] - 0.5, p[1] - 0.5) < 1e-9));
    const folded = atCentre.filter(({ a }) => Math.abs(a) > 1);
    expect(folded).toHaveLength(6);
    const v = folded.filter(({ a }) => a > 0).length;
    expect(Math.abs(v - (folded.length - v))).toBe(2);
    // all four paper corners meet at one point
    const corners = [[0, 0], [1, 0], [1, 1], [0, 1]].map((p) => {
      const i = s.topo.faces.findIndex((f) => f.poly.some((q) => Math.hypot(q[0] - p[0], q[1] - p[1]) < 1e-9));
      const m = s.transforms[i];
      return [m[0] * p[0] + m[4] * p[1] + m[12], m[1] * p[0] + m[5] * p[1] + m[13]];
    });
    for (const q of corners) {
      expect(q[0]).toBeCloseTo(corners[0][0], 9);
      expect(q[1]).toBeCloseTo(corners[0][1], 9);
    }
  });

  it('crane: bird base points, neck and tail end where expected', () => {
    const c = ok(JSON.parse(fs.readFileSync(path.join(DESIGNS, 'crane.json'), 'utf8')));
    expect(c.timeMs).toBeLessThan(2000);
    const bird = c.steps.find((s) => s.caption.startsWith('Repeat behind: Petal'))!.record.after;
    // bird base: long diamond, twice as tall as wide (height 1, width 0.414)
    let minX = 9, maxX = -9, minY = 9, maxY = -9;
    bird.topo.faces.forEach((_, i) => worldPolygon(bird, i).forEach(([x, y]) => {
      minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y);
    }));
    expect(maxY - minY).toBeCloseTo(1, 4);
    expect(maxX - minX).toBeCloseTo(Math.SQRT2 - 1, 4);
  });
});

describe('animator', () => {
  const c = ok(JSON.parse(fs.readFileSync(path.join(DESIGNS, 'crane.json'), 'utf8')));
  const anim = new DesignAnimator(c, { layerGap: 0 });

  it('matches each step state at the step boundaries', () => {
    for (let k = 0; k < c.steps.length; k++) {
      const pose = anim.pose(k);
      const s = c.steps[k].record.before;
      // compare a few corners against the state transforms
      for (let corner = 0; corner < pose.geometry.cornerCount; corner += 7) {
        const f = pose.geometry.faceOfCorner[corner];
        const u = pose.geometry.paper[corner * 2];
        const v = pose.geometry.paper[corner * 2 + 1];
        const m = s.transforms[f];
        expect(pose.positions[corner * 3]).toBeCloseTo(m[0] * u + m[4] * v + m[12], 4);
        expect(pose.positions[corner * 3 + 1]).toBeCloseTo(m[1] * u + m[5] * v + m[13], 4);
        expect(pose.positions[corner * 3 + 2]).toBeCloseTo(m[2] * u + m[6] * v + m[14], 4);
      }
    }
  });

  it('gives finite positions all the way through', () => {
    for (let p = 0; p <= anim.stepCount; p += 0.13) {
      const pose = anim.pose(p);
      for (const x of pose.positions) expect(Number.isFinite(x)).toBe(true);
    }
  });

  it('plans rigid motion for squash and petal folds (no tearing mid-step)', () => {
    for (const caption of ['Squash the front flap into a square', 'Petal fold', 'Repeat behind: Petal fold']) {
      const step = c.steps.find((s) => s.caption === caption)!;
      const path = planStepPath(step.record);
      expect(path, caption).not.toBeNull();
      expect(path!.maxGap).toBeLessThan(1e-3);
      // smooth: no crease turns much more per sample than the straight-line rate
      for (let i = 1; i < path!.angles.length; i++) {
        for (let k = 0; k < path!.angles[i].length; k++) {
          expect(Math.abs(path!.angles[i][k] - path!.angles[i - 1][k])).toBeLessThan(0.15);
        }
      }
    }
  });

  it('keeps the paper connected (welded) mid-step', () => {
    // during the petal fold, shared paper corners must coincide
    const k = c.steps.findIndex((s) => s.caption === 'Petal fold');
    const pose = anim.pose(k + 0.5);
    const g = pose.geometry;
    const first = new Map<number, number>();
    for (let corner = 0; corner < g.cornerCount; corner++) {
      const w = g.weld[corner];
      const f = first.get(w);
      if (f === undefined) { first.set(w, corner); continue; }
      for (let a = 0; a < 3; a++) expect(pose.positions[corner * 3 + a]).toBeCloseTo(pose.positions[f * 3 + a], 6);
    }
  });
});
