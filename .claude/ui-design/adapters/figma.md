# Figma Adapter

Rules for exporting design tokens and specifications for Figma.

<adapter_info>
Service: Figma
URL: https://figma.com/
Output: Design tokens as Figma Variables, setup instructions, frame specs
Strength: Full design tool, collaboration, handoff, prototyping
Best For: Design team collaboration, detailed refinement, prototyping, design handoff
Limitations: No code output (use Dev Mode), requires manual component building
</adapter_info>

<capability_matrix>

| Capability | Support | Notes |
|------------|---------|-------|
| Full screens | ✅ Excellent | Primary use case |
| Individual components | ✅ Excellent | Component system |
| Responsive layouts | ✅ Excellent | Auto layout, constraints |
| Dark mode | ✅ Excellent | Variable modes |
| Animations | ✅ Good | Prototyping, Smart Animate |
| Interactive prototypes | ✅ Excellent | Full prototyping |
| Production code | ⚠️ Via Dev Mode | Code snippets, not full code |
| Design tokens import | ✅ Native | Variables API, W3C format |
| Iteration/refinement | ✅ Excellent | Full design tool |
| Collaboration | ✅ Excellent | Real-time, comments |
| Handoff | ✅ Excellent | Dev Mode, inspect |
| Version history | ✅ Excellent | Built-in |

</capability_matrix>

<export_formats>

## 1. Figma Variables (Native W3C Support)

Figma supports W3C Design Token import. Export format:

```json
{
  "colors": {
    "primary-default": {
      "$value": "#2563EB",
      "$type": "color"
    },
    "primary-hover": {
      "$value": "#1D4ED8",
      "$type": "color"
    }
  },
  "spacing": {
    "4": {
      "$value": "16px",
      "$type": "dimension"
    }
  }
}
```

Flatten nested structure for Figma import:
- `color.primary.default` → `colors/primary-default`
- Use `/` as separator in collection names

## 2. Figma Tokens Plugin Format

For Figma Tokens plugin (legacy projects):

```json
{
  "global": {
    "colors": {
      "primary": {
        "value": "#2563EB",
        "type": "color"
      }
    }
  }
}
```

## 3. Style Dictionary Format

For Style Dictionary workflow (multi-platform):

```json
{
  "color": {
    "primary": {
      "value": "#2563EB"
    }
  }
}
```

</export_formats>

<transformation_rules>

## Design Tokens → Figma Variables

1. **Flatten hierarchy:**
   - Convert nested JSON to flat variable names
   - Use consistent separator (/ or -)

2. **Map types:**
   | W3C Type | Figma Type |
   |----------|------------|
   | color | COLOR |
   | dimension | NUMBER (strip px, convert rem) |
   | fontFamily | STRING |
   | fontWeight | NUMBER |
   | lineHeight | NUMBER |
   | shadow | EFFECT (manual setup) |
   | border | Manual setup |
   | duration | NUMBER |

3. **Create collections:**
   - Colors → Color collection
   - Typography → Typography collection
   - Spacing → Spacing collection
   - Effects → Effects collection
   - Radius → Radius collection

4. **Handle modes:**
   - If dark mode tokens exist, create as separate mode
   - Default mode = light
   - Can add more modes: high-contrast, brand-variants

5. **Alias tokens:**
   - Semantic tokens reference primitive tokens
   - `button.primary.bg` → alias to `colors.primary.default`

</transformation_rules>

<variable_structure>

Recommended Figma Variable structure:

```
📁 Primitives
├── 📁 Colors
│   ├── blue-50        #EFF6FF
│   ├── blue-100       #DBEAFE
│   ├── blue-500       #3B82F6
│   ├── blue-600       #2563EB
│   ├── blue-700       #1D4ED8
│   ├── slate-50       #F8FAFC
│   ├── slate-100      #F1F5F9
│   ├── slate-500      #64748B
│   ├── slate-700      #334155
│   ├── slate-900      #0F172A
│   └── white          #FFFFFF
│
├── 📁 Spacing
│   ├── 0.5            2px
│   ├── 1              4px
│   ├── 2              8px
│   ├── 3              12px
│   ├── 4              16px
│   ├── 6              24px
│   ├── 8              32px
│   └── 12             48px
│
├── 📁 Radius
│   ├── sm             4px
│   ├── md             6px
│   ├── lg             8px
│   ├── xl             12px
│   └── full           9999px
│
└── 📁 Typography
    ├── font-sans      Inter
    ├── font-mono      JetBrains Mono
    ├── size-xs        12px
    ├── size-sm        14px
    ├── size-base      16px
    ├── size-lg        18px
    ├── size-xl        20px
    ├── size-2xl       24px
    ├── weight-normal  400
    ├── weight-medium  500
    ├── weight-semibold 600
    └── weight-bold    700

📁 Semantic (with modes: Light, Dark)
├── 📁 Background
│   ├── default        → white (Light) / slate-900 (Dark)
│   ├── subtle         → slate-50 (Light) / slate-800 (Dark)
│   ├── muted          → slate-100 (Light) / slate-700 (Dark)
│   └── inverse        → slate-900 (Light) / white (Dark)
│
├── 📁 Foreground
│   ├── default        → slate-900 (Light) / slate-50 (Dark)
│   ├── muted          → slate-500 (Light) / slate-400 (Dark)
│   └── inverse        → white (Light) / slate-900 (Dark)
│
├── 📁 Primary
│   ├── default        → blue-600
│   ├── hover          → blue-700
│   ├── foreground     → white
│   └── muted          → blue-100 (Light) / blue-900 (Dark)
│
├── 📁 Border
│   ├── default        → slate-200 (Light) / slate-700 (Dark)
│   ├── muted          → slate-100 (Light) / slate-800 (Dark)
│   └── focus          → blue-500
│
└── 📁 Component
    ├── card-bg        → white (Light) / slate-800 (Dark)
    ├── card-border    → slate-200 (Light) / slate-700 (Dark)
    ├── input-bg       → white (Light) / slate-900 (Dark)
    └── input-border   → slate-300 (Light) / slate-600 (Dark)
```

</variable_structure>

<screen_spec_to_figma>

## Screen Spec → Figma Frame Setup

Generate frame specifications alongside token export:

### Frame Naming Convention
```
[ID] - [Name] / [Variant]

Examples:
SCR-01 - Login / Default
SCR-01 - Login / Error
SCR-01 - Login / Loading
SCR-03 - Dashboard / Desktop
SCR-03 - Dashboard / Tablet
SCR-03 - Dashboard / Mobile
```

### Frame Sizes
| Breakpoint | Width | Use For |
|------------|-------|---------|
| Mobile | 375px | iPhone SE/Mini |
| Mobile L | 428px | iPhone Pro Max |
| Tablet | 768px | iPad Mini |
| Tablet L | 1024px | iPad Pro |
| Desktop | 1440px | Standard laptop |
| Desktop L | 1920px | Large monitor |

### Auto Layout Configuration
For each screen section, specify:
- Direction: horizontal/vertical
- Gap: spacing token
- Padding: spacing token(s)
- Alignment: start/center/end
- Distribution: packed/space-between

</screen_spec_to_figma>

<component_spec_to_figma>

## Component Spec → Figma Component

### Component Naming Convention
```
[Category] / [Name] / [Variant] / [State]

Examples:
Button / Primary / Default
Button / Primary / Hover
Button / Primary / Disabled
Button / Secondary / Default
Input / Text / Default
Input / Text / Focus
Input / Text / Error
Card / Default
Card / With Header
```

### Variant Properties
| Component | Properties |
|-----------|------------|
| Button | variant (primary/secondary/ghost/destructive), size (sm/md/lg), state (default/hover/focus/disabled), loading (true/false) |
| Input | type (text/password/email), state (default/focus/error/disabled), hasLabel (true/false), hasHelper (true/false) |
| Card | hasHeader (true/false), hasFooter (true/false), size (sm/md/lg) |
| Badge | variant (default/secondary/destructive/outline), size (sm/md) |
| Avatar | size (xs/sm/md/lg/xl), hasStatus (true/false) |

