# Origami App

A web app where people watch origami designs fold in 3D, step by step, and interact with the paper. The long-term goal is a social site for sharing designs (see `docs/ROADMAP.md`).

## Stack

- React 19 + TypeScript, built with Vite 6
- Tailwind CSS v4 (via `@tailwindcss/vite`; config lives in `src/index.css`, there is no `tailwind.config.js`)
- three.js through `@react-three/fiber` and `@react-three/drei`
- Icons: `lucide-react`
- Engine tests: Vitest, in `origami-fold-engine/` (a separate package that tests code in the root `src/engine/`)

## Commands

```bash
npm run dev            # dev server on http://localhost:5173
npm run build          # tsc + vite build (run this to typecheck the app)
npm run test:engine    # full engine test suite (Vitest)
```

## Layout

```
src/
  App.tsx                      top bar + mode switch (hash routing: #learn, #crease-pattern)
  index.css                    Tailwind import, design tokens (@theme), base styles
  components/
    prototype/                 Learn mode: step-by-step designs (PrototypeApp, DesignViewer3D)
    modern/                    Crease pattern mode: .fold files, physics, grab (ModernOrigamiApp, OrigamiModernCanvas, CreasePattern2D)
  designs/                     bundled designs (.json step designs, .fold crease patterns)
  engine/
    design/                    exact step folding, layer order, crease-pattern folding, FOLD export
    fold/                      FOLD parsing, unfolding
    mesh/  physics/            bar-and-hinge physics (runs in worker/)
origami-fold-engine/tests/     engine tests
docs/                          ROADMAP.md, ENGINE_AUDIT.md, screenshots
```

## The two modes

- **Learn (step-by-step):** for beginners. A design is a list of steps with captions and hints, played one fold at a time.
- **Crease pattern (advanced):** for experienced folders. Open any `.fold` file, fold it exactly, inspect it, grab the paper.

Both should feel like one app with one visual language. Right now they don't: Learn is dark slate, Crease pattern is light gray, and each has its own header and controls.

## Frontend and design work

**Read `.claude/skills/frontend-design/SKILL.md` before any UI change**, including small ones such as adding a button. It sets the visual direction, the design tokens, the component rules and the review checklist. The current UI is a placeholder and doesn't follow it yet. Don't copy patterns from existing components without checking them against the skill.

The rules that apply everywhere:

- Use the tokens defined in `src/index.css` (`@theme`). Don't use raw Tailwind palette classes (`slate-800`, `indigo-600`, `gray-200`) or hex values in components.
- No emoji in the UI, no gradients, no glassmorphism, no glowing shadows, no `alert()`.
- Write UI text for folders, not engineers: "Folding…", not "Web Worker Bar-and-Hinge"; "Show creases", not "Crease visibility toggle". Keep engine numbers (vertex count, residual force, stiffness) out of sight, behind a developer panel.
- Pull a shared piece into `src/components/ui/` once it's used in both modes.

## Engine conventions

- Exact folding is the source of truth. Physics is only for small moves, relaxing the view and grabbing. Don't use simulation to reach a folded state.
- Engine code in `src/engine/` must not import React or anything from `components/`.
- Add or update a test in `origami-fold-engine/tests/` for any engine behaviour change, and run `npm run test:engine`.

## Git

- Main work happens on `prototype-engine`. `muhammad-ali` follows it.
- `test images/` is local only and must never be committed.
- Commit or push only when asked.
