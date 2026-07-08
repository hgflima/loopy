# Pencil Adapter

Rules for generating Pencil MCP design operations from UI specifications.

<adapter_info>
Service: Pencil MCP
Type: Direct execution (not prompts)
Output: .pen design files via MCP tool operations
File Location: .pen files are stored in `.harn/design/pencil/` within the project directory.
Strength: Direct design execution, component systems, live validation via screenshots
Best For: Rapid prototyping, design system creation, visual validation, iterative design
Limitations: Requires Pencil MCP server, .pen format specific, learning curve for operations syntax, cannot use hidden directory paths
Key Difference: Unlike other adapters that generate prompts for manual use, Pencil executes design operations directly
</adapter_info>

<capability_matrix>

| Capability | Support | Notes |
|------------|---------|-------|
| Full screens | Excellent | Direct canvas rendering |
| Individual components | Excellent | Reusable components with `reusable: true` |
| Responsive layouts | Good | Via layout system (horizontal/vertical/grid) |
| Dark mode | Excellent | Native variables with mode extensions |
| Animations | Limited | Static designs, describe intent in specs |
| Interactive prototypes | Limited | Static output, prototyping via other tools |
| Production code | N/A | Design-focused, use V0 for code |
| Design tokens import | Excellent | Direct via `set_variables` tool |
| Iteration/refinement | Excellent | Direct Update/Replace operations |
| Component systems | Excellent | Full design system support |
| Visual validation | Excellent | Screenshot tool for verification |
| Style guides | Excellent | Built-in style guide system |
| Design systems | Excellent | Reusable components, variables, theming |

</capability_matrix>

<execution_model>

## Direct Execution vs Prompts

Unlike Stitch, V0, or Figma adapters which generate text prompts for manual use, the Pencil adapter generates **executable operations**.

| Aspect | Other Adapters | Pencil Adapter |
|--------|----------------|----------------|
| Output | Text prompts | MCP tool calls |
| Execution | Manual (copy/paste) | Automatic (direct) |
| Iteration | Re-prompt | Update operations |
| Validation | Manual inspection | Screenshot tool |
| Token sync | Manual conversion | Direct set_variables |

## Execution Flow

```
Screen Spec → Parse → Generate Operations → batch_design() → Screenshot → Validate
                                                                    ↓
                                                              If issues: Update operations → batch_design()
```

</execution_model>

<operation_syntax>

## Pencil Operation Types

All operations use JavaScript-like syntax within batch_design:

### Insert (I)
```javascript
nodeId=I(parent, { type: "frame", layout: "vertical", ... })
```

### Update (U)
```javascript
U(nodeId, { fill: "#FFFFFF", padding: 16, ... })
U("instanceId/childId", { content: "Updated text" })
```

### Copy (C)
```javascript
copy=C("sourceId", parent, { name: "Copy Name", positionDirection: "right" })
```

### Replace (R)
```javascript
newNode=R("path/to/node", { type: "text", content: "Replacement" })
```

### Move (M)
```javascript
M("nodeId", "newParent", indexPosition)
```

### Delete (D)
```javascript
D("nodeId")
```

### Generate Image (G)
```javascript
G("frameId", "ai", "modern office workspace")
G("frameId", "stock", "professional headshot")
```

## Node Types

| Type | Description | Key Properties |
|------|-------------|----------------|
| `frame` | Container/layout | layout, gap, padding, fill, placeholder |
| `text` | Text content | content, fontSize, fontWeight, fill |
| `rectangle` | Shape | width, height, fill, cornerRadius |
| `ellipse` | Circle/oval | width, height, fill |
| `ref` | Component instance | ref (component ID) |
| `group` | Visual grouping | children |

## Layout Properties

| Property | Values | Description |
|----------|--------|-------------|
| `layout` | "horizontal", "vertical", "grid" | Child arrangement |
| `gap` | number (px) | Space between children |
| `padding` | number or [t,r,b,l] | Inner padding |
| `placeholder` | true/false | Marks as content container |
| `width` | number, "fill_container", "hug_content" | Width behavior |
| `height` | number, "fill_container", "hug_content" | Height behavior |

</operation_syntax>

<transformation_rules>

## Screen Spec → Pencil Operations

### 1. Pre-flight: Get Editor State
```javascript
// Always start by checking current state
mcp__pencil__get_editor_state({ include_schema: false })
```

