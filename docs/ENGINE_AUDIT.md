# Origami Fold Engine: Comprehensive Audit & Target Architecture

**Date:** October 11, 2026  
**Status:** Audit & Target Specification (Pre-Implementation)  
**Scope:** `origami_app_ag` Engine, Model Representation, Physics Simulation, Reference Evaluation, Phased Migration Plan

---

## Executive Summary

The existing origami engine in this repository is **not a physical origami folding simulator**. Instead, it is a **2D geometric polygon clipper** that slices flat convex polygons with lines on a table and applies rigid 4x4 matrix rotations to the sliced pieces.

Because real origami folding (such as preliminary bases, waterbomb bases, squash folds, and cranes) requires continuous non-planar surface deformation and simultaneous multi-crease hinge movement, the current architecture was unable to simulate them. Consequently, past iterations **faked** complex folds by hardcoding artificial sequential 2D cuts, inventing arbitrary internal face IDs (e.g., `f0.r.r.l`), and writing tests that verified shoelace polygon area preservation on disconnected polygons rather than physical origami kinematics.

This document presents:
1. **Full Audit:** How folds are currently represented, what is hardcoded/preset, what can be salvaged, and what must be discarded.
2. **Target Architecture:** A true bar-and-hinge simulation engine based on the standardized FOLD format (Demaine et al.), dynamic relaxation / mechanical springs, and clean separation between a headless pure TypeScript engine (`src/engine/`) and the React/Three.js rendering layer.
3. **Reference & Dependency Analysis:** Evaluation of Amanda Ghassaei's *Origami Simulator* and Robby Kraft's *Rabbit Ear* regarding architecture, licensing (MIT vs. GPLv3), and bundle size.
4. **Feasibility, Approximations, and Physical Realities:** Frank assessment of rigid vs. non-rigid foldability, flat-fold singularities, bifurcations, and collision limits.
5. **Phased Implementation Plan:** 6 actionable phases, each equipped with concrete unit and integration acceptance tests.

---

## 1. Audit of the Existing Fold Engine & Past Changes

### 1.1 How Folds are Currently Represented

The current engine lives in `origami-fold-engine/src/` and is re-exported via `src/engine/index.ts`. Its operational mechanics are:

1. **Polygon Slicing (`origami-fold-engine/src/split.ts`):**
   - The paper begins as a single convex rectangular face (`f0`) on the $z=0$ plane.
   - For every fold step, a 2D crease line `from -> to` is defined in table coordinates.
   - Every face crossed by the line is clipped into two independent convex polygons using the Sutherland-Hodgman clipping algorithm (`splitConvexPolygon`).
   - Face IDs are generated via string suffix concatenation: `f0.l` and `f0.r`.
2. **Rigid Body Rotation (`origami-fold-engine/src/engine.ts`):**
   - Faces identified as being on the "moving" side are rotated around the 3D axis `[p0, p1, 0]` by a single angle (default $180^\circ$) using a 4x4 matrix (`mat4RotateAboutLine`).
   - If the fold is flat ($180^\circ$), all faces are projected back to a flat plane with an artificial z-offset (`matrix[14] = layer * layerGap`) to prevent visual z-fighting.
3. **Discrete Animation Interpolation (`poseAt(progress)`):**
   - The scrubber progress $\alpha$ is mapped to a discrete step index $k = \lfloor \alpha \rfloor$ and intra-step parameter $t = \alpha - k$.
   - The moving faces for step $k$ interpolate their rotation matrix around the crease line from $0$ to $\theta$.
4. **Custom Schema (`origami-fold-engine/src/types.ts`):**
   - Uses a non-standard JSON format:
     ```ts
     interface FoldStep {
       title: string;
       hint?: string;
       crease?: { from: Vec2; to: Vec2 };
       moving?: 'left' | 'right';
       kind: 'valley' | 'mountain' | 'unfold';
       select?: { faces: string[] }; // Hardcoded internal face IDs!
       angle?: number;
     }
     ```

### 1.2 What is Hardcoded and Preset

Past changes attempted to satisfy user requests for advanced folds ("preliminary fold", "squash fold", "crane") without having a physical simulation engine capable of non-planar folding. This resulted in several critical hardcoded workarounds:

* **Fake Preliminary Base (`src/models/presets.ts` - `PRELIMINARY_FOLD_MODEL`):**
  - Real preliminary base folding requires simultaneous 3D collapse along 4 intersecting creases (horizontal, vertical, diagonal).
  - The current model fakes this by:
    1. Folding in half vertically.
    2. Folding in half horizontally (now a quarter square).
    3. Folding diagonally in half.
    4. Slicing and rotating hardcoded internal face strings across the diagonal:
       `select: { faces: ['f0.r.r.l', 'f0.l.r.l', 'f0.l.l.l', 'f0.r.l.l'] }`.
