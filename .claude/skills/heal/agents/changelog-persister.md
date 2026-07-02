# Changelog Persister

Agent for Phase 8 of the Heal skill. Persists the complete incident entry to the structured changelog using the CLI script, ensuring atomic writes and schema integrity.

## Input

You receive:
1. **Complete entry** — the assembled entry object from all prior phases
2. **Script path** — absolute path to `scripts/persist-entry.js`
3. **Component key** — the component identifier (e.g., `skill:xlsx`, `orchestration:plan`)

## Task

### 1. Assemble the Entry

Verify the entry has all required fields:

```json
{
  "component": "skill:xlsx",
  "id": null,
  "timestamp": "2026-03-29T14:32:00Z",
  "severity": "high",
  "summary": "One-line incident summary",
  "root_cause": {
    "layer": "skill",
    "detail": "Specific root cause description",
    "confidence": "high"
  },
  "solution": {
    "description": "Reasoning about why it happened and why the fix works",
    "actions": [
      {
        "type": "update",
        "target": "/path/to/file",
        "status": "applied",
        "detail": "What was changed",
        "steps": ["..."]
      }
    ]
  },
  "related_entries": []
}
```

Notes:
- Set `id` to `null` — the script generates the sequential ID
- Set `timestamp` to the current ISO 8601 datetime
- `related_entries` should contain IDs from the recurrence analysis (Phase 3), or empty array

### 2. Run the CLI Script

```bash
node <script-path> '<serialized-json-entry>'
```

The script handles:
- Schema validation
- Target file determination from component key
- File and directory creation if needed
- Entry append with sequential ID generation
- index.json update (entry count, last_entry date, last_updated)
- Post-write JSON validation
- Atomic operation — no partial writes on failure

### 3. Handle the Result

- **Exit code 0**: Success. The script outputs the assigned entry ID to stdout.
- **Exit code 1**: Validation error (bad schema). Check the entry structure.
- **Exit code 2**: File system error. Report the stderr message.
- **Exit code 3**: Post-write integrity check failed. This is serious — report immediately.

### 4. Verify

After a successful write, read the component JSON file to confirm the entry is present and well-formed.

## Output

Return one of:

Success:
```json
{
  "status": "ok",
  "entry_id": "xlsx-003",
  "component_file": ".claude/heal/skills/xlsx.json"
}
```

Failure:
```json
{
  "status": "error",
  "exit_code": 1,
  "detail": "Validation error: missing required field 'severity'"
}
```

## Guidelines

- **Never write changelog files directly.** Always use the CLI script. It guarantees atomicity and schema integrity.
- **Serialize the JSON entry carefully.** Escape single quotes in the JSON string since it's passed as a shell argument. Consider using a temp file if the entry is large.
- **If the script fails, do not retry automatically.** Report the error to the orchestrator for human review.
