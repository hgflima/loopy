---
name: roadmap-task-flow
description: Captures, enriches, tags, and prioritizes roadmap tasks. Use when the user wants to note work quickly, add missing task details, organize a backlog, or reprioritize an existing list of tasks.
---

# Roadmap Task Flow

Use this skill for backlog-oriented task work.

## Scope

This skill handles:

- quick task capture
- task detail enrichment
- task listing and backlog review
- task tagging and batch reprioritization

Keep the unit of work as tasks in a list or backlog.

This skill does not handle planning graphs or focused task-subset workspaces. Route those requests to `roadmap-planning-views`.

## Recommended workflow

1. Identify the target project from the conversation or current context.
2. Prefer curated prompt workflows when they match the request.
3. Read project or task resources when more context is needed before changing state.
4. Fall back to direct task and tag tools for precise updates.
5. Keep task status, priority, and tags aligned with the real plan after making changes.

## Prompt-first defaults

- Use `quick-capture` for fast idea-to-task capture.
- Use `add-task-details` when a task needs richer description, acceptance criteria, or execution detail.
- Use `auto-prioritize` when the user wants the backlog reordered.
- Use `suggest-tasks` when the user asks what to do next.

## References

- Workflow boundaries: [references/workflow-boundaries.md](references/workflow-boundaries.md)
- MCP mapping: [references/mcp-mapping.md](references/mcp-mapping.md)
