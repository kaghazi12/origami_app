# Origami Engine Roadmap

The goal is a social site where people share origami designs and anyone can watch them fold in 3D, step by step, and interact with them.

This file covers what exists today, what's missing, and the order to build the rest in. It describes the `prototype-engine` branch.

## The idea in one paragraph

A design is a file: either a step-by-step design (`.json`, our own format) or a crease pattern (`.fold`, the standard FOLD 1.1 format). The engine computes the folded result **exactly**. It does not simulate its way there, because simulating many creases at once from a flat sheet crumples complex models. Physics is used only where it works well: moving between nearby shapes, opening a fold slightly for a clearer view, and grabbing the paper. The site will fold each design once on upload and cache the result, so viewers only play it back.

## Two modes

The app has two modes, for two kinds of folder:

- **Learn (step-by-step)**, for beginners: a design is a list of steps ("fold the corner to the centre") with captions and hints, played one fold at a time like a diagram book. Engine: `src/engine/design/` (step designs). UI: `src/components/prototype/`.
- **Crease pattern (advanced)**, for experienced folders: open any `.fold` file (crease pattern or 3D folded form), fold it exactly, look at the relaxed view, and grab the paper. Engine: exact crease-pattern folding (`src/engine/design/creasePattern.ts`), unfolding (`src/engine/fold/unfold.ts`), physics (`src/engine/physics/`) in a worker. UI: `src/components/modern/`.

Both share the exact folder and the layer-order solver. The old "legacy preset viewer" has been removed; it still exists on the `muhammad-ali` branch.

## Where things stand

| Phase | Goal | Status |
|---|---|---|
| 0. Trustworthy core | Physics bugs fixed, deterministic, fast enough | **Partly.** Strain blow-up and self-collision fixed. Plasticity overriding fold targets, hinge-angle bookkeeping, and slow collisions remain. |
| 1. File formats | A design format people can share | **Done.** Step-by-step `.json` designs and FOLD `.fold` crease patterns. |
| 2. Step engine | Exact folding with correct layer order | **Mostly done.** Simple folds, squash, petal, reverse folds, whole-crease-pattern folding. Gaps listed below. |
| 3. Bake and playback | Fold once, play back smoothly | **Partly.** Playback works in two viewers. Nothing is saved or cached yet. |
| 4. Authoring tool | Make designs without writing files | **Not started.** The biggest gap. |
| 5. Viewer interaction | Rotate, scrub, grab | **Mostly done** in Crease pattern mode. Learn mode has rotate and scrub, but no grab yet. |
| 6. The site | Upload, feed, accounts, sharing | **Not started.** |

### Known gaps

- **Crane:** the legs are not thinned, and the back wing can't be folded down (the stacking chosen in the bird base blocks it). The front wing works.
- **Speed:** exactly folding a large pattern (test 3: 1,170 creases, 332 layers) takes about 3 s in Node and noticeably longer in the browser. Almost all of it is the layer-order solver.
- **Transition frames:** in exact mode the frames between flat and about 85% folded are a computed animation, not real paper. Faces that flip get squashed on the way. 85–100% are real shapes.
- **Two separate 3D viewers:** Learn and Crease pattern modes each have their own viewer, so camera, colours and grab differ. See step 1.
- **Built-in "Preliminary Base" sample:** it isn't flat-foldable as written (4 mountain and 4 valley creases at the centre break Maekawa's rule), so it stays on physics.

## Next steps, in order

### 1. Two modes, one app
The legacy viewer is gone (done). Next, make the two modes feel like one app:
- **Shared 3D viewer:** the same camera framing, paper colours, crease lines and grab in both modes.
- **A bridge:** "Open as crease pattern" in Learn mode exports the finished (or current) step as `.fold` (the exporter exists) and opens it in Crease pattern mode.
- **Consistent design picker:** both modes list the bundled designs that fit them (`.json` in Learn, `.fold` in Crease pattern) and accept uploads.

**Done when:** both modes use one viewer component, and a Learn design can be opened in Crease pattern mode with one click.

### 2. Speed
Get the exact fold of test 3 under 1 s in the browser. The likely route is a faster layer solver: fewer transitivity clauses, watched-literal propagation, and reusing results between steps. Show a "folding…" indicator while it runs, and keep the page responsive.

**Done when:** test 3 loads in under 1 s in Node and under 2 s in Chrome on a normal laptop, with a visible progress state.