* **Fake Squash Fold (`src/models/presets.ts` - `SQUASH_FOLD_MODEL`):**
  - A real squash fold opens a 3D flap and presses it flat symmetrically into a kite.
  - The current model creates two 180° flat folds along angle bisectors on specific hardcoded faces:
    `select: { faces: ['f0.r.r.r'] }` and `select: { faces: ['f0.r.r.l'] }`.
* **Hardcoded UI Logic (`src/components/AuthoringTool.tsx`):**
  - In `handleSquashPreset`, the authoring suite directly checks internal face IDs:
    ```ts
    const hasRightFlap = flatFaces.some((f) => f.id === 'f0.r.r.r');
    const hasLeftFlap = flatFaces.some((f) => f.id === 'f0.r.r.l');
    ```
    If these exact generated string IDs are not present, the preset fails.
* **Fake Origami Crane (`src/models/crane.ts` - `CRANE_MODEL`):**
  - A real crane requires a square base $\to$ bird base (petal folds) $\to$ inside reverse folds for neck and tail.
  - `CRANE_MODEL` defines 7 arbitrary straight cuts across a flat sheet, referencing `select: { faces: ['f0.r.l'] }`. It does not resemble a traditional crane structurally, geometrically, or topologically.
* **Misleading Test Suites (`origami-fold-engine/tests/`):**
  - `squash.test.ts` and `squash_deep.test.ts` assert that the sum of polygon areas equals 1.0 (paper conservation) and that corners land at $(0.85355, 0.85355)$, printing:
    `✓ All physical origami checks passed: Area = 1.0, Perfect Symmetrical Kite`.
  - In reality, these tests only prove that flat 2D polygons can be split and rotated rigidly without losing mathematical area. They do not test 3D physical folding.

### 1.3 What is Reusable

* **Pure Math Utilities (`origami-fold-engine/src/math.ts`):**
  - Vector types (`Vec2`, `Vec3`), matrix operations (`Mat4`, `mat4Mul`, `mat4RotateAboutLine`), and vector projections. Clean, self-contained, and completely free of Three.js or DOM imports.
* **Vitest Test Infrastructure:**
  - Fast, headless test setup using Vitest running in `origami-fold-engine/`.
* **React 19 / R3F Viewing Shell:**
  - `OrigamiCanvas.tsx`: Three.js Canvas setup, TrackballControls, studio lighting.
  - `PaperShaderMaterial.ts`: Two-sided paper shader (different colors/textures for front and back washi/kami paper, custom lighting response).
  - Header, theme selection, and scrubber UI layouts.

### 1.4 What Must Be Thrown Away

1. **`origami-fold-engine/src/split.ts`:**
   - Polygon splitting with Sutherland-Hodgman clipping must be discarded. Folding paper does not sever the sheet into disconnected convex polygons.
2. **Proprietary Step Schema (`types.ts`, `model.ts`):**
   - The sequential `{ crease, moving, kind, select }` step schema must be replaced with the standard **FOLD format**.
3. **Hardcoded Presets & Models (`src/models/presets.ts`, `src/models/crane.ts`):**
   - All 8 hardcoded models and the pseudo-crane must be removed.
4. **Hardcoded Authoring Helpers (`AuthoringTool.tsx`):**
   - Remove `handleSquashPreset` and face ID lookups.
5. **Ad-hoc Extruded Prism Geometry (`PaperMesh.tsx`):**
   - Currently, `PaperMesh.tsx` generates separate prism meshes for each independent face polygon with custom local matrices. This must be replaced with a single continuous triangulated buffer geometry driven by vertex position arrays.
6. **False-Positive Tests:**
   - Remove `tests/squash_deep.test.ts`, `tests/squash.test.ts`, and `tests/preliminary.test.ts`.

---

## 2. Target Architecture

### 2.1 Design Principles & System Boundaries

