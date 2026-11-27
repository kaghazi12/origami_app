# origami-fold-engine (tests)

This folder holds the test suite for the engines in `../src/engine`. The engine code itself lives in the app's `src/engine/`:

- `src/engine/design/` – step-by-step designs (Learn mode) and exact crease-pattern folding
- `src/engine/fold/` – FOLD files: parsing, faces, unfolding folded forms
- `src/engine/mesh/`, `src/engine/physics/` – the bar-and-hinge physics used in Crease pattern mode
- `src/engine/worker/` – the web worker that runs folding off the main thread

```bash
npm install
npm test            # all tests
npm run typecheck
```

The earlier standalone "legacy" fold engine that used to live in `src/` here was removed; it is still on the `muhammad-ali` branch.
See `../docs/ROADMAP.md` for the plan.
