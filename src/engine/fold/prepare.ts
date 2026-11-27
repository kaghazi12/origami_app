/**
 * Everything a FOLD file goes through before the engine sees it.
 *
 * Real FOLD files vary a lot: any unit size, folded forms instead of crease patterns, several
 * frames, faces missing or not matching the edges, creases that cross without a shared vertex,
 * creases that stop in the middle of the paper. And many files describe patterns that can't fold
 * the way they say (wrong mountain/valley counts, partial angles no rigid shape can reach).
 *
 * prepareFold turns any of these into one clean crease pattern on a unit sheet, and returns a
 * plain-language report of what was repaired and what is impossible about the pattern, so the
 * app can explain why a model looks the way it does instead of silently showing a mess.
 */

import { EdgeAssignment, FoldError, FoldFormat } from '../types';
import { parseFold } from './parse';
import { extractPlanarFaces, resolveTJunctions } from './faces';
import { isFoldedForm, unfoldFoldedForm } from './unfold';

export type IssueKind =
  /** Repaired by us; the model is still correct. */
  | 'repaired'
  /** The pattern can't do what the file says; the engine shows the closest it can. */
  | 'impossible'
  /** Worth knowing, no effect on the result. */
  | 'note';

export interface FoldIssue {
  kind: IssueKind;
  /** One short sentence for the UI. */
  title: string;
  /** Detail: where and why. */
  detail?: string;
}

export interface FoldReport {
  issues: FoldIssue[];
  /** Factor the file's coordinates were multiplied by to make the longest side 1. */
  scale: number;
  /** Every M/V crease targets ±180° (or has no angle): the file means "fold flat". */
  flatTarget: boolean;
  /** Interior vertices that break Kawasaki's or Maekawa's theorem (only checked for flat targets). */
  flatFoldViolations: number;
  /** Metadata from the file, for display. */
  title?: string;
  author?: string;
  description?: string;
}

export interface PreparedFold {
  fold: FoldFormat;
  report: FoldReport;
}

const key = (a: number, b: number) => (a < b ? `${a},${b}` : `${b},${a}`);
const isCrease = (a: string) => a === 'M' || a === 'V';

/** Merge FOLD frames: frame i inherits its parent's fields when frame_inherit is true. */
function frames(raw: Record<string, unknown>): Record<string, unknown>[] {
  const top: Record<string, unknown> = { ...raw };
  delete top.file_frames;
  const list = [top];
  const extra = Array.isArray(raw.file_frames) ? (raw.file_frames as Record<string, unknown>[]) : [];
  for (const fr of extra) {
    if (!fr || typeof fr !== 'object') continue;
    const parentIdx = typeof fr.frame_parent === 'number' ? fr.frame_parent : 0;
    const parent = list[parentIdx] ?? top;
    list.push(fr.frame_inherit ? { ...parent, ...fr } : { ...fr });
  }
  return list;
}

function is3DFrame(f: Record<string, unknown>): boolean {
  const classes = Array.isArray(f.frame_classes) ? (f.frame_classes as string[]) : [];
  if (classes.includes('foldedForm')) return true;
  const vc = f.vertices_coords as number[][] | undefined;
  return !!vc && vc.some((v) => v.length > 2 && Math.abs(v[2]) > 1e-9);
}

/** Largest relative change in edge length between two embeddings of the same graph. */
function lengthChange(a: number[][], b: number[][], edges: [number, number][]): number {
  let worst = 0;
  for (const [u, v] of edges) {
    const la = Math.hypot(a[u][0] - a[v][0], a[u][1] - a[v][1], (a[u][2] ?? 0) - (a[v][2] ?? 0));
    const lb = Math.hypot(b[u][0] - b[v][0], b[u][1] - b[v][1], (b[u][2] ?? 0) - (b[v][2] ?? 0));
    if (la > 1e-12) worst = Math.max(worst, Math.abs(lb - la) / la);
  }
  return worst;
}