### 2. Setup Style Guide (if designing from scratch)
```javascript
// Get style tags and fetch appropriate guide
mcp__pencil__get_style_guide_tags()
mcp__pencil__get_style_guide({ tags: ["saas", "modern", "webapp", "clean", "professional"] })
```

### 3. Setup Design Tokens as Variables
```javascript
// Convert W3C tokens to Pencil variables
mcp__pencil__set_variables({
  filePath: ".harn/design/pencil/app.pen",
  variables: {
    "primary": {
      "$value": "#2563EB",
      "type": "color",
      "$extensions": { "mode": { "dark": "#3B82F6" } }
    },
    "background": {
      "$value": "#FFFFFF",
      "type": "color",
      "$extensions": { "mode": { "dark": "#0F172A" } }
    }
    // ... more tokens
  }
})
```

### 4. Create Screen Structure
Transform wireframe to operations:

**From Spec:**
```
┌─────────────────────────────────────────────────────┐
│                    [Background]                      │
│              ┌─────────────────────┐                │
│              │      [Logo]         │                │
│              │  "Welcome back"     │                │
│              │  [Email input]      │                │
│              │  [Password input]   │                │
│              │  [Sign In button]   │                │
│              └─────────────────────┘                │
└─────────────────────────────────────────────────────┘
```

**To Operations:**
```javascript
// Create screen frame
screen=I(document, { type: "frame", name: "Login Screen", width: 1440, height: 900, fill: "#F8FAFC" })

// Create centered card
card=I(screen, { type: "frame", name: "Login Card", layout: "vertical", gap: 24, padding: 32, fill: "#FFFFFF", cornerRadius: 8, width: 400, x: 520, y: 200 })

// Add logo placeholder
logo=I(card, { type: "frame", name: "Logo", width: 48, height: 48, fill: "#E2E8F0", cornerRadius: 8 })

// Add heading
heading=I(card, { type: "text", content: "Welcome back", fontSize: 24, fontWeight: "600", fill: "#0F172A" })

// Add email input (if using design system component)
emailInput=I(card, { type: "ref", ref: "InputFieldComponent", width: "fill_container" })
U(emailInput+"/label", { content: "Email" })
U(emailInput+"/input", { placeholder: "you@example.com" })

// Add password input
passwordInput=I(card, { type: "ref", ref: "InputFieldComponent", width: "fill_container" })
U(passwordInput+"/label", { content: "Password" })

// Add primary button
signInBtn=I(card, { type: "ref", ref: "ButtonPrimary", width: "fill_container" })
U(signInBtn+"/label", { content: "Sign In" })
```

### 5. Validate with Screenshot
```javascript
mcp__pencil__get_screenshot({ filePath: ".harn/design/pencil/app.pen", nodeId: "screenId" })
```

### 6. Iterate if Needed
```javascript
// Fix spacing
U(card, { gap: 16, padding: 24 })

// Fix colors
U(heading, { fill: "#1E293B" })

// Add missing element
forgotLink=I(card, { type: "text", content: "Forgot password?", fontSize: 14, fill: "#64748B" })
```

</transformation_rules>

<token_mapping>

## W3C Design Tokens → Pencil Variables

| Token Path | Pencil Variable | Property Usage |
|------------|-----------------|----------------|
| color.primary.default | primary | fill: "var(primary)" |
| color.primary.hover | primary-hover | fill on hover state |
| color.primary.foreground | primary-foreground | text fill on primary bg |
| color.background.default | background | fill: "var(background)" |
| color.background.subtle | background-subtle | fill for subtle areas |
| color.text.default | foreground | fill for text |
| color.text.muted | muted-foreground | fill for secondary text |
| color.border.default | border | stroke for borders |
| typography.fontFamily.sans | font-sans | fontFamily property |
| spacing.4 | space-4 | gap, padding values |
| border.radius.md | radius-md | cornerRadius property |
| shadow.md | shadow-md | effects property |

### Dark Mode Handling

Pencil variables support mode extensions:

```javascript
mcp__pencil__set_variables({
  filePath: ".harn/design/pencil/app.pen",
  variables: {
    "background": {
      "$value": "#FFFFFF",
      "type": "color",
      "$extensions": {
        "mode": {
          "dark": "#0F172A"
        }
      }
    },
    "foreground": {
      "$value": "#0F172A",
      "type": "color",
      "$extensions": {
        "mode": {
          "dark": "#F8FAFC"
        }
      }
    }
  }
})
```

