---
name: frontend-design
description: Visual direction, design tokens, component rules and review checklist for the origami app's UI. Use before building or changing any screen, component, layout, styling, copy or interaction in src/components or src/index.css, however small, and when asked to make the app look more professional, polished or less generic.
---

# Frontend design for the origami app

The goal is a UI that looks like a carefully made tool for folders, built by people who care about paper. It should not look like a generated dashboard template. Each choice here is meant to look *decided*: one typeface family, one accent colour, one corner radius, one way to show a panel.

Read the whole file before writing UI code. Use the checklist at the end before calling any UI work done.

---

## 1. Direction: washi, kon indigo, yamabuki

Origami already has a visual language. Borrow it instead of the generic SaaS look, and don't drift back to the cream-paper, terracotta and serif look that every AI-made site now has.

- **Washi:** the app is a cool, slightly green paper (`canvas`), not cream and not a dark navy void. Surfaces are flat and matte, like stacked sheets.
- **Kon (indigo ink):** text and lines are a deep indigo, like indigo-dyed cloth and printed diagrams. Ink also fills the bold bands: the landing hero, the footer.
- **Yamabuki (marigold):** the one accent, the colour of a sheet of kami. It is a *fill*: the primary button, the current step, the current-mode tab, the slider thumb, the back of the paper. Text on it is ink. Never use it as text colour on paper (too light); use `accent-ink` for the rare accent-coloured text.
- **Paper thickness:** pressable things (primary and secondary buttons) stand on a hard 2px edge (`shadow-edge`, `shadow-edge-accent`) and press down onto it. This, the dog-ear corner on cards and the valley-crease line are the app's motifs. Nothing more ornamental.
- **The model is the hero.** The 3D viewer gets most of the screen and the cleanest background. Chrome around it is quiet, compact and pushed to the edges.

---

## 2. Design tokens

All colour, type, radius, shadow and motion values live in `src/index.css` in a Tailwind v4 `@theme` block, mirrored for three.js in `src/theme.ts`. Components use only these tokens (`bg-surface`, `text-ink-muted`, `border-line`, `bg-accent`). **Never use raw palette classes (`bg-slate-900`, `text-indigo-600`, `border-gray-200`) or hex values in components.** If a value is missing, add a token; don't hard-code it.

| Group | Tokens | Use |
|---|---|---|
| Washi | `canvas` `surface` `surface-raised` `viewer` `sunken` | page, panels, popovers, behind the model, tracks and inputs |
| Kon | `ink` `ink-muted` `ink-faint` `line` `line-strong` | text, secondary text, placeholders, hairlines, input borders |
| On ink bands | `paper` `paper-muted` `ink-line` | text and lines on `bg-ink` (hero, footer) |
| Yamabuki | `accent` `accent-hover` `accent-edge` `accent-soft` `accent-ink` `on-accent` | fills, its pressed edge, selected rows, accent text on paper, text on accent |
| Focus | `focus` | every focus ring: `focus-visible:ring-2 ring-focus/60` |
| Origami | `valley` `mountain` `border-crease` | crease lines |
| Status | `success` `warning` `danger` and their `-soft` | callouts, toasts |
| Shadows | `shadow-edge` `shadow-edge-accent` `shadow-float` `shadow-dialog` | paper edge under buttons; floating panels; menus and dialogs |

**Fonts** are self-hosted from npm (`@fontsource-variable/bricolage-grotesque`, `@fontsource-variable/instrument-sans`, `@fontsource/ibm-plex-mono`, imported in `src/main.tsx`). Don't add Google Fonts links.

**Dark theme:** not built yet. When it comes, it reuses the same token names under `[data-theme="dark"]` (kon indigo paper). That's why components must use tokens.

---

## 3. Typography

