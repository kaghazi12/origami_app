# origami-fold-engine

Data-driven fold engine. A model is a JSON list of fold steps; the engine turns it into
animated 3D poses of paper faces. No three.js dependency: it outputs plain arrays you hand to
any renderer.

```bash
npm install
npm test          # 31 tests
npm run typecheck
```

## The idea

The paper is a set of **convex faces**. Each face remembers:

- `polygon`: its shape on the unfolded sheet (paper space, counter-clockwise). Use it as UVs for the paper texture.
- `matrix`: where it sits in the world (column-major 4x4, same layout as `THREE.Matrix4`).
- `layer`: stacking order in the flat-folded state.

A fold cuts every selected face along the crease, then rotates everything on one side by 180
degrees about the crease. The rotation is a real 3D rigid transform, so a flipped face just has
its normal pointing at -z. One number drives everything:

```ts
const engine = FoldEngine.fromJSON(json);   // validates, precomputes every step
engine.stepCount;                           // number of steps
engine.poseAt(2.4);                         // step 3 is 40% done -> PosedFace[]
engine.locate(2.4);                         // { stepIndex: 2, t: 0.4, step } for captions
engine.stateAt(3);                          // committed flat state after 3 steps
```

Scrubber, autoplay, and any adaptive slow-down all just change that progress value.

## Step JSON

```json
{
  "version": 1, "id": "letter-fold", "name": "Letter fold",
  "paper": { "width": 1, "height": 1 },
  "steps": [
    {
      "title": "Fold the left third over the middle",
      "hint": "optional longer tip",
      "crease": { "from": [0.333, 0], "to": [0.333, 1] },
      "moving": "left",
      "kind": "valley",
      "select": { "faces": ["f0.r"] }
    }
  ]
}
```

- `crease` is in the coordinates of the paper **as it currently lies flat** (starts as `[0,width] x [0,height]`, y up). This is what makes click-two-points authoring possible.
- `moving`: which side of the directed line `from -> to` rotates. `left` is the counter-clockwise side.
- `kind`: `valley` brings the moving side toward the viewer, `mountain` sends it behind.
- `select` (optional): fold only these faces. Omit it to fold every layer. Face ids: the sheet starts as `f0`; a cut produces `<id>.l` and `<id>.r`.

## Using it with three.js (react-three-fiber)

```tsx
const faces = engine.poseAt(progress);
return faces.map((f) => {
  const geometry = useMemo(() => buildGeometry(f.polygon), [f.id, f.polygon]); // fan: triangulateFan(n)
  return <mesh key={f.id} geometry={geometry} matrixAutoUpdate={false}
               matrix={new THREE.Matrix4().fromArray(f.matrix)}>
    <paperMaterial side={THREE.DoubleSide} />   {/* front colour when gl_FrontFacing, back colour otherwise */}
  </mesh>;
});
```

Triangles are counter-clockwise in paper space and the transforms are proper rotations, so
`gl_FrontFacing` is true exactly when the paper's front side is showing.

## What it does not do yet (v1 limits)

- **Flat folds only.** Every step is a full 180 degree fold. Reverse folds, squash folds, petal folds, sinks and
  curved or 3D-shaped models (box walls, inflated forms) are out of scope for now. Many of them can be written as a
  sequence of flat folds using `select.faces`.
- **No layer-validity check.** The engine stacks flipped layers correctly for simple models but does not detect
  physically impossible folds (paper passing through paper) or whether `select.faces` flaps are really connected at the crease.
- **Layer order is global**, not per region. Fine for classic beginner models; revisit if a model shows wrong overlaps.

## Layout

```
src/math.ts      matrix + polygon helpers
src/split.ts     cutting a convex polygon along a line
src/engine.ts    FoldEngine: precomputes states, answers poseAt()
src/model.ts     parseModel(): validation with field-level error messages
tests/           vitest suite, also runs invariants over everything in examples/
examples/        sample models (add yours and the invariant tests pick them up)
```
