---
name: roadmap
description: Introduces roadmap-skill and routes roadmap work to the right workflow. Use when the user needs brief context about roadmap-skill, or wants help deciding between backlog task flow, planning views, and the web workspace.
---

# Roadmap Skill

Use this skill as the lightweight entry point for roadmap-skill.

## What roadmap-skill is

`roadmap-skill` is a local-first roadmap MCP for managing projects, tasks, tags, planning views, and a browser-based workspace. The MCP already contains the detailed tool, prompt, and resource descriptions, so this skill should stay brief and focus on routing.

## How to route work

- Use `roadmap-task-flow` for capturing tasks, enriching task details, tagging work, or reprioritizing a backlog.
- Use `roadmap-planning-views` when the user wants to build a focused graph from a subset of tasks, reason about dependencies, or organize near-term versus later work in a planning workspace.
- Use `roadmap-web-visualization` when the user wants to open or close the local web workspace, or review roadmap state visually in a browser.

## Default approach

1. Keep the introduction brief.
2. Identify whether the user is asking for backlog flow, planning views, or the web workspace.
3. Read the corresponding reference file only when needed.
4. Let the MCP's own prompt, resource, and tool descriptions carry the implementation detail.
5. Avoid duplicating detailed MCP docs inside this skill.

## References

- Product overview: [references/overview.md](references/overview.md)
- Routing guide: [references/routing.md](references/routing.md)