### Component Structure Notes
```markdown
## Button Component

### Anatomy
- Container (auto layout horizontal, gap: 8px)
  - Leading icon (optional, 16/20/24px based on size)
  - Label (text, font-semibold)
  - Trailing icon (optional)
  - Loading spinner (replaces content when loading)

### Size Mappings
| Size | Height | Padding X | Font Size | Icon Size |
|------|--------|-----------|-----------|-----------|
| sm   | 32px   | 12px      | 14px      | 16px      |
| md   | 40px   | 16px      | 16px      | 20px      |
| lg   | 48px   | 24px      | 18px      | 24px      |

### Color Mappings (use variables)
| Variant | Background | Text | Border |
|---------|------------|------|--------|
| primary | Primary/default | Primary/foreground | none |
| secondary | Background/subtle | Foreground/default | Border/default |
| ghost | transparent | Foreground/muted | none |
| destructive | Destructive/default | Destructive/foreground | none |
```

</component_spec_to_figma>

<dark_mode_setup>

## Dark Mode with Figma Variables

Figma's Variable modes provide native dark mode support.

### Collection Structure for Modes

```
📁 Semantic (with modes: Light, Dark)
├── 📁 Background
│   ├── default        → slate-50 (Light) / slate-900 (Dark)
│   ├── subtle         → white (Light) / slate-800 (Dark)
│   └── muted          → slate-100 (Light) / slate-700 (Dark)
│
├── 📁 Foreground
│   ├── default        → slate-900 (Light) / slate-50 (Dark)
│   └── muted          → slate-500 (Light) / slate-400 (Dark)
│
├── 📁 Primary
│   ├── default        → blue-600 (both modes)
│   ├── hover          → blue-700 (both modes)
│   └── foreground     → white (both modes)
│
└── 📁 Border
    ├── default        → slate-200 (Light) / slate-700 (Dark)
    └── focus          → blue-500 (both modes)
```

### Importing Dark Mode Tokens

From `design-tokens.json`:
```json
{
  "color": {
    "background": {
      "default": {
        "$value": "#FFFFFF",
        "$type": "color",
        "$extensions": {
          "mode": { "dark": "#0F172A" }
        }
      }
    }
  }
}
```

Figma import creates:
1. Variable `background/default`
2. Mode "Light" → `#FFFFFF`
3. Mode "Dark" → `#0F172A`

### Setting Up Modes

1. Create Semantic collection
2. Add mode: "Light" (default)
3. Add mode: "Dark"
4. For each variable:
   - Set Light value
   - Switch to Dark mode
   - Set Dark value
5. Apply variables to components

### Testing Dark Mode

1. Select frame or component
2. In right panel, find "Layer" section
3. Change Variable mode to "Dark"
4. Design updates automatically

### Exporting Dark Mode

When exporting for code:
- CSS variables include both modes
- Tailwind config can reference
- Dev Mode shows both values

</dark_mode_setup>

<figma_setup_instructions>

## Setup Instructions (Generated with Export)

