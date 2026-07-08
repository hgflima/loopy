# Stitch Adapter

Rules for generating Google Stitch-optimized prompts from UI specifications.

<adapter_info>
Service: Google Stitch
URL: https://stitch.withgoogle.com/
Output: UI designs, Figma export, HTML/CSS/Flutter code
Strength: Full-page layouts, complete screens, visual fidelity
Best For: Initial visual exploration, complete screen mockups, marketing pages
Limitations: Less control over component structure, no React/Vue output
</adapter_info>

<capability_matrix>

| Capability | Support | Notes |
|------------|---------|-------|
| Full screens | ✅ Excellent | Primary use case |
| Individual components | ⚠️ Limited | Better to generate full screens |
| Responsive layouts | ✅ Good | Mention breakpoints in prompt |
| Dark mode | ✅ Good | Request explicitly |
| Animations | ⚠️ Limited | Static output, describe intent |
| Interactive prototypes | ❌ No | Export to Figma for this |
| Production code | ⚠️ Basic | HTML/CSS/Flutter, needs refinement |
| Design tokens import | ❌ No | Convert to hex values in prompt |
| Iteration/refinement | ✅ Good | Add instructions to refine |
| Figma export | ✅ Excellent | Best path to design tools |

</capability_matrix>

<prompt_structure>

## Basic Structure

```
[Screen type] for a [app type].

Layout: [layout description with positioning]

Components from [direction]:
- [Component 1 with details]
- [Component 2 with details]
- [Component 3 with details]

Color palette: [colors with hex values]
Typography: [font family]
Spacing: [spacing notes]

[Additional style notes]
```

## Extended Structure (Complex Screens)

```
[Screen type] screen for a [app type/industry] application.
[One sentence about user goal on this screen]

## Layout
[Overall structure]
- [Container/card positioning]
- [Background treatment]
- [Max widths and alignment]

## Content (top to bottom)

### [Section 1 Name]
- [Element with full visual description]
- [Element with colors, sizes, content]

### [Section 2 Name]
- [Element details]

## Visual Style
- Colors: [semantic colors with hex]
- Typography: [font family, key sizes]
- Spacing: [padding, gaps in pixels or descriptive]
- Effects: [shadows, borders, radius]
- Mood: [clean/playful/professional/etc]

## States (if applicable)
- [State 1]: [what changes]
- [State 2]: [what changes]

## Responsive Notes
- Mobile: [how it adapts]
- Tablet: [how it adapts]
```

</prompt_structure>

<transformation_rules>

## Screen Spec → Stitch Prompt

1. **Start with context:**
   - Screen type (login, dashboard, settings, etc.)
   - App type (SaaS, e-commerce, social, etc.)
   - User goal on this screen

2. **Describe layout:**
   - Overall structure (centered card, sidebar layout, full-width)
   - Max widths, alignment
   - Background treatment
   - Use ASCII wireframe as reference

3. **List components:**
   - Use "from top to bottom" or "from left to right"
   - Describe each component with visual details
   - Include actual placeholder content from spec
   - Reference content/copy from Content section

4. **Include design tokens as values:**
   - Convert token references to actual hex values
   - Primary color as hex
   - Font family name
   - Spacing in pixels

5. **Add style notes:**
   - Shadow/elevation
   - Border radius
   - Mood/feeling
   - Brand notes if applicable

6. **Include state variations:**
   - If spec has multiple states, describe each
   - Note what changes between states

7. **Responsive hints:**
   - If spec has responsive notes, summarize key changes
   - Mobile-first or desktop-first indication

</transformation_rules>

<token_mapping>

When converting design tokens for Stitch:

