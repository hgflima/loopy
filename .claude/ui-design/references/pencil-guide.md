# Pencil MCP Integration Guide

Complete guide for using `/ui:pencil` — the interactive design workflow powered by Pencil MCP.

## Table of Contents

1. [Overview](#overview)
2. [Prerequisites](#prerequisites)
3. [Quick Start](#quick-start)
4. [Subcommands Reference](#subcommands-reference)
5. [Workflows](#workflows)
6. [Use Cases](#use-cases)
7. [Best Practices](#best-practices)
8. [Troubleshooting](#troubleshooting)
9. [Integration with Other Commands](#integration-with-other-commands)

---

## Overview

### What is `/ui:pencil`?

`/ui:pencil` is an interactive design command that connects the UI Design System to Pencil MCP, enabling:

- **Direct design execution** — No copy/paste, designs render immediately
- **Visual validation** — Screenshots verify designs match specs
- **Bidirectional sync** — Push specs to designs OR pull designs back to specs
- **Iterative refinement** — Make changes and see results instantly
- **Design system management** — Create and manage reusable components

### How It Differs from `/ui:export pencil`

| Aspect | `/ui:export pencil` | `/ui:pencil` |
|--------|---------------------|--------------|
| Direction | One-way (spec → design) | Bidirectional |
| Interaction | Batch operation | Interactive session |
| Feedback | End result only | Screenshots at each step |
| Iteration | Re-run export | In-session refinement |
| Components | Creates from scratch | Manages library |
| Validation | Manual | Built-in |

### When to Use Which

**Use `/ui:export pencil` when:**
- You have complete specs and want to generate all designs at once
- You're doing initial bulk creation
- You don't need interactive feedback

**Use `/ui:pencil` when:**
- You want to iterate on designs interactively
- You need to validate designs against specs
- You're managing a design system
- You want to sync changes bidirectionally
- You're exploring style options

---

## Prerequisites

### 1. Pencil MCP Server

Ensure Pencil MCP is configured in your Claude Code settings:

```json
// In your MCP configuration
{
  "mcpServers": {
    "pencil": {
      "command": "...",
      "args": ["..."]
    }
  }
}
```

### 2. UI Design System Installed

The UI Design System should be installed:

```bash
npx ui-design-cc
```

### 3. Project Initialization (Recommended)

For best results, initialize your UI specs first:

```bash
/ui:init
/ui:setup-tokens
/ui:design-screens
```

This gives `/ui:pencil` specs to work with.

---

## Quick Start

### Scenario: Create your first Pencil design

```bash
# 1. Open or create a design file
/ui:pencil open .harn/design/pencil/myapp.pen

# 2. If you have specs, push them to Pencil
/ui:pencil sync --push

# 3. Validate the results
/ui:pencil validate SCR-01

# 4. Iterate on any issues
/ui:pencil iterate SCR-01
```

### Scenario: Start from scratch with style guide

```bash
# 1. Create new design file
/ui:pencil open --new

# 2. Explore and apply a style
/ui:pencil style --explore
# Select tags: saas, modern, dashboard

# 3. Create components from specs
/ui:pencil components --create-from-specs

# 4. Build screens interactively
/ui:pencil iterate SCR-01 --from-scratch
```

---

## Subcommands Reference

### `/ui:pencil open`

Opens or creates a Pencil design file.

**Syntax:**
```bash
/ui:pencil open [file]           # Open specific file
/ui:pencil open                  # List and choose
/ui:pencil open --new            # Create new file
/ui:pencil open --template dash  # Start from template
```

**Examples:**
```bash
# Open existing file
/ui:pencil open .harn/design/pencil/app.pen

# Create new file with guided setup
/ui:pencil open --new

# Start from dashboard template
/ui:pencil open --template dashboard
```

**What happens:**
1. File opens in Pencil
2. Current contents are analyzed
3. Summary shown (screens, components, variables)
4. Offers to sync design tokens if available

---

### `/ui:pencil sync`

Bidirectional synchronization between specs and Pencil designs.

**Syntax:**
```bash
/ui:pencil sync --push           # Specs → Pencil
/ui:pencil sync --pull           # Pencil → Specs
/ui:pencil sync --diff           # Show differences
/ui:pencil sync --push SCR-01    # Single screen
/ui:pencil sync --tokens         # Only tokens
/ui:pencil sync --components     # Only components
```

**Push workflow (Specs → Pencil):**
1. Reads your `.harn/design/screens/*.md` specs
2. Compares to existing Pencil screens
3. Shows what will be created/updated
4. Asks for confirmation
5. Generates and executes operations
6. Takes screenshots for validation
7. Updates registry with node IDs

**Pull workflow (Pencil → Specs):**
1. Reads all screens from Pencil
2. Extracts structure, colors, components
3. Generates spec markdown files
4. Updates design tokens from variables
5. Updates component inventory

**Diff workflow:**
1. Compares specs to Pencil designs
2. Shows differences side-by-side
3. Does NOT make any changes
4. Suggests sync direction

**Examples:**
```bash
# Full sync from specs to Pencil
/ui:pencil sync --push

# Pull a design you modified in Pencil back to specs
/ui:pencil sync --pull SCR-01

# Check what's different without changing anything
/ui:pencil sync --diff

# Only sync design tokens
/ui:pencil sync --tokens --push
```

---

### `/ui:pencil components`

Manage design system components.

**Syntax:**
```bash
/ui:pencil components --list              # List all
/ui:pencil components --create "Badge"    # Create new
/ui:pencil components --create-from-specs # From COMPONENTS.md
/ui:pencil components --preview Button/Primary
/ui:pencil components --extract nodeId    # Make node reusable
/ui:pencil components --variants Button/Primary
```

**List:** Shows all reusable components grouped by type.

**Create:** Interactive component creation:
1. Asks for component name
2. Asks for type (button, input, card, etc.)
3. Asks for variants needed
4. Generates component with properties
5. Shows screenshot

**Create from specs:** Reads `COMPONENTS.md` and creates all:
1. Parses component specifications
2. Creates each as reusable node
3. Takes screenshots of each
4. Reports results

**Preview:** Takes screenshot of specific component.

**Extract:** Converts existing node to reusable:
1. Identifies node by ID
2. Marks as `reusable: true`
3. Assigns component name
4. Now usable as `ref` in other screens

**Examples:**
```bash
# See what components exist
/ui:pencil components --list

# Create all components from your specs
/ui:pencil components --create-from-specs

# Preview a specific component
/ui:pencil components --preview Input/Error

# I designed a nice card, make it reusable
/ui:pencil components --extract card_abc123 --name "Card/Feature"
```

---

### `/ui:pencil validate`

Visual validation against specifications.

**Syntax:**
```bash
/ui:pencil validate SCR-01       # Single screen
/ui:pencil validate all          # All screens
/ui:pencil validate --strict     # Fail on any issue
/ui:pencil validate --report     # Generate report file
```

**Validation checks:**
- Layout matches wireframe
- All components from spec present
- Colors match design tokens
- Typography matches spec
- Spacing matches spec
- States designed (if spec lists them)

**Output:**
- Screenshot of current design
- Checklist of spec requirements
- Pass/fail for each item
- Suggestions for fixes
- Option to auto-fix or iterate

**Examples:**
```bash
# Validate login screen
/ui:pencil validate SCR-01

# Validate everything and generate report
/ui:pencil validate all --report

# Strict validation (for CI/CD)
/ui:pencil validate all --strict
```

---

### `/ui:pencil iterate`

Interactive refinement session.

**Syntax:**
```bash
/ui:pencil iterate SCR-01              # Refine existing
/ui:pencil iterate SCR-01 --from-spec  # Generate first, then refine
/ui:pencil iterate --from-scratch      # Start blank
```

**How it works:**
1. Shows current screenshot
2. Asks "What would you like to change?"
3. You describe changes in natural language
4. Generates and executes operations
5. Shows new screenshot
6. Asks to keep, undo, or adjust
7. Repeat until you say "done"

**Natural language examples:**

| You say | What happens |
|---------|--------------|
| "Make the button bigger" | Increases button height and padding |
| "Add more space between inputs" | Increases gap in form group |
| "The heading should be bolder" | Changes font weight to 700 |
| "Move forgot password below the button" | Reorders elements |
| "Add a subtle border to the card" | Adds light stroke |
| "Make everything more compact" | Reduces padding and gaps |
| "Try a darker background" | Changes background color |
| "Add an icon to the Google button" | Inserts icon element |

**Session controls:**
- **"keep"** — Accept current change
- **"undo"** — Revert last change
- **"adjust"** — Modify the last change
- **"history"** — Show all changes this session
- **"done"** — End session

**Examples:**
```bash
# Interactive refinement of login screen
/ui:pencil iterate SCR-01

# Generate from spec first, then refine
/ui:pencil iterate SCR-03 --from-spec

# Start completely fresh
/ui:pencil iterate --from-scratch
```

---

### `/ui:pencil style`

Explore and apply style guides.

**Syntax:**
```bash
/ui:pencil style --explore       # Browse tags
/ui:pencil style --tags "saas,modern,dashboard"
/ui:pencil style --apply sg_123  # Apply by ID
/ui:pencil style --preview       # Preview without applying
```

**Explore workflow:**
1. Shows available style tags by category
2. You select tags that fit your project
3. Generates style guide for those tags
4. Shows color palette, typography, spacing
5. Option to apply or try different tags

**Tag categories:**
- **Platform:** mobile, webapp, website, desktop
- **Industry:** saas, ecommerce, fintech, healthcare
- **Aesthetic:** modern, minimal, bold, playful, professional
- **Color:** dark, light, colorful, monochrome
- **Layout:** dashboard, landing, forms, cards

**Apply workflow:**
1. Updates Pencil variables with style colors
2. Optionally updates existing elements
3. Shows before/after comparison

**Examples:**
```bash
# Explore what styles are available
/ui:pencil style --explore

# Get a style guide for specific tags
/ui:pencil style --tags "fintech,professional,webapp,dark"

# Preview a style before applying
/ui:pencil style --tags "playful,colorful,mobile" --preview

# Apply a previously saved style guide
/ui:pencil style --apply sg_abc123
```

---

### `/ui:pencil layout`

Debug layout and positioning issues.

**Syntax:**
```bash
/ui:pencil layout screen_abc     # Inspect specific node
/ui:pencil layout --problems     # Only show issues
/ui:pencil layout --depth 5      # Deeper inspection
```

**What it shows:**
- Tree structure of nodes
- Dimensions and positioning
- Layout mode (horizontal, vertical, grid)
- Alignment and gap values
- Problems highlighted

**Common problems detected:**
- **Clipped content** — Child larger than parent
- **Overflow** — Content exceeds bounds
- **Misalignment** — Items not aligned as expected
- **Gap issues** — Inconsistent spacing

**Fix suggestions:**
- For each problem, suggests specific operation
- Option to apply fixes automatically

**Examples:**
```bash
# Debug layout of a screen
/ui:pencil layout screen_abc123

# Show only problematic nodes
/ui:pencil layout --problems

# Deep inspection of complex layout
/ui:pencil layout screen_abc123 --depth 5
```

---

## Workflows

### Workflow 1: New Project from Specs

Best for: Starting a new project with defined specifications.

```bash
# Step 1: Initialize specs (if not done)
/ui:init
/ui:setup-tokens
/ui:design-screens

# Step 2: Open new Pencil file
/ui:pencil open --new

# Step 3: Get style inspiration
/ui:pencil style --explore
# Select: saas, modern, webapp, professional

# Step 4: Create design system components
/ui:pencil components --create-from-specs

# Step 5: Push all screens
/ui:pencil sync --push

# Step 6: Validate each screen
/ui:pencil validate all

# Step 7: Iterate on any issues
/ui:pencil iterate SCR-01
```

### Workflow 2: Rapid Prototyping

Best for: Quickly exploring design ideas without full specs.

```bash
# Step 1: Open new file
/ui:pencil open --new

# Step 2: Pick a style
/ui:pencil style --tags "minimal,webapp,light"

# Step 3: Start iterating from scratch
/ui:pencil iterate --from-scratch

# Say things like:
# "Create a login screen with email and password"
# "Add a card in the center"
# "Make it look more modern"
# "Add social login buttons"

# Step 4: When happy, pull back to specs
/ui:pencil sync --pull
```

### Workflow 3: Design System First

Best for: Building a component library before screens.

```bash
# Step 1: Open/create file
/ui:pencil open .harn/design/pencil/design-system.pen

# Step 2: Apply style guide
/ui:pencil style --tags "saas,modern,professional"

# Step 3: Create components interactively
/ui:pencil components --create "Button/Primary"
/ui:pencil components --create "Button/Secondary"
/ui:pencil components --create "Input/Default"
/ui:pencil components --create "Card/Default"
# ... etc

# Step 4: Preview and refine each
/ui:pencil components --preview Button/Primary
/ui:pencil iterate btn_primary_id

# Step 5: Build screens using components
/ui:pencil sync --push
```

### Workflow 4: Existing Design Refinement

Best for: Improving designs that already exist in Pencil.

```bash
# Step 1: Open existing file
/ui:pencil open .harn/design/pencil/app.pen

# Step 2: Check current state
/ui:pencil layout --problems

# Step 3: Fix any layout issues
# (follow suggestions)

# Step 4: Validate against specs
/ui:pencil validate all

# Step 5: Iterate on issues
/ui:pencil iterate SCR-01

# Step 6: If you made good changes, update specs
/ui:pencil sync --pull SCR-01
```

### Workflow 5: Design Review & Validation

Best for: Checking that designs match specifications.

```bash
# Step 1: Open design file
/ui:pencil open .harn/design/pencil/app.pen

# Step 2: Run full validation
/ui:pencil validate all --report

# Step 3: Review report
# Opens .harn/design/ui-exports/validation-report.md

# Step 4: Fix issues found
/ui:pencil iterate SCR-01  # For each screen with issues

# Step 5: Re-validate
/ui:pencil validate all --strict
```

### Workflow 6: Bidirectional Collaboration

Best for: When designs and specs evolve together.

```bash
# Designer made changes in Pencil...

# Step 1: Check what changed
/ui:pencil sync --diff

# Step 2: Pull design changes to specs
/ui:pencil sync --pull

# Developer updated specs...

# Step 3: Check what changed
/ui:pencil sync --diff

# Step 4: Push spec changes to design
/ui:pencil sync --push
```

---

## Use Cases

### Use Case 1: Solo Developer Building a SaaS App

**Scenario:** You're building a task management SaaS and want to design the UI before coding.

```bash
# Initialize project
/ui:init
# Answer: SaaS, web app, task management, modern aesthetic

# Set up design tokens
/ui:setup-tokens

# Design key screens
/ui:design-screens
# Define: Dashboard, Task List, Task Detail, Settings

# Open Pencil and apply style
/ui:pencil open --new
/ui:pencil style --tags "saas,modern,webapp,productivity"

# Create components
/ui:pencil components --create-from-specs

# Generate all screens
/ui:pencil sync --push

# Refine dashboard
/ui:pencil iterate SCR-01
# "Add a sidebar with navigation"
# "Make the task cards more compact"
# "Add a create task button in the header"

# Validate before coding
/ui:pencil validate all

# Export to V0 for React code
/ui:export v0
```

### Use Case 2: Exploring Multiple Design Directions

**Scenario:** You want to try different visual styles before committing.

```bash
# Create first variation
/ui:pencil open .harn/design/pencil/variation-a.pen
/ui:pencil style --tags "minimal,light,professional"
/ui:pencil sync --push

# Create second variation
/ui:pencil open .harn/design/pencil/variation-b.pen
/ui:pencil style --tags "bold,dark,modern"
/ui:pencil sync --push

# Create third variation
/ui:pencil open .harn/design/pencil/variation-c.pen
/ui:pencil style --tags "playful,colorful,friendly"
/ui:pencil sync --push

# Compare screenshots of each
/ui:pencil validate SCR-01  # In each file

# Pick favorite and continue with that file
```

### Use Case 3: Retrofitting Specs to Existing Design

**Scenario:** You have a design in Pencil but no specs.

```bash
# Open existing design
/ui:pencil open .harn/design/pencil/existing-app.pen

# Pull everything to specs
/ui:pencil sync --pull

# Review generated specs
# .harn/design/screens/*.md now populated
# .harn/design/COMPONENTS.md now populated
# .harn/design/design-tokens.json now populated

# Enhance specs with behavior details
# (manually add interactions, states, etc.)

# Validate design matches enhanced specs
/ui:pencil validate all
```

### Use Case 4: Component Library Development

**Scenario:** Building a design system for a team.

```bash
# Create design system file
/ui:pencil open .harn/design/pencil/design-system.pen --new

# Apply brand style
/ui:pencil style --tags "enterprise,professional,webapp"

# Create foundation components
/ui:pencil components --create "Typography/H1"
/ui:pencil components --create "Typography/H2"
/ui:pencil components --create "Typography/Body"

# Create interactive components
/ui:pencil components --create "Button/Primary"
/ui:pencil components --create "Button/Secondary"
/ui:pencil components --create "Button/Ghost"
/ui:pencil components --create "Button/Destructive"

/ui:pencil components --create "Input/Default"
/ui:pencil components --create "Input/Error"
/ui:pencil components --create "Input/Success"

/ui:pencil components --create "Select/Default"
/ui:pencil components --create "Checkbox"
/ui:pencil components --create "Radio"
/ui:pencil components --create "Switch"

# Create container components
/ui:pencil components --create "Card/Default"
/ui:pencil components --create "Card/Interactive"
/ui:pencil components --create "Modal"
/ui:pencil components --create "Sidebar"
/ui:pencil components --create "Header"

# Preview all components
/ui:pencil components --list

# Pull to specs for documentation
/ui:pencil sync --pull --components
```

### Use Case 5: Responsive Design Iteration

**Scenario:** Designing mobile and desktop versions.

```bash
# Open design file
/ui:pencil open .harn/design/pencil/app.pen

# Create desktop version first
/ui:pencil sync --push SCR-01

# Iterate on desktop
/ui:pencil iterate SCR-01
# Refine until happy

# Copy to create mobile version
/ui:pencil iterate SCR-01-mobile --from-scratch
# "Create mobile version of login, 375px wide"
# "Stack elements vertically"
# "Make inputs full width"
# "Increase touch target sizes"

# Validate both versions
/ui:pencil validate SCR-01
/ui:pencil validate SCR-01-mobile
```

### Use Case 6: Client Presentation Prep

**Scenario:** Need polished screenshots for a presentation.

```bash
# Open design file
/ui:pencil open .harn/design/pencil/client-app.pen

# Validate everything looks good
/ui:pencil validate all

# Fix any issues
/ui:pencil iterate SCR-01  # etc.

# Ensure consistent styling
/ui:pencil layout --problems  # Fix any layout issues

# Generate validation report with screenshots
/ui:pencil validate all --report

# Screenshots are now in the report for presentation
```

---

## Best Practices

### 1. Start with Style

Apply a style guide before creating screens:
```bash
/ui:pencil style --explore
/ui:pencil style --tags "your,relevant,tags"
```

This sets up variables and gives consistent aesthetics.

### 2. Build Components First

Create reusable components before full screens:
```bash
/ui:pencil components --create-from-specs
# or
/ui:pencil components --create "Button/Primary"
```

Components ensure consistency and make updates easier.

### 3. Validate Frequently

Run validation after significant changes:
```bash
/ui:pencil validate SCR-01
```

Catches issues before they compound.

### 4. Use Natural Language in Iterate

Be specific but natural:
```
Good: "Make the button wider and add more padding"
Good: "The heading should be larger and bold"
Good: "Add 16px space between the inputs"

Less Good: "Make it better"
Less Good: "Fix the layout"
```

### 5. Keep Sync Direction Clear

Decide source of truth and stick to it:
- **Spec-first:** Always push, only pull to capture approved changes
- **Design-first:** Always pull, only push for initial structure

### 6. Use Layout Debug for Complex Screens

When things don't look right:
```bash
/ui:pencil layout screen_id --problems
```

### 7. Extract Repeated Patterns

If you find yourself repeating something:
```bash
/ui:pencil components --extract node_id --name "Pattern/Name"
```

### 8. Commit After Major Milestones

After completing a screen or component set:
```bash
git add .harn/design/pencil/*.pen .harn/
git commit -m "docs(ui): design SCR-01 Login screen"
```

---

## Troubleshooting

### "No Pencil file open"

**Solution:**
```bash
/ui:pencil open .harn/design/pencil/app.pen
# or
/ui:pencil open --new
```

### "Cannot connect to Pencil MCP"

**Check:**
1. Pencil MCP server is running
2. MCP configuration in Claude Code settings
3. Server logs for errors

### "Operation failed / rolled back"

**Debug:**
```bash
/ui:pencil layout node_id
```

Common causes:
- Invalid node ID reference
- Parent doesn't exist
- Syntax error in operations

### "Screen not found"

**Solution:**
```bash
# List what exists
/ui:pencil open  # Shows contents

# Create missing screen
/ui:pencil sync --push SCR-XX
```

### "Validation fails but design looks correct"

**Possible causes:**
- Spec outdated — run `/ui:pencil sync --pull` to update
- Different element names — check node names match spec
- Hidden elements — check visibility and opacity

### "Style not applying correctly"

**Debug:**
```bash
# Check current variables
/ui:pencil sync --diff --tokens

# Re-apply style
/ui:pencil style --tags "..." --preview
```

### "Components not showing as reusable"

**Fix:**
```bash
# Make sure node is marked reusable
/ui:pencil components --extract node_id --name "Component/Name"
```

---

## Integration with Other Commands

### With `/ui:init`

Run `/ui:init` first to establish project context:
```bash
/ui:init
# Then
/ui:pencil open --new
```

### With `/ui:setup-tokens`

Tokens sync automatically:
```bash
/ui:setup-tokens
# Then
/ui:pencil open --new
# Offers to sync tokens
```

### With `/ui:design-screens`

Specs become source for sync:
```bash
/ui:design-screens
# Then
/ui:pencil sync --push
```

### With `/ui:export v0`

After Pencil design, export to code:
```bash
/ui:pencil iterate SCR-01  # Refine design
/ui:pencil validate SCR-01  # Validate
/ui:export v0 SCR-01  # Get React code
```

### With `/ui:realize`

Track implementation status:
```bash
/ui:pencil validate SCR-01  # Confirm design done
/ui:realize SCR-01 --source pencil  # Mark as designed
```

### With `/ui:sync`

Different from `/ui:pencil sync`:
- `/ui:sync` — Checks spec vs implementation (code)
- `/ui:pencil sync` — Syncs spec vs Pencil design

---

## Summary

`/ui:pencil` transforms UI design from a static export process into an interactive, iterative workflow:

| Subcommand | Purpose | Key Benefit |
|------------|---------|-------------|
| `open` | Open/create files | Start any session |
| `sync` | Bidirectional sync | Keep specs and designs aligned |
| `components` | Manage library | Consistent, reusable elements |
| `validate` | Check against specs | Catch issues early |
| `iterate` | Refine interactively | Immediate visual feedback |
| `style` | Apply style guides | Consistent aesthetics |
| `layout` | Debug issues | Fix positioning problems |

The key advantage is the **feedback loop** — every change produces immediate visual results, making design iteration fast and reliable.
