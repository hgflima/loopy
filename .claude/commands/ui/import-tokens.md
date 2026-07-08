---
name: ui:import-tokens
description: Import design tokens from external sources (Figma, Style Dictionary, Tailwind, W3C)
allowed-tools: [Read, Write, Edit, AskUserQuestion, Glob]
---

<objective>
Import design tokens from external design tools or token files. Transform to W3C Design Tokens format. Merge or replace existing tokens while preserving custom additions.
</objective>

<context>
@.harn/design/design-tokens.json (if exists)
@.harn/design/UI-CONTEXT.md (if exists)
</context>

<ux_principles>
## Source Detection

Automatically detect source format when possible:
- File extension hints
- JSON structure analysis
- Known format patterns

## Conflict Resolution

When merging with existing tokens:
- Show clear diff of changes
- Allow selective merge
- Preserve custom tokens not in import
</ux_principles>

<process>

<step name="identify_source">
## Identify Import Source

**Question: Where are you importing tokens from?**

Options:
- Figma Variables export (JSON)
- Style Dictionary format
- Tailwind config (tailwind.config.js/ts)
- W3C Design Tokens format
- Tokens Studio export
- Custom JSON file
- Paste JSON directly

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 UI ► IMPORT TOKENS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Select your token source format.

Supported formats:
  • Figma Variables export
  • Style Dictionary
  • Tailwind config
  • W3C Design Tokens (native)
  • Tokens Studio
  • Custom JSON

───────────────────────────────────────────────────────
```
</step>

<step name="locate_file">
## Locate Source File

**If file path expected:**

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 UI ► PROVIDE TOKEN FILE
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Provide the path to your token file, or paste the JSON directly.

Examples:
  • ./tokens.json
  • ~/Downloads/figma-export.json
  • ./tailwind.config.js

Or type "paste" to paste JSON content.
───────────────────────────────────────────────────────
```

**Validate input:**
- Read the file
- Verify valid JSON (or JS for Tailwind)
- Check for expected structure
</step>

<step name="detect_and_parse">
## Detect Format and Parse

Analyze JSON structure to detect format:

**Figma Variables Export:**
```json
{
  "collections": {
    "Primitives": {
      "Blue/500": { "value": "#3B82F6", "type": "COLOR" }
    }
  }
}
```

**Style Dictionary:**
```json
{
  "color": {
    "primary": {
      "value": "#2563EB",
      "comment": "Primary brand color"
    }
  }
}
```

**W3C Design Tokens:**
```json
{
  "color": {
    "primary": {
      "$value": "#2563EB",
      "$type": "color"
    }
  }
}
```

**Tailwind Config:**
```javascript
{
  theme: {
    extend: {
      colors: {
        primary: {
          DEFAULT: '#2563EB',
          50: '#EFF6FF',
          500: '#3B82F6'
        }
      }
    }
  }
}
```

**Tokens Studio:**
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

Report detected format:
```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 UI ► FORMAT DETECTED
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Detected: [Format Name]

Found tokens:
  Colors:      [N] values
  Typography:  [N] values
  Spacing:     [N] values
  Shadows:     [N] values
  Other:       [N] values

Proceed with import?
───────────────────────────────────────────────────────
```
</step>

<step name="transform_tokens">
## Transform to W3C Format

Convert all tokens to W3C Design Tokens format:

### Color Transformations
```javascript
// Input (various formats)
"#2563EB"
"rgb(37, 99, 235)"
"hsl(221, 83%, 53%)"
"rgba(37, 99, 235, 0.5)"

// Output (W3C)
{
  "$value": "#2563EB",
  "$type": "color"
}

// With alpha
{
  "$value": "#2563EB80",
  "$type": "color"
}
```

### Typography Transformations
```javascript
// Input (Style Dictionary)
{
  "fontSize": { "value": "16px" },
  "fontWeight": { "value": "500" },
  "fontFamily": { "value": "Inter" }
}

// Output (W3C)
{
  "fontFamily": {
    "sans": { "$value": "Inter, system-ui, sans-serif", "$type": "fontFamily" }
  },
  "fontSize": {
    "base": { "$value": "1rem", "$type": "dimension" }
  },
  "fontWeight": {
    "medium": { "$value": "500", "$type": "fontWeight" }
  }
}
```

