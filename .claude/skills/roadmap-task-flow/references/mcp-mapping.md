# MCP Mapping For Task Flow

## Prefer these prompts first

- `quick-capture`
- `add-task-details`
- `auto-prioritize`
- `suggest-tasks`

## Useful read-only resources

- `roadmap://projects` to identify candidate projects
- `roadmap://project/{projectId}` to inspect project context
- `roadmap://project/{projectId}/tasks` to understand current backlog state
- `roadmap://project/{projectId}/progress` to check progress and overdue work

## Primary tools

- `list_projects`
- `get_project`
- `create_task`
- `list_tasks`
- `get_task`
- `update_task`
- `batch_update_tasks`
- `create_tag`
- `list_tags`
- `update_tag`
- `get_tasks_by_tag`

## Fallback logic

- If prompt support exists and the request matches a curated workflow, start there.
- If prompt support is unavailable or too coarse for the request, use resources and direct tools.
- If the user starts talking about graph organization or dependency reasoning for a chosen subset, switch to `roadmap-planning-views`.
