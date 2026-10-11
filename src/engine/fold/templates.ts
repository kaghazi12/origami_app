import { FoldFormat, EdgeAssignment } from '../types';

/**
 * Creates a blank rectangular sheet of paper
 */
export function createSquareSheet(width: number = 1, height: number = 1): FoldFormat {
  return {
    file_spec: 1.1,
    file_creator: 'origami-fold-engine',
    file_title: 'Blank Sheet',
    file_classes: ['singleModel'],
    frame_classes: ['creasePattern'],
    vertices_coords: [
      [0, 0],
      [width, 0],
      [width, height],
      [0, height],
    ],
    edges_vertices: [
      [0, 1],
      [1, 2],
      [2, 3],
      [3, 0],
    ],
    edges_assignment: ['B', 'B', 'B', 'B'],
    edges_foldAngle: [0, 0, 0, 0],
    faces_vertices: [[0, 1, 2, 3]],
  };
}

/**
 * Single vertical valley fold in half
 */
export function createHalfFoldPattern(width: number = 1, height: number = 1): FoldFormat {
  const midX = width / 2;
  return {
    file_spec: 1.1,
    file_creator: 'origami-fold-engine',
    file_title: 'Half Fold (Valley)',
    file_classes: ['singleModel'],
    frame_classes: ['creasePattern'],
    vertices_coords: [
      [0, 0], // 0
      [midX, 0], // 1
      [width, 0], // 2
      [width, height], // 3
      [midX, height], // 4
      [0, height], // 5
    ],
    edges_vertices: [
      [0, 1],
      [1, 2],
      [2, 3],
      [3, 4],
      [4, 5],
      [5, 0],
      // Valley crease down center:
      [1, 4],
    ],
    edges_assignment: ['B', 'B', 'B', 'B', 'B', 'B', 'V'],
    edges_foldAngle: [0, 0, 0, 0, 0, 0, 180],
    faces_vertices: [
      [0, 1, 4, 5],
      [1, 2, 3, 4],
    ],
  };
}

/**
 * Diagonal valley fold in half
 */
export function createDiagonalFoldPattern(width: number = 1, height: number = 1): FoldFormat {
  return {
    file_spec: 1.1,
    file_creator: 'origami-fold-engine',
    file_title: 'Diagonal Fold',
    file_classes: ['singleModel'],
    frame_classes: ['creasePattern'],
    vertices_coords: [
      [0, 0], // 0
      [width, 0], // 1
      [width, height], // 2
      [0, height], // 3
    ],
    edges_vertices: [
      [0, 1],
      [1, 2],
      [2, 3],
      [3, 0],
      // Diagonal crease:
      [0, 2],
    ],
    edges_assignment: ['B', 'B', 'B', 'B', 'V'],
    edges_foldAngle: [0, 0, 0, 0, 180],
    faces_vertices: [
      [0, 1, 2],
      [0, 2, 3],
    ],
  };
}

/**
 * Classical Waterbomb Base Crease Pattern
 * Center vertex with horizontal Mountain fold and two diagonal Valley folds
 */
export function createWaterbombBasePattern(size: number = 1): FoldFormat {
  const half = size / 2;
  return {
    file_spec: 1.1,
    file_creator: 'origami-fold-engine',
    file_title: 'Waterbomb Base',
    file_classes: ['singleModel'],
    frame_classes: ['creasePattern'],
    vertices_coords: [
      [0, 0], // 0 bottom-left
      [half, 0], // 1 bottom-mid
      [size, 0], // 2 bottom-right
      [size, half], // 3 right-mid
      [size, size], // 4 top-right
      [half, size], // 5 top-mid
      [0, size], // 6 top-left
      [0, half], // 7 left-mid
      [half, half], // 8 center
    ],
    edges_vertices: [
      // Boundary
      [0, 1],
      [1, 2],
      [2, 3],
      [3, 4],
      [4, 5],
      [5, 6],
      [6, 7],
      [7, 0],
      // Orthogonal mountain folds (dual of Preliminary Base)
      [1, 8],
      [8, 5],
      [7, 8],
      [8, 3],
      // Diagonal valley folds
      [0, 8],
      [8, 4],
      [6, 8],
      [8, 2],
    ],
    edges_assignment: [
      'B', 'B', 'B', 'B', 'B', 'B', 'B', 'B',
      'M', 'M', 'M', 'M',
      'V', 'V', 'V', 'V',
    ],
    edges_foldAngle: [
      0, 0, 0, 0, 0, 0, 0, 0,
      -180, -180, -180, -180,
      180, 180, 180, 180,
    ],
    faces_vertices: [
      [0, 1, 8],
      [1, 2, 8],
      [2, 3, 8],
      [3, 4, 8],
      [4, 5, 8],
      [5, 6, 8],
      [6, 7, 8],
      [7, 0, 8],
    ],
  };
}

/**
 * Classical Preliminary Base (Square Base) Crease Pattern
 * Center vertex with orthogonal Valley folds and diagonal Mountain folds
 */
