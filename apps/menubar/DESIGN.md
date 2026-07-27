<!-- TARGET: this DESIGN.md describes the intended native-macOS direction, not the current terminal-mimicry code. Re-run /impeccable document in scan mode once the redesign lands, to capture the real shipped tokens. -->
---
name: Loopy
description: Native macOS menubar dashboard for governing long-running agentic loops — legible at a glance, unambiguous at the gate.
colors:
  # Canonical values below are the LIGHT theme. Dark-theme mirrors live in
  # prose (§2) and the sidecar tonal ramps. Format is OKLCH by project
  # doctrine (SKILL.md "Use OKLCH"); Stitch's linter warns but accepts it.

  # Neutrals — carry ~90% of every surface (Restrained chrome)
  bg: "oklch(0.994 0 0)"
  surface: "oklch(0.975 0.001 260)"
  surface-elevated: "oklch(1 0 0)"
  border: "oklch(0.905 0.002 260)"
  border-strong: "oklch(0.84 0.003 260)"
  ink: "oklch(0.22 0.005 260)"
  ink-secondary: "oklch(0.44 0.006 260)"
  ink-tertiary: "oklch(0.56 0.006 260)"

  # Accent — the loopy signature magenta (hue ~352, from brand seed 355).
  # Interactive: primary actions, current selection, focus, the approval beacon.
  accent: "oklch(0.55 0.21 352)"
  accent-hover: "oklch(0.50 0.21 352)"
  accent-pressed: "oklch(0.45 0.20 352)"
  accent-subtle: "oklch(0.95 0.03 352)"

  # Semantic state vocabulary — appears ONLY as status dots, pills, labels.
  # Never chrome, never decoration. Standardized 1:1 with task/step status.
  state-running: "oklch(0.60 0.12 210)"
  state-running-ink: "oklch(0.50 0.13 210)"
  state-done: "oklch(0.60 0.14 150)"
  state-done-ink: "oklch(0.49 0.14 150)"
  state-blocked: "oklch(0.74 0.14 75)"
  state-blocked-ink: "oklch(0.52 0.11 75)"
  state-failed: "oklch(0.58 0.20 28)"
  state-failed-ink: "oklch(0.52 0.20 28)"
typography:
  headline:
    fontFamily: "-apple-system, 'SF Pro Text', system-ui, sans-serif"
    fontSize: "17px"
    fontWeight: 600
    lineHeight: 1.3
    letterSpacing: "-0.01em"
  title:
    fontFamily: "-apple-system, 'SF Pro Text', system-ui, sans-serif"
    fontSize: "15px"
    fontWeight: 600
    lineHeight: 1.35
    letterSpacing: "-0.005em"
  body:
    fontFamily: "-apple-system, 'SF Pro Text', system-ui, sans-serif"
    fontSize: "13px"
    fontWeight: 400
    lineHeight: 1.5
    letterSpacing: "normal"
  label:
    fontFamily: "-apple-system, 'SF Pro Text', system-ui, sans-serif"
    fontSize: "11px"
    fontWeight: 590
    lineHeight: 1.2
    letterSpacing: "0.04em"
  data:
    fontFamily: "ui-monospace, 'SF Mono', 'JetBrains Mono', Menlo, monospace"
    fontSize: "12px"
    fontWeight: 450
    lineHeight: 1.45
    letterSpacing: "normal"
rounded:
  sm: "6px"
  md: "8px"
  lg: "10px"
  pill: "999px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "12px"
  lg: "16px"
  xl: "24px"