| Token Reference | Stitch Language |
|-----------------|-----------------|
| color.primary.default | "primary [color] #HEXVAL" |
| color.primary.hover | "darker [color] on hover #HEXVAL" |
| color.secondary.default | "secondary [color] #HEXVAL" |
| color.background.default | "white/light background" or "#HEXVAL background" |
| color.background.subtle | "subtle gray background #HEXVAL" |
| color.text.default | "dark text #HEXVAL" |
| color.text.muted | "muted/gray text #HEXVAL" |
| color.border.default | "light border #HEXVAL" |
| color.error.default | "red error color #HEXVAL" |
| color.success.default | "green success color #HEXVAL" |
| typography.fontFamily.sans | "[Font name] font family" |
| typography.fontFamily.mono | "[Font name] monospace font" |
| typography.fontSize.base | "16px base text" |
| typography.fontSize.lg | "18px large text" |
| typography.fontSize.h1 | "36px heading" |
| spacing.4 | "16px spacing" or "comfortable spacing" |
| spacing.6 | "24px spacing" or "generous spacing" |
| spacing.8 | "32px spacing" or "spacious" |
| border.radius.sm | "slightly rounded (4px)" |
| border.radius.md | "medium rounded corners (6px)" |
| border.radius.lg | "well rounded (8px)" |
| border.radius.full | "fully rounded/pill shape" |
| shadow.sm | "subtle/light shadow" |
| shadow.md | "medium shadow" or "soft shadow" |
| shadow.lg | "prominent shadow" |

</token_mapping>

<component_descriptions>

Describe components in Stitch-friendly language:

| Component | Stitch Description |
|-----------|-------------------|
| Button (primary) | "Primary [color] button with white text '[label]', [width] width, rounded corners" |
| Button (secondary) | "Outlined button with [color] border, no fill, '[label]' text" |
| Button (ghost) | "Text-only button '[label]' with no background" |
| Button (destructive) | "Red danger button '[label]'" |
| InputField | "[Type] input field with '[label]' label above, placeholder '[placeholder]'" |
| InputField (error) | "Input field with red border, error message '[message]' below" |
| TextArea | "Multi-line text area, [rows] rows tall, label '[label]'" |
| Select/Dropdown | "Dropdown selector showing '[default]' with chevron down icon" |
| Checkbox | "Small checkbox with '[label]' text beside it" |
| Radio | "Radio button option '[label]'" |
| Switch/Toggle | "Toggle switch, currently [on/off], label '[label]'" |
| Card | "Card with [color] background, [shadow] shadow, [radius] rounded corners, [padding] padding" |
| Modal | "Centered modal overlay on dimmed background, [width] wide, containing [content]" |
| Navbar | "Top navigation bar with [logo] on left, [links] in center/right" |
| Sidebar | "Left sidebar [width] wide with [content], [color] background" |
| Avatar | "Circular user avatar, [size] diameter, showing [image/initials]" |
| Badge | "Small [color] badge with '[text]' label" |
| Alert | "[Type] alert box with icon, message '[message]'" |
| Toast | "Toast notification in [position] corner showing '[message]'" |
| Table | "Data table with columns: [columns], [rows] rows" |
| Tabs | "Tab bar with tabs: [tabs], '[active]' active" |
| Breadcrumb | "Breadcrumb navigation: [path]" |
| Pagination | "Pagination showing page [n] of [total]" |
| Progress | "Progress bar at [percentage]%" |
| Skeleton | "Loading skeleton placeholder for [element]" |
| Divider | "Horizontal divider line" or "Divider with '[text]' in center" |
| Empty state | "Empty state with [illustration], heading '[title]', text '[message]', action '[button]'" |

</component_descriptions>

<iteration_guidance>

## When Results Need Refinement

### If layout is wrong:
```
Refine: Move [element] to [position]. The [section] should be [above/below/left of] the [other section].
```

### If colors are off:
```
Refine: Change the [element] color to #HEXVAL. The overall palette should feel more [warm/cool/muted/vibrant].
```

### If spacing is wrong:
```
Refine: Add more space between [element] and [element]. The overall layout should feel more [spacious/compact].
```

### If component style is wrong:
```
Refine: Make the [button/input/card] more [rounded/squared/minimal/prominent].
```

### If content is wrong:
```
Refine: Change the [heading/text/label] to say "[new text]".
```

### General refinement pattern:
```
Keep the current design but:
1. [Change 1]
2. [Change 2]
3. [Change 3]
```

</iteration_guidance>

<example_transformation>