export function createPreliminaryBasePattern(size: number = 1): FoldFormat {
  const half = size / 2;
  return {
    file_spec: 1.1,
    file_creator: 'origami-fold-engine',
    file_title: 'Preliminary Base',
    file_classes: ['singleModel'],
    frame_classes: ['creasePattern'],
    vertices_coords: [
      [0, 0], // 0 bottom-left
      [half, 0], // 1 bottom-mid
      [size, 0], // 2 bottom-right
      [size, half], // 3 right-mid
      [size, size], // 4 top-right
      [half, size], // 5 top-mid
      [0, size], // 6 top-left
      [0, half], // 7 left-mid
      [half, half], // 8 center
    ],
    edges_vertices: [
      // Boundary
      [0, 1],
      [1, 2],
      [2, 3],
      [3, 4],
      [4, 5],
      [5, 6],
      [6, 7],
      [7, 0],
      // Orthogonal valley folds
      [1, 8],
      [8, 5],
      [7, 8],
      [8, 3],
      // Diagonal mountain folds
      [0, 8],
      [8, 4],
      [6, 8],
      [8, 2],
    ],
    edges_assignment: [
      'B', 'B', 'B', 'B', 'B', 'B', 'B', 'B',
      'V', 'V', 'V', 'V',
      'M', 'M', 'M', 'M',
    ],
    edges_foldAngle: [
      0, 0, 0, 0, 0, 0, 0, 0,
      180, 180, 180, 180,
      -180, -180, -180, -180,
    ],
    faces_vertices: [
      [0, 1, 8],
      [1, 2, 8],
      [2, 3, 8],
      [3, 4, 8],
      [4, 5, 8],
      [5, 6, 8],
      [6, 7, 8],
      [7, 0, 8],
    ],
  };
}

/**
 * Computes 1-DOF rigid origami coupled fold angles for Miura-ori
 * Given parallelogram acute angle gamma and vertical fold angle theta_V:
 * tan(|theta_H| / 2) = cos(gamma) * tan(|theta_V| / 2)
 */
export function computeMiuraCoupledAngles(
  gammaRad: number,
  foldAngleVRad: number
): { thetaV: number; thetaH: number } {
  const tanHalfV = Math.tan(Math.abs(foldAngleVRad) / 2);
  const tanHalfH = Math.cos(gammaRad) * tanHalfV;
  const foldAngleHRad = 2 * Math.atan(tanHalfH);
  return {
    thetaV: foldAngleVRad,
    thetaH: Math.sign(foldAngleVRad || 1) * foldAngleHRad,
  };
}

/**
 * Classical Miura-ori periodic origami tessellation pattern
 * Periodic parallelogram tessellation with stated acute angle gamma.
 * 1-DOF rigid-foldable mechanism with auxetic (negative Poisson's ratio) collapse.
 * Satisfies Kawasaki's and Maekawa's theorems at every interior vertex.
 */
export function createMiuraOriPattern(
  cols: number = 3,
  rows: number = 3,
  width: number = 1,
  height: number = 1,
  gammaDeg: number = 60
): FoldFormat {
  const gammaRad = (gammaDeg * Math.PI) / 180;
  const dx = width / cols;
  const dy = height / rows;
  const shiftX = dy * Math.cos(gammaRad); // horizontal shift for parallelogram

  const vertices_coords: [number, number][] = [];
  const vLookup = (c: number, r: number) => r * (cols + 1) + c;

  for (let r = 0; r <= rows; r++) {
    const xOffset = r % 2 === 1 ? shiftX : 0;
    for (let c = 0; c <= cols; c++) {
      const x = c * dx + xOffset;
      const y = r * dy;
      vertices_coords.push([x, y]);
    }
  }

  const edges_vertices: [number, number][] = [];
  const edges_assignment: EdgeAssignment[] = [];
  const edges_foldAngle: number[] = [];

  // Coupled fold angles at default reference fold state theta_V = 45 deg
  const refThetaVDeg = 45;
  const { thetaH: refThetaHRad } = computeMiuraCoupledAngles(gammaRad, (refThetaVDeg * Math.PI) / 180);
  const refThetaHDeg = (refThetaHRad * 180) / Math.PI;

  // Horizontal edges: between (c, r) and (c+1, r)
  for (let r = 0; r <= rows; r++) {
    const isBoundaryRow = r === 0 || r === rows;
    for (let c = 0; c < cols; c++) {
      const u = vLookup(c, r);
      const v = vLookup(c + 1, r);
      edges_vertices.push([u, v]);

      if (isBoundaryRow) {
        edges_assignment.push('B');
        edges_foldAngle.push(0);
      } else {
        const isMountain = (c + r) % 2 === 0;
        edges_assignment.push(isMountain ? 'M' : 'V');
        edges_foldAngle.push(isMountain ? -refThetaHDeg : refThetaHDeg);
      }
    }
  }

  // Vertical zigzag edges: between (c, r) and (c, r+1)
  for (let c = 0; c <= cols; c++) {
    const isBoundaryCol = c === 0 || c === cols;
    for (let r = 0; r < rows; r++) {
      const u = vLookup(c, r);
      const v = vLookup(c, r + 1);
      edges_vertices.push([u, v]);

      if (isBoundaryCol) {
        edges_assignment.push('B');
        edges_foldAngle.push(0);
      } else {
        const isMountain = c % 2 === 1;
        edges_assignment.push(isMountain ? 'M' : 'V');
        edges_foldAngle.push(isMountain ? -refThetaVDeg : refThetaVDeg);
      }
    }
  }

  // Faces: each quad [v(c, r), v(c+1, r), v(c+1, r+1), v(c, r+1)]
  const faces_vertices: number[][] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      faces_vertices.push([
        vLookup(c, r),
        vLookup(c + 1, r),
        vLookup(c + 1, r + 1),
        vLookup(c, r + 1),
      ]);
    }
  }

  return {
    file_spec: 1.1,
    file_creator: 'origami-fold-engine',
    file_title: `Miura-ori (${cols}x${rows}, gamma=${gammaDeg}°)`,
    file_classes: ['singleModel'],
    frame_classes: ['creasePattern'],
    vertices_coords,
    edges_vertices,
    edges_assignment,
    edges_foldAngle,
    faces_vertices,
  };
}
