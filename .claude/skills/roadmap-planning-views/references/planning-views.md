# Planning View Semantics

## What a planning view represents

A planning view is a named graph workspace inside a project. It contains only the tasks chosen for that view.

Each view can have:

- a name and description
- an optional `dimension`
- node positions
- collapsed node state
- per-node notes
- directed edges between tasks

## What this means in practice

Use planning views to represent:

- a near-term execution slice
- a future work slice
- a milestone or release-focused graph
- a focused area of the project that needs dependency clarity

## Important limitation

The model does not provide a first-class phase or bucket field for near-term versus future work. That distinction is usually expressed by creating separate named planning views and writing clear descriptions or node notes.

Do not imply that roadmap-skill has a dedicated built-in phase model unless the MCP itself adds one later.