```
┌────────────────────────────────────────────────────────────────────────┐
│                          React / UI Layer                              │
│                                                                        │
│   ┌────────────────────┐   ┌───────────────────┐   ┌───────────────┐   │
│   │ 3D Viewport (R3F)  │   │  2D CP Editor     │   │ Scrubber / UI │   │
│   │  OrigamiCanvas     │   │  Crease Canvas    │   │ Fold Angle    │   │
│   └─────────┬──────────┘   └─────────┬─────────┘   └───────┬───────┘   │
└─────────────┼────────────────────────┼─────────────────────┼───────────┘
              │ Direct Buffer Transfer │ FOLD mutation       │ Fold Progress
              ▼                        ▼                     ▼
┌────────────────────────────────────────────────────────────────────────┐
│           Engine Boundary (Pure TypeScript - src/engine/)              │
│                 No React, No Three.js, No DOM imports                  │
│                                                                        │
│   ┌────────────────────────────────────────────────────────────────┐   │
│   │ Crease Pattern Model (FOLD 1.1 Specification)                  │   │
│   │ Single Source of Truth: vertices_coords, edges_vertices,       │   │
│   │ edges_assignment ('B','M','V','F'), edges_foldAngle            │   │
│   └──────────────────────────────┬─────────────────────────────────┘   │
│                                  │ Triangulation                       │
│                                  ▼                                     │
│   ┌────────────────────────────────────────────────────────────────┐   │
│   │ Triangulated Mesh (Topology & Connectivity)                    │   │
│   │ Node positions [u,v,0], Triangle faces, Edge lookup            │   │
│   └──────────────────────────────┬─────────────────────────────────┘   │
│                                  │ Physics Assembly                    │
│                                  ▼                                     │
│   ┌────────────────────────────────────────────────────────────────┐   │
│   │ Bar-and-Hinge Mechanical Model                                 │   │
│   │ - Bars (Axial Springs on all edges: L0, k_axial)               │   │
│   │ - Crease Hinges (M/V edges: target angle θ(α), k_crease)       │   │
│   │ - Facet Hinges (F triangulation edges: target angle 0, k_facet)│   │
│   └──────────────────────────────┬─────────────────────────────────┘   │
│                                  │ Numerical Integration               │
│                                  ▼                                     │
│   ┌────────────────────────────────────────────────────────────────┐   │
│   │ Solver (Dynamic Relaxation / XPBD)                             │   │
│   │ Solves equations of motion / constraints to equilibrium        │   │
│   │ Output: Float32Array 3D vertex positions [x, y, z]             │   │
│   └────────────────────────────────────────────────────────────────┘   │
└────────────────────────────────────────────────────────────────────────┘
```

1. **Pure TypeScript Engine (`src/engine/`):**
   - Strictly zero dependencies on `react`, `react-dom`, `three`, `@react-three/*`, or browser DOM (`window`, `document`).
   - Runs identically in Node.js (via Vitest), in the main browser thread, and inside a Web Worker.
2. **Single Source of Truth:**
   - The 2D crease pattern represented in the standard **FOLD format** (Demaine, Ku, Kraft et al.).
   - The 3D folded shape is the mechanical equilibrium state of that crease pattern under applied fold angles.
3. **Continuous Triangulated Mesh:**
   - The paper is represented as a single continuous 2D planar graph triangulated into 3D facet elements.
   - Vertices maintain continuous coordinates; edges are shared between adjacent triangles.
4. **Zero Buffer Allocation in Render Loop:**
   - The engine produces contiguous `Float32Array` buffers for 3D vertex positions and normals.
   - The Three.js mesh simply updates `geometry.attributes.position.needsUpdate = true`.

---

### 2.2 Data Structures

#### 2.2.1 FOLD Format (Single Source of Truth)
Adheres to the official FOLD 1.1 specification:
```ts
export type EdgeAssignment = 'B' | 'M' | 'V' | 'F' | 'U';
// B: Boundary edge (perimeter of the paper)
// M: Mountain fold
// V: Valley fold
// F: Flat crease (internal facet edge or 0-angle crease)
// U: Unassigned

export interface FoldFormat {
  file_spec: 1.1;
  file_creator?: string;
  file_title?: string;
  file_classes?: string[];
  frame_classes?: string[];
  // 2D flat paper coordinates: [u, v] in [0, width] x [0, height]
  vertices_coords: [number, number][];
  // Connectivity: [v_start, v_end]
  edges_vertices: [number, number][];
  // Assignment for each edge
  edges_assignment: EdgeAssignment[];
  // Target fold angle in degrees: [-180, 180]
  // Valley is positive (+180° = fully folded flat), Mountain is negative (-180°)
  edges_foldAngle?: number[];
  // Optional polygonal face definitions
  faces_vertices?: number[][];
}
```

