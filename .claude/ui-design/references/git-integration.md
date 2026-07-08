# Git Integration Reference

> Auto-commit philosophy for UI Design System

## Core Philosophy

**Commit outcomes, not process.** The git log should read like a changelog of what was designed and specified, not a diary of exploration.

## Git Initialization

Always check for existing git repo before operations:

```bash
# Check for git repo (handles both regular repos and submodules)
if [ -d .git ] || [ -f .git ]; then
    echo "Git repo exists"
else
    git init
    echo "Initialized new git repo"
fi
```

**Rule:** UI Design operations always work within a git repo. If none exists, initialize one silently.

## Auto-Commit Strategy

### When to Commit

| Event | Commit? | Type |
|-------|---------|------|
| `/ui:init` completes | Yes | `docs(ui)` |
| `/ui:setup-tokens` completes | Yes | `feat(ui)` |
| `/ui:design-screens` creates/updates screen | Yes | `docs(ui)` |
| `/ui:define-components` completes | Yes | `docs(ui)` |
| `/ui:export` generates prompts | Yes | `docs(ui)` |
| `/ui:realize` marks screen realized | Yes | `docs(ui)` |
| `/ui:sync` fixes drift | Yes | `fix(ui)` |
| `/ui:decisions` adds decision | Yes | `docs(ui)` |
| `/ui:patterns` adds pattern | Yes | `docs(ui)` |
| `/ui:import-tokens` imports tokens | Yes | `feat(ui)` |
| `/ui:import-design` syncs designs | Yes | `docs(ui)` |

### Commit Message Format

```
{type}(ui): {action} {subject}

- {detail 1}
- {detail 2}
- {detail 3}
```

**Types:**
- `docs(ui)` — Specifications, screens, patterns, decisions
- `feat(ui)` — Design tokens, new capabilities
- `fix(ui)` — Drift fixes, corrections

### Message Examples

```bash
# After /ui:init
docs(ui): initialize UI context for ProjectName

- Platform: web (React + Next.js)
- Breakpoints: mobile-first (375, 768, 1024, 1440)
- Inspiration: Linear, Notion, Stripe

# After /ui:setup-tokens
feat(ui): establish design token system

- Colors: primary, secondary, semantic palette
- Typography: 4-step scale with Inter/system fonts
- Spacing: 4px base unit, 8-step scale
- Dark mode: enabled via $extensions.mode

# After /ui:design-screens (single screen)
docs(ui): specify SCR-01 Login screen

- 10-section format with ASCII wireframe
- Components: Input (2), Button (2), Link (1)
- States: default, loading, error, success

# After /ui:design-screens (multiple screens)
docs(ui): specify screens SCR-01 through SCR-04

- SCR-01: Login (auth flow entry)
- SCR-02: Signup (registration)
- SCR-03: Dashboard (main hub)
- SCR-04: Settings (preferences)

# After /ui:export
docs(ui): export V0 prompts for auth screens

- Generated: SCR-01 Login, SCR-02 Signup
- Format: React + shadcn/ui + Tailwind
- Dark mode: included via dark: classes

# After /ui:realize
docs(ui): mark SCR-01 Login as realized

- Implementation: src/app/login/page.tsx
- Verified: all states, responsive, a11y

# After /ui:sync
fix(ui): sync drift in SCR-03 Dashboard

- Updated: button variants (outline → ghost)
- Added: missing loading state
- Aligned: spacing with token system

# After /ui:decisions
docs(ui): add design decision DEC-003

- Decision: Use tab navigation over sidebar
- Rationale: Mobile-first, reduces complexity
- Affected: Dashboard, Settings screens
```

## File Staging

**Always stage files individually.** Never use `git add .` or `git add -A`.

```bash
# Good - explicit staging
git add .harn/design/UI-CONTEXT.md
git add .harn/design/design-tokens.json
git add .harn/design/screens/SCR-01-login.md

# Bad - never do this
git add .
git add -A
```

**Rationale:**
- Prevents accidental commits of unrelated files
- Makes commits atomic and reviewable
- Each commit contains only what was intended

## Auto-Push

After successful commit, automatically push to remote:

```bash
# Check if remote exists
if git remote | grep -q origin; then
    git push origin $(git branch --show-current)
fi
```

**Push only when:**
1. Remote `origin` exists
2. Commit succeeded
3. Branch has upstream tracking

## Planning Docs Handling

UI Design artifacts live in `.harn/design/`:

```
.harn/design/
├── UI-SPEC.md
├── UI-CONTEXT.md
├── UI-PATTERNS.md
├── UI-DECISIONS.md
├── UI-REGISTRY.md
├── COMPONENTS.md
├── design-tokens.json
├── screens/
│   └── SCR-*.md
└── ui-exports/
    └── *.md
```

**Commit behavior:**
- If `.harn/` is gitignored → skip git operations for those files
- If `.harn/` is tracked → commit all UI artifacts

Detection:
```bash
git check-ignore -q .harn 2>/dev/null && COMMIT_HARN=false || COMMIT_HARN=true
```

## Implementation in Agents

Each agent checks git status and commits at completion:

```markdown
## Git Integration

<git_protocol>
1. **On Start:**
   - Check for `.git` folder
   - If missing, run `git init`

2. **On Completion:**
   - Stage modified files individually
   - Commit with comprehensive message
   - Push if remote exists

3. **Commit Format:**
   ```
   {type}(ui): {action} {subject}

   - {detail 1}
   - {detail 2}
   ```

4. **Skip If:**
   - `.harn/` is gitignored
   - No changes to commit
   - Git operation fails (warn, don't block)
</git_protocol>
```

## Error Handling

Git operations should **warn but not block** UI Design work:

```bash
# Attempt commit, warn on failure
if ! git commit -m "message"; then
    echo "Warning: Git commit failed. Changes preserved but not committed."
fi
```

**Never fail the UI Design operation due to git issues.**

## Example Workflow

```bash
# User runs /ui:init
# Agent: Check git
[ -d .git ] || git init

# Agent: Do work...creates UI-CONTEXT.md, UI-SPEC.md

# Agent: Stage files
git add .harn/design/UI-CONTEXT.md
git add .harn/design/UI-SPEC.md

# Agent: Commit
git commit -m "docs(ui): initialize UI context for MyApp

- Platform: web (React + Vite)
- Breakpoints: 375, 768, 1024, 1440
- Inspiration: Linear, Vercel
"

# Agent: Push
git push origin main
```

## Summary

| Aspect | Behavior |
|--------|----------|
| **Git Init** | Auto-initialize if no `.git` folder |
| **Commit Trigger** | After each command completion |
| **Message Format** | `{type}(ui): {action} {subject}` with bullets |
| **File Staging** | Individual files only |
| **Push** | Automatic if remote exists |
| **Errors** | Warn, don't block |
| **Gitignored** | Skip git ops for `.harn/` if ignored |
