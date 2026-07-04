---
name: roadmap-planning-views
description: Creates and organizes focused planning views from a subset of roadmap tasks. Use when the user wants to build a task graph, analyze dependencies, identify ready or blocked work, or group near-term and future work into a focused planning workspace.
---

# Roadmap Planning Views

Use this skill when roadmap work shifts from backlog management to graph-based planning.

## Scope

This skill handles:

- creating a planning view for a selected subset of tasks
- adding or removing tasks from that view
- arranging node layout and notes for a focused workspace
- creating, updating, or removing dependency edges
- analyzing graph structure to find ready, blocked, root, leaf, or isolated work

Keep the unit of work as a chosen subset of tasks inside a named graph workspace.

## Recommended workflow

1. Determine which project the graph belongs to.
2. Identify the subset of tasks that belong in this planning view.
3. Create or reuse a planning view with a clear purpose, such as near-term focus, release slice, or future work exploration.
4. Add the chosen tasks, then create or refine edges only where relationships matter.
5. Run analysis when the user needs execution order or blocking insight.
6. Update node notes or layout only to improve clarity of the planning workspace.
7. Use more than one planning view when the user wants separate slices such as near-term work versus future work.

## Important framing

Treat a planning view as a focused workspace built from a task subset. It supports dependency reasoning, but it is broader than a dependency analyzer.

Use multiple planning views when the user wants separate graphs for different horizons, themes, or execution slices.

## References

- Planning view semantics: [references/planning-views.md](references/planning-views.md)
- MCP mapping: [references/mcp-mapping.md](references/mcp-mapping.md)