components:
  button-primary:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.surface-elevated}"
    typography: "{typography.body}"
    rounded: "{rounded.sm}"
    padding: "6px 14px"
  button-primary-hover:
    backgroundColor: "{colors.accent-hover}"
    textColor: "{colors.surface-elevated}"
    rounded: "{rounded.sm}"
    padding: "6px 14px"
  button-secondary:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    typography: "{typography.body}"
    rounded: "{rounded.sm}"
    padding: "6px 14px"
  status-pill-running:
    backgroundColor: "{colors.accent-subtle}"
    textColor: "{colors.state-running-ink}"
    typography: "{typography.label}"
    rounded: "{rounded.pill}"
    padding: "2px 8px"
  kanban-card:
    backgroundColor: "{colors.surface-elevated}"
    textColor: "{colors.ink}"
    typography: "{typography.data}"
    rounded: "{rounded.md}"
    padding: "8px 10px"
  approval-prompt:
    backgroundColor: "{colors.surface-elevated}"
    textColor: "{colors.ink}"
    typography: "{typography.body}"
    rounded: "{rounded.lg}"
    padding: "16px"
---

# Design System: Loopy

## 1. Overview

**Creative North Star: "The Mission Control Window"**

Loopy is a window onto a process that runs without you. A dev fires a run and walks away; an agent implements, verifies, simplifies, audits, and asks for a human hand at the merge — for minutes or hours. This interface is the calm, honest pane of glass they glance at from the menu bar to know *what it's doing, whether it needs them, and that they're still in command*. It borrows the composure of a flight console: everything legible, nothing blinking without a reason, the one decision that needs a human impossible to miss. It is **vivo, transparente, sob controle** — alive, transparent, in control.

The system is built on a hard split: **neutral chrome, semantic color.** The surface — every panel, card, toolbar, popover — is native macOS neutral, light or dark following the system. Color is spent almost entirely on *meaning*: the loopy-signature magenta for what's interactive and what needs you, and a small standardized vocabulary of state hues (running, done, blocked, failed) that appear only as status dots and pills. The room is quiet; the color does the signaling.

This explicitly rejects four things, named in PRODUCT.md. It is **not terminal mimicry** — no índigo-hacker background, no monospace-everything, no ASCII glyphs as decoration; loopy was born a TUI but this app is a native macOS citizen. It is **not an "AI SaaS" dashboard** — no infinite identical card grids, no giant gradient hero-metric, no decorative glassmorphism. It is **not an overloaded devtool** — no Grafana wall of twenty competing panels; transparency means *organized* legibility, not everything at once. And it is **not a toy** — no confetti, no cute mascotry, no choreographed entrances; this is work infrastructure.

**Key Characteristics:**
- Neutral native surfaces (light + dark, system-following); color reserved for meaning.
- One signature accent (loopy magenta) for interaction, selection, and the approval beacon.
- A standardized semantic state palette, used only as indicators — never chrome.
- Sans-first native typography; monospace scoped narrowly to verbatim machine output.
- Three reading altitudes: tray badge → popover glance → full dashboard.
- Motion only where it reports a real state change.

## 2. Colors

Neutral chrome carries the room; a single magenta accent and a tight semantic-state set carry all the meaning. Restrained by default, per the product register — the palette earns its one committed accent and nothing more.

### Primary
- **Loopy Magenta** (`oklch(0.55 0.21 352)`): The signature. A confident magenta-red pulled from the brand seed and reinterpreted off the old terminal palette. It marks exactly three things and nothing else: **interactive** (primary buttons, the current selection, focus rings), **alive** (the fix-loop pulse), and — most importantly — **the human gate** (an approval waiting on the dev). The accent means *you*. Fills pair with `surface-elevated` (near-white) text; hover `oklch(0.50 0.21 352)`, pressed `oklch(0.45 0.20 352)`. As a soft selection/attention tint, `accent-subtle` (`oklch(0.95 0.03 352)`) in light, `oklch(0.30 0.07 352)` in dark.

