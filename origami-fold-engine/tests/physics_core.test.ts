import { describe, expect, it } from 'vitest';
import { createHalfFoldPattern, createSquareSheet } from '../../src/engine/fold';
import { createMeshFromFold } from '../../src/engine/mesh';
import {
  BarHingeSolver,
  computeDihedralAngle,
  computeMaxBarStrain,
  assertFinite,
} from '../../src/engine/physics';

describe('Phase 3: Bar-and-Hinge Mechanical Physics Core', () => {
  it('single hinge valley fold reaches 90° target within 1° and strain < 0.1%', () => {
    const fold = createHalfFoldPattern(1, 1);
    const mesh = createMeshFromFold(fold, {
      axialStiffness: 20000,
      creaseStiffness: 5.0,
      facetStiffness: 100.0,
    });

    const valleyHinge = mesh.hinges.find((h) => h.assignment === 'V')!;
    expect(valleyHinge).toBeDefined();

    // Set restAngle to 90 degrees (pi / 2 rad)
    valleyHinge.restAngle = Math.PI / 2;

    // Pin the crease axis vertices [1, 4] so the paper hinges in place
    const fixed = new Set<number>([1, 4]);
    const solver = new BarHingeSolver(mesh, {
      dt: 0.004,
      damping: 0.94,
      fixedVertices: fixed,
    });

    solver.applySeedPerturbation(1e-4);

    const result = solver.solveToEquilibrium(1500, 1e-5);
    expect(result.converged).toBe(true);
    assertFinite(mesh);

    // 1. Verify final dihedral angle within 1 degree of 90 degrees
    const finalAngleRad = computeDihedralAngle(valleyHinge, mesh.positions);
    const finalAngleDeg = (finalAngleRad * 180) / Math.PI;

    expect(Math.abs(finalAngleDeg - 90)).toBeLessThan(1.0);

    // 2. Verify maximum bar strain < 0.1% (0.001)
    const maxStrain = computeMaxBarStrain(mesh.bars, mesh.positions);
    expect(maxStrain).toBeLessThan(0.001);

    console.log(
      `✓ Valley Fold 90° Test: Final Angle = ${finalAngleDeg.toFixed(2)}° (Target: 90°), Max Strain = ${(maxStrain * 100).toFixed(4)}% in ${result.iterations} steps`
    );
  });

  it('facet torsion springs resist out-of-plane bending and preserve flatness', () => {
    const square = createSquareSheet(1, 1);
    // Square triangulated into 2 triangles with 1 diagonal facet hinge
    const mesh = createMeshFromFold(square, {
      axialStiffness: 10000,
      creaseStiffness: 1.0,
      facetStiffness: 80.0,
    });

    const facetHinge = mesh.hinges[0];
    expect(facetHinge.assignment).toBe('F');
    expect(facetHinge.restAngle).toBe(0);

    // Pin diagonal vertices (0 and 2)
    const solver = new BarHingeSolver(mesh, {
      dt: 0.005,
      damping: 0.92,
      fixedVertices: new Set<number>([0, 2]),
    });

    // Apply an external out-of-plane perturbation force on vertex 1
    mesh.positions[1 * 3 + 2] = 0.05; // 5% out-of-plane displacement

    const result = solver.solveToEquilibrium(400, 1e-6);
    expect(result.converged).toBe(true);
    assertFinite(mesh);

    // Verify facet hinge snapped back flat (dihedral angle < 1 degree)
    const finalAngleRad = computeDihedralAngle(facetHinge, mesh.positions);
    const finalAngleDeg = (finalAngleRad * 180) / Math.PI;

    expect(Math.abs(finalAngleDeg)).toBeLessThan(1.0);
  });

  it('dissipates kinetic energy toward static equilibrium under viscous damping', () => {
    const fold = createHalfFoldPattern(1, 1);
    const mesh = createMeshFromFold(fold, { creaseStiffness: 5.0 });

    const valleyHinge = mesh.hinges.find((h) => h.assignment === 'V')!;
    valleyHinge.restAngle = Math.PI / 3; // 60 degrees

    const solver = new BarHingeSolver(mesh, {
      dt: 0.004,
      damping: 0.92,
      fixedVertices: new Set<number>([1, 4]),
    });
    solver.applySeedPerturbation(1e-4);

    const result = solver.solveToEquilibrium(1200, 1e-4);
    expect(result.converged).toBe(true);
    assertFinite(mesh);
    expect(solver.getKineticEnergy()).toBeLessThan(1e-4);
  });

  // Amendment D: Early Performance Benchmark
  it('Amendment D: benchmarks solver ms/step and reports max vertex count at 60 fps', () => {
    const testCases = [
      { name: 'Small Mesh (Half Fold)', fold: createHalfFoldPattern(1, 1), targetEdgeLength: 0 },
      { name: 'Medium Mesh (Remeshed 0.25)', fold: createSquareSheet(1, 1), targetEdgeLength: 0.25 },
      { name: 'Dense Mesh (Remeshed 0.1)', fold: createSquareSheet(1, 1), targetEdgeLength: 0.1 },
      { name: 'High-Density Mesh (Remeshed 0.05)', fold: createSquareSheet(1, 1), targetEdgeLength: 0.05 },
    ];

    console.log('\n============================================================');
    console.log('       AMENDMENT D: SOLVER PERFORMANCE BENCHMARK            ');
    console.log('============================================================');

    const numBenchmarkSteps = 200;
    const targetFrameBudgetMs = 16.667; // 60 fps budget

    for (const tc of testCases) {
      const mesh = createMeshFromFold(tc.fold, {
        targetEdgeLength: tc.targetEdgeLength,
        axialStiffness: 10000,
        creaseStiffness: 1.0,
        facetStiffness: 50.0,
      });

      const solver = new BarHingeSolver(mesh, { dt: 0.005, damping: 0.95 });

      // Warm-up run
      for (let i = 0; i < 20; i++) solver.step();

      // Timed run
      const startTime = performance.now();
      for (let i = 0; i < numBenchmarkSteps; i++) {
        solver.step();
      }
      const totalTimeMs = performance.now() - startTime;
      const msPerStep = totalTimeMs / numBenchmarkSteps;
      const stepsPerFrame60 = Math.floor(targetFrameBudgetMs / msPerStep);

      assertFinite(mesh);

      console.log(
        `${tc.name.padEnd(35)} | Vertices: ${String(mesh.numVertices).padStart(4)} | Triangles: ${String(mesh.numTriangles).padStart(4)} | ` +
        `ms/step: ${msPerStep.toFixed(4)} ms | Substeps @ 60fps: ${stepsPerFrame60}`
      );

      // Verify solver is sub-millisecond for normal interactive meshes
      if (mesh.numVertices <= 121) {
        expect(msPerStep).toBeLessThan(2.0); // Sub-2ms per step
      }
    }
    console.log('============================================================\n');
  });
});