#### 2.2.2 Triangulated Mesh Representation
When a FOLD object has polygonal faces with $>3$ vertices, it must be triangulated:
```ts
export interface TriMesh {
  // Flat 2D initial coordinates: 2 * numVertices
  uvs: Float32Array;
  // Current 3D positions: 3 * numVertices
  positions: Float32Array;
  // Current 3D velocities: 3 * numVertices
  velocities: Float32Array;
  // Vertex masses: numVertices
  masses: Float32Array;
  // Triangle index buffer: 3 * numTriangles
  indices: Uint32Array;
  
  // Mechanical Bar elements (all edges in the triangulation)
  bars: BarElement[];
  // Mechanical Hinge elements (all internal shared edges)
  hinges: HingeElement[];
}

export interface BarElement {
  v0: number;
  v1: number;
  restLength: number;
  stiffness: number; // k_axial
}

export interface HingeElement {
  edgeIndex: number;
  v0: number; // Hinge axis start vertex
  v1: number; // Hinge axis end vertex
  v2: number; // Opposite vertex in triangle 1
  v3: number; // Opposite vertex in triangle 2
  assignment: EdgeAssignment; // 'M' | 'V' | 'F'
  targetAngle: number; // In radians: desired fold deviation from flat
  stiffness: number; // k_crease for M/V, k_facet for F
}
```

---

### 2.3 The Bar-and-Hinge Mechanical Formulation

The mechanical formulation draws from the foundational work of **Schenk & Guest (2011)** and **Ghassaei, Demaine & Gershenfeld (2018)**:

#### 1. Axial Springs (Bar Elements)
Every edge in the triangulated mesh resists stretching and compression to enforce paper incompressibility.
For edge $e = (i, j)$ with current positions $\mathbf{x}_i, \mathbf{x}_j$ and rest length $L_0$:
$$\Delta L = \|\mathbf{x}_j - \mathbf{x}_i\| - L_0$$
$$\mathbf{f}_{j,\text{axial}} = -k_{\text{axial}} \cdot \Delta L \cdot \frac{\mathbf{x}_j - \mathbf{x}_i}{\|\mathbf{x}_j - \mathbf{x}_i\|}, \quad \mathbf{f}_{i,\text{axial}} = -\mathbf{f}_{j,\text{axial}}$$
$k_{\text{axial}}$ is set high (e.g., $10^4 - 10^5$) so that edge stretch remains $< 0.1\%$.

#### 2. Crease & Facet Torsion Springs (Hinge Elements)
Every internal edge shared by two triangles $T_1 = (v_0, v_1, v_2)$ and $T_2 = (v_1, v_0, v_3)$ forms a hinge:
- The hinge axis vector is $\mathbf{e} = \mathbf{x}_1 - \mathbf{x}_0$.
- Normal of $T_1$: $\mathbf{n}_1 = \frac{(\mathbf{x}_1 - \mathbf{x}_0) \times (\mathbf{x}_2 - \mathbf{x}_0)}{\|(\mathbf{x}_1 - \mathbf{x}_0) \times (\mathbf{x}_2 - \mathbf{x}_0)\|}$
- Normal of $T_2$: $\mathbf{n}_2 = \frac{(\mathbf{x}_3 - \mathbf{x}_0) \times (\mathbf{x}_1 - \mathbf{x}_0)}{\|(\mathbf{x}_3 - \mathbf{x}_0) \times (\mathbf{x}_1 - \mathbf{x}_0)\|}$
- Dihedral fold angle $\theta \in [-\pi, \pi]$:
  $$\cos\theta = \mathbf{n}_1 \cdot \mathbf{n}_2, \quad \sin\theta = (\mathbf{n}_1 \times \mathbf{n}_2) \cdot \frac{\mathbf{e}}{\|\mathbf{e}\|}$$
  $$\theta = \text{atan2}(\sin\theta, \cos\theta)$$
  *(When flat, $\theta = 0$; valley folds yield $\theta > 0$, mountain folds yield $\theta < 0$)*.

- **Crease Springs ('M' / 'V'):**
  For a folding progress parameter $\alpha \in [0, 1]$:
  $$\theta_{\text{target}}(\alpha) = \alpha \cdot \theta_{\text{fold}}$$
  Restoring torque: $\tau = -k_{\text{crease}} (\theta - \theta_{\text{target}}(\alpha))$.
- **Facet Springs ('F'):**
  Flat triangulation edges must remain flat:
  $$\theta_{\text{target}} = 0$$
  Restoring torque: $\tau = -k_{\text{facet}} \cdot \theta$.
  **Stiffness ratio:** $k_{\text{facet}} \gg k_{\text{crease}}$ (typically $k_{\text{facet}} \ge 20 \cdot k_{\text{crease}}$). This keeps paper panels rigid while allowing creases to fold easily.