**Input: Screen Spec**
```markdown
# SCR-01: Login

Route: /login
Layout: centered-card (max-width: 400px)

## Purpose
Allow existing users to sign in to their account.

## Wireframe
┌─────────────────────────────────────────────────────┐
│                    [Background]                      │
│                                                      │
│              ┌─────────────────────┐                │
│              │      [Logo]         │                │
│              │                     │                │
│              │  "Welcome back"     │                │
│              │                     │                │
│              │  [Email input]      │                │
│              │  [Password input]   │                │
│              │                     │                │
│              │  [Sign In button]   │                │
│              │                     │                │
│              │  Forgot password?   │                │
│              │  ─────── or ─────── │                │
│              │  [Google button]    │                │
│              └─────────────────────┘                │
│                                                      │
└─────────────────────────────────────────────────────┘

## Components
1. Logo — centered, 48px height
2. Heading — "Welcome back", typography.h2
3. InputField — label: "Email", type: email, placeholder: "you@example.com"
4. InputField — label: "Password", type: password
5. Button — label: "Sign In", variant: primary, fullWidth
6. Link — "Forgot password?", centered
7. Divider — text: "or"
8. Button — label: "Continue with Google", variant: secondary, icon: google, fullWidth

## Design Tokens
- Primary: #2563EB
- Background: #F8FAFC
- Text: #0F172A
- Muted: #64748B
- Border: #E2E8F0
- Font: Inter
```

**Output: Stitch Prompt**
```
Login screen for a SaaS application.
The user wants to sign in to access their account.

## Layout
Centered card on light gray background (#F8FAFC).
- Card: white, max width 400px, horizontally and vertically centered
- Card has subtle shadow and rounded corners (6px)
- Card padding: 24px all sides

## Content (top to bottom)

### Header
- Logo placeholder: 48px height, centered horizontally, subtle gray placeholder
- Heading: "Welcome back" in 24px semibold text, centered, dark gray (#0F172A)

### Form
- Email input field:
  - Label "Email" above in small text (#64748B)
  - Input with light border (#E2E8F0), rounded corners
  - Placeholder: "you@example.com"
  - Full width

- Password input field:
  - Label "Password" above
  - Password dots for input masking
  - Same style as email input
  - Full width

- Primary button "Sign In":
  - Blue background (#2563EB)
  - White text, semibold
  - Full width, rounded corners
  - Comfortable padding

### Footer
- "Forgot password?" link:
  - Centered, small text
  - Muted gray color (#64748B)
  - Underline on hover implied

- Horizontal divider with "or" in the center:
  - Light gray line (#E2E8F0)
  - "or" text in small muted style

- Secondary button "Continue with Google":
  - White/light background with gray border
  - Google "G" icon on the left
  - Full width, same height as primary button

## Visual Style
- Colors: Primary blue #2563EB, text dark #0F172A, muted #64748B, borders #E2E8F0, background #F8FAFC
- Typography: Inter font family, clean and modern
- Spacing: 16px between form elements, 24px card padding, 8px between label and input
- Effects: Subtle shadow on card (0 4px 6px rgba(0,0,0,0.05))
- Mood: Clean, professional, trustworthy
```

</example_transformation>

<dark_mode>

## Dark Mode Generation

When design tokens include dark mode values, generate separate prompts:

### Detecting Dark Mode Tokens

Check `design-tokens.json` for:
```json
{
  "color": {
    "background": {
      "default": {
        "$value": "#FFFFFF",
        "$extensions": {
          "mode": { "dark": "#0F172A" }
        }
      }
    }
  }
}
```

### Light Mode Prompt

Use the primary `$value` for all tokens:
```
Login screen for a SaaS application.
[... standard prompt ...]

LIGHT THEME
- Background: light gray (#F8FAFC)
- Card: white (#FFFFFF)
- Text: dark slate (#0F172A)
- Muted text: gray (#64748B)
```

### Dark Mode Prompt

Extract `$extensions.mode.dark` values:
```
Login screen for a SaaS application.
[... same structure ...]

DARK THEME
- Background: deep slate (#0F172A)
- Card: dark gray (#1E293B)
- Text: light gray (#F1F5F9)
- Muted text: slate (#94A3B8)
- Maintain the same blue primary (#3B82F6)

The overall mood is dark and modern, with high contrast for readability.
```

### Both Modes in One Prompt

```
Generate this login screen in both LIGHT and DARK modes:

LIGHT MODE:
- Background: #F8FAFC
- Card: #FFFFFF
- Text: #0F172A
[...]

DARK MODE:
- Background: #0F172A
- Card: #1E293B
- Text: #F1F5F9
[...]

Use the same layout and components for both, only changing colors.
```

</dark_mode>

