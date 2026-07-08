# Generic Adapter

Rules for generating tool-agnostic prompts that work with any AI design tool.

<adapter_info>
Service: Any AI UI generator
Output: Universal prompts that work across tools
Strength: Flexibility, future-proofing, tool-agnostic
Best For: New/unknown tools, custom workflows, documentation
Limitations: May need adjustment for specific tool quirks
</adapter_info>

<capability_matrix>

| Capability | Support | Notes |
|------------|---------|-------|
| Full screens | ✅ Works | Universal screen descriptions |
| Individual components | ✅ Works | Universal component descriptions |
| Responsive layouts | ✅ Works | Describe breakpoint behavior |
| Dark mode | ✅ Works | Describe both modes |
| Animations | ⚠️ Variable | Tool-dependent support |
| Interactive prototypes | ⚠️ Variable | Tool-dependent |
| Production code | ⚠️ Variable | Depends on tool |
| Design tokens | ✅ Works | Always include hex values |
| Iteration/refinement | ✅ Works | Clear refinement language |
| Future tools | ✅ Excellent | Main advantage |

</capability_matrix>

<prompt_structure>

## Basic Structure

```
[Screen/Component Description]

This is a [type] for [app type/purpose].

LAYOUT
[Overall structure and positioning]

ELEMENTS (top to bottom)
1. [Element description with visual details]
2. [Element description with visual details]
3. [Element description with visual details]

STYLE
- Colors: [color descriptions with hex codes]
- Typography: [font and size notes]
- Spacing: [spacing descriptions]
- Effects: [shadows, borders, etc.]

INTERACTION (if applicable)
- [Interaction descriptions]
```

## Extended Structure (Complex Screens)

```
[SCREEN TYPE] SCREEN

PURPOSE
[What this screen does, who uses it, what they accomplish]

CONTEXT
- App type: [SaaS, e-commerce, social, etc.]
- User state: [logged in, anonymous, admin, etc.]
- Where from: [previous screens that lead here]
- Where to: [screens user can navigate to]

LAYOUT
[Overall page structure]
- Container: [width, centering, background]
- Sections: [how content is divided]

CONTENT

## Section 1: [Name]
[Detailed description of section content]

Elements:
- [Element 1]: [full description with visual details, colors, sizes]
- [Element 2]: [full description]

## Section 2: [Name]
[Continue for each section]

VISUAL STYLE

Colors:
- Primary: #HEXVAL — [description of where used]
- Secondary: #HEXVAL — [description]
- Background: #HEXVAL — [description]
- Text: #HEXVAL — [description]
- Muted: #HEXVAL — [description]
- Border: #HEXVAL — [description]
- Error: #HEXVAL — [description]
- Success: #HEXVAL — [description]

Typography:
- Font: [font family name]
- Headings: [sizes, weights]
- Body: [size, line height]
- Small text: [size]

Spacing:
- Component padding: [value]
- Between elements: [value]
- Section margins: [value]

Effects:
- Shadows: [descriptions with values]
- Borders: [descriptions]
- Radius: [corner rounding values]

STATES
- Default: [description]
- Loading: [what changes]
- Error: [what changes]
- Success: [what changes]
- Empty: [what shows when no data]

RESPONSIVE
- Desktop (1440px+): [current layout]
- Tablet (768px-1439px): [changes]
- Mobile (below 768px): [changes]

ACCESSIBILITY
- [Key accessibility requirements]
```

</prompt_structure>

<transformation_rules>

## Screen Spec → Generic Prompt

1. **Describe, don't prescribe:**
   - Say what it looks like, not how to build it
   - Use visual language, not technical terms
   - Assume no specific component library

2. **Be explicit about everything:**
   - Don't assume defaults
   - Specify colors as hex codes
   - Describe spacing in pixels or relative terms
   - Mention all visual attributes

3. **Structure clearly:**
   - Use numbered lists for elements
   - Group related information
   - Include all sections even if simple

4. **Include context:**
   - What kind of app this is for
   - The purpose of the screen
   - User goal on this screen
   - Industry/domain if relevant

