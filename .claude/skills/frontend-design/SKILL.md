---
name: frontend-design
description: Visual direction, design tokens, component rules and review checklist for the origami app's UI. Use before building or changing any screen, component, layout, styling, copy or interaction in src/components or src/index.css, however small, and when asked to make the app look more professional, polished or less generic.
---

# Frontend design for the origami app

The goal is a UI that looks like a carefully made tool for folders, built by people who care about paper. It should not look like a generated dashboard template. Each choice here is meant to look *decided*: one typeface family, one accent colour, one corner radius, one way to show a panel.

Read the whole file before writing UI code. Use the checklist at the end before calling any UI work done.

---

## 1. Direction: paper, ink, one red

Origami already has a visual language. Borrow it instead of the generic SaaS look.

- **Paper:** the app is a warm off-white sheet, not a dark navy void. Surfaces are flat, matte and lightly tinted, the way stacked paper looks.
- **Ink:** text and lines are near-black with a warm tint, like printed diagrams. The hierarchy comes from weight, size and spacing, not from colour.
- **One red:** a single accent, the colour of kami (origami paper), used sparingly: the primary action, the current step, the selection. Never decoration.
- **Diagram notation:** valley and mountain creases use the real conventions (valley dashed, mountain dash-dot-dot). Reuse that line style as the app's one motif, for dividers in empty states or the progress track. Don't add anything more ornamental than that.
- **The model is the hero.** The 3D viewer gets most of the screen and the cleanest background. Chrome around it is quiet, compact and pushed to the edges.

Good references to think of: a well-typeset origami diagram book, Linear's restraint, Figma's tool density, Apple's Freeform. The things to avoid are listed in section 7.

---

## 2. Design tokens

All colour, type, radius and shadow values live in `src/index.css` in a Tailwind v4 `@theme` block. Components use only these tokens (`bg-surface`, `text-ink-muted`, `border-line`, `bg-accent`). **Never use raw palette classes (`bg-slate-900`, `text-indigo-600`, `border-gray-200`) or hex values in components.** If a value is missing, add a token; don't hard-code it.

The starting set below can be tuned, but keep the structure:

```css
@import "tailwindcss";

@theme {
  /* Paper (surfaces) */
  --color-canvas:        #F4F1EA;  /* app background, warm paper */
  --color-surface:       #FBFAF6;  /* panels, sidebars */
  --color-surface-raised:#FFFFFF;  /* menus, popovers, dialogs */
  --color-viewer:        #ECE8DF;  /* behind the 3D model */
  --color-sunken:        #EAE6DC;  /* inputs, segmented-control track */

  /* Ink (text, lines) */
  --color-ink:           #1C1A17;  /* primary text */
  --color-ink-muted:     #5E5950;  /* secondary text */
  --color-ink-faint:     #8F897D;  /* tertiary text, placeholders, disabled */
  --color-line:          #DDD8CC;  /* hairline borders and dividers */
  --color-line-strong:   #C7C1B3;  /* input borders, hover borders */

  /* Accent: kami red. Use sparingly. */
  --color-accent:        #C2412D;
  --color-accent-hover:  #A93624;
  --color-accent-soft:   #F6E3DE;  /* selected row background */
  --color-on-accent:     #FFFFFF;

  /* Origami semantics */
  --color-valley:        #2F5DA8;  /* valley crease */
  --color-mountain:      #C2412D;  /* mountain crease */
  --color-border-crease: #1C1A17;  /* paper edge */

  /* Status (text and icons; for backgrounds use the -soft variants) */
  --color-success:       #3F7A4F;
  --color-success-soft:  #E3EFE5;
  --color-warning:       #9A6B12;
  --color-warning-soft:  #F5ECD7;
  --color-danger:        #B3261E;
  --color-danger-soft:   #F7E1DF;

  /* Type */
  --font-sans:    "Geist", ui-sans-serif, system-ui, sans-serif;
  --font-display: "Newsreader", ui-serif, Georgia, serif;
  --font-mono:    "Geist Mono", ui-monospace, monospace;

  /* Shape */
  --radius-sm: 4px;   /* chips, small buttons inside controls */
  --radius-md: 6px;   /* buttons, inputs, list rows. The default. */
  --radius-lg: 10px;  /* panels, popovers, dialogs. Largest allowed. */

  /* Elevation: flat by default. Shadows only for things floating above content. */
  --shadow-float: 0 1px 2px rgb(28 26 23 / 0.06), 0 4px 12px rgb(28 26 23 / 0.08);
  --shadow-dialog: 0 2px 4px rgb(28 26 23 / 0.06), 0 12px 32px rgb(28 26 23 / 0.14);

  /* Motion */
  --ease-out: cubic-bezier(0.2, 0.8, 0.2, 1);
}
```

Load Geist, Geist Mono and Newsreader from Google Fonts in `index.html` and remove Plus Jakarta Sans and JetBrains Mono. Delete the `.glass-panel` utility and the custom rose-tinted scrollbar.

**Dark theme:** don't build one yet. When it comes, it reuses the same token names under `[data-theme="dark"]` (warm charcoal paper, not navy). That's why components must use tokens.