### Secondary — Semantic State Vocabulary
Not decoration and not chrome. Each hue maps 1:1 to a task/step status and appears only as a small status dot, a pill, or a label. The `-ink` variant is the AA-safe text tone on light surfaces.
- **Running Cyan** (dot `oklch(0.60 0.12 210)`, text `oklch(0.50 0.13 210)`): work in flight. A calm teal-cyan — a deliberate thread back to the terminal's cyan, cooled and quieted. The "vivo" color.
- **Done Green** (dot `oklch(0.60 0.14 150)`, text `oklch(0.49 0.14 150)`): task merged, backlog advanced.
- **Blocked/Paused Amber** (dot `oklch(0.74 0.14 75)`, text `oklch(0.52 0.11 75)`): waiting on a dependency or a paused escalation. Amber text must be darkened hard to hit AA — hence the low-L `-ink`.
- **Failed Red-Orange** (dot `oklch(0.58 0.20 28)`, text `oklch(0.52 0.20 28)`): a check failed, a step errored. Held at hue 28 (orange-red), a clear ~35° away from the magenta accent so "failed" never reads as "interactive."
- *Skipped* and *ready* borrow neutrals (a hollow/muted dot), not their own hue — the vocabulary stays small.

### Neutral
- **Ink** (`oklch(0.22 0.005 260)`): primary text; ~14:1 on `bg`.
- **Ink Secondary** (`oklch(0.44 0.006 260)`): secondary text, metadata; comfortably AA for body.
- **Ink Tertiary** (`oklch(0.56 0.006 260)`): muted meta, disabled labels, placeholder — used only where the text is non-essential.
- **Border** (`oklch(0.905 0.002 260)`) / **Border Strong** (`oklch(0.84 0.003 260)`): hairline dividers and control outlines.
- **Surface** (`oklch(0.975 0.001 260)`) / **Surface Elevated** (`oklch(1 0 0)`): panel and card fills; elevated is the popover/menu/card-on-panel tone, paired with a shadow.
- **Bg** (`oklch(0.994 0 0)`): the window ground.

### Dark Theme Mirror
Dark is a **native neutral dark, not the old índigo `#0f0f23`.** Chroma stays near zero; depth comes from tonal layering, not tint.
- bg `oklch(0.20 0.004 260)` · surface `oklch(0.24 0.004 260)` · surface-elevated `oklch(0.28 0.005 260)` · border `oklch(0.32 0.005 260)`.
- ink `oklch(0.95 0.003 260)` · ink-secondary `oklch(0.72 0.004 260)` · ink-tertiary `oklch(0.56 0.005 260)`.
- Semantic hues brighten for dark surfaces: running `0.72`, done `0.72`, blocked `0.80`, failed `0.68`, accent `0.66` L — same hue/chroma family.

### Tertiary — Tool-Kind Vocabulary (C-0019)
When the agent calls a tool, its **family** gets a hue — but the hue rides **only on the icon glyph's stroke** (`currentColor` on the SVG), never a fill, tint, border, or pill (C1). What fills the pill/dot is the tool's **status** (`pending`/`in_progress`/`completed`/`failed`), in the state hues above. So the tool distinction never rests on hue: it rests on **shape** — which glyph paired with which pill — and survives color-blindness exactly as the state palette does.

The SDK's ten `ToolKind`s collapse into intent families: five take a new hue, two inherit (destruction *is* the danger hue; "other" stays neutral to keep the vocabulary small). Each new hue sits ≥30° from every reserved state hue in the wheel, so a tool colour never reads as "failed" or "interactive". The tokens are in `ui/tokens.css`; the family map in `ui/tool-kind.ts`.

| Family (`ToolKind`) | Token | Light | Dark |
|---|---|---|---|
| Read (`read`, `search`, `fetch`) | `--tool-read` | `oklch(0.55 0.15 240)` | `oklch(0.74 0.13 240)` |
| Write (`edit`, `move`) | `--tool-write` | `oklch(0.55 0.14 112)` | `oklch(0.74 0.13 112)` |
| Execute (`execute`) | `--tool-exec` | `oklch(0.55 0.12 180)` | `oklch(0.74 0.11 180)` |
| Think (`think`) | `--tool-think` | `oklch(0.55 0.15 270)` | `oklch(0.74 0.14 270)` |
| Govern (`switch_mode`) | `--tool-mode` | `oklch(0.55 0.15 322)` | `oklch(0.74 0.14 322)` |
| Destroy (`delete`) | `--tool-danger` | inherits `--state-failed-ink` | idem |
| Other (`other`) | `--tool-other` | inherits `--ink-tertiary` | idem |

