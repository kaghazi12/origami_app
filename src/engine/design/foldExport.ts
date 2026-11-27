/**
 * Export a folded state as a FOLD 1.1 file (https://github.com/edemaine/fold).
 *
 * Main frame: the crease pattern (unfolded sheet) with M / V / F / B assignments and fold
 * angles. Second frame (file_frames[0]): the folded form, with folded vertex positions and
 * faceOrders for the layer order of overlapping faces.
 */

import { mat4Apply } from './math';
import { faceIndex, worldPolygon, type PaperState } from './state';
import { overlapArea } from './polygon';
import type { CompiledDesign } from './compile';

export interface FoldFile {
  file_spec: 1.1;
  file_creator: string;
  file_author?: string;
  file_title: string;
  file_description?: string;
  file_classes: string[];
  frame_title: string;
  frame_classes: string[];
  frame_attributes: string[];
  frame_unit: string;
  vertices_coords: [number, number][];
  edges_vertices: [number, number][];
  edges_assignment: ('B' | 'M' | 'V' | 'F')[];
  edges_foldAngle: number[];
  faces_vertices: number[][];
  file_frames: {
    frame_title: string;
    frame_classes: string[];
    frame_attributes: string[];
    frame_parent: number;
    frame_inherit: boolean;
    vertices_coords: [number, number, number][];
    faceOrders?: [number, number, number][];
  }[];
}

export interface FoldExportOptions {
  title: string;
  author?: string;
  description?: string;
  /** Internal units -> file units (CompiledDesign.scale). */
  scale: number;
}

const round = (x: number) => Math.round(x * 1e12) / 1e12;

export function exportFold(state: PaperState, opts: FoldExportOptions): FoldFile {
  const faces = state.topo.faces;
  const inv = 1 / opts.scale;

  // 1. unique vertices (paper coordinates)
  const verts: [number, number][] = [];
  const vertKey = new Map<string, number>();
  const keyOf = (p: [number, number]) => `${Math.round(p[0] * 1e7)},${Math.round(p[1] * 1e7)}`;
  const vertexOf = (p: [number, number]) => {
    const k = keyOf(p);
    let v = vertKey.get(k);
    if (v === undefined) { v = verts.length; verts.push([p[0], p[1]]); vertKey.set(k, v); }
    return v;
  };
  const faceCorner = faces.map((f) => f.poly.map((p) => vertexOf(p as [number, number])));

  // 2. faces with T-junction vertices inserted along their edges
  const faces_vertices = faceCorner.map((corners) => {
    const out: number[] = [];
    for (let i = 0; i < corners.length; i++) {
      const a = verts[corners[i]];
      const b = verts[corners[(i + 1) % corners.length]];
      out.push(corners[i]);
      const dx = b[0] - a[0];
      const dy = b[1] - a[1];
      const L2 = dx * dx + dy * dy;
      const on: { v: number; t: number }[] = [];
      verts.forEach((p, v) => {
        if (v === corners[i] || v === corners[(i + 1) % corners.length]) return;
        const t = ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / L2;
        if (t <= 1e-9 || t >= 1 - 1e-9) return;
        const d = Math.abs((p[0] - a[0]) * dy - (p[1] - a[1]) * dx) / Math.sqrt(L2);
        if (d < 1e-8) on.push({ v, t });
      });
      on.sort((x, y) => x.t - y.t).forEach((o) => out.push(o.v));
    }
    return out;
  });

  // 3. edges, with the crease angle between the two faces that share them
  const creaseAngle = new Map<string, number>();
  state.topo.creases.forEach((c, k) => creaseAngle.set(`${Math.min(c.a, c.b)}|${Math.max(c.a, c.b)}`, state.angles[k]));
  const edgeFaces = new Map<string, number[]>();
  const edges_vertices: [number, number][] = [];
  faces_vertices.forEach((fv, f) => {
    for (let i = 0; i < fv.length; i++) {
      const a = fv[i];
      const b = fv[(i + 1) % fv.length];
      const k = a < b ? `${a},${b}` : `${b},${a}`;
      let list = edgeFaces.get(k);
      if (!list) { list = []; edgeFaces.set(k, list); edges_vertices.push(a < b ? [a, b] : [b, a]); }
      list.push(f);
    }
  });
  const edges_assignment: FoldFile['edges_assignment'] = [];
  const edges_foldAngle: number[] = [];
  for (const [a, b] of edges_vertices) {
    const fs = edgeFaces.get(`${a},${b}`)!;
    if (fs.length < 2) {
      edges_assignment.push('B');
      edges_foldAngle.push(0);
      continue;
    }
    const ang = creaseAngle.get(`${Math.min(fs[0], fs[1])}|${Math.max(fs[0], fs[1])}`) ?? 0;
    const deg = round((ang * 180) / Math.PI);
    edges_assignment.push(Math.abs(deg) < 1e-6 ? 'F' : deg > 0 ? 'V' : 'M');
    edges_foldAngle.push(Math.abs(deg) < 1e-6 ? 0 : deg);
  }

  // 4. folded form: vertex positions and layer order
  const folded: [number, number, number][] = verts.map(() => [0, 0, 0]);
  const placed = new Uint8Array(verts.length);
  faces_vertices.forEach((fv, f) => {
    for (const v of fv) {
      if (placed[v]) continue;
      const w = mat4Apply(state.transforms[f], [verts[v][0], verts[v][1], 0]);
      folded[v] = [round(w[0] * inv), round(w[1] * inv), round(w[2] * inv)];
      placed[v] = 1;
    }
  });
  const faceOrders: [number, number, number][] = [];
  if (state.flat) {
    const idx = faceIndex(state.topo);
    const polys = faces.map((_, i) => worldPolygon(state, i));
    state.above.forEach((iAbove, key) => {
      const [x, y] = key.split('|');
      const i = idx.get(x);
      const j = idx.get(y);
      if (i === undefined || j === undefined) return;
      if (overlapArea(polys[i], polys[j]) < 1e-8) return;
      // FOLD: [f, g, +1] means f lies on the side of g that g's normal points to
      const gNormal = Math.sign(state.transforms[j][10]) || 1;
      faceOrders.push([i, j, (iAbove ? 1 : -1) * gNormal]);
    });
  }

  return {
    file_spec: 1.1,
    file_creator: 'origami_app prototype design engine',
    ...(opts.author ? { file_author: opts.author } : {}),
    file_title: opts.title,
    ...(opts.description ? { file_description: opts.description } : {}),
    file_classes: ['singleModel'],
    frame_title: 'Crease pattern',
    frame_classes: ['creasePattern'],
    frame_attributes: ['2D'],
    frame_unit: 'unit',
    vertices_coords: verts.map((p) => [round(p[0] * inv), round(p[1] * inv)]),
    edges_vertices,
    edges_assignment,
    edges_foldAngle,
    faces_vertices,
    file_frames: [
      {
        frame_title: 'Folded form',
        frame_classes: ['foldedForm'],
        frame_attributes: [state.flat ? '2D' : '3D'],
        frame_parent: 0,
        frame_inherit: true,
        vertices_coords: folded,
        ...(state.flat ? { faceOrders } : {}),
      },
    ],
  };
}

/** Export the state after `stepCount` steps of a compiled design (default: the end). */
export function exportCompiledFold(c: CompiledDesign, stepCount = c.steps.length, title = c.design.meta.title): FoldFile {
  const state = stepCount <= 0 ? c.initial : c.steps[Math.min(stepCount, c.steps.length) - 1].record.after;
  return exportFold(state, { title, author: c.design.meta.author, description: c.design.meta.description, scale: c.scale });
}