#### 3. Nodal Force Distribution (Bridson / Tamstorf Formulation)
The torsional torque $\tau$ is converted into conservative nodal forces acting on the 4 vertices ($\mathbf{x}_0, \mathbf{x}_1, \mathbf{x}_2, \mathbf{x}_3$):
$$\mathbf{f}_2 = \tau \cdot \frac{\mathbf{n}_1}{h_1}, \quad \mathbf{f}_3 = \tau \cdot \frac{\mathbf{n}_2}{h_2}$$
where $h_1$ is the height of $v_2$ relative to the hinge line $\mathbf{e}$, and $h_2$ is the height of $v_3$.
The balancing forces on the axis vertices $v_0$ and $v_1$ ensure zero net force and zero net external torque:
$$\mathbf{f}_0 = -\frac{(\mathbf{x}_1 - \mathbf{x}_2) \cdot \mathbf{e}}{\|\mathbf{e}\|^2} \mathbf{f}_2 - \frac{(\mathbf{x}_1 - \mathbf{x}_3) \cdot \mathbf{e}}{\|\mathbf{e}\|^2} \mathbf{f}_3$$
$$\mathbf{f}_1 = -\mathbf{f}_2 - \mathbf{f}_3 - \mathbf{f}_0$$

---

### 2.4 The Simulation Loop (Dynamic Relaxation)

To compute the folded shape at any fold progress $\alpha$, the engine uses **Dynamic Relaxation with adaptive viscous damping**:

```ts
class BarHingeSolver {
  step(dt: number, damping: number) {
    // 1. Reset forces
    this.forces.fill(0);

    // 2. Compute axial spring forces
    for (const bar of this.bars) {
      this.accumulateBarForce(bar);
    }

    // 3. Compute hinge torsion forces (creases + facet springs)
    for (const hinge of this.hinges) {
      this.accumulateHingeForce(hinge);
    }

    // 4. Time integration (Verlet / Euler with damping)
    for (let i = 0; i < this.numVertices; i++) {
      if (this.isFixed[i]) continue;
      
      const fx = this.forces[i * 3 + 0];
      const fy = this.forces[i * 3 + 1];
      const fz = this.forces[i * 3 + 2];
      const m = this.masses[i];

      // a = F/m - c*v
      this.velocities[i * 3 + 0] = (this.velocities[i * 3 + 0] + (fx / m) * dt) * damping;
      this.velocities[i * 3 + 1] = (this.velocities[i * 3 + 1] + (fy / m) * dt) * damping;
      this.velocities[i * 3 + 2] = (this.velocities[i * 3 + 2] + (fz / m) * dt) * damping;

      this.positions[i * 3 + 0] += this.velocities[i * 3 + 0] * dt;
      this.positions[i * 3 + 1] += this.velocities[i * 3 + 1] * dt;
      this.positions[i * 3 + 2] += this.velocities[i * 3 + 2] * dt;
    }
  }

  /** Solve until kinetic energy drops below tolerance or max iterations reached */
  solveToEquilibrium(maxIterations = 500, tol = 1e-5): boolean {
    for (let iter = 0; iter < maxIterations; iter++) {
      this.step(0.01, 0.92);
      if (this.getKineticEnergy() < tol) return true;
    }
    return false;
  }
}
```

---

### 2.5 User Interaction Pipeline

1. **Viewer Scrubber:**
   - User drags the progress scrubber $\alpha \in [0, 1]$.
   - The engine updates $\theta_{\text{target}}(\alpha) = \alpha \cdot \theta_{\text{fold}}$ for all active creases.
   - The solver executes a relaxation batch and emits updated 3D vertex positions to React/Three.js.
2. **Crease Pattern Authoring (2D):**
   - User adds or modifies an edge in the 2D crease pattern editor.
   - The engine updates the FOLD graph $\to$ runs planar constrained triangulation $\to$ builds bars and hinges.
   - Paper immediately reflects the new crease pattern.
3. **Interactive 3D Manipulation:**
   - User clicks/drags a vertex in 3D: applies an external temporary position constraint $\mathbf{x}_{\text{target}}$ during relaxation.

---

## 3. Evaluation of Open-Source References & Dependencies

We investigated two leading open-source origami libraries: **Origami Simulator (Amanda Ghassaei)** and **Rabbit Ear (Robby Kraft)**.