5. **Use universal terminology:**
   - "button" not "Button component"
   - "text entry field" not "Input"
   - "dropdown selector" not "Select"
   - "card container" not "Card"

6. **Be tool-agnostic:**
   - No component library references
   - No framework terminology
   - No CSS class names
   - Pure visual description

</transformation_rules>

<element_descriptions>

Describe UI elements in universal terms:

| Component Type | Generic Description |
|----------------|---------------------|
| Button (primary) | "A prominent button with filled background in [color], white text reading '[label]', [width] wide" |
| Button (secondary) | "A subtle button with [color] border outline, no fill, [color] text reading '[label]'" |
| Button (ghost) | "A text-only button with no background or border, [color] text reading '[label]'" |
| Button (destructive) | "A warning/danger button with red background, white text reading '[label]'" |
| Button (loading) | "Button showing a spinning indicator, text may say '[label]' or be hidden" |
| Text input | "A text entry field with '[label]' label above, placeholder text '[placeholder]', [width] wide" |
| Password input | "A password entry field showing dots/bullets instead of characters, label '[label]'" |
| Email input | "An email entry field, label '[label]', may show email validation hints" |
| Search input | "A search field with magnifying glass icon, placeholder '[placeholder]'" |
| Textarea | "A multi-line text area, approximately [rows] lines tall, label '[label]'" |
| Checkbox | "A small square checkbox with '[label]' text beside it, [checked/unchecked]" |
| Radio buttons | "A set of circular radio buttons with options: [options], currently '[selected]' is selected" |
| Toggle/Switch | "A toggle switch, currently [on/off], with label '[label]'" |
| Dropdown/Select | "A dropdown selector showing '[current value]' with a down arrow, options include: [options]" |
| Slider | "A horizontal slider from [min] to [max], currently at [value]" |
| Date picker | "A date selection field showing '[format]', opens calendar when clicked" |
| File upload | "A file upload area, may show drag-and-drop zone or button" |
| Card | "A contained section with [background] background, [shadow description], [radius] rounded corners, [padding] internal padding" |
| Modal/Dialog | "A centered overlay box on dimmed background, [width] wide, containing [summary of content]" |
| Sheet/Drawer | "A panel sliding in from the [side], [width] wide, containing [content]" |
| Avatar | "A circular user image, [size] in diameter, showing [image/initials/icon]" |
| Badge | "A small [color] pill/tag with '[text]' text, used to indicate [purpose]" |
| Icon | "A [name/description] icon, [size], [color]" |
| Navigation bar | "A horizontal bar at the [position] with [contents description]" |
| Sidebar | "A vertical panel on the [side], [width] wide, containing [contents]" |
| Tab bar | "A row of tabs with options: [tabs], '[active]' currently selected" |
| Breadcrumb | "Navigation breadcrumb showing: [path]" |
| Pagination | "Page navigation showing [current] of [total] pages with prev/next controls" |
| Progress bar | "A horizontal progress indicator at [percentage]% complete" |
| Toast/Notification | "A small notification message in [position] corner, [type]: '[message]'" |
| Alert banner | "A full-width [type] message at [position] saying '[message]'" |
| Table | "A data table with columns for [columns], showing [row count] rows of [data type]" |
| List | "A vertical list of [items], each showing [item description]" |
| Grid | "A [columns] column grid of [items], each [item description]" |
| Accordion | "Expandable sections: [sections], currently [expanded] is open" |
| Tooltip | "Small hint text '[text]' appearing on hover near [element]" |
| Loading skeleton | "Placeholder shapes indicating loading content" |
| Empty state | "A centered message for empty content: illustration, heading '[title]', text '[message]', action '[button]'" |
| Error state | "An error display showing: heading '[title]', details '[message]', action '[button]'" |

</element_descriptions>

<color_descriptions>

Describe colors clearly:

| Token | Generic Description Pattern |
|-------|----------------------------|
| Primary | "The main brand color (#HEXVAL), a [warm/cool] [descriptive] [color family]" |
| Secondary | "A supporting color (#HEXVAL) for [use case]" |
| Accent | "An accent color (#HEXVAL) for highlights and emphasis" |
| Background | "Background is [color description] (#HEXVAL)" |
| Surface | "Card/panel surfaces use [color] (#HEXVAL)" |
| Text primary | "Main text in [color description] (#HEXVAL)" |
| Text muted | "Secondary/muted text in [color] (#HEXVAL)" |
| Border | "Borders use a [light/subtle] [color] (#HEXVAL)" |
| Error | "Error states use [red shade] (#HEXVAL)" |
| Success | "Success states use [green shade] (#HEXVAL)" |
| Warning | "Warning states use [yellow/orange shade] (#HEXVAL)" |

**Examples:**
- "The main brand color is a vibrant blue (#2563EB), conveying trust and professionalism"
- "Text uses near-black (#0F172A) for readability, with muted gray (#64748B) for secondary content"
- "The page background is an off-white (#F8FAFC) that's easy on the eyes"
- "Error messages use a clear red (#DC2626) that draws attention without being harsh"

</color_descriptions>

<spacing_descriptions>

Describe spacing in understandable terms:

| Spacing | Generic Description |
|---------|---------------------|
| 4px | "tight spacing" or "minimal gap" |
| 8px | "compact spacing" |
| 12px | "cozy spacing" |
| 16px | "comfortable spacing" or "standard" |
| 24px | "generous spacing" or "spacious" |
| 32px | "very spacious" or "roomy" |
| 48px+ | "ample breathing room" or "significant space" |

**Include pixel values for precision:**
- "comfortable spacing (16px between elements)"
- "generous padding inside the card (24px all sides)"
- "tight gap (8px) between the icon and label"

**Relative descriptions:**
- "twice the standard spacing"
- "half the card padding"
- "consistent with other form fields"

</spacing_descriptions>

<typography_descriptions>

Describe typography clearly:

| Element | Description Pattern |
|---------|---------------------|
| Font family | "[Font name], a [serif/sans-serif/monospace] font that feels [modern/classic/friendly/professional]" |
| Heading 1 | "Large heading at [size], [weight], [color]" |
| Heading 2 | "Section heading at [size], [weight], [color]" |
| Body | "Body text at [size], [weight], [line height], [color]" |
| Small/Caption | "Small text at [size] for [use case]" |
| Button text | "Button labels at [size], [weight], [case]" |
| Link | "Links in [color], [underlined/not underlined]" |

**Examples:**
- "Using Inter, a clean sans-serif font that feels modern and approachable"
- "Main heading at 36px, semibold weight, dark gray"
- "Body text at 16px with 1.5 line height for comfortable reading"
- "Button labels in 14px semibold, uppercase optional"

</typography_descriptions>

<layout_descriptions>

Describe layouts without technical terms:

| Layout | Description |
|--------|-------------|
| Centered | "Content centered horizontally (and optionally vertically) on the page" |
| Left-aligned | "Content aligned to the left side" |
| Full-width | "Content spanning the full width of the screen" |
| Constrained | "Content limited to [max-width], centered within the page" |
| Two-column | "Two side-by-side columns, [ratio] split" |
| Sidebar | "[Side] sidebar ([width] wide) with main content taking remaining space" |
| Grid | "[N] columns of equal width items" |
| Stack | "Elements stacked vertically with [spacing] between them" |
| Inline | "Elements arranged horizontally in a row" |
| Sticky | "Element stays fixed at [position] when scrolling" |

</layout_descriptions>

<dark_mode>

## Dark Mode Descriptions

When design tokens include dark mode values, describe both modes.

### Detecting Dark Mode Tokens

Check for `$extensions.mode.dark` in tokens:
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

### Describing Light Mode

