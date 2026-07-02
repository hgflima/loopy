# Heal — Data Schema

This document defines the directory structure, JSON schemas, enum values, and ID conventions for the heal changelog system.

## Directory Structure

```
.claude/heal/
├── index.json                          # Global index
├── skills/
│   └── <skill-name>.json              # e.g., xlsx.json, docx.json
├── commands/
│   └── <command-name>.json            # e.g., slash-fix.json
├── code/
│   └── <domain>.json                  # e.g., react-components.json
├── orchestration/
│   └── <phase>.json                   # e.g., plan.json, research.json
├── environment/
│   └── <domain>.json                  # e.g., dependencies.json
└── rules/
    └── <domain>.json                  # e.g., claude-md.json
```

Category directories are created on demand. File names are kebab-case.

The component key format is `<category>:<name>`, which maps to `<category>/<name>.json`. For example:
- `skill:xlsx` -> `skills/xlsx.json`
- `orchestration:plan` -> `orchestration/plan.json`
- `rule:claude-md` -> `rules/claude-md.json`

## index.json

The global index tracks all components and their entry counts.

```json
{
  "last_updated": "2026-04-02T09:15:00Z",
  "total_entries": 14,
  "components": {
    "skill:xlsx": {
      "path": "skills/xlsx.json",
      "entry_count": 3,
      "last_entry": "2026-04-02"
    },
    "orchestration:plan": {
      "path": "orchestration/plan.json",
      "entry_count": 2,
      "last_entry": "2026-04-01"
    }
  }
}
```

| Field | Type | Description |
|-------|------|-------------|
| `last_updated` | ISO 8601 | Timestamp of the most recent write |
| `total_entries` | number | Sum of all entry_count values |
| `components` | object | Keyed by component key |
| `components[key].path` | string | Relative path from `.claude/heal/` |
| `components[key].entry_count` | number | Number of entries in this component file |
| `components[key].last_entry` | date string | Date (YYYY-MM-DD) of the most recent entry |

## Component JSON

Each component file holds the entries for one component.

```json
{
  "component": "skill:xlsx",
  "entries": [
    {
      "id": "xlsx-001",
      "timestamp": "2026-03-29T14:32:00Z",
      "severity": "high",
      "summary": "Chart generated with inverted Y axis when dataset contains negative values",
      "root_cause": {
        "layer": "skill",
        "detail": "The xlsx skill doesn't handle negative values when configuring the Y axis range via openpyxl. Min/max is calculated without considering sign, resulting in inverted axis.",
        "confidence": "high"
      },
      "solution": {
        "description": "openpyxl doesn't auto-adjust Y axis range for negative values. The immediate fix was explicit min/max calculation with sign handling. Prevention requires the skill to always validate data range before generating any chart, and a global rule for data validation in visualizations.",
        "actions": [
          {
            "type": "update",
            "target": "/path/to/SKILL.md",
            "status": "applied",
            "detail": "Added paragraph to charting section about validating axis range for negative values",
            "steps": [
              "Read SKILL.md",
              "Locate the charting section",
              "Add validation paragraph after existing axis configuration instructions",
              "Validate markdown is well-formed"
            ]
          }
        ]
      },
      "related_entries": []
    }
  ]
}
```

### Entry Fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | string | yes | Format: `<short-name>-<NNN>` (e.g., `xlsx-001`) |
| `timestamp` | ISO 8601 | yes | When the entry was created |
| `severity` | enum | yes | See severity enum below |
| `summary` | string | yes | One-line incident summary |
| `root_cause` | object | yes | See below |
| `root_cause.layer` | enum | yes | See layer enum below |
| `root_cause.detail` | string | yes | Specific root cause description |
| `root_cause.confidence` | enum | yes | See confidence enum below |
| `solution` | object | yes | See below |
| `solution.description` | string | yes | Reasoning: why it happened + why the fix works |
| `solution.actions` | array | yes | Array of action objects |
| `related_entries` | string[] | yes | IDs of related entries (recurrence), or empty array |

### Action Fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `type` | enum | yes | `add`, `update`, or `remove` |
| `target` | string | yes | Absolute file path |
| `status` | enum | yes | `pending` or `applied` |
| `detail` | string | yes | What was changed and why |
| `steps` | string[] | yes | Deterministic execution steps |

## Enums

### severity

| Value | Definition |
|-------|-----------|
| `low` | Corrected without impact on final output |
| `medium` | Required partial rework |
| `high` | Delivered output was wrong |
| `critical` | Silent failure — output appeared correct but wasn't |

### confidence

| Value | Definition |
|-------|-----------|
| `high` | Cause is evident in context (clear error, stack trace, reproducible) |
| `medium` | Cause is probable but alternative hypotheses exist |
| `low` | Inference with insufficient information |

### layer

| Value | Definition |
|-------|-----------|
| `skill` | Bug or limitation in a skill |
| `command` | Slash command failure |
| `code` | Inadequate code implementation |
| `environment` | Dependency, permission, network, infrastructure |
| `rule` | Directive in CLAUDE.md or rules caused or allowed the problem |
| `orchestration:advise` | Failure in the advise phase |
| `orchestration:research` | Failure in the research phase |
| `orchestration:plan` | Failure in the planning phase |
| `orchestration:implement` | Failure in the implementation phase |
| `orchestration:ai-validation` | Failure in agent validation |
| `orchestration:human-validation` | Failure in human validation |
| `orchestration:retrospective` | Failure in the retrospective phase |

### action type

| Value | Definition |
|-------|-----------|
| `add` | Create new content in the target |
| `update` | Modify existing content in the target |
| `remove` | Remove content from the target |

### action status

| Value | Definition |
|-------|-----------|
| `pending` | Approved but not yet executed |
| `applied` | Executed successfully |

## ID Generation

Convention: `<component-short-name>-<sequential-number>`

The short name is the `<name>` part of the component key (after the colon). The sequential number is zero-padded to 3 digits, starting at 001.

Examples:
- `xlsx-001`, `xlsx-002`
- `plan-001`, `plan-002`
- `react-components-001`

The `persist-entry.js` script is responsible for generating unique, sequential IDs. It reads the current entry_count from index.json and increments.
