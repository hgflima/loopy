# MCP Mapping For Planning Views

## Start with context

When the user has not clearly identified the project or candidate task subset, begin with:

- `roadmap://projects`
- `roadmap://project/{projectId}`
- `roadmap://project/{projectId}/tasks`

## Primary tools

- `create_dependency_view`
- `list_dependency_views`
- `get_dependency_view`
- `update_dependency_view`
- `add_task_to_dependency_view`
- `update_dependency_view_node`
- `batch_update_dependency_view_nodes`
- `remove_task_from_dependency_view`
- `add_dependency_view_edge`
- `update_dependency_view_edge`
- `remove_dependency_view_edge`
- `analyze_dependency_view`

## Tool usage pattern

1. Inspect project tasks.
2. Create or select the right planning view.
3. Add only the tasks that belong in the focused workspace.
4. Create edges for meaningful ordering or blocking relationships.
5. Run `analyze_dependency_view` when the user needs execution insight.
6. Refine notes or layout only when it improves readability.

## Boundary reminder

If the user is still only cleaning up backlog items, task metadata, or general priorities, route back to `roadmap-task-flow`.