**AA contrast — verified manually (C-0019 T-016).** The glyph is a graphical object, so the applicable bar is WCAG 1.4.11 non-text contrast (**3:1**) against the card's `--surface`. Measured ratios of the five new hues vs `--surface` in each theme (OKLCH → sRGB → relative luminance):

| Token | Light (vs `oklch(0.975)`) | Dark (vs `oklch(0.24)`) |
|---|---|---|
| `--tool-read` | 4.33:1 | 7.25:1 |
| `--tool-write` | 4.39:1 | 7.28:1 |
| `--tool-exec` | 4.12:1 | 7.49:1 |
| `--tool-think` | 4.66:1 | 6.96:1 |
| `--tool-mode` | 4.88:1 | 6.72:1 |

All five clear 3:1 in **both** themes (≥4.12:1 light, ≥6.72:1 dark) — comfortably legible even before the glyph's shape carries the meaning. The two inherited tokens ride their sources' already-verified ink tones.

### Named Rules
**The Meaning-Only Rule.** Color is spent only on meaning. If a surface, border, or piece of chrome is colored for looks rather than to signal an interactive target or a state, it is wrong. Neutrals carry the room; the magenta and the four state hues carry the signal.

**The Accent-Means-You Rule.** The magenta accent appears only where the dev is meant to look or act: interactive controls, the current selection, and — its most important job — a pending approval. Its rarity is what makes an approval impossible to miss.

**The Glyph-Only Rule.** A tool call's family hue rides **only** on its icon glyph stroke — never a fill, tint, border, or pill. Status owns the pill in the state hues; the family owns the glyph. The distinction is carried by shape, so it survives color-blindness (C1).

## 3. Typography

**UI Font:** `-apple-system` / SF Pro Text (with `system-ui`, `Segoe UI`, sans-serif fallback)
**Data/Mono Font:** `ui-monospace` / SF Mono (with JetBrains Mono, Menlo, monospace fallback)

**Character:** One native sans carries everything a person reads — headings, titles, labels, body, **and the agent's prose in the stream** (rendered as Markdown, C-0019). A single monospace is held in reserve for everything a *machine* wrote *verbatim*: task IDs where columns must align, fenced code and tool output in the stream, and log tails. This is the honest reading of "nativo macOS polido" — sans-first, with mono as the data typeface (as Xcode and Linear's code blocks do), *not* monospace-everywhere.

### Hierarchy
Fixed rem/px scale (never fluid clamp — this is product UI at consistent DPI), ratio ≈1.15.
- **Headline** (600, 17px, 1.3): the largest UI text — LaunchConfig heading, empty-state titles, section headers. Used sparingly; there is no hero here.
- **Title** (600, 15px, 1.35): card titles, panel headers, the approval question.
- **Body** (400, 13px, 1.5): default text. macOS base size. Prose capped at 65–75ch.
- **Label** (590, 11px, +0.04em, 1.2): column headers (BACKLOG · STEPS · FIM), meta keys. The *one* place tracked small caps is allowed — a standardized system label, never an eyebrow above every section.
- **Data** (450, 12px, mono, 1.45): task IDs (`T-001`), fenced code and tool output in the stream, log tails, check names — anything verbatim from the machine. The agent's prose in the stream is *not* here — it reads as `body` sans Markdown (C-0019).

### Named Rules
**The Machine-Voice Rule.** Monospace is reserved for text a machine emitted — IDs, streams, logs, check output. Everything a human reads is sans. If you're reaching for mono on a button, a heading, or a title, that's the terminal-mimicry reflex; stop.

## 4. Elevation

Depth is **flat-by-default with functional lift.** Panels, cards, and columns sit flat on their surface, separated by hairline borders and tonal steps — not shadow. Shadow is spent only where something genuinely floats above the plane: the tray popover, native menus, and the approval prompt when it commands attention. In **dark mode, shadows read poorly**, so elevation there is conveyed by *tonal layering* — a higher surface is a lighter surface (`surface` → `surface-elevated`) — with at most a soft ambient shadow on the popover.

