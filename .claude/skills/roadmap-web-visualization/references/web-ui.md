# Browser Workflow Notes

## When to use the web workspace

Open the browser when the user wants:

- a visual kanban review
- a quick scan of tasks or project state
- a planning-view or graph overview in the UI

## Preferred entry points

- Use the `open-web-ui` prompt when prompt support is available.
- Otherwise use `open_web_interface` directly.
- Use `close_web_interface` when the user is done with the browser workspace.

## Keep this skill narrow

This skill should not explain the full roadmap method. It only handles entering and leaving the local visual workspace, plus a short explanation of why the UI is useful.
