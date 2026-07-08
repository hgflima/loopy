---
name: ui:scan
description: Scan existing codebase to discover all UI components, screens, and design tokens
allowed-tools: [Read, Write, Edit, Glob, Grep, Bash, Task]
agent: ui-scanner
---

<objective>
Reverse-engineer an existing codebase to extract a complete inventory of UI elements. Discovers all components, screens/routes, design tokens from styles, and reusable patterns. Outputs CODE-ANALYSIS.md for review before spec generation.

**Use case:** You have a built app but no design documentation. This command creates the foundation for design tool export.
</objective>

<context>
@./.claude/ui-design/templates/code-analysis.md
@./.claude/agents/ui-scanner.md
</context>

<ux_principles>
## Non-Invasive Scanning

- Never modify source files
- Only read and analyze
- Handle errors gracefully (skip unreadable files)

## Progressive Discovery

- Start with quick detection
- Ask before deep scanning large codebases
- Report progress for long scans

## Clear Output

- Summarize findings immediately
- Write detailed analysis to file
- Recommend next steps
</ux_principles>

<process>

<step name="check_prerequisites">
## Check Prerequisites

1. **Check for existing scan:**
   - If `.harn/design/CODE-ANALYSIS.md` exists, ask:
     - "Rescan from scratch (overwrites previous)"
     - "Incremental scan (updates existing)"
     - "Cancel"

2. **Check for existing specs:**
   - If `.harn/design/UI-SPEC.md` exists, warn that this is a reverse workflow
   - Suggest `/ui:sync` instead if they want to analyze drift

3. **Create .harn/design/ if needed:**
   - `mkdir -p .harn/design/ui-state`
</step>

<step name="quick_detection">
## Quick Framework Detection

Run fast detection checks:

```
Check for package.json → Extract framework from dependencies
Check for tailwind.config.* → Tailwind CSS styling
Check for tsconfig.json → TypeScript
Check for next.config.* → Next.js
Check for vite.config.* → Vite
Check for app/ or pages/ → Routing type
Check for components/ → Component directory
```

Report detected stack:
```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 UI ► QUICK DETECTION
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Framework:  [Next.js 14]
Styling:    [Tailwind CSS]
Language:   [TypeScript]
Routing:    [App Router - app/ directory]
Components: [~45 files in components/]

Proceed with full scan?
```
</step>

<step name="estimate_scope">
## Estimate Scan Scope

Count files to estimate scan size:

```bash
# Count component files
find . -path ./node_modules -prune -o -name "*.tsx" -print | wc -l
find . -path ./node_modules -prune -o -name "*.jsx" -print | wc -l

# Count style files
find . -path ./node_modules -prune -o -name "*.css" -print | wc -l
```

For large codebases (>200 component files):
- Warn about scan duration
- Offer to limit scope (e.g., only components/, only pages/)
</step>

<step name="spawn_scanner">
## Spawn UI Scanner Agent

For any codebase, spawn the UI Scanner agent:

Provide to agent:
- Detected framework
- Root directory
- Any scope limitations
- Incremental flag if updating

The scanner will:
1. Deep scan all component directories
2. Map all routes/screens
3. Extract design tokens from styles
4. Detect patterns
5. Build dependency graph
</step>

<step name="component_scan">
## Component Discovery (Scanner Task)

Scan all potential component directories:

**Primary locations:**
- `components/**/*`
- `src/components/**/*`
- `app/components/**/*`
- `lib/components/**/*`

**Secondary locations:**
- `ui/**/*`
- `src/ui/**/*`
- `shared/**/*`

For each component file (.tsx, .jsx, .vue, .svelte):
1. Extract component name
2. Parse props/interface (TypeScript) or propTypes (JavaScript)
3. Detect variants (from props, conditionals, or className)
4. Find default values
5. Identify styling approach
6. Map imports (dependencies)
7. Count usage (where imported)

**Handle special patterns:**
- Compound components (Tabs.Root, Tabs.List)
- HOCs and wrappers
- Forwarded refs
- Polymorphic components
</step>

<step name="screen_scan">
## Screen/Route Discovery (Scanner Task)

Based on detected routing:

**Next.js App Router:**
- Scan `app/**/page.tsx` for pages
- Scan `app/**/layout.tsx` for layouts
- Parse route groups `(folder)`
- Parse dynamic routes `[param]`

**Next.js Pages Router:**
- Scan `pages/**/*.tsx`
- Exclude `_app.tsx`, `_document.tsx`

**React Router:**
- Search for `<Route` elements
- Search for `createBrowserRouter` config
- Search for `routes` array

**Vue/Nuxt:**
- Scan `pages/**/*.vue`
- Parse router config

For each screen:
1. Extract route path
2. Identify layout hierarchy
3. List components used
4. Detect data fetching
5. Note protected/public status
</step>

<step name="token_extraction">
## Design Token Extraction (Scanner Task)

Extract tokens from:

**1. Tailwind Config (priority):**
```javascript
// tailwind.config.ts
theme: {
  colors: { ... },      // → color tokens
  fontFamily: { ... },  // → typography
  fontSize: { ... },    // → type scale
  spacing: { ... },     // → spacing scale
  borderRadius: { ... }, // → radius tokens
  boxShadow: { ... },   // → shadow tokens
}
```

**2. CSS Variables:**
```css
:root {
  --primary: #2563EB;   // → color.primary
  --font-sans: Inter;   // → typography.fontFamily
}
```

**3. Theme Files:**
- `theme.ts`, `theme.js`
- `tokens.json`
- `colors.ts`

**4. Dark Mode Detection:**
- Tailwind `dark:` classes
- `prefers-color-scheme` media query
- Theme provider context
- `data-theme` attribute

Output to W3C Design Tokens format:
```json
{
  "color": {
    "primary": {
      "$value": "#2563EB",
      "$type": "color",
      "$extensions": {
        "mode": { "dark": "#3B82F6" }
      }
    }
  }
}
```
</step>

<step name="pattern_detection">
## Pattern Detection (Scanner Task)

Identify reusable patterns:

**Layout Patterns:**
- Auth layout (login/signup similarity)
- Dashboard layout (sidebar + content)
- Settings sections (form groups)
- List/detail patterns

**Component Patterns:**
- Form patterns (validation, submission)
- Table patterns (sorting, filtering)
- Modal patterns (confirmation, forms)
- Empty state patterns
- Loading state patterns

**Detection Method:**
- Component co-occurrence analysis
- Layout structure comparison
- Shared composition patterns

Document each pattern:
- Name
- Used in (screens)
- Structure (ASCII diagram)
- Components involved
</step>

<step name="write_analysis">
## Write CODE-ANALYSIS.md

Create `.harn/design/CODE-ANALYSIS.md` with:

```markdown
# Code Analysis: [Project Name]

## Executive Summary
[Quick metrics: framework, counts, health]

## Framework & Stack
[Detection results with sources]

## Component Inventory
[Full catalog with props, variants, usage]

## Screen Inventory
[All routes with layouts and components]

## Design Tokens
[Extracted values with sources]

## Patterns Detected
[Reusable patterns with diagrams]

## Dependency Graph
[Component relationships]

## Recommendations
[Next steps for design export]
```
</step>

<step name="write_tokens">
## Write Design Tokens

Create `.harn/design/design-tokens.json`:
- W3C Design Tokens format
- Include source references in $description
- Include dark mode variants in $extensions
</step>

<step name="update_state">
## Update Scanner State

Create/update `.harn/design/ui-state/scanner-state.json`:

```json
{
  "last_scan": "[timestamp]",
  "scan_type": "full",
  "framework": {
    "name": "Next.js",
    "version": "14.0.0",
    "styling": "Tailwind CSS",
    "routing": "App Router"
  },
  "counts": {
    "components": 45,
    "screens": 12,
    "tokens_extracted": 87,
    "patterns_detected": 6
  },
  "files_scanned": 234
}
```
</step>

<step name="completion">
## Completion Summary

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 UI ► CODEBASE SCAN COMPLETE
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Framework:    [Next.js 14] + [Tailwind CSS]
Language:     [TypeScript]

Discovered:
  • Components:  45 across 7 categories
  • Screens:     12 routes
  • Tokens:      87 values extracted
  • Patterns:    6 detected

Files Created:
  ✓ .harn/design/CODE-ANALYSIS.md
  ✓ .harn/design/design-tokens.json
  ✓ .harn/design/ui-state/scanner-state.json

Top Components by Usage:
  1. Button (47 uses)
  2. Icon (89 uses)
  3. Input (32 uses)

───────────────────────────────────────────────────────

## ▶ Next Steps

**Review the analysis:**
  Read .harn/design/CODE-ANALYSIS.md

**Generate specs from discovery:**
  /ui:generate-specs

**Or export directly (skip specs):**
  /ui:export [service]

**One-shot alternative:**
  /ui:reverse-engineer (scan + generate + export)

───────────────────────────────────────────────────────
```
</step>

<step name="git_commit">
## Git Commit

After successful scan:

```bash
# Check if .harn/ is gitignored
git check-ignore -q .harn 2>/dev/null && COMMIT_HARN=false || COMMIT_HARN=true

if [ "$COMMIT_HARN" = "true" ]; then
    git add .harn/design/CODE-ANALYSIS.md
    git add .harn/design/design-tokens.json
    git add .harn/design/ui-state/scanner-state.json

    git commit -m "docs(ui): scan codebase - [N] components, [N] screens

- Framework: [framework]
- Styling: [styling approach]
- Tokens extracted: [count]
- Patterns detected: [count]
"

    if git remote | grep -q origin; then
        git push origin $(git branch --show-current) 2>/dev/null || true
    fi
fi
```
</step>

</process>

<success_criteria>
- `.harn/design/CODE-ANALYSIS.md` created with complete inventory
- `.harn/design/design-tokens.json` created (if tokens found)
- All components cataloged with props and usage counts
- All screens/routes mapped with layouts
- Patterns documented with examples
- Clear next steps recommended
- Git commit created (if not gitignored)
</success_criteria>