| Project | License | Package / Module Status | Bundle Size | Primary Focus | Recommendation |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Origami Simulator** *(Amanda Ghassaei et al.)* | **MIT License** | Monolithic WebGL web app; **NOT** published as modular npm library | N/A (WebGL/Three app) | 3D dynamic relaxation bar-and-hinge simulation on GPU | **Reference ONLY.** Mathematical formulation and FOLD integration are direct inspiration; cannot be an npm dependency. |
| **Rabbit Ear** *(Robby Kraft)* | **GNU GPLv3** | Published on npm (`rabbit-ear`), ES6/UMD | **> 500 KB** | 2D graph geometry, flat-foldability theorems, SVG rendering | **Reference ONLY.** GPLv3 creates strict copyleft hazards; bundle is excessive; does NOT provide 3D bar-and-hinge physics. |

### 3.1 Detailed Findings: Amanda Ghassaei's Origami Simulator
- **Licensing:** Released under the permissive **MIT License**.
- **Architecture:** 
  - Designed as an interactive browser application where dynamic relaxation is executed **on the GPU** via WebGL fragment shaders (`Simulation.js` using Three.js `GPUComputationRenderer`).
  - Vertices and normals are stored in floating-point textures.
- **Why it cannot be an npm dependency:**
  - It is not packaged as a reusable headless library.
  - Tightly coupled to WebGL contexts, GLSL shaders, and Three.js scene graphs.
  - Importing it into `src/engine/` would directly violate the core project requirement: *"The fold engine must live in a pure TypeScript module (src/engine/) with NO React or three.js imports, so it is unit-testable with Vitest and can run in a Web Worker."*
- **Role in our project:**
  - **Invaluable conceptual and mathematical reference**. The formulas for dihedral angle gradients, dynamic relaxation damping, and FOLD mesh extraction will be implemented in pure TypeScript for CPU/Web Worker execution.

### 3.2 Detailed Findings: Rabbit Ear (`rabbit-ear.js`)
- **Licensing:** Released under the **GNU General Public License v3 (GPLv3)**.
  - **CRITICAL LEGAL NOTICE:** GPLv3 is a strong copyleft license. If `rabbit-ear` is imported as a runtime dependency, the entire application, including the user interface and downstream proprietary usage, is legally required to be open-sourced under GPLv3.
- **Bundle Size:** Over **500 KB** minified.
- **Feature Set:**
  - Focuses on 2D crease pattern math: flat-foldability validation (Kawasaki's Theorem, Maekawa's Theorem), planar graph manipulation, and SVG crease pattern visualization.
  - Does **not** include a 3D bar-and-hinge physics simulator or dynamic relaxation engine.
- **Role in our project:**
  - **Do NOT install as a dependency.**
  - We will implement a lightweight (~10 KB), zero-dependency, MIT-compatible FOLD parser and triangulator directly within `src/engine/`.

---

## 4. Feasibility, Approximations, and Physical Limitations

In accordance with the instruction: *"Do not claim something works unless a test or a demo proves it. If something is infeasible or only approximate, say so in your report."*

| Physical / Numerical Phenomenon | Real Origami Behavior | Bar-and-Hinge Simulation Behavior | Feasibility & Handling |
| :--- | :--- | :--- | :--- |
| **Non-Rigid Foldability** | Paper buckles and bends smoothly across panels during folding. | Triangular facets stay rigid if $k_{\text{facet}} = \infty$. If too rigid, the model **locks up** and cannot fold. | **Approximate.** Facets must have finite bending stiffness $k_{\text{facet}}$ along triangulation diagonals to allow necessary elastic buckling during folding. |
| **Flat-Folded Singularity ($\theta \to \pm 180^\circ$)** | Layers stack with microscopic finite paper thickness ($0.1\text{mm}$). | At $\theta = \pm 180^\circ$, triangle normals become opposing or co-linear, causing mathematical singularities and zero-volume intersections. | **Infeasible at pure $180^\circ$.** Fold progress $\alpha$ must clamp to $\approx 95\% - 98\%$ (e.g. $170^\circ - 175^\circ$), or use layer offset heuristics. |
| **Flat Bifurcation / Deadlock** | Human fingers push corners out-of-plane to initiate 3D buckling. | If a crease pattern starts perfectly flat ($z=0$), all dihedral angle forces lie in the $z=0$ plane! There is no out-of-plane force. | **Requires Seed Perturbation.** To initiate folding from a flat sheet, vertices must receive a microscopic out-of-plane perturbation ($\epsilon \sim 10^{-4}$) directed along crease signs. |
| **Global Self-Intersection** | Paper sheets cannot pass through each other. | Springs only enforce local edge lengths and hinge angles. Disconnected flaps will freely pass through each other. | **Full CCD is Infeasible on CPU; Penalty Repulsion is Feasible.** Full continuous collision detection across all triangles on CPU is $O(N^2)$ and too slow. We provide local vertex-triangle penalty repulsion for adjacent layers. |
| **CPU Performance vs. Mesh Size** | Paper is a continuous continuum. | Solved via explicit discrete time steps on CPU. | **Bounded Mesh Density.** Small to medium patterns (up to $\approx 300 - 500$ vertices) run smoothly at $\ge 60$ FPS on CPU/Worker. High-density meshes (>2,000 vertices) require GPU compute. |