### Shadow Vocabulary (light theme)
- **shadow-sm** (`0 1px 2px rgba(0,0,0,0.08)`): resting cards, subtle separation from panel.
- **shadow-pop** (`0 8px 32px rgba(0,0,0,0.16)`, + 1px hairline border): the tray popover and native menus.
- **shadow-gate** (`0 4px 24px rgba(0,0,0,0.14)`): the approval prompt, so the one decision that needs a human lifts off the board.

### Named Rules
**The Flat-Until-It-Floats Rule.** Surfaces are flat at rest. A shadow appears only when an element genuinely floats above the plane (popover, menu, gate) — never to decorate a card that isn't going anywhere.

## 5. Components

Every interactive component ships the full state set — default, hover, focus-visible, active, disabled, and where relevant loading and error. Half a state set is a bug.

### Buttons
- **Shape:** gently rounded (6px, `rounded.sm`), native control proportions.
- **Primary:** `accent` fill, near-white text, 6px×14px padding. The primary action of a surface (Start run, Approve). Hover `accent-hover`, active `accent-pressed`, focus a 2px accent ring at 40% offset.
- **Secondary:** `surface` fill, 1px `border-strong`, `ink` text. Neutral actions (Cancel, Stop). Hover raises fill one tonal step.
- **Ghost:** transparent, `ink-secondary` text, no border. Tertiary/inline actions. Hover fills with `surface`.
- **Disabled:** `ink-tertiary` text, no fill, no shadow, `cursor: default`.

### Status Indicator (Signature)
The core semantic surface — the visual grammar for the seven task statuses.
- **Dot:** an 8px filled circle in the state hue (`state-running` etc.); *ready* and *skipped* render as a hollow or muted-neutral dot. Never color-only — always paired with a text label or a fixed position (its Kanban column), so it survives color-blindness.
- **Pill:** state-`-ink` text on a subtle tint of the same hue, `rounded.pill`, `label` type. Used for the running/attention badge and the tray title glyph.
- **Approval beacon:** the pending-approval count renders in `accent` (the magenta), not a state hue — because it demands a *person*, not just reports a state.

### Kanban Card
- **Corner:** 8px (`rounded.md`). **Background:** `surface-elevated` on the column's `surface`. **Border:** none in light (shadow-sm separates); 1px `border` in dark (tonal only).
- **Content:** task ID in `data` mono (aligned), title in `body` sans truncated to one line, a status dot leading. A failed step shows the failing step name in `state-failed-ink`, right-aligned.
- **Motion:** moving columns is a 240ms ease-out slide — the primary "vivo" signal. The fix-loop (`goto`) reveal is a single 2s accent ring pulse, reduced-motion → a static ring.

### Approval Prompt (Signature Gate)
The most important surface in the app — the moment the run needs a human. When a gate arrives: a native notification fires, the window comes to front, and this prompt lifts on `shadow-gate`.
- **Container:** `surface-elevated`, 10px radius, 16px padding, a thin `accent` top edge to mark it as *the* attention surface.
- **Content:** the question in `title` type, the task/diff context in `body`/`data`, two unmistakable buttons — **Approve** (primary/accent) and **Reject** (secondary). Both keyboard-operable (⏎ / ⎋); a queue count shows if more gates wait.
- **Never** let a gate blend into the board. It is the one place the UI is allowed to interrupt.

