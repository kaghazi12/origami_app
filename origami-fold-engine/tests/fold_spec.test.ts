import { describe, expect, it } from 'vitest';
import {
  parseFold,
  serializeFold,
  createSquareSheet,
  createHalfFoldPattern,
  createDiagonalFoldPattern,
  createWaterbombBasePattern,
  createPreliminaryBasePattern,
} from '../../src/engine/fold';
import { FoldError, FoldFormat } from '../../src/engine/types';

describe('Phase 1: FOLD 1.1 Specification Foundation', () => {
  it('parses valid square sheet FOLD model', () => {
    const raw = createSquareSheet(2, 3);
    const parsed = parseFold(raw);
    expect(parsed.file_spec).toBe(1.1);
    expect(parsed.vertices_coords).toHaveLength(4);
    expect(parsed.edges_vertices).toHaveLength(4);
    expect(parsed.edges_assignment).toEqual(['B', 'B', 'B', 'B']);
    expect(parsed.edges_foldAngle).toEqual([0, 0, 0, 0]);
  });

  it('parses valid Half Fold pattern with valley crease', () => {
    const raw = createHalfFoldPattern(1, 1);
    const parsed = parseFold(raw);
    expect(parsed.vertices_coords).toHaveLength(6);
    expect(parsed.edges_vertices).toHaveLength(7);
    expect(parsed.edges_assignment[6]).toBe('V');
    expect(parsed.edges_foldAngle?.[6]).toBe(180);
  });

  it('parses Waterbomb and Preliminary Base crease patterns', () => {
    const wb = parseFold(createWaterbombBasePattern(1));
    expect(wb.vertices_coords).toHaveLength(9);
    expect(wb.edges_assignment.filter((a) => a === 'B')).toHaveLength(8);
    expect(wb.edges_assignment.filter((a) => a === 'M')).toHaveLength(2);
    expect(wb.edges_assignment.filter((a) => a === 'V')).toHaveLength(4);

    const pb = parseFold(createPreliminaryBasePattern(1));
    expect(pb.vertices_coords).toHaveLength(9);
    expect(pb.edges_assignment.filter((a) => a === 'B')).toHaveLength(8);
    expect(pb.edges_assignment.filter((a) => a === 'V')).toHaveLength(4);
    expect(pb.edges_assignment.filter((a) => a === 'M')).toHaveLength(4);
  });

  it('rejects invalid inputs with descriptive FoldError', () => {
    expect(() => parseFold(null)).toThrow(FoldError);
    expect(() => parseFold([])).toThrow(FoldError);
    expect(() => parseFold({ vertices_coords: 'invalid' })).toThrow(FoldError);
    expect(() =>
      parseFold({
        vertices_coords: [[0, 0], [1, 0]],
        edges_vertices: [[0, 2]], // out-of-bounds vertex index 2
        edges_assignment: ['B'],
      })
    ).toThrow(/out-of-bounds/);
    expect(() =>
      parseFold({
        vertices_coords: [[0, 0], [1, 0]],
        edges_vertices: [[0, 0]], // self edge
        edges_assignment: ['B'],
      })
    ).toThrow(/cannot connect/);
    expect(() =>
      parseFold({
        vertices_coords: [[0, 0], [1, 0]],
        edges_vertices: [[0, 1]],
        edges_assignment: ['X'], // invalid assignment
      })
    ).toThrow(/must be one of/);
    expect(() =>
      parseFold({
        vertices_coords: [[0, 0], [1, 0]],
        edges_vertices: [[0, 1]],
        edges_assignment: ['B', 'V'], // length mismatch
      })
    ).toThrow(/length/);
  });

  it('round-trip serialization preserves exact model data', () => {
    const original = createWaterbombBasePattern(1.5);
    const serialized = serializeFold(original);
    const roundtripped = parseFold(JSON.parse(serialized));
    expect(roundtripped).toEqual(original);
  });

  it('verifies pure TypeScript execution with zero DOM/Three.js dependencies', () => {
    expect(typeof (globalThis as unknown as { window?: unknown }).window).toBe('undefined');
    expect(typeof (globalThis as unknown as { document?: unknown }).document).toBe('undefined');
  });
});
