---
name: heal
description: >
  Self-healing post-incident skill for Claude Code sessions. Invoke after any unexpected
  outcome: wrong output, misinterpreted request, skipped steps, or silent failures. Mines the
  conversation to diagnose root causes, formulates corrective actions on skills/rules/CLAUDE.md,
  executes approved fixes, and persists a structured changelog. Use this skill whenever the user
  reports a problem ("heal this", "that was wrong", "what went wrong", "analyze this failure",
  "lessons learned") or wants to understand and prevent a recurrence of any issue encountered
  during a session.
license: MIT
metadata:
  version: 1.1.0
  author: hgflima
keywords:
  - heal
  - self-healing
  - post-mortem
  - incident-analysis
  - root-cause
  - retrospective
  - correction
---

# Heal

Post-incident self-healing orchestrator. Analyzes what went wrong in a Claude Code session, formulates corrective actions, executes approved fixes on the harness (skills, rules, CLAUDE.md), and persists a structured changelog for future incident context.

## Design

This skill is a **thin orchestrator**. It manages the flow, interacts with the user, and delegates context-heavy work to subagents. The main context window is typically already under pressure when this skill is invoked, so protecting it is essential.

The analytical framework combines Post-Mortem (timeline to cause to action), Bow-Tie (categorize failure point, prevent or mitigate), and FMEA (severity and recurrence to prioritize corrections).

**Skill handles directly:** Triage (Phase 1), history loading (Phase 2), execution planning (Phase 6).
**Agents handle:** Root cause analysis (Phase 3), solution formulation (Phase 4), collaborative review (Phase 5), execution (Phase 7), changelog persistence (Phase 8), audit (Phase 9).

## File References

Before starting, note the location of this skill's directory. All paths below are relative to it.

- **Agent instructions:** `agents/` — read the relevant file before spawning each agent
- **Data schema and enums:** `references/schema.md` — read once at the start for directory conventions and data structures
- **CLI script:** `scripts/persist-entry.js` — used by the changelog-persister agent in Phase 8

## Execution Flow

### Phase 1 — Triage (Skill Direct)

Mine the current conversation to reconstruct:
1. What was requested
2. What was executed
3. Where it deviated from expectations
4. How it was corrected (if at all)
5. What the final output was

Identify the **affected component** using the key format `<category>:<name>` (e.g., `skill:xlsx`, `orchestration:plan`, `rule:claude-md`). The category maps to a subdirectory under `.claude/heal/` — see `references/schema.md` for the directory structure.

Propose a **severity** level and present it to the user for confirmation:

| Severity | Definition |
|----------|-----------|
| `low` | Corrected without impact on final output |
| `medium` | Required partial rework |
| `high` | Delivered output was wrong |
| `critical` | Silent failure — output appeared correct but wasn't |

Do NOT proceed without explicit severity confirmation from the user.

**Carry forward:** incident summary + confirmed severity + component key.

### Phase 2 — Load History (Skill Direct)

Read `.claude/heal/index.json`. If the component has prior entries, load the corresponding JSON file path from the index.

This phase is **idempotent and read-only**. No file creation, no state mutation. If the directory or files don't exist, carry forward empty history.

**Carry forward:** component history JSON (or empty context if first incident).

### Phase 3 — Root Cause Analysis (Agent)

Read `agents/root-cause-analyst.md`, then spawn the agent.

**Pass:** incident summary (Phase 1) + component history (Phase 2).
**Receive:** structured `root_cause` object with `layer`, `detail`, `confidence`, and recurrence info.

### Phase 4 — Solution Formulation (Agent)

Read `agents/solution-formulator.md`, then spawn the agent.

**Pass:** `root_cause` (Phase 3) + list of target file paths the agent should read to understand current state.
**Receive:** complete `solution` object with `description` and `actions` array.

### Phase 5 — Collaborative Review (Agent Loop)

Present the full diagnosis (root cause with confidence) and proposed solution to the user. Ask if they approve or want to discuss.

This is a **loop**:
1. User approves -> exit loop, proceed to Phase 6
2. User suggests changes -> read `agents/solution-reviewer.md`, spawn an agent with the current plan + user feedback, receive the revised plan, present again
3. Repeat until explicit approval

The reviewer agent will flag conflicts with historical entries if the user's suggestions contradict past learnings.

### Phase 6 — Execution Plan (Skill Direct)

Transform the approved solution into an ordered task list. Each task maps to one action from the solution, with its steps. This list is the contract for Phase 7 — nothing outside it gets executed.

Use TaskCreate/TaskUpdate tools to track each action as a task item.

### Phase 7 — Execution (Agent(s))

Read `agents/executor.md`. For each action (or group of actions on the same target file), spawn an agent.

**Pass:** the action(s) + target file path.
**Receive:** status per action (`applied` | `failed` + reason).

Update the action statuses in the solution object. Mark corresponding tasks as complete.

### Phase 8 — Changelog Persistence (Agent)

Read `agents/changelog-persister.md`, then spawn the agent.

**Pass:** the complete entry assembled from all phase outputs + absolute path to `scripts/persist-entry.js`.
**Receive:** `ok` with entry ID | `error` with detail.

The entry ID follows the convention `<component-short-name>-<NNN>` (e.g., `xlsx-001`). The script guarantees uniqueness and atomicity.

### Phase 9 — Audit (Agent)

Read `agents/auditor.md`, then spawn the agent.

**Pass:** list of actions with their targets, expected changes, and Phase 7 statuses + the new entry ID and component key.
**Receive:** audit report (pass/fail per item, detail on failures).

Present the audit summary to the user. If any items failed, discuss remediation before closing.

## Context Window Rules

The orchestrator's context should only ever contain:
- The incident summary and confirmed severity
- Structured outputs returned by agents (root_cause, solution, statuses, audit report)
- User interaction text

Never load raw file contents or full changelog data into the orchestrator. That work belongs to the agents.