---

## 5. Phased Implementation Plan & Acceptance Tests

### Phase 1: Engine Foundation & FOLD 1.1 Specification
**Goal:** Create a pure TypeScript FOLD parser, validator, and data structures in `src/engine/fold/` with zero external dependencies.

* **Components to Implement:**
  - `src/engine/types.ts`: FOLD 1.1 interfaces, edge assignments, mesh data types.
  - `src/engine/fold/parse.ts`: Validates untrusted JSON into typed `FoldFormat`.
  - `src/engine/fold/serialize.ts`: Exports `FoldFormat` back to JSON.
  - `src/engine/fold/validate.ts`: Validates topology (vertex index ranges, edge uniqueness, non-zero edge lengths).
* **Acceptance Tests (`tests/fold_spec.test.ts`):**
  1. `test_parse_valid_fold`: Correctly parses a standard square sheet FOLD file with 'B', 'M', 'V', 'F' edges.
  2. `test_reject_malformed_fold`: Rejects out-of-bounds vertex indices, missing fields, or degenerate edges with descriptive errors.
  3. `test_roundtrip_serialization`: `parse(serialize(model))` preserves all coordinates, assignments, and angles without numerical drift.
  4. `test_no_browser_imports`: Verifies no references to `window`, `document`, `THREE`, or `react` exist in the module.

---

### Phase 2: Crease Pattern Triangulation & Mesh Assembly
**Goal:** Transform arbitrary FOLD polygonal faces into a continuous triangulated mesh preserving all crease lines as internal edges.

* **Components to Implement:**
  - `src/engine/mesh/triangulate.ts`: Constrained triangulation for polygonal faces (convex fan or ear-clipping) adding 'F' assignment to virtual diagonals.
  - `src/engine/mesh/topology.ts`: Half-edge or winged-edge lookup extracting every shared edge into a `HingeElement` with its 4 constituent vertices $(v_0, v_1, v_2, v_3)$.
  - `src/engine/mesh/mesh.ts`: Assembly into `TriMesh` with flat initial positions and rest lengths.
* **Acceptance Tests (`tests/mesh_topology.test.ts`):**
  1. `test_preserve_creases`: Every crease in `edges_vertices` is explicitly represented as an edge in the triangulated mesh.
  2. `test_hinge_extraction`: Every internal edge shared by two triangles generates exactly one hinge referencing the correct 4 vertices.
  3. `test_boundary_edges`: Boundary edges ('B') have exactly one adjacent triangle and are never registered as hinges.
  4. `test_euler_characteristic`: Triangulated mesh satisfies $V - E + F = 1$ for a simply connected sheet.

---

### Phase 3: Bar-and-Hinge Mechanical Physics Core
**Goal:** Implement axial edge springs, dihedral crease torsion springs, facet flat springs, and dynamic relaxation solver in `src/engine/physics/`.

* **Components to Implement:**
  - `src/engine/physics/bars.ts`: Axial spring forces and potential energy.
  - `src/engine/physics/hinges.ts`: Dihedral angle calculation and Bridson/Tamstorf nodal gradient forces.
  - `src/engine/physics/solver.ts`: Dynamic Relaxation solver with viscous damping and convergence checking.
* **Acceptance Tests (`tests/physics_core.test.ts`):**
  1. `test_single_hinge_valley_fold`: Two triangles connected by a single valley crease fold accurately to $90^\circ$ and $170^\circ$. Final dihedral angle matches target within $\pm 1^\circ$.
  2. `test_edge_length_incompressibility`: During and after folding, all edge lengths remain within $\pm 0.1\%$ of their rest lengths ($L_0$).
  3. `test_facet_spring_flatness`: A quad split into two triangles by a virtual 'F' edge resists bending under crease torque when $k_{\text{facet}} \ge 20 \cdot k_{\text{crease}}$ (dihedral deviation $< 2^\circ$).
  4. `test_energy_dissipation`: Kinetic energy monotonically decreases to static equilibrium under viscous damping.

---

### Phase 4: Classical Multi-Crease Base Verification (Headless Physics)
**Goal:** Prove true multi-crease simultaneous folding without any hardcoded preset folds or polygon cutting.

