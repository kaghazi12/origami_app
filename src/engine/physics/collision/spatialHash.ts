/**
 * 3D Spatial Hash Broad-Phase for Triangle Collision Detection
 * 
 * High-performance zero-allocation spatial hash using flat arrays (head/next linked lists)
 * and dense integer stamps for O(1) visited-pair filtering without memory allocations.
 */

export class SpatialHash {
  private cellSize: number;
  private invCellSize: number;
  private numBuckets: number;
  private mask: number;
  private numFaces: number = 0;

  // Dense flat matrix of topological adjacency (1 byte per pair)
  private isAdjacent: Uint8Array = new Uint8Array(0);

  // Dense flat query stamp array for O(1) duplicate pair rejection without allocations or Set/Map lookups
  private pairStamp: Int32Array = new Int32Array(0);
  private queryStamp: number = 0;

  // Flat linked lists for zero-GC bucket insertion
  private head: Int32Array;
  private next: Int32Array;
  private triangleId: Int32Array;
  private entryCount: number = 0;
  private maxEntries: number;

  // Preallocated candidate pairs pool
  private candidatePairs: [number, number][] = [];

  constructor(cellSize: number = 0.05, numBucketsPowerOf2: number = 2048, maxEntries: number = 32768) {
    this.cellSize = cellSize;
    this.invCellSize = 1.0 / cellSize;
    this.numBuckets = numBucketsPowerOf2;
    this.mask = numBucketsPowerOf2 - 1;
    this.maxEntries = maxEntries;

    this.head = new Int32Array(this.numBuckets);
    this.next = new Int32Array(this.maxEntries);
    this.triangleId = new Int32Array(this.maxEntries);

    // Prepopulate pool
    for (let i = 0; i < 4096; i++) {
      this.candidatePairs.push([0, 0]);
    }
  }

  setCellSize(cellSize: number): void {
    if (cellSize > 1e-6) {
      this.cellSize = cellSize;
      this.invCellSize = 1.0 / cellSize;
    }
  }

  /**
   * Precomputes topological adjacency from triangle face indices and 2D UV rest geometry.
   * Two triangles are considered adjacent (no self-collision tested) if:
   * 1. They share 1 or more vertices (immediate topological neighbors)
   * 2. Their 2D rest centroid distance is below minRestDist (continuous local paper patch)
   */
  initTopology(
    faces: number[] | Int32Array | Uint32Array,
    numFaces: number,
    uvs?: Float64Array | number[],
    minRestDist?: number
  ): void {
    this.numFaces = numFaces;
    const totalPairs = numFaces * numFaces;
    this.isAdjacent = new Uint8Array(totalPairs);
    this.pairStamp = new Int32Array(totalPairs);

    for (let f = 0; f < numFaces; f++) {
      this.isAdjacent[f * numFaces + f] = 1; // self
    }

    // Build vertex-to-triangles map
    const vertexToTriangles: Map<number, number[]> = new Map();
    for (let f = 0; f < numFaces; f++) {
      const v0 = faces[f * 3 + 0];
      const v1 = faces[f * 3 + 1];
      const v2 = faces[f * 3 + 2];

      for (const v of [v0, v1, v2]) {
        let list = vertexToTriangles.get(v);
        if (!list) {
          list = [];
          vertexToTriangles.set(v, list);
        }
        list.push(f);
      }
    }

    // Connect any triangles that share a vertex
    for (const [, triList] of vertexToTriangles) {
      for (let i = 0; i < triList.length; i++) {
        const t1 = triList[i];
        for (let j = i + 1; j < triList.length; j++) {
          const t2 = triList[j];
          this.isAdjacent[t1 * numFaces + t2] = 1;
          this.isAdjacent[t2 * numFaces + t1] = 1;
        }
      }
    }

    // Filter continuous local patch by 2D rest coordinates if provided
    if (uvs && uvs.length > 0) {
      const centroids: [number, number][] = new Array(numFaces);
      let totalEdgeLen = 0;
      let edgeCount = 0;

      for (let f = 0; f < numFaces; f++) {
        const v0 = faces[f * 3 + 0];
        const v1 = faces[f * 3 + 1];
        const v2 = faces[f * 3 + 2];

        const u0 = uvs[v0 * 2 + 0], v0_uv = uvs[v0 * 2 + 1];
        const u1 = uvs[v1 * 2 + 0], v1_uv = uvs[v1 * 2 + 1];
        const u2 = uvs[v2 * 2 + 0], v2_uv = uvs[v2 * 2 + 1];

        centroids[f] = [(u0 + u1 + u2) / 3, (v0_uv + v1_uv + v2_uv) / 3];

        totalEdgeLen += Math.hypot(u1 - u0, v1_uv - v0_uv);
        totalEdgeLen += Math.hypot(u2 - u1, v2_uv - v1_uv);
        totalEdgeLen += Math.hypot(u0 - u2, v0_uv - v2_uv);
        edgeCount += 3;
      }

      const avgEdge = edgeCount > 0 ? totalEdgeLen / edgeCount : 0.1;
      const threshold = minRestDist ?? Math.max(0.01, 1.4 * avgEdge);

      for (let i = 0; i < numFaces; i++) {
        const ci = centroids[i];
        for (let j = i + 1; j < numFaces; j++) {
          const cj = centroids[j];
          const distUV = Math.hypot(ci[0] - cj[0], ci[1] - cj[1]);
          if (distUV < threshold) {
            this.isAdjacent[i * numFaces + j] = 1;
            this.isAdjacent[j * numFaces + i] = 1;
          }
        }
      }
    }
  }