```
VISUAL STYLE — LIGHT MODE

Colors:
- Page background: Off-white (#F8FAFC), soft and easy on the eyes
- Card/surface: Pure white (#FFFFFF) with subtle shadow
- Primary text: Near-black (#0F172A) for excellent readability
- Secondary text: Medium gray (#64748B) for less prominent content
- Primary action: Vibrant blue (#2563EB) for buttons and links
- Borders: Light gray (#E2E8F0), barely visible but defining edges

Mood: Clean, airy, professional, daytime-friendly
```

### Describing Dark Mode

```
VISUAL STYLE — DARK MODE

Colors:
- Page background: Deep slate (#0F172A), rich and dark
- Card/surface: Slightly lighter (#1E293B) to create depth
- Primary text: Off-white (#F1F5F9) for comfortable reading
- Secondary text: Muted slate (#94A3B8) for less prominent content
- Primary action: Slightly brighter blue (#3B82F6) for visibility
- Borders: Dark gray (#334155), subtle but visible

Mood: Modern, focused, reduced eye strain, night-friendly
```

### Both Modes in One Prompt

```
Generate this screen with both LIGHT and DARK mode versions.

LAYOUT
[Same layout description for both]

CONTENT
[Same content for both]

LIGHT MODE COLORS
- Background: Light gray (#F8FAFC)
- Card: White (#FFFFFF)
- Text: Dark slate (#0F172A)
- Muted: Gray (#64748B)
- Primary: Blue (#2563EB)
- Border: Light gray (#E2E8F0)

DARK MODE COLORS
- Background: Deep slate (#0F172A)
- Card: Dark slate (#1E293B)
- Text: Off-white (#F1F5F9)
- Muted: Light slate (#94A3B8)
- Primary: Bright blue (#3B82F6)
- Border: Dark gray (#334155)

Both modes use the same layout, spacing, and typography.
The difference is purely in color values.
```

### Transition Descriptions

```
When switching modes:
- Background smoothly transitions (300ms)
- Text colors change together
- Shadows adjust for dark surfaces
- No layout shift occurs
```

</dark_mode>

<iteration_guidance>

## When Results Need Refinement

### General refinement pattern:
```
Adjust the previous design:
1. [Specific change with before/after]
2. [Specific change with before/after]
3. [Specific change with before/after]

Keep everything else the same.
```

### Layout corrections:
```
Move the [element] to [new position].
The [section] should be [above/below/left of/right of] the [other section].
Center the [element] horizontally.
Add more space between [element A] and [element B].
```

### Color corrections:
```
Change the [element] color from [current] to [new color] (#HEXVAL).
Make the overall palette feel more [warm/cool/muted/vibrant].
Increase contrast between [element] and [background].
```

### Spacing corrections:
```
Add more space between [elements].
Reduce the padding inside [container].
Make the layout feel more [spacious/compact].
Align [elements] with consistent spacing.
```

### Typography corrections:
```
Make the [heading/text] [larger/smaller].
Use [bolder/lighter] weight for [element].
Improve readability by increasing line spacing.
```

### Component corrections:
```
Make the [button/input/card] more [rounded/squared].
Add a [shadow/border] to [element].
Change [element] to appear [more prominent/more subtle].
```

### Content corrections:
```
Change the [heading/label/button text] to "[new text]".
Add a [subtitle/helper text/description] below [element].
Remove the [element] from the design.
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
│              ┌─────────────────────┐                │
│              │      [Logo]         │                │
│              │  "Welcome back"     │                │
│              │  [Email input]      │                │
│              │  [Password input]   │                │
│              │  [Sign In button]   │                │
│              │  Forgot password?   │                │
│              │  ─────── or ─────── │                │
│              │  [Google button]    │                │
│              └─────────────────────┘                │
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
```