### Using Variables in Operations

```javascript
// Reference variables in node properties
card=I(screen, {
  type: "frame",
  fill: "var(background)",
  // Or use direct values if variables not set up
  fill: "#FFFFFF"
})

heading=I(card, {
  type: "text",
  content: "Welcome back",
  fill: "var(foreground)"
})
```

</token_mapping>

<component_mapping>

## UI Components → Pencil Nodes

### Without Design System (Raw Nodes)

| Component | Pencil Structure |
|-----------|------------------|
| Button (primary) | `{ type: "frame", layout: "horizontal", fill: "#2563EB", padding: [12, 24], cornerRadius: 6, children: [{ type: "text", content: "Label", fill: "#FFFFFF" }] }` |
| Button (outline) | `{ type: "frame", layout: "horizontal", stroke: "#E2E8F0", strokeWidth: 1, padding: [12, 24], cornerRadius: 6 }` |
| InputField | Frame (vertical) containing: Label (text) + Input frame (rectangle with text) |
| Card | `{ type: "frame", fill: "#FFFFFF", cornerRadius: 8, padding: 24, effects: [shadow] }` |
| Avatar | `{ type: "ellipse", width: 40, height: 40, fill: imageOrColor }` |
| Badge | `{ type: "frame", fill: color, padding: [4, 8], cornerRadius: 9999 }` with text child |
| Divider | `{ type: "rectangle", width: "fill_container", height: 1, fill: "#E2E8F0" }` |

### With Design System (Component Instances)

```javascript
// First, check available components
mcp__pencil__batch_get({
  filePath: ".harn/design/pencil/app.pen",
  patterns: [{ reusable: true }],
  readDepth: 2
})

// Then use refs to instances
button=I(container, { type: "ref", ref: "ButtonPrimary" })
U(button+"/label", { content: "Sign In" })

input=I(container, { type: "ref", ref: "InputField" })
U(input+"/label", { content: "Email" })
U(input+"/placeholder", { content: "you@example.com" })
```

### Building Reusable Components

```javascript
// Create a reusable button component
buttonComp=I(document, {
  type: "frame",
  name: "Button/Primary",
  reusable: true,
  layout: "horizontal",
  padding: [12, 24],
  fill: "#2563EB",
  cornerRadius: 6
})
btnLabel=I(buttonComp, {
  type: "text",
  name: "label",
  content: "Button",
  fill: "#FFFFFF",
  fontSize: 14,
  fontWeight: "500"
})

// Now use it as a ref
btn1=I(screen, { type: "ref", ref: buttonComp })
U(btn1+"/label", { content: "Sign In" })
```

</component_mapping>

<layout_patterns>

## Common Layout Patterns

### Centered Card Layout (Login, Signup)

```javascript
screen=I(document, { type: "frame", name: "Login", width: 1440, height: 900, fill: "#F8FAFC" })
centerContainer=I(screen, { type: "frame", layout: "vertical", width: "fill_container", height: "fill_container", alignItems: "center", justifyContent: "center" })
card=I(centerContainer, { type: "frame", layout: "vertical", width: 400, padding: 32, gap: 24, fill: "#FFFFFF", cornerRadius: 8 })
```

### Sidebar + Content (Dashboard)

```javascript
screen=I(document, { type: "frame", name: "Dashboard", width: 1440, height: 900, layout: "horizontal" })
sidebar=I(screen, { type: "frame", layout: "vertical", width: 280, height: "fill_container", fill: "#0F172A", padding: 16 })
main=I(screen, { type: "frame", layout: "vertical", width: "fill_container", height: "fill_container", padding: 32, gap: 24 })
```

### Header + Content + Footer

```javascript
screen=I(document, { type: "frame", name: "Page", width: 1440, height: 900, layout: "vertical" })
header=I(screen, { type: "frame", layout: "horizontal", width: "fill_container", height: 64, padding: [0, 32], fill: "#FFFFFF" })
content=I(screen, { type: "frame", layout: "vertical", width: "fill_container", height: "fill_container", padding: 32 })
footer=I(screen, { type: "frame", layout: "horizontal", width: "fill_container", height: 80, padding: [0, 32], fill: "#F8FAFC" })
```

### Card Grid (Dashboard Widgets)