| Role | Class | Notes |
|---|---|---|
| Landing headline | `font-display text-5xl lg:text-6xl xl:text-7xl font-semibold tracking-tight text-balance` | Bricolage Grotesque. `text-balance` so no word is left alone on a line. |
| Landing section heading | `font-display text-4xl font-semibold tracking-tight` | |
| Design title (sidebar) | `font-display text-3xl font-semibold tracking-tight` | The same in both modes. |
| Step caption (main instruction) | `font-display text-xl font-semibold` | The most important text on the screen in Learn mode. |
| Panel heading | `text-sm font-semibold text-ink` | Sentence case. **Not** `uppercase tracking-wider text-[11px]`. |
| Body / list rows | `text-sm text-ink` | Instrument Sans. |
| Secondary / meta | `text-sm text-ink-muted` or `text-xs text-ink-muted` | |
| Numbers | add `tabular-nums` | Use `font-mono` only for real code or file names. |

Rules:

- Use the Tailwind type scale only. No `text-[11px]` or `text-[10px]`: the smallest size is `text-xs` (12px), for metadata only.
- Interface text uses `font-normal`, `font-medium` and `font-semibold`. Bold is for the wordmark only.
- Write in sentence case everywhere: buttons, headings, menu items. Use no all-caps labels.
- Use a real ellipsis (…), real quotes, and en dashes for ranges.
- **The wordmark** is lowercase "origami" in Bricolage Grotesque bold, trimmed to its x-height (`.trim-ex`, CSS `text-box`) so it centres on the mark. Without the trim it floats above the mark.

---

## 4. Layout and spacing

- Spacing comes from the 4px Tailwind scale. The common values are 1, 2, 3, 4, 6, 8. Avoid odd values such as `py-1.5` and `px-2.5` unless you're aligning to an icon.
- **App shell:** one top bar of 48px (`h-12`) holds the wordmark, the mode switch, the design name and the primary actions. Under it there is a sidebar of 288px (`w-72`) on the left and the viewer filling the rest. Both modes use this shell.
- **Viewer overlays:** floating controls sit 16px (`inset-4`) from the edges on `bg-surface-raised shadow-float rounded-lg`. Group them; don't scatter single buttons in four corners.
- **Transport bar** (play, step, scrub, speed): one row, 56px tall, at the bottom of the viewer, centred and at most `max-w-3xl` wide.
- **Density:** this is a tool. Controls are 32px tall (`h-8`), and list rows are 36px. Don't inflate everything to 44–48px cards.
- Align to edges. Labels and values share baselines, and icons sit centred with text (`inline-flex items-center gap-2`).
- Divide with whitespace first and a `border-line` hairline second. Never put a card inside a card inside a card.

---

## 5. Components

Build these once in `src/components/ui/` and use them in both modes. Don't restyle a `<button>` inline in every file.

**Button**: variants `primary` (marigold fill, ink text, accent edge; once per view), `secondary` (raised surface, `border-line-strong`, paper edge), `ghost` (no border, `hover:bg-sunken`), `inverse` (outline, for ink bands only). Sizes `sm` (h-7) and `md` (h-8). Radius `rounded-md`. Every button needs a visible `focus-visible:ring-2 ring-focus/60 ring-offset-1` and a disabled state (`opacity-50 cursor-not-allowed`).

**IconButton**: square, the same height as a button, with a Lucide icon at 16px and `strokeWidth={1.75}`. It always needs an `aria-label` and a tooltip.

**SegmentedControl**: for mode switches and 0.5×/1×/2× speed. The track is `bg-sunken rounded-md p-0.5`. The selected segment's raised thumb (`bg-surface-raised shadow-sm`) slides between segments; the others are `text-ink-muted`. Don't use an accent fill for the selected segment.

**Select / design picker**: a custom popover list showing each design's title, difficulty and step count, plus a small flat crease-pattern thumbnail when available. Not a raw native `<select>`.

**StepList** (Learn mode): a numbered list. The current step gets `bg-accent-soft` and a 3px marigold bar on the left, sliding from step to step; finished steps get `text-ink-muted` and a small check; future steps get `text-ink`. Clicking a step jumps to it. A failed step shows a warning icon and its reason inline, not struck-through text.

