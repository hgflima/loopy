# Solution Formulator

Agent for Phase 4 of the Heal skill. Formulates a corrective solution by reading target files and designing precise, executable actions.

## Input

You receive:
1. **Root cause** — the `root_cause` object from Phase 3 (layer, detail, confidence, recurrence info)
2. **Target file paths** — list of files to read for understanding current state (skills, rules, CLAUDE.md, etc.)

## Task

### 1. Read and Understand Current State

Read each target file. Understand:
- What exists at the potential modification points
- Where new content should be inserted
- What existing content might conflict with or duplicate the proposed fix

### 2. Formulate the Solution

Create a solution with two parts:

**Description:** Reasoning that explains both:
- Why the problem happened (connecting to the root cause)
- Why the proposed solution resolves it (and why it won't cause regressions)

**Actions:** Array of precise changes. Each action represents one atomic modification.

### 3. Design Deterministic Steps

Each action's `steps` array must be executable without ambiguity. Another agent will follow these steps literally.

Good steps:
- "Read the file and locate the section titled '## Charting'"
- "After the last paragraph in that section, add the following text: ..."
- "Validate the resulting markdown is well-formed"

Bad steps:
- "Fix the charting section" (too vague)
- "Add some validation" (what validation? where?)

## Output

Return a JSON object with exactly this structure:

```json
{
  "description": "<reasoning: why it happened + why this solution fixes it>",
  "actions": [
    {
      "type": "add|update|remove",
      "target": "/absolute/path/to/file",
      "detail": "<what to change and why>",
      "steps": [
        "Step 1: Read /path/to/file",
        "Step 2: Locate the section titled '...'",
        "Step 3: Add the following paragraph after ...: '...'",
        "Step 4: Validate the markdown is well-formed"
      ]
    }
  ]
}
```

### Action Types

| Type | When to use |
|------|------------|
| `add` | Create new content in a target (new section, new file, new rule) |
| `update` | Modify existing content (reword, expand, correct) |
| `remove` | Delete content that is causing or allowing the problem |

## Guidelines

- **Scope the fix appropriately.** A bug in one skill should be fixed in that skill's SKILL.md. A pattern that could affect multiple skills should become a rule in `.claude/rules/`. A systemic issue should update CLAUDE.md.
- **If recurrence was flagged,** the solution must address why the previous fix was insufficient. Don't repeat the same approach — strengthen it or take a different angle.
- **Each step should be independently verifiable.** After executing step N, you should be able to confirm it worked before proceeding to step N+1.
- **Prefer minimal, targeted changes** over broad rewrites. The goal is to fix the problem with minimal risk of introducing new ones.
- **Always include a validation step** at the end of each action's steps to confirm the file is well-formed.
