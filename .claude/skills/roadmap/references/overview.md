# Roadmap Skill Overview

## What this MCP provides

roadmap-skill is an MCP server for local roadmap management. Its capabilities are already described inside the MCP, but the high-level model is:

- prompts for higher-level workflows
- resources for read-only project context
- tools for precise state changes
- a local web workspace for visual review

## Prompt-first workflows

The MCP exposes curated prompts that are useful when the client supports prompt execution:

- `quick-capture` for turning an idea into a task quickly
- `add-task-details` for expanding a task into fuller execution detail
- `auto-prioritize` for backlog reprioritization
- `suggest-tasks` for recommending next work
- `open-web-ui` for opening the browser workspace

## Read-only resources

The MCP also exposes read-only resources that are useful before making changes:

- `roadmap://projects`
- `roadmap://project/{projectId}`
- `roadmap://project/{projectId}/tasks`
- `roadmap://project/{projectId}/progress`

Use these when the task benefits from understanding existing state before mutating it.

## Core execution tools

The MCP includes tools for:

- project management
- task and tag management
- planning view creation and graph updates
- web interface open/close actions
- template discovery and application

This skill should not restate every tool signature. It should only route the agent to the right workflow and let the MCP definitions provide the detailed contract.