<state_variations>

When generating multiple states, create separate prompts or use:

```
Generate the login screen in these states:

STATE 1: Default (empty form)
[Description]

STATE 2: Filled (user has entered data)
- Email shows "user@example.com"
- Password shows dots (filled)
- Sign In button appears ready

STATE 3: Error (validation failed)
- Email input has red border
- Error message below: "Please enter a valid email"
- Button still enabled

STATE 4: Loading (form submitted)
- Sign In button shows loading spinner
- Button text: "Signing in..."
- Inputs slightly dimmed
```

</state_variations>

<reverse_sync>

## Importing Generated Designs Back

After generating in Stitch and exporting:

1. **Figma Export Path (Recommended)**
   - Export to Figma from Stitch
   - Use `/ui:realize --import figma [file-url]` to analyze
   - System extracts: colors used, components identified, layout structure
   - Updates UI-REGISTRY.md with implementation status

2. **Code Export Path**
   - Export HTML/CSS or Flutter from Stitch
   - Use `/ui:import-design --source stitch --files [paths]`
   - System analyzes: component structure, styles used, deviations from spec
   - Flags any mismatches for review

3. **What Gets Tracked**
   ```markdown
   ## SCR-01: Login
   - Status: Generated
   - Source: Stitch
   - Generated: 2026-01-19
   - Exported to: Figma
   - Deviations: None identified
   - Files:
     - figma: [link]
     - stitch-prompt-v1.md
   ```

</reverse_sync>

<handoff_document>

Generate alongside prompt for designer handoff:

```markdown
# Design Brief: Login Screen (SCR-01)

## Quick Summary
A clean login screen for SaaS users to access their accounts. Centered card layout on subtle background.

## Key Requirements
- [ ] Card centered both horizontally and vertically
- [ ] Logo placeholder at top (48px)
- [ ] Email and password inputs with labels
- [ ] Primary action: "Sign In" (blue, full width)
- [ ] Secondary: Google sign-in option
- [ ] "Forgot password?" link between them

## Design Tokens
| Token | Value |
|-------|-------|
| Primary | #2563EB |
| Background | #F8FAFC |
| Text | #0F172A |
| Muted | #64748B |
| Border | #E2E8F0 |
| Font | Inter |
| Card radius | 6px |
| Card shadow | subtle |

## Accessibility Notes
- Focus states on all interactive elements
- Min 4.5:1 contrast ratio for text
- Labels associated with inputs

## States Needed
1. Default (empty)
2. Filled
3. Error (validation)
4. Loading (submitting)

## Related Screens
- SCR-02: Signup (similar layout)
- SCR-03: Forgot Password (same card style)

---
*Generated by UI Design System • Source: SCR-01-login.md*
```

</handoff_document>

<best_practices>

**Do:**
- Be specific about colors (always use hex codes)
- Mention positioning explicitly (centered, left-aligned, etc.)
- Describe spacing in pixels AND descriptive terms
- Include actual placeholder content from spec
- Specify button widths (full width vs. auto)
- Include the user goal/context
- Reference the ASCII wireframe structure
- Describe mood/feeling for subjective guidance

**Don't:**
- Use technical component names (say "input field" not "InputField")
- Reference token names directly in prompts (use values)
- Assume Stitch knows your design system
- Skip describing "obvious" elements (describe everything)
- Forget to mention font family
- Leave out shadow/elevation details
- Skip responsive hints for complex layouts

</best_practices>

<export_workflow>

## After Generating in Stitch

1. **Review the output**
   - Does layout match wireframe?
   - Are colors correct?
   - Are all elements present?
   - Does it feel right?

2. **Iterate if needed**
   - Use refinement prompts (see iteration_guidance)
   - Keep prompts focused on specific changes
   - Track versions: v1, v2, v3...

3. **Export decision:**
   | Export To | Best For |
   |-----------|----------|
   | Figma | Further refinement, team review, prototyping |
   | HTML/CSS | Quick static prototype |
   | Flutter | Mobile-first implementations |

4. **Record in system:**
   - Run `/ui:realize` to track the generation
   - Update UI-REGISTRY.md
   - Note any deviations

5. **Sync back:**
   - If modifications were made in Figma, run `/ui:sync`
   - System will flag spec vs. implementation differences

</export_workflow>