* **Components to Implement:**
  - Benchmark FOLD files:
    - `fixtures/waterbomb_base.fold`: 4 creases meeting at center (3 valleys, 1 mountain).
    - `fixtures/preliminary_base.fold`: 4 creases meeting at center (2 valleys, 2 mountains or diagonal mountains).
    - `fixtures/miura_ori.fold`: Tessellation cell with 6 vertices and alternating creases.
  - Headless multi-crease simulation runner in `src/engine/simulation.ts`.
* **Acceptance Tests (`tests/multi_crease_simulation.test.ts`):**
  1. `test_waterbomb_collapse`: Headless simulation of `waterbomb_base.fold` folds from flat state ($\alpha=0$) to 3D tent equilibrium ($\alpha=1$) simultaneously without manual step sequencing.
  2. `test_preliminary_base_collapse`: Headless simulation of `preliminary_base.fold` collapses all 4 corners symmetrically in 3D.
  3. `test_zero_hardcoding_assertion`: Test verifies that no face IDs, preset coordinates, or step branching exist in the solver codebase.
  4. `test_strain_bounds`: Maximum in-plane strain across all bars during collapse remains $< 1.0\%$.

---

### Phase 5: R3F Rendering & Web Worker Architecture
**Goal:** Connect the pure TypeScript engine to React Three Fiber via a Web Worker or direct buffer bridge.

* **Components to Implement:**
  - `src/engine/worker.ts`: Web Worker script executing the simulation loop off the main thread.
  - `src/hooks/useFoldEngine.ts`: React hook managing worker messaging, fold progress state, and buffer updates.
  - `src/components/OrigamiMesh.tsx`: Replaces `PaperMesh.tsx`. Single Three.js `BufferGeometry` updated via typed arrays (`Float32Array`).
  - Integration with `PaperShaderMaterial.ts` for two-sided rendering and crease line highlighting.
* **Acceptance Tests (`tests/integration_bridge.test.ts` + Visual Demo):**
  1. `test_worker_message_protocol`: Worker correctly handles `LOAD_FOLD`, `SET_PROGRESS`, and `STEP_SIMULATION` messages.
  2. `test_buffer_transfer_zero_alloc`: State updates reuse existing `ArrayBuffer` allocations without memory leaks.
  3. `test_scrubber_reactivity`: Scrubbing $\alpha$ from 0 to 1 drives 3D mesh deformation smoothly at $\ge 60$ FPS.

---

### Phase 6: Crease Pattern Authoring & FOLD Import/Export
**Goal:** Enable user interaction to create and edit crease patterns dynamically.

* **Components to Implement:**
  - FOLD file drag-and-drop import and export in UI Header.
  - Dynamic 2D Crease Pattern Editor: Add crease line $\to$ compute intersections $\to$ update FOLD $\to$ trigger re-triangulation and simulation.
  - Clean retirement and removal of `origami-fold-engine/src/split.ts` and fake presets.
* **Acceptance Tests (`tests/authoring_workflow.test.ts`):**
  1. `test_dynamic_crease_addition`: Adding an edge from $(0, 0.5)$ to $(1, 0.5)$ with assignment 'V' dynamically creates a fold line that folds under simulation.
  2. `test_fold_file_import_export`: Exported FOLD file can be re-imported into another session with identical simulation output.
  3. `test_cleanup_verification`: Verifies zero occurrences of `f0.r.r.r`, `f0.r.r.l`, or `splitConvexPolygon` in the entire repository.

---

## 6. Current Status & Phase 5.7 Transition Note

> [!WARNING]
> **Phase 4.6 Kinetic Damping & Barnes DR Results Marked INVALID (NaN False Convergence)**
> In Phase 4.6, Dynamic Relaxation with Kinetic Damping and Barnes fictitious mass scaling appeared to converge in 7 steps with ~0 N residual force. That result was an invalid **false-convergence artifact**: when coordinates blew up into `NaN`, `maxResidualForce` evaluated `NaN > 0` as `false`, erroneously marking the solver as converged on non-finite coordinates.
> In Phase 5.7:
> 1. A shared strict verification helper `assertFinite(mesh)` was added to the physics engine and called across all solver tests.
> 2. `solveToEquilibrium` is guarded so that a convergence flag can NEVER be set on non-finite state (`Number.isFinite(resForce)` and `isMeshFinite(mesh)` required).
> 3. The engine has transitioned to **Small-Step XPBD (Extended Position-Based Dynamics, Macklin et al. 2019)** with hard distance constraints ($\alpha=0$), which is unconditionally stable, completely eliminates axial bar elongation without time step instability, and executes at 0.6–3.7 ms per step on 121V and 441V meshes.