### Stream Panel (Work Narrative)
The pane is a **semantic timeline of the agent's turn**, not a raw terminal transcript. The same list backs both the Run's `StreamPanel` and the Interview's `ActivityLine` (C-0019 D1). Items arrive in stream order and intercalate freely.
- **What the timeline carries:** **tool-call cards** whose status transitions live (`pending → in_progress → completed/failed`); real **diffs** — only the changed hunks, `+`/`−` coloured, never the file twice; **thoughts** collapsed by default with a "Pensando · N" counter that opens on click; the turn's **plan**; **mode** changes; and the agent's **prose rendered as Markdown with syntax-highlighted code**. An update the UI does not model still shows up as a `raw` row with its JSON behind a closed disclosure — nothing is silently dropped (D3).
- **Code IS decorated now.** The earlier direction — an undecorated pane that mimicked a raw terminal — is **revoked** (D4/D5). Fenced code is highlighted through a dedicated `--syntax-*` palette (never the `--state-*`/`--tool-*` names — a string painted "done-green" would read as a status), scoped to the mono code surface so the Meaning-Only Rule still holds (the meaning is the code's own structure).
- **Type split:** `data` mono for verbatim machine output (code, tool output, IDs, log tails); `body` sans for the agent's prose Markdown. New items fade in over 120ms (reduced-motion → instant).
- **Payloads ride whole, render on demand (D6/C3):** `content`, `rawInput`, and `rawOutput` are sent untruncated but nest inside a closed `<details>`, and the card carries `content-visibility: auto`, so a giant payload never lays out until someone opens it. The ring cap (~500 items/task) and an `elided` cut marker keep the DOM bounded without lying about what was dropped.
- **Tool colour is glyph-only** — see §2's Tool-Kind Vocabulary and **The Glyph-Only Rule**.

### View Switcher / Navigation
- A native **segmented control** (Kanban / Graph / Streams), not tabs-with-underline. `surface` track, `surface-elevated` selected segment with `ink` text and a subtle lift; unselected `ink-secondary`. The default view is Kanban.

### Tray Popover (Glance)
- The compact glance: one line — `done/total · running · ⚠ approvals` — plus **Abrir** and **Parar**. `surface-elevated`, `shadow-pop`, 12–16px padding, `body` type. The whole surface is `user-select: none`. This is the "legible at a glance" altitude; it must read in under a second.

## 6. Do's and Don'ts

### Do:
- **Do** keep chrome neutral and spend color on meaning — the magenta accent for interaction/selection/approval, the four state hues for status only.
- **Do** render the loopy magenta on approvals so the human gate is impossible to miss (**The Accent-Means-You Rule**).
- **Do** follow the system appearance: full light and dark themes, native-neutral both, switching with macOS.
- **Do** pair every status color with a label or fixed position — color-blind users must never depend on hue alone.
- **Do** hold monospace to verbatim machine output (IDs, streams, logs); everything a person reads is sans (**The Machine-Voice Rule**).
- **Do** hit WCAG AA: body ≥4.5:1, large ≥3:1, in *both* themes — use the `-ink` state variants for any colored text.
- **Do** give motion a job: a card slides because it changed columns, a chunk fades because it arrived. 150–250ms, ease-out, `prefers-reduced-motion` honored everywhere.

### Don't:
- **Don't** mimic the terminal — no índigo-hacker `#0f0f23` background, no monospace-everything, no magenta/cyan terminal color-scheme as chrome, no ASCII glyphs as decoration. (PRODUCT.md anti-reference: *mímica de terminal*.)
- **Don't** build an "AI SaaS" dashboard — no infinite identical card grids, no giant gradient hero-metric, no decorative glassmorphism, no tiny tracked eyebrow above every section. (PRODUCT.md anti-reference: *dashboard "AI SaaS"*.)
- **Don't** overload like Grafana/Datadog — no wall of twenty competing panels, no color without semantics. Transparency is *organized* legibility, not everything at once. (PRODUCT.md anti-reference: *devtool sobrecarregado*.)
- **Don't** turn it into a toy — no confetti, no cute mascot, no choreographed page-load sequences, no decorative motion. This is work infrastructure. (PRODUCT.md anti-reference: *brinquedo excessivamente animado*.)
- **Don't** use a `border-left`/`border-right` colored side-stripe on cards, list items, or the approval prompt — use a full hairline, a tint, a leading status dot, or the thin accent top-edge instead.
- **Don't** use gradient text (`background-clip: text`) or any decorative gradient. Emphasis comes from weight and size.
- **Don't** let the failed red-orange drift toward the magenta hue — keep failed at ~28° so "error" never reads as "interactive."
- **Don't** ship a component with half its states. Every interactive element needs default/hover/focus-visible/active/disabled at minimum.