/** Split edges where they cross each other without a shared vertex (adds the crossing points). */
function splitCrossings(fold: FoldFormat): { fold: FoldFormat; added: number } {
  const V = (fold.vertices_coords as number[][]).map((p) => [p[0], p[1]] as [number, number]);
  const E = fold.edges_vertices;
  const n = E.length;
  // bounding boxes for a cheap reject
  const box = E.map(([a, b]) => [Math.min(V[a][0], V[b][0]), Math.max(V[a][0], V[b][0]), Math.min(V[a][1], V[b][1]), Math.max(V[a][1], V[b][1])]);
  const cuts: { e: number; v: number }[] = [];
  const eps = 1e-9;
  let added = 0;
  // sort by min x to prune pairs
  const order = [...E.keys()].sort((i, j) => box[i][0] - box[j][0]);
  for (let ii = 0; ii < n; ii++) {
    const i = order[ii];
    for (let jj = ii + 1; jj < n; jj++) {
      const j = order[jj];
      if (box[j][0] > box[i][1] + eps) break;
      if (box[j][3] < box[i][2] - eps || box[j][2] > box[i][3] + eps) continue;
      const [a, b] = E[i], [c, d] = E[j];
      if (a === c || a === d || b === c || b === d) continue;
      const p = V[a], r = [V[b][0] - p[0], V[b][1] - p[1]];
      const q = V[c], s = [V[d][0] - q[0], V[d][1] - q[1]];
      const den = r[0] * s[1] - r[1] * s[0];
      if (Math.abs(den) < 1e-14) continue; // parallel (overlaps are handled by T-junctions)
      const t = ((q[0] - p[0]) * s[1] - (q[1] - p[1]) * s[0]) / den;
      const u = ((q[0] - p[0]) * r[1] - (q[1] - p[1]) * r[0]) / den;
      if (t <= 1e-7 || t >= 1 - 1e-7 || u <= 1e-7 || u >= 1 - 1e-7) continue;
      V.push([p[0] + t * r[0], p[1] + t * r[1]]);
      const v = V.length - 1;
      cuts.push({ e: i, v }, { e: j, v });
      added++;
    }
  }
  if (!added) return { fold, added: 0 };
  // the new vertices lie inside the crossed edges; resolveTJunctions splits them there
  const out = resolveTJunctions({ ...fold, vertices_coords: V });
  void cuts;
  return { fold: out, added };
}

/** Remove crease chains that end in the middle of the paper (they don't separate faces). */
function pruneDangling(fold: FoldFormat): { fold: FoldFormat; removed: number } {
  const nV = fold.vertices_coords.length;
  const alive = fold.edges_vertices.map(() => true);
  const deg = new Int32Array(nV);
  fold.edges_vertices.forEach(([a, b]) => { deg[a]++; deg[b]++; });
  let removed = 0;
  let changed = true;
  while (changed) {
    changed = false;
    fold.edges_vertices.forEach(([a, b], e) => {
      if (!alive[e] || fold.edges_assignment[e] === 'B') return;
      if (deg[a] === 1 || deg[b] === 1) {
        alive[e] = false; deg[a]--; deg[b]--; removed++; changed = true;
      }
    });
  }
  if (!removed) return { fold, removed: 0 };
  const keep = (_: unknown, e: number) => alive[e];
  return {
    fold: {
      ...fold,
      edges_vertices: fold.edges_vertices.filter(keep),
      edges_assignment: fold.edges_assignment.filter(keep),
      ...(fold.edges_foldAngle ? { edges_foldAngle: fold.edges_foldAngle.filter(keep) } : {}),
    },
    removed,
  };
}

/** True when faces_vertices exist and agree with the edges: creases between two faces, edges on one. */
function facesMatchEdges(fold: FoldFormat): boolean {
  const faces = fold.faces_vertices;
  if (!faces || faces.length === 0) return false;
  const count = new Map<string, number>();
  for (const f of faces) for (let i = 0; i < f.length; i++) {
    const k = key(f[i], f[(i + 1) % f.length]);
    count.set(k, (count.get(k) ?? 0) + 1);
  }
  const edgeKeys = new Set<string>();
  for (let e = 0; e < fold.edges_vertices.length; e++) {
    const [a, b] = fold.edges_vertices[e];
    const k = key(a, b);
    edgeKeys.add(k);
    if ((count.get(k) ?? 0) !== (fold.edges_assignment[e] === 'B' ? 1 : 2)) return false;
  }
  // every face side must be an edge
  for (const k of count.keys()) if (!edgeKeys.has(k)) return false;
  return true;
}