**Output: Generic Prompt**
```
LOGIN SCREEN

PURPOSE
This is a login screen for a web application. Existing users come here to sign in to their accounts with email and password, or via Google authentication.

CONTEXT
- App type: SaaS web application
- User state: Not logged in
- User goal: Sign in to access their account

LAYOUT
The page has a light gray background (#F8FAFC). A white card is centered both horizontally and vertically on the page. The card is 400 pixels wide at maximum, with rounded corners (6px radius) and a subtle shadow beneath it.

CONTENT

## Card Container
A white card centered on the gray background.
- Maximum width: 400 pixels
- Padding: 24 pixels on all sides
- Background: white (#FFFFFF)
- Corner radius: 6 pixels
- Shadow: subtle (appears to float slightly above background)

## Inside the Card (top to bottom)

### Logo Area
A placeholder for the company logo.
- Height: 48 pixels
- Centered horizontally
- Could show an image or company initial

### Heading
Large text reading "Welcome back"
- Size: 24 pixels
- Weight: semibold (600)
- Color: dark gray (#0F172A)
- Centered horizontally
- Below the logo with some space

### Email Field
A text entry field for email address.
- Small label above: "Email" in muted gray (#64748B)
- Input field spanning full width of card content
- Placeholder text: "you@example.com" in light gray
- Light border (#E2E8F0), rounded corners (4px)
- Comfortable padding inside

### Password Field
A password entry field (input hidden with dots).
- Small label above: "Password"
- Same styling as email field
- Characters display as bullets/dots when typed

### Sign In Button
A prominent action button.
- Blue background (#2563EB)
- White text reading "Sign In"
- Spans full width of card content
- Rounded corners, comfortable vertical padding
- On hover: slightly darker blue

### Forgot Password Link
A small text link below the button.
- Text: "Forgot password?"
- Centered horizontally
- Muted gray color (#64748B)
- Smaller than body text
- Becomes underlined or primary color on hover

### Divider
A horizontal separator with text.
- Thin gray line (#E2E8F0) spanning the width
- Text "or" in the middle, breaking the line
- "or" in small, muted gray text

### Google Sign In Button
An alternative authentication option.
- White/light background with gray border (#E2E8F0)
- Google "G" icon on the left side
- Text reading "Continue with Google"
- Spans full width, same height as Sign In button

VISUAL STYLE

Colors:
- Primary action: Vibrant blue (#2563EB) — used for Sign In button
- Page background: Light gray (#F8FAFC) — subtle, not stark white
- Card background: White (#FFFFFF)
- Main text: Near-black (#0F172A) — for headings, labels
- Muted text: Slate gray (#64748B) — for placeholders, hints
- Borders: Light gray (#E2E8F0) — for inputs, dividers
- Interactive hover: Darker blue (#1D4ED8)

Typography:
- Font family: Inter (or similar clean sans-serif)
- Heading: 24px, semibold weight
- Labels: 14px, regular weight, muted color
- Body/inputs: 16px, regular weight
- Link text: 14px

Spacing:
- Inside card: 24px padding
- Between form elements: 16px
- Between label and input: 8px
- Between main button and forgot link: 12px
- Around divider: 16px above and below

Effects:
- Card shadow: Subtle (0 4px 6px with very low opacity black)
- Input border radius: 4px
- Button border radius: 6px
- Card border radius: 6px

STATES

Default: Empty form as described above

Filled:
- Email shows entered text
- Password shows bullets
- Button ready to click

Error:
- Invalid field has red border (#DC2626)
- Error message appears below in red
- Field label may turn red

Loading:
- Sign In button shows spinning indicator
- Button text may change to "Signing in..."
- Form fields slightly dimmed/disabled

RESPONSIVE

Desktop (800px+): Card centered as described

Mobile (below 800px):
- Card takes nearly full width (with small margins)
- Same vertical layout
- Touch-friendly tap targets

ACCESSIBILITY
- Labels connected to inputs
- Error messages announced to screen readers
- Focus visible on all interactive elements
- Sufficient color contrast throughout
```

</example_transformation>

<reverse_sync>

## Importing Generated Designs Back

After generating in any tool:

1. **Document the output**
   - Save/export from the tool
   - Note the tool used and date
   - Capture any variations created

2. **Track in UI System**
   ```bash
   /ui:realize --source [tool-name] --screen SCR-01
   ```
   - Records generation in UI-REGISTRY.md
   - Links to exported files

3. **Compare to spec**
   - Run `/ui:sync`
   - System analyzes for differences
   - Flags deviations for review

