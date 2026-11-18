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

for (const dIter of [4, 6, 8, 10]) {
  const testMesh = JSON.parse(JSON.stringify(splitMesh));
  // Reconstruct Float64Arrays
  testMesh.positions = new Float64Array(splitMesh.positions);
  testMesh.velocities = new Float64Array(splitMesh.velocities);
  testMesh.masses = new Float64Array(splitMesh.masses);
  testMesh.uvs = new Float64Array(splitMesh.uvs);
  testMesh.indices = new Int32Array(splitMesh.indices);

  const solver = new XPBDSolver(testMesh, {
    substeps: 15,
    iterations: 1,
    distanceIterations: dIter,
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

  const vHinges = testMesh.hinges.filter((h: any) => h.assignment === 'V');
  const t0 = performance.now();
  for (let f = 0; f < 10; f++) {
    const alpha = Math.min(1.0, (f + 1) / 5);
    for (const h of vHinges) h.restAngle = alpha * Math.PI;
    solver.step(0.016);
    assertFinite(testMesh);
  }
  const elapsed = performance.now() - t0;
  const strain = solver.getMaxStrain() * 100;
  console.log(`dIter=${dIter}: strain=${strain.toFixed(4)}%, time=${elapsed.toFixed(1)} ms, ms/frame=${(elapsed/10).toFixed(2)} ms`);
}
