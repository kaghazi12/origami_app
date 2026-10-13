import { TriMesh } from '../types';

/**
 * Validates that all physical state vectors in a TriMesh (positions, velocities,
 * masses, hinge rest angles, and bar rest lengths) are strictly finite numbers (not NaN, Infinity, or -Infinity).
 * 
 * Throws a descriptive Error if any non-finite component is encountered.
 */
export function assertFinite(mesh: TriMesh): void {
  const numV = mesh.numVertices;
  const pos = mesh.positions;
  const vel = mesh.velocities;
  const masses = mesh.masses;

  // 1. Verify vertex coordinates
  for (let i = 0; i < numV * 3; i++) {
    const val = pos[i];
    if (typeof val !== 'number' || Number.isNaN(val) || !Number.isFinite(val)) {
      const vIdx = Math.floor(i / 3);
      const comp = i % 3 === 0 ? 'X' : i % 3 === 1 ? 'Y' : 'Z';
      throw new Error(`assertFinite failed: Non-finite position at vertex ${vIdx} (${comp}): ${val}`);
    }
  }

  // 2. Verify vertex velocities
  for (let i = 0; i < numV * 3; i++) {
    const val = vel[i];
    if (typeof val !== 'number' || Number.isNaN(val) || !Number.isFinite(val)) {
      const vIdx = Math.floor(i / 3);
      const comp = i % 3 === 0 ? 'X' : i % 3 === 1 ? 'Y' : 'Z';
      throw new Error(`assertFinite failed: Non-finite velocity at vertex ${vIdx} (${comp}): ${val}`);
    }
  }

  // 3. Verify nodal masses
  for (let i = 0; i < numV; i++) {
    const m = masses[i];
    if (typeof m !== 'number' || Number.isNaN(m) || !Number.isFinite(m) || m <= 0) {
      throw new Error(`assertFinite failed: Non-finite or non-positive mass at vertex ${i}: ${m}`);
    }
  }

  // 4. Verify hinge properties and rest angles
  for (let i = 0; i < mesh.hinges.length; i++) {
    const h = mesh.hinges[i];
    if (typeof h.restAngle !== 'number' || Number.isNaN(h.restAngle) || !Number.isFinite(h.restAngle)) {
      throw new Error(`assertFinite failed: Non-finite restAngle on hinge ${i}: ${h.restAngle}`);
    }
    if (typeof h.stiffness !== 'number' || Number.isNaN(h.stiffness) || !Number.isFinite(h.stiffness)) {
      throw new Error(`assertFinite failed: Non-finite stiffness on hinge ${i}: ${h.stiffness}`);
    }
  }

  // 5. Verify bar properties
  for (let i = 0; i < mesh.bars.length; i++) {
    const b = mesh.bars[i];
    if (typeof b.restLength !== 'number' || Number.isNaN(b.restLength) || !Number.isFinite(b.restLength) || b.restLength <= 0) {
      throw new Error(`assertFinite failed: Non-finite or non-positive restLength on bar ${i}: ${b.restLength}`);
    }
    if (typeof b.stiffness !== 'number' || Number.isNaN(b.stiffness) || !Number.isFinite(b.stiffness)) {
      throw new Error(`assertFinite failed: Non-finite stiffness on bar ${i}: ${b.stiffness}`);
    }
  }
}

/**
 * Returns true if all physical states in the mesh are finite, false otherwise.
 */
export function isMeshFinite(mesh: TriMesh): boolean {
  try {
    assertFinite(mesh);
    return true;
  } catch {
    return false;
  }
}