### 3. Reliability on real files
Collect 10–20 real `.fold` files from the web, from simple to complex. Each must either fold correctly or show a clear reason it can't. Add them to the test suite.

**Done when:** a test runs every file in a `test-files/` folder and checks it folds, or that it's rejected with a reason.

### 4. Authoring tool
Make designs in the browser:
- Click a flap, draw a fold line, pick valley or mountain and which layers, and see the result immediately.
- Named moves (squash, petal, reverse fold) as buttons.
- Import a `.fold` file or a crease-pattern image (the box-pleat image tracer exists as a script; it should become a tool in the app).

**Done when:** someone can make the paper cup and the preliminary base without touching JSON.

### 5. Save and share
- A backend that stores designs.
- Fold each design once on upload and cache the result.
- Generate a thumbnail from the final frame.
- Give each design a shareable link.
- Limits on file size and fold time, so uploads can't hang the server.

**Done when:** a design can be uploaded and opened from a link on another machine.

### 6. Social features
Feed, profiles, likes, comments, remix (copy someone's design and edit it). This is standard web work once steps 1–5 exist.

## Architecture (current)

```
src/engine/design/      Exact engine: step designs (Learn) + crease-pattern folding
  format.ts             Design format v1: parse + validate .json designs
  state.ts, ops.ts      Paper as faces + creases; fold, reverseFold, collapse, unfold, turnOver, rotate
  layers.ts             Layer-order solver (SAT): crease, transitivity, taco/tortilla rules
  kinematics.ts         Rigid motion planning for squash/petal steps
  animator.ts           Playback for step designs
  creasePattern.ts      Fold a whole .fold crease pattern exactly; ExactFoldPlayer (flat -> folded)
  foldExport.ts         Export any folded state as FOLD 1.1
src/engine/fold/        FOLD files: parse, faces, unfold folded forms
src/engine/physics/     XPBD bar-and-hinge physics, self-collision
src/engine/worker/      Web worker: physics loop + exact-fold mode, grab, relaxed keyframes
src/components/prototype/  Learn mode (step-by-step designs)
src/components/modern/  Crease pattern mode (.fold files)
origami-fold-engine/    Test suite (vitest); no engine code any more
src/designs/            Bundled designs (.json step designs, .fold crease patterns)
```

### How a `.fold` file is played (Crease pattern mode)

1. On load the worker tries the exact folder. It is used ("exact mode") when every mountain/valley crease folds fully flat (±180°) and the file has more than 24 such creases, or when "Exact fold: On" is chosen.
2. The exact folder computes every face's folded position, checks the creases fold together without tearing, and solves the layer order.
3. In the background, physics opens the exact fold slightly (97% down to 85%) and keeps those shapes as keyframes, so the folds are readable.
4. The fold slider plays:
   - 0 → about 85%: computed transition.
   - 85–99%: relaxed real shapes.
   - 100%: exact flat fold.
5. Grabbing hands the current shape to physics. Moving the slider returns to the exact fold.
6. Files with too few creases, or creases that don't fit together at their target angles, use physics instead. The reason is shown next to "Exact fold". 3D targets (partial angles) are folded exactly too.

### File format notes

- **`.fold` files** must include `vertices_coords`, `edges_vertices`, `edges_assignment` **and `faces_vertices`**. The FOLD spec makes faces optional, but Origami Simulator and others reject files without them. A test checks this for every bundled file.
- **Folded-form `.fold` files** (3D coordinates of the finished model, e.g. `frame_classes: ["foldedForm"]`, like Jason Ku's `box.fold`) are unfolded into their crease pattern on load. Faces are laid flat across shared edges, fold angles are measured from the 3D shape, and mountain/valley comes from the file. The result is then folded like any other pattern. Exact mode also handles 3D targets (partial fold angles); only fully flat targets need the layer solver.
- **Step designs (`.json`)** use `format: "origami-design"`, `version: 1`, `meta`, `paper` and `steps`. Each step has a caption, an optional hint and one action. `fold` and `reverseFold` coordinates are in the current view. `collapse` coordinates are on the unfolded sheet. See `src/engine/design/format.ts` for the full reference.

## Testing

- Engine tests: `npx vitest run` in `origami-fold-engine/`.
- Typecheck: `npx tsc --noEmit -p .` in the repo root.
- One existing test (`multi_crease_bases.test.ts`) fails because it writes to a hard-coded path on another computer. Its own assertions pass.