### Spacing Transformations
```javascript
// Input (Tailwind)
{
  spacing: {
    1: '0.25rem',
    2: '0.5rem',
    4: '1rem'
  }
}

// Output (W3C)
{
  "spacing": {
    "1": { "$value": "0.25rem", "$type": "dimension" },
    "2": { "$value": "0.5rem", "$type": "dimension" },
    "4": { "$value": "1rem", "$type": "dimension" }
  }
}
```

### Shadow Transformations
```javascript
// Input (Figma/CSS)
"0 1px 3px rgba(0,0,0,0.1)"

// Output (W3C)
{
  "$value": {
    "offsetX": "0",
    "offsetY": "1px",
    "blur": "3px",
    "spread": "0",
    "color": "#0000001A"
  },
  "$type": "shadow"
}
```
</step>

<step name="check_existing">
## Check Existing Tokens

If `.harn/design/design-tokens.json` exists:

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 UI ► EXISTING TOKENS FOUND
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Found existing design-tokens.json with:
  Colors:      12 values
  Typography:   8 values
  Spacing:     10 values

Import will affect:
  ⚡ Modified:  color.primary.500 (#2563EB → #3B82F6)
  ⚡ Modified:  color.primary.600 (#1D4ED8 → #2563EB)
  ✚ Added:     color.accent.* (new category)
  ○ Unchanged: typography.*, spacing.*, shadow.*

How would you like to proceed?
───────────────────────────────────────────────────────
```

**Question: How to handle existing tokens?**

Options:
- Merge (imported values win on conflict)
- Merge (existing values win on conflict)
- Replace all (overwrite completely)
- Review each conflict individually
</step>

<step name="resolve_conflicts">
## Resolve Conflicts (if review selected)

For each conflict:

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 UI ► CONFLICT: color.primary.500
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Existing:  #2563EB  ████
Imported:  #3B82F6  ████

Which value to keep?
───────────────────────────────────────────────────────
```

Options:
- Keep existing
- Use imported
- Skip this token
</step>

<step name="add_metadata">
## Add Metadata

Ensure imported tokens have proper metadata:

```json
{
  "$schema": "https://design-tokens.org/schema.json",
  "$metadata": {
    "source": "[detected format]",
    "imported": "[timestamp]",
    "original_file": "[file path]"
  },
  "color": {
    "primary": {
      "500": {
        "$value": "#3B82F6",
        "$type": "color",
        "$description": "Primary brand color",
        "$extensions": {
          "imported_from": "[source]"
        }
      }
    }
  }
}
```
</step>

<step name="write_tokens">
## Write Tokens

Write merged/replaced tokens to `.harn/design/design-tokens.json`

**Validation checks:**
- Valid JSON structure
- W3C format compliance
- All required categories present
- No orphaned references
- Color values are valid hex/rgb
</step>

<step name="update_decisions">
## Document Import Decision

Append to `.harn/design/UI-DECISIONS.md`:

```markdown
## DEC-XXX: Token Import
**Date:** [date]
**Source:** [format] from [file]
**Action:** [Merged/Replaced]
**Tokens imported:** [N] total
**Conflicts resolved:** [N] (list if any)
```
</step>

<step name="completion">
## Completion Summary

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 UI ► TOKENS IMPORTED
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Source:   [detected format]
File:     [file path]
Action:   [Merged with existing / Replaced existing / Created new]

Tokens imported:
  Colors:       [N] values ([M] new, [K] updated)
  Typography:   [N] values
  Spacing:      [N] values
  Shadows:      [N] values
  Border:       [N] values
  Other:        [N] values

  Total:        [T] tokens

Conflicts:    [N] resolved

Output: .harn/design/design-tokens.json

───────────────────────────────────────────────────────

## ▶ Next Up

**Update specifications** — Ensure specs reference new tokens

`/ui:sync` — Check for spec/token alignment

**Regenerate exports** — Prompts may need updating

`/ui:export [service]`

**View tokens** — Review the imported tokens

`/ui:status`

───────────────────────────────────────────────────────
```
</step>

</process>

<success_criteria>
- Tokens successfully parsed from source format
- Tokens transformed to W3C format
- `.harn/design/design-tokens.json` created or updated
- No data loss during transformation
- Conflicts resolved per user preference
- Import documented in decisions
- Token validation passes
</success_criteria>