```javascript
grid=I(content, { type: "frame", layout: "grid", gap: 24, gridColumns: 3 })
card1=I(grid, { type: "frame", fill: "#FFFFFF", padding: 24, cornerRadius: 8 })
card2=I(grid, { type: "frame", fill: "#FFFFFF", padding: 24, cornerRadius: 8 })
card3=I(grid, { type: "frame", fill: "#FFFFFF", padding: 24, cornerRadius: 8 })
```

</layout_patterns>

<iteration_guidance>

## Refining Pencil Designs

### If layout is wrong:
```javascript
// Adjust container properties
U("containerId", { layout: "vertical", gap: 16, alignItems: "center" })

// Move element to different parent
M("elementId", "newParentId", 0)  // Move to position 0

// Adjust positioning
U("elementId", { x: 100, y: 50 })
```

### If colors are off:
```javascript
// Update fill colors
U("elementId", { fill: "#2563EB" })

// Update text colors
U("textId", { fill: "#0F172A" })

// Update multiple at once
U("card", { fill: "#FFFFFF", stroke: "#E2E8F0", strokeWidth: 1 })
```

### If spacing is wrong:
```javascript
// Adjust padding
U("container", { padding: 24 })
U("container", { padding: [16, 24, 16, 24] })  // [top, right, bottom, left]

// Adjust gap between children
U("container", { gap: 16 })
```

### If component is missing:
```javascript
// Insert at specific position
missing=I("parentId", { type: "text", content: "Forgot password?", fontSize: 14 })
M(missing, "parentId", 5)  // Move to position 5 among siblings
```

### If element needs replacement:
```javascript
// Replace entirely
newElement=R("oldElementId", { type: "frame", layout: "horizontal", gap: 8 })
```

### If design system component wrong:
```javascript
// Update descendant inside component instance
U("instanceId/labelId", { content: "New Label" })
U("instanceId/iconId", { fill: "#3B82F6" })
```

### Validation Loop
```javascript
// 1. Make changes
U("elementId", { fill: "#2563EB" })

// 2. Take screenshot
mcp__pencil__get_screenshot({ nodeId: "screenId" })

// 3. Review and iterate if needed
U("elementId", { fill: "#1D4ED8" })  // Adjust based on visual
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
- Card: #FFFFFF
- Text: #0F172A
- Muted: #64748B
- Border: #E2E8F0
- Font: Inter
```

**Output: Pencil Operations**