```markdown
# Figma Setup Instructions

## 1. Import Design Tokens

### Native Import (Figma Variables)
1. Open your Figma file
2. Go to Local Variables panel (right sidebar)
3. Click dropdown menu → "Import variables"
4. Select `figma-tokens.json`
5. Review variable mapping
6. Confirm import

### Post-Import Checklist
- [ ] Verify all colors imported correctly
- [ ] Check spacing values (should be numbers, not strings)
- [ ] Confirm typography values
- [ ] Test mode switching (Light ↔ Dark)

## 2. Set Up Collections

If not auto-created, manually organize:

1. **Primitives Collection**
   - Raw values (blue-500, spacing-4, etc.)
   - No modes needed
   - These are referenced by semantic tokens

2. **Semantic Collection**
   - Meaningful names (background/default, text/muted)
   - Add modes: Light, Dark
   - Reference primitives (alias)

## 3. Create Component Library

### Base Components (in order)
1. **Icons** - Import icon set (Lucide recommended)
2. **Button** - All variants and states
3. **Input** - Text, password, email, with states
4. **Checkbox/Radio/Switch** - Selection controls
5. **Select** - Dropdown selection
6. **Card** - Container component
7. **Badge** - Status indicators
8. **Avatar** - User images

### Composite Components (use base components)
1. **Form Field** - Label + Input + Helper/Error
2. **Navigation Item** - Icon + Label + Badge
3. **Data Table Row** - Checkbox + Cells + Actions
4. **Card variants** - With header, footer, actions

### Screen Templates
1. **Auth Layout** - Centered card on background
2. **Dashboard Layout** - Sidebar + Header + Content
3. **Settings Layout** - Tabs + Content area
4. **List Layout** - Filters + Table + Pagination

## 4. Build Screen Frames

For each screen in UI-SPEC.md:

1. Create frame at appropriate size
2. Name: "SCR-XX - [Name]"
3. Add to "Screens" page
4. Build using component instances
5. Apply auto layout matching spec
6. Use variables for all colors/spacing

### Screen States
For screens with multiple states:
- Create variants as separate frames
- Or use component variants with state property
- Link in prototype for state transitions

## 5. Set Up Prototyping

### Navigation Flows
- Connect frames for user flows
- Use "Navigate to" for screen transitions
- "Scroll to" for in-page navigation

### Interactions
- Hover states on buttons
- Focus states on inputs
- Modal open/close
- Dropdown menus

### Transitions
- Smart Animate for state changes
- Dissolve for screen transitions
- Slide for drawers/sheets

## 6. Configure Dev Mode

### Variables → CSS
Enable CSS variable export:
- Naming: kebab-case
- Format: --color-primary-default

### Component Documentation
For each component, add:
- Description
- Usage guidelines
- Related components
- Code snippet examples

## 7. Handoff Preparation

### Checklist
- [ ] All components documented
- [ ] Styles linked to variables
- [ ] Auto layout used throughout
- [ ] No detached instances
- [ ] Dev Mode annotations added
- [ ] Prototype flows complete
```

</figma_setup_instructions>

<iteration_guidance>

## When Designs Need Refinement

### Token Adjustments
After seeing designs, you may need to adjust tokens:

```markdown
## Token Updates Needed

Based on Figma review:
1. Primary blue too bright → Adjust to #1E40AF
2. Card shadow too strong → Reduce to shadow-sm
3. Body font too small → Increase base to 18px

Action: Update design-tokens.json and re-import
```

### Component Refinements
```markdown
## Component Updates

Button:
- Increase padding-x from 16px to 20px
- Add 2px border for secondary variant
- Adjust focus ring offset to 2px

Input:
- Increase height from 40px to 44px
- Add subtle background color
```

### Spec Updates
After Figma refinement, update specs:
```bash
/ui:sync --from-figma [file-url]
```
- Extracts changes from Figma
- Updates spec files
- Flags intentional deviations

</iteration_guidance>

<reverse_sync>

## Importing Figma Designs Back

After designing in Figma:

1. **Export Updated Tokens**
   - Figma → Export variables
   - Save as `figma-tokens-updated.json`
   - Run `/ui:import-tokens --source figma --file [path]`
   - System diffs against current tokens

2. **Document Changes**
   - What changed and why
   - Approved by whom
   - Update design-tokens.json

3. **Sync Screen Specs**
   - If screen layout changed, update spec
   - Run `/ui:sync --from-figma [url]`
   - Review proposed changes
   - Accept or reject each

4. **Registry Entry**
   ```markdown
   ## SCR-01: Login
   - Status: Designed
   - Source: Figma
   - Figma File: [link]
   - Last Sync: 2026-01-19
   - Deviations from Spec:
     - Card padding increased to 32px (approved)
     - Added "Remember me" checkbox (new requirement)
   - Ready for: V0 code generation
   ```

5. **Export for Code Generation**
   - From Figma designs, generate V0/Stitch prompts
   - Run `/ui:export v0 --from-figma [url]`
   - Figma designs inform the prompt

</reverse_sync>

<handoff_document>

Generate alongside export for team handoff:

```markdown
# Figma Handoff: [Project Name]

## File Structure

```
📄 [Project Name] Design System
├── 📑 Cover
├── 📑 Tokens & Styles
│   ├── Color Palette
│   ├── Typography Scale
│   ├── Spacing System
│   └── Effects
├── 📑 Components
│   ├── Buttons
│   ├── Forms
│   ├── Cards
│   ├── Navigation
│   └── Feedback
├── 📑 Screens
│   ├── Auth Screens
│   ├── Dashboard
│   ├── Settings
│   └── [Other sections]
└── 📑 Prototypes
    └── Main User Flow
```

## Variable Collections

| Collection | Modes | Token Count |
|------------|-------|-------------|
| Primitives | - | 45 |
| Semantic | Light, Dark | 28 |
| Component | - | 12 |

## Components

| Component | Variants | States |
|-----------|----------|--------|
| Button | 4 | 5 |
| Input | 3 | 4 |
| Card | 3 | 1 |
| [etc.] | | |

## Screens

| ID | Name | Breakpoints | States |
|----|------|-------------|--------|
| SCR-01 | Login | D, M | 4 |
| SCR-02 | Signup | D, M | 3 |
| SCR-03 | Dashboard | D, T, M | 2 |
| [etc.] | | | |

## How to Use This File

### For Designers
1. Duplicate file to your drafts
2. Use components from library
3. Follow auto layout patterns
4. Use variables, not raw colors

### For Developers
1. Enable Dev Mode
2. Use "Copy CSS" for styles
3. Reference variable names
4. Check component documentation

### For Reviewers
1. Use prototype for flow review
2. Leave comments on frames
3. Check responsive variants

## Links

- Specs: [link to .harn/design/ folder]
- Tokens: [link to design-tokens.json]
- Prototype: [link to prototype view]
- Dev Mode: [link to dev mode view]

---
*Generated by UI Design System • [Date]*
```

</handoff_document>

<diff_from_other_tools>

## Key Differences: Figma vs Others

| Aspect | Figma | V0 | Stitch |
|--------|-------|-----|--------|
| Output | Design files | React code | Visual designs |
| Primary use | Full design work | Code generation | Quick mockups |
| Collaboration | Excellent | Solo | Solo |
| Token import | Native | Via Tailwind | Manual |
| Prototyping | Excellent | N/A | N/A |
| Handoff | Excellent (Dev Mode) | Direct code | Export to Figma |
| Iteration | Full control | Code iteration | Re-prompt |

## When to Use Figma
- Full design system work
- Team collaboration needed
- Detailed visual refinement
- Interactive prototypes
- Client presentations
- Design-to-dev handoff

## When to Skip Figma
- Solo developer project
- Simple screens
- React implementation priority
- Time-constrained
- No design team

## Typical Flow with Figma
```
Spec → Stitch (quick visual) → Figma (refine) → V0 (code)
       or
Spec → Figma (full design) → V0 (code)
```

</diff_from_other_tools>

<export_file_structure>

Generate multiple files for Figma export:

```
ui-exports/
├── figma-tokens.json          # W3C format for native import
├── figma-tokens-plugin.json   # Figma Tokens plugin format (legacy)
├── figma-setup.md             # Setup instructions
├── figma-components.md        # Component specifications
├── figma-frames.md            # Frame/screen specifications
├── figma-handoff.md           # Team handoff document
└── figma-prototype-flows.md   # Prototype connection map
```

</export_file_structure>

<best_practices>

**Do:**
- Use variables for all colors/spacing (never raw values)
- Apply auto layout to everything
- Name layers descriptively
- Create variants for all states
- Document components in Dev Mode
- Set up modes for light/dark
- Use consistent naming conventions
- Link prototypes for user flows

**Don't:**
- Use raw hex colors (use variables)
- Create one-off styles (reuse components)
- Flatten auto layout for "quick fixes"
- Leave unnamed layers (Group 1, Frame 234)
- Skip responsive variants
- Forget to set constraints
- Detach instances unnecessarily
- Skip state variants

</best_practices>
