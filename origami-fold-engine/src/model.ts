import type { Vec2 } from './math';
import { FoldError, type FoldModel, type FoldStep } from './types';

function fail(path: string, message: string): never {
  throw new FoldError(`${path} ${message}`);
}

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

const isVec2 = (v: unknown): v is Vec2 =>
  Array.isArray(v) && v.length === 2 && v.every((n) => typeof n === 'number' && Number.isFinite(n));

const isPositive = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v > 0;

/**
 * Validate untrusted JSON (from the database, the admin panel, or the authoring tool) and
 * return a typed model. Throws FoldError with a path like `steps[2].moving` on the first problem.
 */
export function parseModel(input: unknown): FoldModel {
  if (!isObject(input)) fail('model', 'must be an object');
  const m = input as Record<string, unknown>;

  if (m.version !== 1) fail('version', 'must be 1');
  if (typeof m.id !== 'string' || m.id === '') fail('id', 'must be a non-empty string');
  if (typeof m.name !== 'string' || m.name === '') fail('name', 'must be a non-empty string');

  const paper = m.paper;
  if (!isObject(paper) || !isPositive(paper.width) || !isPositive(paper.height)) {
    fail('paper', 'must have positive numeric width and height');
  }
  if (!Array.isArray(m.steps)) fail('steps', 'must be an array');

  const steps = (m.steps as unknown[]).map((raw, i): FoldStep => {
    const at = `steps[${i}]`;
    if (!isObject(raw)) fail(at, 'must be an object');
    const s = raw as Record<string, unknown>;

    if (typeof s.title !== 'string' || s.title === '') fail(`${at}.title`, 'must be a non-empty string');
    if (s.hint !== undefined && typeof s.hint !== 'string') fail(`${at}.hint`, 'must be a string');

    if (s.kind !== 'valley' && s.kind !== 'mountain' && s.kind !== 'unfold') {
      fail(`${at}.kind`, 'must be "valley", "mountain", or "unfold"');
    }

    const crease = s.crease;
    if (s.kind !== 'unfold') {
      if (!isObject(crease) || !isVec2(crease.from) || !isVec2(crease.to)) {
        fail(`${at}.crease`, 'must have "from" and "to" as [x, y] number pairs');
      }
      if (s.moving !== 'left' && s.moving !== 'right') fail(`${at}.moving`, 'must be "left" or "right"');
    } else {
      if (crease !== undefined && (!isObject(crease) || !isVec2(crease.from) || !isVec2(crease.to))) {
        fail(`${at}.crease`, 'must have "from" and "to" as [x, y] number pairs');
      }
      if (s.moving !== undefined && s.moving !== 'left' && s.moving !== 'right') {
        fail(`${at}.moving`, 'must be "left" or "right"');
      }
    }

    let select: FoldStep['select'];
    if (s.select !== undefined) {
      const sel = s.select;
      if (!isObject(sel) || !Array.isArray(sel.faces) || !sel.faces.every((f) => typeof f === 'string')) {
        fail(`${at}.select`, 'must be { faces: string[] }');
      }
      select = { faces: [...((sel as Record<string, unknown>).faces as string[])] };
    }

    if (s.angle !== undefined && (typeof s.angle !== 'number' || !Number.isFinite(s.angle))) {
      fail(`${at}.angle`, 'must be a finite number');
    }

    const c = crease as { from: Vec2; to: Vec2 } | undefined;
    return {
      title: s.title as string,
      ...(s.hint !== undefined ? { hint: s.hint as string } : {}),
      ...(c ? { crease: { from: [c.from[0], c.from[1]], to: [c.to[0], c.to[1]] } } : {}),
      ...(s.moving ? { moving: s.moving as FoldStep['moving'] } : {}),
      kind: s.kind as FoldStep['kind'],
      ...(select ? { select } : {}),
      ...(s.angle !== undefined ? { angle: s.angle as number } : {}),
    };
  });

  const p = paper as { width: number; height: number };
  return {
    version: 1,
    id: m.id as string,
    name: m.name as string,
    paper: { width: p.width, height: p.height },
    steps,
  };
}