/** Interior vertices breaking Kawasaki (alternate angles sum to 180°) or Maekawa (|M − V| = 2). */
function flatFoldCheck(fold: FoldFormat): { bad: number; interior: number; example?: string } {
  const V = fold.vertices_coords as number[][];
  const inc: { ang: number; a: EdgeAssignment }[][] = V.map(() => []);
  fold.edges_vertices.forEach(([a, b], e) => {
    const s = fold.edges_assignment[e];
    inc[a].push({ ang: Math.atan2(V[b][1] - V[a][1], V[b][0] - V[a][0]), a: s });
    inc[b].push({ ang: Math.atan2(V[a][1] - V[b][1], V[a][0] - V[b][0]), a: s });
  });
  let bad = 0, interior = 0;
  let example: string | undefined;
  inc.forEach((list, vi) => {
    if (list.some((x) => x.a === 'B')) return;
    const cr = list.filter((x) => isCrease(x.a)).sort((p, q) => p.ang - q.ang);
    if (cr.length === 0) return;
    interior++;
    const m = cr.filter((x) => x.a === 'M').length;
    const v = cr.length - m;
    let alt = 0;
    for (let i = 0; i < cr.length; i += 2) {
      let d = cr[(i + 1) % cr.length].ang - cr[i].ang;
      if (d <= 0) d += 2 * Math.PI;
      alt += d;
    }
    const kawasakiOk = cr.length % 2 === 0 && Math.abs(alt - Math.PI) < 1e-6;
    const maekawaOk = Math.abs(m - v) === 2;
    if (!kawasakiOk || !maekawaOk) {
      bad++;
      if (!example) {
        const at = `(${+V[vi][0].toFixed(3)}, ${+V[vi][1].toFixed(3)})`;
        example = !maekawaOk
          ? `The corner at ${at} has ${m} mountain and ${v} valley creases; a flat fold needs exactly two more of one than the other.`
          : `The creases at ${at} don't satisfy Kawasaki's rule (alternate angles must add up to 180°).`;
      }
    }
  });
  return { bad, interior, example };
}

/**
 * Turn any FOLD JSON into a clean crease pattern on a unit sheet, with a report.
 * Throws FoldError (with a readable message) only when there's no usable pattern at all.
 */
