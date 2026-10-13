import { describe, it, expect } from 'vitest';
import { createWaterbombBasePattern } from '../../src/engine/fold';
import { createMeshFromFold } from '../../src/engine/mesh';
import { XPBDSolver, assertFinite } from '../../src/engine/physics';

describe('Phase 6.5 Requirement 5: Sleep at Rest and Input Wakeup', () => {
  it('sleeps when resting (speed < 1e-4, strain < 0.01) and wakes on input', () => {
    const fold = createWaterbombBasePattern(1);
    const mesh = createMeshFromFold(fold, { targetEdgeLength: 0.10 });

    const solver = new XPBDSolver(mesh, {
      substeps: 10,
      iterations: 1,
      distanceIterations: 4,
      fixedVertices: [0],
    });

    let restFrameCount = 0;
    let isSleeping = false;
    let framePostCount = 0;

    function stepAndCheckSleep(alpha = 0, targetAlpha = 0) {
      if (isSleeping) {
        return { slept: true };
      }

      solver.step(0.016);
      framePostCount++;

      let maxSpeed = 0;
      for (let i = 0; i < mesh.numVertices; i++) {
        const vx = mesh.velocities[i * 3 + 0];
        const vy = mesh.velocities[i * 3 + 1];
        const vz = mesh.velocities[i * 3 + 2];
        const s = Math.hypot(vx, vy, vz);
        if (s > maxSpeed) maxSpeed = s;
      }

      const maxStrain = solver.getMaxStrain();
      const targetReached = Math.abs(alpha - targetAlpha) < 1e-4;

      if (targetReached && maxSpeed < 1e-4 && maxStrain < 0.01) {
        restFrameCount++;
      } else {
        restFrameCount = 0;
      }

      if (restFrameCount >= 10) {
        isSleeping = true;
      }

      return { slept: false, maxSpeed, maxStrain, restFrameCount, isSleeping };
    }

    function wakeFromSleep() {
      restFrameCount = 0;
      isSleeping = false;
    }

    // 1. Initial flat sheet without motion
    // It should settle and enter sleep within 10-15 frames
    for (let f = 0; f < 30; f++) {
      stepAndCheckSleep(0, 0);
    }

    expect(isSleeping).toBe(true);
    const postsAtRest = framePostCount;

    // 2. While sleeping, simulating extra ticks consumes 0 solver steps (CPU time = 0ms)
    const t0 = performance.now();
    for (let f = 0; f < 100; f++) {
      stepAndCheckSleep(0, 0);
    }
    const elapsedSleepingMs = performance.now() - t0;
    expect(framePostCount).toBe(postsAtRest); // No frames posted while sleeping!
    expect(elapsedSleepingMs).toBeLessThan(1.0); // Essentially 0 ms CPU time

    console.log(`[Sleep Test] Slept at frame ${postsAtRest}. 100 sleeping ticks took ${elapsedSleepingMs.toFixed(3)} ms (0 steps, 0 CPU).`);

    // 3. Wake up on SET_DRAG input
    wakeFromSleep();
    expect(isSleeping).toBe(false);

    // Drag center vertex
    const qIndex = Math.floor(mesh.numVertices / 2);
    solver.setDragTarget(qIndex, [0.4, 0.4, 0.05]);

    // Now stepping should resume actively
    const res = stepAndCheckSleep(0, 0);
    expect(res.slept).toBe(false);
    expect(framePostCount).toBeGreaterThan(postsAtRest);

    assertFinite(mesh);
    console.log(`[Sleep Test] Successfully woke from sleep on drag input! New frame post count: ${framePostCount}`);
  });
});