**Slider / scrubber**: a custom track (`bg-line`, 4px tall) with the filled part in `bg-ink`, tick marks at each step boundary and a 14px marigold thumb with an ink ring. Don't use `accent-indigo-500` on a native range input.

**Callout**: for errors and warnings in panels. `bg-warning-soft text-warning` with an icon, a one-line title in `font-medium` and the detail in `text-ink-muted`. Use the danger colours only for real failures.

**Toast**: replaces every `alert()`. It appears at the bottom centre, above the transport bar, and disappears after 4s. Errors stay until dismissed.

**EmptyState / drop zone**: a valley-crease (dashed) outline, one line of instruction ("Drop a .fold file here, or open one"), and one secondary button.

**Loading**: while a design folds, show "Folding…" with a thin indeterminate progress line at the top of the viewer. Don't use spinners in the middle of the model or `animate-pulse` on text.

**Field / TextArea** (`ui/Field.tsx`): label above, hint or error below, optional character count. **Dialog / ConfirmDialog** (`ui/Dialog.tsx`): every confirmation and small form; never `confirm()`.

**Community pieces** (`components/community/`): `DesignCard` for every grid of designs, `Avatar` (a sheet in the person's colour with a folded corner) and `PersonLink`, `LikeButton`, `StepPlayer` for a compact step design player. Pages read data with `useDb` and change it through `db` only.

**Icons:** use Lucide only, at 16px in controls and 20px in empty states, always `strokeWidth={1.75}`. Never emoji (no 📍, ✋ or ✕ in labels). Use `MapPin`, `Hand` and `X` instead.

---

## 6. Motion

Animations use the `motion` library (`motion/react`). `App.tsx` wraps everything in `<MotionConfig reducedMotion="user">`, and `index.css` zeroes CSS transitions under `prefers-reduced-motion`; anything that loops (the hero, the pattern strip, the step preview) checks `usePrefersReducedMotion()` and stays still.

Motion should look like paper: things **fold** (rotate on a hinge edge, `--ease-fold`) or **slide** (spring), never bounce or glow.

| What | How |
|---|---|
| Page change | the page fades and rises 10px (`App.tsx`, `AnimatePresence mode="popLayout"`) |
| Current item (top-bar mode tab, segmented-control thumb, current step in Learn) | one element with a shared `layoutId` that slides to the new item |
| Popovers, toasts | fade plus a 4–16px slide, 120–240ms; toasts spring |
| Step caption | old caption out, new one in (`AnimatePresence mode="wait"`); a marigold bar on the card's top edge shows progress through the step |
| Landing | headline words fold down (`FoldInText`); sections fold up into view once (`Reveal`); hero crease lines stroke themselves in (`animate-draw`) |
| Logo | the mark's corner folds in once per visit and lifts a little on hover |
| Buttons | 150ms colour; pressing moves the button down onto its paper edge (`translate-y-0.5`, edge shadow off). No hover scale-ups. |

- Use `Reveal` and `FoldInText` from `src/components/ui/Motion.tsx` rather than writing new entrance animations.
- Animate `opacity`, `transform` and colours. Never `transition-all`, never animate width, height, top or left (use `layout` for size changes).
- Nothing loops in the tool pages except the fold itself and the indeterminate progress line.

---

## 7. Signs of AI-made design to remove on sight

The current UI has most of these. Remove each one you meet in a file you're working in:

- Default Tailwind **slate/gray + indigo** palettes, or switching between dark navy and light gray from one screen to the next
- The **cream + terracotta + serif** look (what this app had before): it now reads as generic AI design
- **Gradients** of any kind (`bg-gradient-to-*`, gradient text, gradient borders)
- **Glassmorphism**: `backdrop-blur`, translucent `bg-*/80` panels over the 3D scene, `.glass-panel`
- Glowing or coloured shadows, and `shadow-lg`/`shadow-xl` on things that aren't floating
- **Emoji** used as icons or decoration
- **Tiny all-caps labels** (`text-[11px] uppercase tracking-wider`) used as section headings everywhere
- Pills and badges stating implementation details ("Web Worker Bar-and-Hinge", "121 V / 441 V") in the main UI
- Fake logos: a coloured square with initials ("AG")
- `rounded-2xl` and `rounded-full` on everything, and mixed radii on one screen
- `animate-pulse`, bouncing icons, hover scale-ups on buttons, glow or shimmer effects
- Raw engine numbers in the main UI (residual force, stiffness, vertex counts, "Folded in 43 ms · 128 faces"). Move them to a collapsible **Developer** panel that's hidden by default.
- Generic copy: "Unleash", "Seamless", "Powerful", "✨", "Origami 3D Studio – Fold Engine Viewer & Authoring". The product name is plain.
- Native `alert()`/`confirm()` dialogs
- Four or more buttons of equal weight in a row with no clear primary

---

## 8. Copy

- Write for someone folding paper, not someone reading the code. Say "Fold", "Unfold", "Next step", "Show creases", "Open a design", "Grab the paper to move it".
- Error messages say what went wrong and what to do: "Step 7 can't be folded: the flap is under another layer. Steps before it still play." Don't show raw exception text or stack traces to users; keep them in the developer panel and the console.
- Mode names: **Learn** and **Crease pattern**. The "(step-by-step)" and "(advanced)" qualifiers become a short description in the mode switch's tooltip, not part of the label.
- The page `<title>` is the product name, then the design name when one is open: `Crane · Origami`.

---

## 9. Accessibility

- Text contrast is at least 4.5:1 (3:1 for large text and icons). `ink-faint` on `canvas` is for placeholders and disabled text only.
- Every interactive element can be reached with the keyboard and has a visible focus ring. The keyboard shortcuts (space for play/pause, ← and → for steps) are listed in a `?` popover.
- Icon-only buttons have an `aria-label`. The step list is an `<ol>`, and the current step has `aria-current="step"`.
- Don't use colour as the only signal. Valley and mountain differ in line style as well as colour; status uses an icon plus text.
- Remove `user-select: none` from `body`. Allow it only on the 3D canvas and on drag handles, so people can copy captions and errors.

---

## 10. 3D viewer styling

- The scene background is `--color-viewer` (flat, no gradient, no fog). The floor is either a barely visible shadow-catcher or nothing.
- Lighting is soft: one key light and one ambient light, with no coloured lights. Paper colours come from the design file.
- Crease lines are thin and use the valley and mountain tokens, and they follow the "Show creases" toggle.
- The camera fits the model with about 15% margin on load and on "Reset view". Rotation is smooth and damped.
- Both modes use the same viewer component, camera framing, lights and crease style (roadmap step 1). Don't style one viewer without the other.

---

## Checklist before calling UI work done

Run `npm run dev` and look at the actual screen, at 1440px and 1024px wide. Then check:

- [ ] No raw palette classes or hex values in components: `grep -rE "(slate|gray|zinc|indigo|violet|rose|emerald|amber)-[0-9]" src/components` returns nothing in the files you touched.
- [ ] No emoji, gradients, `backdrop-blur`, `transition-all`, `animate-pulse`, `alert(` or `text-[Npx]` in the files you touched.
- [ ] One primary (accent) action per view; everything else is secondary or ghost.
- [ ] One radius scale (`sm`/`md`/`lg`) and one control height (`h-8`) on the screen.
- [ ] Sentence case throughout; no all-caps labels.
- [ ] Engine and debug numbers are behind the Developer panel.
- [ ] Hover, focus-visible, active, disabled, loading, empty and error states exist for what you built.
- [ ] Both modes still look like the same app.
- [ ] Keyboard: tab through the screen; focus is always visible, and play/pause and step keys work.
- [ ] `npm run build` passes.
