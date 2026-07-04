---
name: roadmap-web-visualization
description: Opens and uses the local roadmap web workspace for visual review. Use when the user wants to inspect projects, tasks, kanban state, or planning views in the browser.
---

# Roadmap Web Visualization

Use this skill for the local browser workspace only.

## Scope

This skill handles:

- opening the local roadmap web interface
- closing the interface when requested
- briefly explaining when the browser is useful for visual review

Keep this skill lightweight and UI-oriented.

Do not turn this skill into a planning methodology guide. Route backlog work to `roadmap-task-flow` and graph organization work to `roadmap-planning-views`.

## Recommended workflow

1. Open the web workspace when the user wants visual inspection or interactive review.
2. Keep the action lightweight.
3. If the user then wants graph edits or backlog changes, continue with the relevant roadmap MCP workflow after the interface is open.

## References

- Browser workflow notes: [references/web-ui.md](references/web-ui.md)