export function prepareFold(raw: unknown): PreparedFold {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new FoldError('This file isn’t a FOLD object.');
  const r = raw as Record<string, unknown>;
  const issues: FoldIssue[] = [];
  const all = frames(r);

  // 1. pick the crease pattern frame, and a folded frame of the same paper if there is one
  let base = all.find((f) => Array.isArray(f.vertices_coords) && !is3DFrame(f)) ?? all.find((f) => Array.isArray(f.vertices_coords));
  if (!base) throw new FoldError('This FOLD file has no vertices.');
  const folded3D = all.find((f) => f !== base && Array.isArray(f.vertices_coords) && is3DFrame(f));

  let fold = parseFold(base);
  if (isFoldedForm(fold)) {
    // only a folded form was given: unfold it into its crease pattern
    const u = unfoldFoldedForm(fold);
    fold = { ...u.fold };
    issues.push({ kind: 'note', title: 'Unfolded from the folded model in the file.' });
  } else if (folded3D) {
    // a multi-frame file: use the folded frame's angles if it is really the same paper folded
    const coords3 = folded3D.vertices_coords as number[][];
    if (coords3.length === fold.vertices_coords.length) {
      const change = lengthChange(fold.vertices_coords as number[][], coords3, fold.edges_vertices);
      if (change < 0.01) {
        try {
          const u = unfoldFoldedForm({ ...fold, vertices_coords: coords3.map((p) => [p[0], p[1], p[2] ?? 0]) as [number, number, number][], frame_classes: ['foldedForm'] });
          fold = { ...fold, edges_foldAngle: u.fold.edges_foldAngle };
          issues.push({ kind: 'note', title: 'Fold angles taken from the folded frame in the file.' });
        } catch {
          /* keep the crease pattern's own angles */
        }
      } else {
        issues.push({
          kind: 'repaired',
          title: 'The folded frame in this file was ignored.',
          detail: `It isn’t the same paper as the crease pattern: some edges change length by ${(change * 100).toFixed(0)}% between the two frames.`,
        });
      }
    }
  }

  // 2. unit sheet: longest side 1, corner at the origin
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (const v of fold.vertices_coords) { x0 = Math.min(x0, v[0]); x1 = Math.max(x1, v[0]); y0 = Math.min(y0, v[1]); y1 = Math.max(y1, v[1]); }
  const size = Math.max(x1 - x0, y1 - y0);
  if (!(size > 0)) throw new FoldError('This FOLD file’s sheet has no area.');
  const scale = 1 / size;
  fold = { ...fold, vertices_coords: (fold.vertices_coords as number[][]).map((v) => [(v[0] - x0) * scale, (v[1] - y0) * scale]) as [number, number][] };

  // 3. unassigned creases can't be folded by anyone; treat them as flat and say so
  const unassigned = fold.edges_assignment.filter((a) => a === 'U').length;
  if (unassigned) {
    fold = { ...fold, edges_assignment: fold.edges_assignment.map((a) => (a === 'U' ? 'F' : a)) as EdgeAssignment[] };
    issues.push({ kind: 'impossible', title: `${unassigned} creases have no mountain or valley assigned.`, detail: 'They are left flat.' });
  }

  // 4. topology: crossings, dangling creases, faces that don't match the edges
  const crossed = splitCrossings(fold);
  if (crossed.added) {
    fold = crossed.fold;
    issues.push({ kind: 'repaired', title: `${crossed.added} places where creases cross without a shared corner were joined.` });
  }
  const pruned = pruneDangling(fold);
  if (pruned.removed) {
    fold = pruned.fold;
    issues.push({
      kind: 'impossible',
      title: `${pruned.removed} creases stop in the middle of the paper.`,
      detail: 'A crease that ends inside a face can’t fold on its own, so they are left out.',
    });
  }
  const resolved = resolveTJunctions(fold);
  const tSplit = resolved.edges_vertices.length !== fold.edges_vertices.length;
  if (tSplit) fold = resolved;
  if (!facesMatchEdges(fold)) {
    const had = !!fold.faces_vertices?.length;
    const faces = extractPlanarFaces(fold);
    if (!faces.length) throw new FoldError('No faces could be found between the creases of this file.');
    fold = { ...fold, faces_vertices: faces };
    if (had) {
      issues.push({
        kind: 'repaired',
        title: 'The faces in this file didn’t match its creases, so they were rebuilt.',
        detail: 'Without this, some creases would belong to no face and could never fold.',
      });
    }
  }

  // 5. fold angles: fill missing, keep the sign consistent with the assignment
  let signFixed = 0;
  const angles = fold.edges_assignment.map((a, e) => {
    const d = fold.edges_foldAngle?.[e];
    if (a === 'M' || a === 'V') {
      const mag = d === undefined || !Number.isFinite(d) || d === 0 ? 180 : Math.min(180, Math.abs(d));
      if (d !== undefined && d !== 0 && Math.sign(d) !== (a === 'V' ? 1 : -1)) signFixed++;
      return a === 'V' ? mag : -mag;
    }
    return 0;
  });
  fold = { ...fold, edges_foldAngle: angles };
  if (signFixed) issues.push({ kind: 'repaired', title: `${signFixed} fold angles had the wrong sign for their mountain/valley and were flipped.` });

  // 6. can it fold flat at all?
  const flatTarget = angles.every((d, e) => !isCrease(fold.edges_assignment[e]) || Math.abs(Math.abs(d) - 180) < 1e-6);
  let flatFoldViolations = 0;
  if (flatTarget) {
    const chk = flatFoldCheck(fold);
    flatFoldViolations = chk.bad;
    if (chk.bad) {
      issues.push({
        kind: 'impossible',
        title: `This pattern can’t fold flat: ${chk.bad} of ${chk.interior} inner corners break the flat-folding rules.`,
        detail: `${chk.example} It is folded as far as the paper allows.`,
      });
    }
  }

  return {
    fold: { ...fold, file_spec: 1.1, frame_classes: ['creasePattern'] },
    report: {
      issues,
      scale,
      flatTarget,
      flatFoldViolations,
      title: typeof r.file_title === 'string' ? r.file_title : typeof r.frame_title === 'string' ? r.frame_title : undefined,
      author: typeof r.file_author === 'string' ? r.file_author : undefined,
      description: typeof r.file_description === 'string' ? r.file_description : undefined,
    },
  };
}