```javascript
// Step 1: Set up variables
mcp__pencil__set_variables({
  filePath: ".harn/design/pencil/app.pen",
  variables: {
    "primary": { "$value": "#2563EB", "type": "color" },
    "primary-foreground": { "$value": "#FFFFFF", "type": "color" },
    "background": { "$value": "#F8FAFC", "type": "color" },
    "card": { "$value": "#FFFFFF", "type": "color" },
    "foreground": { "$value": "#0F172A", "type": "color" },
    "muted": { "$value": "#64748B", "type": "color" },
    "border": { "$value": "#E2E8F0", "type": "color" }
  }
})

// Step 2: Create screen structure
// Operations for batch_design:

screen=I(document, { type: "frame", name: "SCR-01 Login", width: 1440, height: 900, fill: "#F8FAFC" })
center=I(screen, { type: "frame", layout: "vertical", width: "fill_container", height: "fill_container", alignItems: "center", justifyContent: "center" })
card=I(center, { type: "frame", name: "Login Card", layout: "vertical", width: 400, padding: 32, gap: 24, fill: "#FFFFFF", cornerRadius: 8 })
logo=I(card, { type: "frame", name: "Logo", width: 48, height: 48, fill: "#E2E8F0", cornerRadius: 8 })
heading=I(card, { type: "text", name: "Heading", content: "Welcome back", fontSize: 24, fontWeight: "600", fill: "#0F172A", textAlign: "center" })
formGroup=I(card, { type: "frame", layout: "vertical", gap: 16, width: "fill_container" })
emailLabel=I(formGroup, { type: "text", content: "Email", fontSize: 14, fontWeight: "500", fill: "#0F172A" })
emailInput=I(formGroup, { type: "frame", width: "fill_container", height: 40, fill: "#FFFFFF", stroke: "#E2E8F0", strokeWidth: 1, cornerRadius: 6, padding: [0, 12] })
emailPlaceholder=I(emailInput, { type: "text", content: "you@example.com", fontSize: 14, fill: "#94A3B8" })
passwordLabel=I(formGroup, { type: "text", content: "Password", fontSize: 14, fontWeight: "500", fill: "#0F172A" })
passwordInput=I(formGroup, { type: "frame", width: "fill_container", height: 40, fill: "#FFFFFF", stroke: "#E2E8F0", strokeWidth: 1, cornerRadius: 6, padding: [0, 12] })
passwordDots=I(passwordInput, { type: "text", content: "••••••••", fontSize: 14, fill: "#0F172A" })
signInBtn=I(card, { type: "frame", name: "Sign In Button", layout: "horizontal", width: "fill_container", height: 44, fill: "#2563EB", cornerRadius: 6, alignItems: "center", justifyContent: "center" })
signInLabel=I(signInBtn, { type: "text", content: "Sign In", fontSize: 14, fontWeight: "500", fill: "#FFFFFF" })
forgotLink=I(card, { type: "text", content: "Forgot password?", fontSize: 14, fill: "#64748B", textAlign: "center" })
dividerRow=I(card, { type: "frame", layout: "horizontal", gap: 12, width: "fill_container", alignItems: "center" })
dividerLeft=I(dividerRow, { type: "rectangle", width: "fill_container", height: 1, fill: "#E2E8F0" })
dividerText=I(dividerRow, { type: "text", content: "or", fontSize: 12, fill: "#94A3B8" })
dividerRight=I(dividerRow, { type: "rectangle", width: "fill_container", height: 1, fill: "#E2E8F0" })
googleBtn=I(card, { type: "frame", name: "Google Button", layout: "horizontal", width: "fill_container", height: 44, fill: "#FFFFFF", stroke: "#E2E8F0", strokeWidth: 1, cornerRadius: 6, alignItems: "center", justifyContent: "center", gap: 8 })
googleIcon=I(googleBtn, { type: "frame", width: 20, height: 20, fill: "#E2E8F0", cornerRadius: 4 })
googleLabel=I(googleBtn, { type: "text", content: "Continue with Google", fontSize: 14, fontWeight: "500", fill: "#0F172A" })

// Step 3: Validate
mcp__pencil__get_screenshot({ filePath: ".harn/design/pencil/app.pen", nodeId: screen })
```

</example_transformation>

<dark_mode>

## Dark Mode Generation

### Option 1: Variables with Mode Extensions

Set up variables that switch automatically:

```javascript
mcp__pencil__set_variables({
  filePath: ".harn/design/pencil/app.pen",
  variables: {
    "background": {
      "$value": "#F8FAFC",
      "type": "color",
      "$extensions": { "mode": { "dark": "#0F172A" } }
    },
    "card": {
      "$value": "#FFFFFF",
      "type": "color",
      "$extensions": { "mode": { "dark": "#1E293B" } }
    },
    "foreground": {
      "$value": "#0F172A",
      "type": "color",
      "$extensions": { "mode": { "dark": "#F8FAFC" } }
    },
    "muted": {
      "$value": "#64748B",
      "type": "color",
      "$extensions": { "mode": { "dark": "#94A3B8" } }
    },
    "border": {
      "$value": "#E2E8F0",
      "type": "color",
      "$extensions": { "mode": { "dark": "#334155" } }
    }
  }
})
```

### Option 2: Duplicate Screen for Dark Mode

Copy the light mode screen and update colors:

```javascript
// Copy the screen
darkScreen=C("lightScreenId", document, { name: "SCR-01 Login (Dark)", positionDirection: "right", positionPadding: 100 })

// Update colors throughout
U(darkScreen, { fill: "#0F172A" })
U(darkScreen+"/card", { fill: "#1E293B" })
U(darkScreen+"/heading", { fill: "#F8FAFC" })
// ... update all elements
```

### Option 3: Batch Replace Colors

```javascript
mcp__pencil__replace_all_matching_properties({
  filePath: ".harn/design/pencil/app.pen",
  parents: ["darkScreenId"],
  properties: {
    fillColor: [
      { from: "#F8FAFC", to: "#0F172A" },
      { from: "#FFFFFF", to: "#1E293B" },
      { from: "#0F172A", to: "#F8FAFC" },
      { from: "#64748B", to: "#94A3B8" },
      { from: "#E2E8F0", to: "#334155" }
    ]
  }
})
```

</dark_mode>

<state_variations>

## Generating Screen States

For screens with multiple states, create frames for each:

```javascript
// Find space for state variations
mcp__pencil__find_empty_space_on_canvas({
  filePath: ".harn/design/pencil/app.pen",
  nodeId: "loginScreenId",
  width: 1440,
  height: 900,
  padding: 100,
  direction: "right"
})

// Copy screen for each state
errorState=C("loginScreenId", document, { name: "SCR-01 Login (Error)", positionDirection: "right", positionPadding: 100 })

// Add error styling
U(errorState+"/emailInput", { stroke: "#EF4444", strokeWidth: 2 })
errorMsg=I(errorState+"/formGroup", { type: "text", content: "Please enter a valid email address", fontSize: 12, fill: "#EF4444" })
M(errorMsg, errorState+"/formGroup", 2)  // Position after email input

// Loading state
loadingState=C("loginScreenId", document, { name: "SCR-01 Login (Loading)", positionDirection: "right", positionPadding: 100 })
U(loadingState+"/signInBtn", { opacity: 0.7 })
U(loadingState+"/signInLabel", { content: "Signing in..." })
```

### Common States to Generate

| State | Changes |
|-------|---------|
| Default | Base design |
| Hover | Button/input hover colors |
| Focus | Focus ring on inputs |
| Error | Red borders, error messages |
| Loading | Disabled appearance, spinner |
| Success | Success colors, check icon |
| Empty | Empty state illustration + message |

</state_variations>

<reverse_sync>

## Importing from Pencil Back to Specs

### Reading Existing Designs

```javascript
// Get all screens
mcp__pencil__batch_get({
  filePath: ".harn/design/pencil/app.pen",
  patterns: [{ name: "SCR-.*" }],
  readDepth: 3
})

// Get design system components
mcp__pencil__batch_get({
  filePath: ".harn/design/pencil/app.pen",
  patterns: [{ reusable: true }],
  readDepth: 2
})

// Get current variables
mcp__pencil__get_variables({ filePath: ".harn/design/pencil/app.pen" })
```

### What Gets Tracked

```markdown
## SCR-01: Login
- Status: Designed
- Source: Pencil
- File: .harn/design/pencil/app.pen
- Node ID: screen_abc123
- Generated: 2026-01-19
- States:
  - Default: screen_abc123
  - Error: screen_def456
  - Loading: screen_ghi789
- Deviations: None
```

### Sync Workflow

1. **Check for changes:**
   - Compare spec wireframe to Pencil layout
   - Compare spec tokens to Pencil variables
   - Compare spec components to Pencil components

2. **Update spec from design:**
   - Extract layout structure
   - Extract color values used
   - Extract component inventory

3. **Update design from spec:**
   - Apply new token values
   - Add missing components
   - Fix layout deviations

</reverse_sync>

<handoff_document>

Generate alongside operations for documentation:

```markdown
# Design Handoff: SCR-01 Login

## Pencil File
- **File:** .harn/design/pencil/app.pen
- **Screen Node:** screen_abc123
- **States:** Default, Error, Loading

## Visual Verification

Screenshot attached via `get_screenshot` validation.

## Design Tokens Used

| Token | Value | Usage |
|-------|-------|-------|
| primary | #2563EB | Sign In button |
| primary-foreground | #FFFFFF | Button text |
| background | #F8FAFC | Page background |
| card | #FFFFFF | Card fill |
| foreground | #0F172A | Headings, body text |
| muted | #64748B | Secondary text, links |
| border | #E2E8F0 | Input borders, dividers |

## Components Created

| Component | Node ID | Reusable |
|-----------|---------|----------|
| Login Card | card_xyz | No (screen-specific) |
| Email Input | input_email | Could extract |
| Password Input | input_pass | Could extract |
| Primary Button | btn_signin | Could extract |
| Outline Button | btn_google | Could extract |

## Layout Structure

```
Screen (1440x900, #F8FAFC)
└── Center Container (fill, centered)
    └── Card (400px, vertical, gap:24, padding:32)
        ├── Logo (48x48)
        ├── Heading ("Welcome back")
        ├── Form Group (vertical, gap:16)
        │   ├── Email Label + Input
        │   └── Password Label + Input
        ├── Sign In Button (primary, full-width)
        ├── Forgot Link (muted)
        ├── Divider Row (line + "or" + line)
        └── Google Button (outline, full-width)
```

## States Designed

- [x] Default
- [x] Error (validation)
- [x] Loading (submitting)
- [ ] Success (redirect)

## Next Steps

1. Extract reusable components to design system
2. Generate additional states if needed
3. Export to implementation via V0 adapter

---
*Generated by UI Design System • Source: SCR-01-login.md*
```

</handoff_document>

<workflow_integration>

## Integration with UI Design System

### Export Command Usage

```bash
/ui:export pencil           # All screens
/ui:export pencil SCR-01    # Single screen
/ui:export pencil SCR-01,SCR-02  # Multiple screens
```

### Automatic Workflow

When `/ui:export pencil` is invoked:

1. **Load specs** — Read screen specs from `.harn/design/screens/`
2. **Load tokens** — Read `.harn/design/design-tokens.json`
3. **Get/create .pen file** — Open or create design file
4. **Setup variables** — Sync tokens to Pencil variables
5. **Generate operations** — Transform specs to batch_design operations
6. **Execute operations** — Call batch_design with operations
7. **Validate** — Take screenshots of generated screens
8. **Report** — Show results with screenshot previews

### Output Files

```
.harn/design/ui-exports/
├── pencil-operations.md    # Generated operations log
├── pencil-handoff.md       # Handoff documentation
└── handoffs/
    ├── SCR-01-pencil.md    # Per-screen handoff
    └── ...
```

### State Updates

```json
// .harn/design/ui-state/prompter-state.json
{
  "exports": {
    "pencil": {
      "last_export": "2026-01-19",
      "screens_exported": ["SCR-01", "SCR-02"],
      "pen_file": ".harn/design/pencil/app.pen",
      "node_mapping": {
        "SCR-01": "screen_abc123",
        "SCR-02": "screen_def456"
      }
    }
  }
}
```

</workflow_integration>

<design_system_workflow>

## Building Design Systems with Pencil

### 1. Get Design System Guidelines

```javascript
mcp__pencil__get_guidelines({ topic: "design-system" })
```

### 2. Create Component Library

```javascript
// Create components frame
dsFrame=I(document, { type: "frame", name: "Design System", layout: "vertical", gap: 48, padding: 48 })

// Button variants
buttonsSection=I(dsFrame, { type: "frame", name: "Buttons", layout: "vertical", gap: 24 })
btnPrimary=I(buttonsSection, { type: "frame", name: "Button/Primary", reusable: true, layout: "horizontal", fill: "#2563EB", padding: [12, 24], cornerRadius: 6 })
btnLabel=I(btnPrimary, { type: "text", name: "label", content: "Button", fill: "#FFFFFF", fontSize: 14, fontWeight: "500" })

btnSecondary=I(buttonsSection, { type: "frame", name: "Button/Secondary", reusable: true, layout: "horizontal", fill: "#FFFFFF", stroke: "#E2E8F0", strokeWidth: 1, padding: [12, 24], cornerRadius: 6 })
secLabel=I(btnSecondary, { type: "text", name: "label", content: "Button", fill: "#0F172A", fontSize: 14, fontWeight: "500" })

// Input fields
inputsSection=I(dsFrame, { type: "frame", name: "Inputs", layout: "vertical", gap: 24 })
inputField=I(inputsSection, { type: "frame", name: "Input/Default", reusable: true, layout: "vertical", gap: 6 })
inputLabel=I(inputField, { type: "text", name: "label", content: "Label", fill: "#0F172A", fontSize: 14, fontWeight: "500" })
inputBox=I(inputField, { type: "frame", name: "input", width: 320, height: 40, fill: "#FFFFFF", stroke: "#E2E8F0", strokeWidth: 1, cornerRadius: 6, padding: [0, 12] })
inputPlaceholder=I(inputBox, { type: "text", name: "placeholder", content: "Placeholder", fill: "#94A3B8", fontSize: 14 })
```

### 3. Use Components in Screens

```javascript
// Reference design system components
emailInput=I(formContainer, { type: "ref", ref: "Input/Default" })
U(emailInput+"/label", { content: "Email" })
U(emailInput+"/placeholder", { content: "you@example.com" })

signInBtn=I(formContainer, { type: "ref", ref: "Button/Primary" })
U(signInBtn+"/label", { content: "Sign In" })
```

</design_system_workflow>

<orchestrator_pattern>

## Multi-Screen Orchestrator Pattern

When pushing/pulling/exporting 2+ screens, the system uses an **orchestrator + subagent** pattern to prevent context window exhaustion:

1. **Orchestrator** (the main command) handles shared setup:
   - Opens the .pen file
   - Sets variables from design tokens (once)
   - Gets available reusable components (once)
   - Identifies which screens need processing

2. **Per-screen subagents** (one Task per screen) run in parallel:
   - Each agent receives self-contained context (spec, tokens, components, adapter rules)
   - Each handles all MCP operations for its screen (batch_design, get_screenshot, etc.)
   - Each runs in its own fresh context window
   - Each returns a structured result (node_id, status, issues)

3. **Orchestrator** collects results:
   - Gathers node IDs from each agent
   - Updates pencil-state.json and UI-REGISTRY.md
   - Reports combined summary

This pattern applies to:
- `/ui:pencil sync --push` (2+ screens)
- `/ui:pencil sync --pull` (2+ screens)
- `/ui:pencil validate all` (2+ screens)
- `/ui:export pencil` (2+ screens)

For single-screen operations, handle directly without subagents.

</orchestrator_pattern>

<best_practices>

**Do:**
- Always validate with `get_screenshot` after major changes
- Use variables for colors/tokens for consistency and easy updates
- Create reusable components for repeated UI patterns
- Use meaningful names for nodes (helps with updates)
- Batch related operations together (max 25 per call)
- Use `placeholder: true` on frames that will receive dynamic content
- Check existing components with `batch_get` before creating duplicates
- Follow the adapter's layout patterns for consistent structure
- Use the orchestrator pattern for multi-screen operations (2+ screens)
- Inline all necessary context when spawning per-screen subagents

**Don't:**
- Generate IDs manually (they're auto-created)
- Exceed 25 operations per batch_design call
- Forget to set up variables before referencing them
- Use absolute positioning when layout containers work better
- Skip the screenshot validation step
- Create new components when design system components exist
- Hard-code colors instead of using variables
- Nest operations incorrectly (each operation must be on its own line)
- Process multiple screens in a single context window (use orchestrator pattern)

**Operation Syntax Rules:**
- Every Insert (I), Copy (C), Replace (R) must have a binding name
- Use `+` to concatenate paths: `instanceId+"/childId"`
- Bindings only work within the same batch_design call
- Operations execute sequentially; errors roll back all operations
- Use the correct node types: frame, text, rectangle, ellipse, ref, group

</best_practices>

<diff_from_others>

## Key Differences: Pencil vs Other Adapters

| Aspect | Pencil | Stitch | V0 | Figma |
|--------|--------|--------|-----|-------|
| Output | .pen files | Visual prompts | React code | Token JSON |
| Execution | Direct MCP | Manual copy | Manual copy | Manual import |
| Iteration | Update ops | Re-prompt | Built-in UI | Manual edit |
| Validation | Screenshot | Visual check | Code review | Visual check |
| Components | Native | Limited | shadcn/ui | Native |
| Tokens | set_variables | Hex in prompt | Tailwind | Variables |
| Best for | Rapid iteration | Visual explore | Production code | Team collab |

## When to Use Pencil Instead of Others

- You want **direct execution** without copy/paste
- You need **visual validation** via screenshots
- You're building a **component library**
- You want **iterative refinement** with precise control
- You need **design token synchronization**
- You're **prototyping rapidly** with immediate feedback

## When to Use Others Instead of Pencil

- **Stitch:** Early visual exploration, marketing pages
- **V0:** Production React code, TypeScript interfaces
- **Figma:** Team collaboration, detailed design refinement
- **Generic:** Unknown tools, documentation

</diff_from_others>

<export_workflow>

## After Generating in Pencil

1. **Review with screenshot**
   ```javascript
   mcp__pencil__get_screenshot({ nodeId: "screenId" })
   ```

2. **Iterate if needed**
   ```javascript
   U("elementId", { fill: "#2563EB", cornerRadius: 8 })
   mcp__pencil__get_screenshot({ nodeId: "screenId" })
   ```

3. **Extract components** (if patterns emerge)
   - Identify repeated structures
   - Create reusable components
   - Replace instances with refs

4. **Record in system**
   ```bash
   /ui:realize SCR-01 --source pencil
   ```

5. **Export to code** (if needed)
   ```bash
   /ui:export v0 SCR-01  # Generate V0 prompts from same spec
   ```

6. **Sync check**
   ```bash
   /ui:sync  # Compare spec to Pencil design
   ```

</export_workflow>
