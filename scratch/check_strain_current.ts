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

// Build 2-ring topological adjacency in solver
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

const strain = solver.getMaxStrain() * 100;
const isect = solver.checkSelfIntersections();
console.log(`Strain with current spatial hash: ${strain.toFixed(4)}%, Möller intersections: ${isect.intersectionCount}`);