---

## 3. Typography

| Role | Class | Notes |
|---|---|---|
| Design title (sidebar, finished-model card) | `font-display text-2xl leading-tight` | The only place the serif appears. It gives each design an editorial feel. |
| Step caption (main instruction) | `text-lg font-medium text-ink` | The most important text on the screen in Learn mode. |
| Section heading | `text-sm font-semibold text-ink` | Sentence case. **Not** `uppercase tracking-wider text-[11px]`. |
| Body / list rows | `text-sm text-ink` | |
| Secondary / meta | `text-sm text-ink-muted` or `text-xs text-ink-muted` | |
| Numbers (step counts, timings) | add `tabular-nums` | Use `font-mono` only for real code or file names. |

Rules:

- Use the Tailwind type scale only. No `text-[11px]` or `text-[10px]`: the smallest size is `text-xs` (12px), for metadata only.
- Use two weights, `font-normal` and `font-medium`, plus `font-semibold` for headings. Never `font-bold` or `font-extrabold` in the UI.
- Write in sentence case everywhere: buttons, headings, menu items. Use no all-caps labels.
- Use a real ellipsis (…), real quotes, and en dashes for ranges.

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

**Button**: variants `primary` (accent fill, used once per view), `secondary` (surface fill with a `border-line-strong` border), `ghost` (no border, `hover:bg-sunken`). Sizes `sm` (h-7) and `md` (h-8). Radius `rounded-md`. Every button needs a visible `focus-visible:ring-2 ring-accent/40 ring-offset-1` and a disabled state (`opacity-50 cursor-not-allowed`).

**IconButton**: square, the same height as a button, with a Lucide icon at 16px and `strokeWidth={1.75}`. It always needs an `aria-label` and a tooltip.

**SegmentedControl**: for mode switches and 0.5×/1×/2× speed. The track is `bg-sunken rounded-md p-0.5`. The selected segment is `bg-surface-raised shadow-sm text-ink`, and the others are `text-ink-muted`. Don't use an accent fill for the selected segment.

**Select / design picker**: a custom popover list showing each design's title, difficulty and step count, plus a small flat crease-pattern thumbnail when available. Not a raw native `<select>`.

**StepList** (Learn mode): a numbered list. The current step gets `bg-accent-soft` and a 2px accent bar on the left; finished steps get `text-ink-muted` and a small check; future steps get `text-ink`. Clicking a step jumps to it. A failed step shows a warning icon and its reason inline, not struck-through text.

**Slider / scrubber**: a custom track (`bg-line`, 4px tall) with the filled part in `bg-ink`, tick marks at each step boundary and a 14px thumb. Don't use `accent-indigo-500` on a native range input.

**Callout**: for errors and warnings in panels. `bg-warning-soft text-warning` with an icon, a one-line title in `font-medium` and the detail in `text-ink-muted`. Use the danger colours only for real failures.

**Toast**: replaces every `alert()`. It appears at the bottom centre, above the transport bar, and disappears after 4s. Errors stay until dismissed.

**EmptyState / drop zone**: a valley-crease (dashed) outline, one line of instruction ("Drop a .fold file here, or open one"), and one secondary button.

**Loading**: while a design folds, show "Folding…" with a thin indeterminate progress line at the top of the viewer. Don't use spinners in the middle of the model or `animate-pulse` on text.

**Icons:** use Lucide only, at 16px in controls and 20px in empty states, always `strokeWidth={1.75}`. Never emoji (no 📍, ✋ or ✕ in labels). Use `MapPin`, `Hand` and `X` instead.

---

## 6. Motion

- Transitions use 120–180ms for hover, press and selection, and 200–240ms for panels and popovers, all with `var(--ease-out)`.
- Animate only `opacity`, `transform`, and `background-color`/`color`. Never animate layout or use `transition-all`.
- Fold animation in the viewer is the only long motion. Nothing else on screen should move while it plays.
- Respect `prefers-reduced-motion`: turn off UI transitions, and make the fold player jump step by step instead of easing.

---

## 7. Signs of AI-made design to remove on sight

The current UI has most of these. Remove each one you meet in a file you're working in:

- Default Tailwind **slate/gray + indigo** palettes, or switching between dark navy and light gray from one screen to the next
- **Gradients** of any kind (`bg-gradient-to-*`, gradient text, gradient borders)
- **Glassmorphism**: `backdrop-blur`, translucent `bg-*/80` panels over the 3D scene, `.glass-panel`
- Glowing or coloured shadows, and `shadow-lg`/`shadow-xl` on things that aren't floating
- **Emoji** used as icons or decoration
- **Tiny all-caps labels** (`text-[11px] uppercase tracking-wider`) used as section headings everywhere
- Pills and badges stating implementation details ("Web Worker Bar-and-Hinge", "121 V / 441 V") in the main UI
- Fake logos: a coloured square with initials ("AG")
- `rounded-2xl` and `rounded-full` on everything, and mixed radii on one screen
- `animate-pulse`, bouncing icons, hover scale-ups on buttons
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
