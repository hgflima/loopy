---
name: ui:sync
description: Detect drift between specifications and implementations, synchronize state
allowed-tools: [Read, Write, Edit, Glob, Grep, AskUserQuestion, Task]
agent: ui-specifier (for spec updates), ui-researcher (for analysis)
---

<objective>
Detect and resolve drift between UI specifications and realized implementations. Check for consistency across tokens, screens, components, and exports. Provide actionable sync recommendations.
</objective>

<context>
@.harn/design/UI-SPEC.md (if exists)
@.harn/design/design-tokens.json (if exists)
@.harn/design/screens/*.md (if exists)
@.harn/design/COMPONENTS.md (if exists)
@.harn/design/ui-exports/*.md (if exists)
@.harn/design/UI-REGISTRY.md (if exists)
</context>

<ux_principles>
## Comprehensive Check

Sync checks multiple dimensions:
- Token consistency (tokens used match definitions)
- Spec completeness (all required sections)
- Export freshness (exports match current specs)
- Component alignment (components in specs exist in inventory)
- Implementation status (registry matches reality)

## Actionable Output

Every drift item should have a clear resolution action.
</ux_principles>

<process>

<step name="gather_files">
## Gather All UI Files

Collect all UI specification files:
- design-tokens.json
- UI-SPEC.md
- screens/*.md
- COMPONENTS.md
- UI-PATTERNS.md
- ui-exports/*.md
- UI-REGISTRY.md
- UI-DECISIONS.md

Note missing files for reporting.
</step>

<step name="check_token_references">
## Check Token References

Scan all screen specs for token references:

**Valid token reference:**
```markdown
Background: color.background.subtle
```

**Check against design-tokens.json:**
- Does `color.background.subtle` exist?
- Is the value correct?

Report drift:
```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 UI ► TOKEN DRIFT
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Checking token references across specifications...

✓ color.primary.default — Used in 6 screens
✓ color.primary.foreground — Used in 6 screens
✗ color.accent.500 — Referenced but not defined
  → SCR-04-dashboard.md:42
  → SCR-07-settings.md:38
⚠ color.warning.default — Defined but unused
  → Consider removing or adding usage

Undefined tokens: 1
Unused tokens: 1
───────────────────────────────────────────────────────
```
</step>

<step name="check_component_references">
## Check Component References

Verify components in screen specs exist in COMPONENTS.md:

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 UI ► COMPONENT DRIFT
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Checking component references...

✓ Button — Defined, used in 8 screens
✓ Input — Defined, used in 5 screens
✗ SocialButton — Used but not in COMPONENTS.md
  → SCR-01-login.md, SCR-02-signup.md
⚠ DatePicker — Defined but not used
  → Consider removing from COMPONENTS.md

Undefined components: 1
Unused components: 1
───────────────────────────────────────────────────────
```
</step>

<step name="check_spec_completeness">
## Check Spec Completeness

Verify each screen has all 10 sections:

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 UI ► SPEC COMPLETENESS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Checking screen specification completeness...

SCR-01: Login
  ✓ Meta  ✓ Purpose  ✓ Wireframe  ✓ Layout
  ✓ Components  ✓ States  ✓ Interactions
  ✓ Responsive  ✓ Accessibility  ✓ Content
  Complete: 10/10

SCR-03: Dashboard
  ✓ Meta  ✓ Purpose  ○ Wireframe  ✓ Layout
  ✓ Components  ○ States  ○ Interactions
  ✓ Responsive  ○ Accessibility  ✓ Content
  Missing: 4/10 — Needs completion

Incomplete screens: 1
───────────────────────────────────────────────────────
```
</step>

<step name="check_export_freshness">
## Check Export Freshness

Compare export timestamps with spec modifications:

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 UI ► EXPORT FRESHNESS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Checking if exports are up to date...

Stitch Exports:
  ✓ SCR-01: Login — Up to date
  ⚠ SCR-02: Signup — Spec modified after export
    Spec: 2026-01-19 14:30
    Export: 2026-01-19 10:00
  ○ SCR-03: Dashboard — Never exported

V0 Exports:
  ✓ SCR-01: Login — Up to date
  ○ SCR-02: Signup — Never exported
  ○ SCR-03: Dashboard — Never exported

Stale exports: 1
Missing exports: 3
───────────────────────────────────────────────────────
```
</step>

<step name="check_registry_status">
## Check Registry Accuracy

Verify registry matches file system:

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 UI ► REGISTRY ACCURACY
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Checking registry against specifications...

✓ SCR-01 — In registry and spec exists
✓ SCR-02 — In registry and spec exists
✗ SCR-06 — In specs but not in registry
  → Add to UI-REGISTRY.md
⚠ SCR-10 — In registry but spec file missing
  → Remove from registry or create spec

Unregistered screens: 1
Orphaned registry entries: 1
───────────────────────────────────────────────────────
```
</step>

<step name="check_pattern_usage">
## Check Pattern Usage

Verify patterns are documented and used consistently:

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 UI ► PATTERN CONSISTENCY
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Checking pattern usage...

PAT-01: Auth Card
  Documented: ✓
  Used in: SCR-01, SCR-02, SCR-03
  Consistent: ✓

PAT-02: Data Table
  Documented: ✓
  Used in: SCR-04, SCR-05
  ⚠ Inconsistent: SCR-05 missing pagination

Undocumented patterns detected:
  ? Similar structure in SCR-06, SCR-07, SCR-08
    → Consider documenting as new pattern
───────────────────────────────────────────────────────
```
</step>

<step name="generate_sync_report">
## Generate Sync Report

Compile all findings:

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 UI ► SYNC REPORT
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Overall Health: ██████████░░ 75%

TOKEN CONSISTENCY                              [1 issue]
───────────────────────────────────────────────────────
✗ color.accent.500 undefined
  Fix: Add to design-tokens.json or update references

COMPONENT ALIGNMENT                            [1 issue]
───────────────────────────────────────────────────────
✗ SocialButton not in inventory
  Fix: Run /ui:define-components

SPEC COMPLETENESS                              [1 issue]
───────────────────────────────────────────────────────
○ SCR-03: Dashboard missing 4 sections
  Fix: Complete wireframe, states, interactions, accessibility

EXPORT FRESHNESS                               [1 issue]
───────────────────────────────────────────────────────
⚠ SCR-02 export is stale
  Fix: Run /ui:export stitch SCR-02

REGISTRY ACCURACY                              [2 issues]
───────────────────────────────────────────────────────
✗ SCR-06 not in registry
○ SCR-10 orphaned (no spec)

───────────────────────────────────────────────────────
Total Issues: N (critical, warning, info)
───────────────────────────────────────────────────────
```
</step>

<step name="offer_auto_fix">
## Offer Auto-Fix

**Question: Would you like to auto-fix resolvable issues?**

Options:
- Fix all (safe fixes only)
- Fix specific categories
- Generate fix list (manual)
- Skip fixes

**Auto-fixable issues:**
- Add missing tokens to design-tokens.json
- Add missing screens to registry
- Remove orphaned registry entries
- Update export timestamps

**Manual fixes required:**
- Complete missing spec sections
- Define new components
- Regenerate stale exports
</step>

<step name="apply_fixes">
## Apply Fixes

For each auto-fixable issue:

```markdown
## Applying Fixes

✓ Added color.accent.500 to design-tokens.json
  Value: #F59E0B (inferred from similar tokens)
  Please verify this is correct.

✓ Added SCR-06 to UI-REGISTRY.md
  Status: Pending

✓ Removed SCR-10 from UI-REGISTRY.md
  (Spec file did not exist)

Manual action needed:
→ Complete SCR-03 sections: /ui:design-screens SCR-03
→ Define SocialButton: /ui:define-components
→ Refresh exports: /ui:export stitch SCR-02
```
</step>

<step name="completion">
## Completion Summary

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 UI ► SYNC COMPLETE
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Issues Found: 6
Auto-Fixed:   3
Remaining:    3

Fixed:
  ✓ Added missing token color.accent.500
  ✓ Added SCR-06 to registry
  ✓ Removed orphaned SCR-10 from registry

Remaining Manual Actions:
  1. Complete SCR-03 specification
     → /ui:design-screens SCR-03

  2. Add SocialButton to component inventory
     → /ui:define-components

  3. Regenerate stale SCR-02 export
     → /ui:export stitch SCR-02

Updated Health: ██████████████░ 88%

───────────────────────────────────────────────────────

## ▶ Recommended Next

Address remaining issues in order:
1. `/ui:design-screens SCR-03` — Complete missing sections
2. `/ui:define-components` — Update component inventory
3. `/ui:export stitch SCR-02` — Refresh stale export

───────────────────────────────────────────────────────
```
</step>

</process>

<success_criteria>
- All UI files scanned for consistency
- Drift detected and categorized
- Auto-fixable issues resolved
- Manual fixes clearly documented
- Registry aligned with specifications
- Health score calculated
- Actionable next steps provided
</success_criteria>