  private hashCoords(i: number, j: number, k: number): number {
    return ((i * 73856093) ^ (j * 19349663) ^ (k * 83492791)) & this.mask;
  }

  /**
   * Rebuilds spatial hash with current 3D positions
   */
  build(
    positions: Float64Array | number[],
    faces: number[] | Int32Array | Uint32Array,
    numFaces: number,
    margin: number = 0.002
  ): void {
    this.head.fill(-1);
    this.entryCount = 0;

    const inv = this.invCellSize;

    for (let t = 0; t < numFaces; t++) {
      const v0 = faces[t * 3 + 0] * 3;
      const v1 = faces[t * 3 + 1] * 3;
      const v2 = faces[t * 3 + 2] * 3;

      const x0 = positions[v0 + 0], y0 = positions[v0 + 1], z0 = positions[v0 + 2];
      const x1 = positions[v1 + 0], y1 = positions[v1 + 1], z1 = positions[v1 + 2];
      const x2 = positions[v2 + 0], y2 = positions[v2 + 1], z2 = positions[v2 + 2];

      const minX = Math.min(x0, x1, x2) - margin;
      const maxX = Math.max(x0, x1, x2) + margin;
      const minY = Math.min(y0, y1, y2) - margin;
      const maxY = Math.max(y0, y1, y2) + margin;
      const minZ = Math.min(z0, z1, z2) - margin;
      const maxZ = Math.max(z0, z1, z2) + margin;

      const iMin = Math.floor(minX * inv);
      const iMax = Math.floor(maxX * inv);
      const jMin = Math.floor(minY * inv);
      const jMax = Math.floor(maxY * inv);
      const kMin = Math.floor(minZ * inv);
      const kMax = Math.floor(maxZ * inv);

      for (let i = iMin; i <= iMax; i++) {
        for (let j = jMin; j <= jMax; j++) {
          for (let k = kMin; k <= kMax; k++) {
            if (this.entryCount >= this.maxEntries) return; // safety clamp
            const bucket = this.hashCoords(i, j, k);
            const idx = this.entryCount++;
            this.triangleId[idx] = t;
            this.next[idx] = this.head[bucket];
            this.head[bucket] = idx;
          }
        }
      }
    }
  }

  /**
   * Queries candidate non-adjacent triangle pairs (A < B) with zero allocation
   */
  queryCandidatePairs(): [number, number][] {
    this.queryStamp++;
    if (this.queryStamp > 2000000000) {
      this.pairStamp.fill(0);
      this.queryStamp = 1;
    }
    const stamp = this.queryStamp;
    const nF = this.numFaces;
    const isAdj = this.isAdjacent;
    const stamps = this.pairStamp;

    let pairCount = 0;

    for (let b = 0; b < this.numBuckets; b++) {
      let idx1 = this.head[b];
      while (idx1 !== -1) {
        const t1 = this.triangleId[idx1];
        let idx2 = this.next[idx1];
        while (idx2 !== -1) {
          const t2 = this.triangleId[idx2];
          if (t1 !== t2) {
            const minT = t1 < t2 ? t1 : t2;
            const maxT = t1 < t2 ? t2 : t1;
            const pairIdx = minT * nF + maxT;

            if (isAdj[pairIdx] === 0 && stamps[pairIdx] !== stamp) {
              stamps[pairIdx] = stamp;
              if (pairCount >= this.candidatePairs.length) {
                this.candidatePairs.push([minT, maxT]);
              } else {
                const pair = this.candidatePairs[pairCount];
                pair[0] = minT;
                pair[1] = maxT;
              }
              pairCount++;
            }
          }
          idx2 = this.next[idx2];
        }
        idx1 = this.next[idx1];
      }
    }

    this.candidatePairs.length = pairCount;
    return this.candidatePairs;
  }
}
