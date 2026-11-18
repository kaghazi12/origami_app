import { createSquareSheet } from '../src/engine/fold';
import { createMeshFromFold, splitMeshAlongPolylines } from '../src/engine/mesh';
import { XPBDSolver, assertFinite } from '../src/engine/physics';

const baseFold = createSquareSheet(1, 1);
const mesh = createMeshFromFold(baseFold, { targetEdgeLength: 0.05 }); // 441V
const thickness = 0.002;

const splitMesh = splitMeshAlongPolylines(
  mesh,
  [[[0.5, 0.0], [0.5, 1.0]]],
  { assignment: 'V', targetAngleDeg: 180, creaseStiffness: 1000 }
);

const basePins = new Set<number>();
for (let i = 0; i < splitMesh.numVertices; i++) {
  if (splitMesh.uvs[i * 2 + 0] <= 0.45) {
    basePins.add(i);
  }
}

const solver = new XPBDSolver(splitMesh, {
  substeps: 15,
  iterations: 1,
  distanceIterations: 4,
  fixedVertices: basePins,
  enableTable: true,
  tableZ: 0.0,
  paperThickness: thickness,
  enableGravity: true,
  gravity: 2.0,
  muStatic: 0.4,
  muKinetic: 0.3,
  bendingCompliance: 0.001,
  enableSelfCollision: true,
  velocityDamping: 0.98,
});

const vHinges = splitMesh.hinges.filter((h: any) => h.assignment === 'V');
for (let f = 0; f < 10; f++) {
  const alpha = Math.min(1.0, (f + 1) / 5);
  for (const h of vHinges) h.restAngle = alpha * Math.PI;
  solver.step(0.016);
  assertFinite(splitMesh);
}

// Inspect bars with highest strain
const barStrains: { barIdx: number; strain: number; v0: number; v1: number; restLen: number; curLen: number; uv0: [number, number]; uv1: [number, number] }[] = [];
for (let b = 0; b < splitMesh.bars.length; b++) {
  const bar = splitMesh.bars[b];
  const p0 = bar.v0 * 3, p1 = bar.v1 * 3;
  const dx = splitMesh.positions[p0 + 0] - splitMesh.positions[p1 + 0];
  const dy = splitMesh.positions[p0 + 1] - splitMesh.positions[p1 + 1];
  const dz = splitMesh.positions[p0 + 2] - splitMesh.positions[p1 + 2];
  const curLen = Math.hypot(dx, dy, dz);
  const s = Math.abs(curLen - bar.restLength) / bar.restLength;
  barStrains.push({
    barIdx: b,
    strain: s,
    v0: bar.v0,
    v1: bar.v1,
    restLen: bar.restLength,
    curLen,
    uv0: [splitMesh.uvs[bar.v0 * 2 + 0], splitMesh.uvs[bar.v0 * 2 + 1]],
    uv1: [splitMesh.uvs[bar.v1 * 2 + 0], splitMesh.uvs[bar.v1 * 2 + 1]],
  });
}

barStrains.sort((a, b) => b.strain - a.strain);

console.log('Top 10 strained bars:');
for (let i = 0; i < 10; i++) {
  const b = barStrains[i];
  console.log(`Bar ${b.barIdx}: strain=${(b.strain * 100).toFixed(4)}%, v0=${b.v0} uv0=(${b.uv0[0].toFixed(3)}, ${b.uv0[1].toFixed(3)}), v1=${b.v1} uv1=(${b.uv1[0].toFixed(3)}, ${b.uv1[1].toFixed(3)}), restLen=${b.restLen.toFixed(5)}, curLen=${b.curLen.toFixed(5)}`);
}