4. **Registry Entry**
   ```markdown
   ## SCR-01: Login
   - Status: Generated
   - Source: [Tool name]
   - Generated: 2026-01-19
   - Prompt: .harn/design/ui-exports/generic-prompts.md#scr-01
   - Output: [links to files]
   - Deviations:
     - Tool added slight animation to button (acceptable)
     - Colors match spec
   ```

</reverse_sync>

<handoff_document>

Generate alongside prompt for handoff:

```markdown
# Design Brief: Login Screen (SCR-01)

## Quick Summary
A centered login card for users to sign in with email/password or Google. Clean, minimal design conveying trust.

## Visual Requirements

### Layout
- [ ] White card centered on gray (#F8FAFC) background
- [ ] Card max-width: 400px
- [ ] Card padding: 24px
- [ ] Card shadow: subtle

### Elements (top to bottom)
- [ ] Logo placeholder, 48px tall, centered
- [ ] "Welcome back" heading, 24px semibold, centered
- [ ] Email input with label
- [ ] Password input with label
- [ ] "Sign In" primary button, full width, blue (#2563EB)
- [ ] "Forgot password?" link, centered, muted
- [ ] "or" divider line
- [ ] "Continue with Google" secondary button with icon

### Colors
| Purpose | Value |
|---------|-------|
| Primary | #2563EB |
| Background | #F8FAFC |
| Card | #FFFFFF |
| Text | #0F172A |
| Muted | #64748B |
| Border | #E2E8F0 |

### Typography
- Font: Inter (or similar sans-serif)
- Heading: 24px semibold
- Body: 16px regular
- Labels: 14px regular

### Spacing
- Card padding: 24px
- Between fields: 16px
- Label to input: 8px

## States Needed
1. Default (empty)
2. Filled
3. Error (validation)
4. Loading

## Responsive
- Mobile: Card fills width with margins

---
*Generated by UI Design System*
```

</handoff_document>

<tool_compatibility_notes>

## Adapting for Specific Tools

If using a specific tool and generic prompt doesn't work well:

### ChatGPT/DALL-E
- Focus on visual description
- Be explicit about layout positioning
- Describe as "UI mockup" or "interface design"

### Midjourney
- Add "UI design, clean interface, modern"
- Specify aspect ratio
- Less technical, more aesthetic language

### Claude Artifacts
- Can be more technical
- Describe HTML/CSS structure if helpful
- Request interactive elements

### Galileo AI
- Very visual descriptions work well
- Focus on aesthetics and feel
- Good for marketing pages

### New/Unknown Tools
- Start with basic structure
- Test and iterate
- Note what works for future use

</tool_compatibility_notes>

<diff_from_other_adapters>

## Key Differences: Generic vs Specific Adapters

| Aspect | Generic | Stitch | V0 | Figma |
|--------|---------|--------|-----|-------|
| Language | Descriptive | Visual + hex | Technical | Token-based |
| Component refs | None | Natural language | shadcn names | Figma terms |
| Code output | Never assumed | HTML/CSS/Flutter | React + Tailwind | Variables/JSON |
| Best for | Unknown tools | Quick visuals | React code | Design files |

## When to Use Generic
- Tool not yet supported by adapter
- Tool documentation incomplete
- Testing new AI design tools
- Need tool-agnostic documentation
- Fallback when specific adapter fails

## When to Use Specific Adapter
- Tool is known (Stitch, V0, Figma)
- Need optimized output
- Want tool-specific features
- Higher success rate expected

</diff_from_other_adapters>

<best_practices>

**Do:**
- Use plain English descriptions
- Include all visual details
- Provide hex codes for all colors
- Describe layout relationships
- Include interaction hints
- Use universal terminology
- Be explicit, not implicit
- Describe what you see, not how to build

**Don't:**
- Use component library names
- Assume technical knowledge
- Skip "obvious" details
- Use shorthand or abbreviations
- Reference external systems
- Use CSS class names
- Use framework terminology
- Assume defaults

</best_practices>
