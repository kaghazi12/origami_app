# Origami App

A web app where people watch origami designs fold in 3D, step by step, and interact with the paper. The long-term goal is a social site for sharing designs (see `docs/ROADMAP.md`).

## Stack

- React 19 + TypeScript, built with Vite 6
- Tailwind CSS v4 (via `@tailwindcss/vite`; config lives in `src/index.css`, there is no `tailwind.config.js`)
- three.js through `@react-three/fiber` and `@react-three/drei`
- Icons: `lucide-react`
- Animation: `motion` (`motion/react`). Fonts are self-hosted with `@fontsource` (Bricolage Grotesque, Instrument Sans, IBM Plex Mono)
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
  App.tsx                      picks the page from the URL hash (router.ts: #/, #/learn, #/crease-pattern, #/explore, #/d/<id>, #/u/<handle>, #/create[/<id>], #/signin)
  index.css                    Tailwind import, design tokens (@theme), base styles
  theme.ts                     the same colours for three.js and SVG (keep in sync with index.css)
  pages/                       LandingPage, LearnPage, CreasePatternPage, ExplorePage, DesignPage, ProfilePage, SignInPage, CreatePage
  store/                       the site's data (people, designs, likes, comments, follows) in localStorage; db.ts is the API
  components/
    ui/                        shared kit: Button, IconButton, SegmentedControl, Scrubber, Picker, Switch, Callout, Toast, Tooltip, Thumbnails, Motion (Reveal, FoldInText)
    shell/                     TopBar and Wordmark, used on every page
    community/                 design cards, thumbnails, avatars, like button, user menu, step player
    editor/                    the design editor: FoldCanvas (draw a fold), CollapseCanvas (squash/petal on the crease pattern), StepEditor
    prototype/                 DesignViewer3D (Learn mode and the landing hero)
    modern/                    OrigamiModernCanvas (Crease pattern mode: physics, grab, pin)
  designs/                     bundled designs (.json step designs, .fold crease patterns); index.ts is the catalogue
  engine/
    design/                    exact step folding, layer order, crease-pattern folding, FOLD export
    fold/                      FOLD parsing, unfolding
    mesh/  physics/            bar-and-hinge physics (runs in worker/)
origami-fold-engine/tests/     engine tests
docs/                          ROADMAP.md, ENGINE_AUDIT.md, screenshots
```

## Sharing (no backend yet)

Profiles, designs (drafts and published), likes, comments, follows and remixes live in this browser's localStorage, through `src/store/db.ts`. It enforces what a server would (sign in to change anything, only your own designs and comments, drafts private, size limits) and is tested in `origami-fold-engine/tests/store.test.ts`. Pages read it with `useDb((db) => …)` and change it with `db.…` calls only, so a real backend replaces `db.ts` and nothing else. A new browser is seeded (`seed.ts`) with the bundled designs under the "Origami library" account and two made-up sample people. Bundled designs are stored as references (`source: { type: 'bundled' }`), uploads and authored designs inline.

## The two modes

- **Learn (step-by-step):** for beginners. A design is a list of steps with captions and hints, played one fold at a time.
- **Crease pattern (advanced):** for experienced folders. Open any `.fold` file, fold it exactly, inspect it, grab the paper.

Both share one shell (top bar, 288px sidebar, viewer, transport bar) and one visual language. They still use two different 3D viewer components (roadmap step 1).

## Frontend and design work

**Read `.claude/skills/frontend-design/SKILL.md` before any UI change**, including small ones such as adding a button. It sets the visual direction, the design tokens, the component rules and the review checklist. Build new UI from `src/components/ui/` rather than styling raw elements.

The rules that apply everywhere:

- Use the tokens defined in `src/index.css` (`@theme`). Don't use raw Tailwind palette classes (`slate-800`, `indigo-600`, `gray-200`) or hex values in components.
- The look is washi paper, kon-indigo ink and one marigold accent (a fill, never text on paper). Don't drift back to cream + terracotta + serif.
- No emoji in the UI, no gradients, no glassmorphism, no glowing shadows, no `alert()`.
- Animate with `motion`, following the skill's motion table, and respect reduced motion.
- Write UI text for folders, not engineers: "Folding…", not "Web Worker Bar-and-Hinge"; "Show creases", not "Crease visibility toggle". Keep engine numbers (vertex count, residual force, stiffness) out of sight, behind a developer panel.
- Pull a shared piece into `src/components/ui/` once it's used in both modes.
- Engine and physics numbers in Crease pattern mode live in the sidebar's collapsed **Developer** panel. Keep them there.

## Engine conventions

- Exact folding is the source of truth. Physics is only for small moves, relaxing the view and grabbing. Don't use simulation to reach a folded state.
- Every FOLD file goes through `prepareFold` (`src/engine/fold/prepare.ts`) before the engine sees it: unit size, multi-frame files, faces rebuilt when they don't match the creases, crossing creases joined, and a report of what's impossible about the pattern (shown in the sidebar's File check). Never feed raw file JSON to the mesh or worker.
- Physics folds are driven by `FoldDriver` (`src/engine/physics/foldDriver.ts`): the fold always reaches the slider value, then the paper settles and stops. Plasticity stays off for loaded patterns, and self-collision stays on (also when grabbing an exact fold).
- When a file's mountains and valleys can't stack, `foldCreasePattern` swaps the fewest creases it can find so the pattern folds flat (`reassigned`; the folded shape doesn't depend on mountain/valley, only the layer order does). The worker folds the corrected pattern, and the File check says how many creases changed and offers the corrected file.
- Only if no assignment folds flat (or the creases tear) is the file folded by physics, with `FoldDriver`'s `jamStrain`: it stops where the paper starts to stretch, and the page says where. Valid patterns never get a limit.
- The exact fold's relaxed keyframes (physics-opened poses near 100%) are dropped as soon as one pushes paper through paper (more crossings than the exact fold). Without collisions they used to sink layers and show the back colour on top.
- `origami-fold-engine/tests/fold_files_robustness.test.ts` folds every bundled `.fold` file and fails if one stalls, never stops, or passes paper through paper. Every `.fold` file dropped in `src/designs/` shows up in the picker automatically (`NN_name.fold` under Test files, anything else under Your files), and the robustness test folds the ones the app folds by physics. The current ones (`01_`–`12_`) are generated and verified by `npm run generate:test-folds` (`scripts/generate-test-folds.ts`); edit the script, not the JSON. The original broken versions live in `origami-fold-engine/fixtures/invalid/` and test how broken files are reported.
- Engine code in `src/engine/` must not import React or anything from `components/`.
- Add or update a test in `origami-fold-engine/tests/` for any engine behaviour change, and run `npm run test:engine`.

## Git

- Main work happens on `prototype-engine`. `muhammad-ali` follows it.
- `test images/` is local only and must never be committed.
- Commit or push only when asked.
