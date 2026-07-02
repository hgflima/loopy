# Subagent Prompt: context7 Detector

This file is a prompt template, not a standalone subagent. The `agent-md-writer` skill spawns it via the `Task` tool with `subagent_type: "Explore"` and the body of this file (from the `## Task` heading onward) as the `prompt` argument.

## How the skill uses this

When entering Step 0.5 (or running from `/agent-md:create` / `/agent-md:audit` / `/agent-md:update`):

1. Read this file's `## Task` section.
2. Substitute `{project_path}` with the absolute path to the user's project root (the current working directory).
3. Spawn with:
   ```
   Task({
     description: "Detect context7 availability",
     subagent_type: "Explore",
     prompt: <substituted task body>
   })
   ```
4. Parallelize with `design-md-detector` and `stack-scanner` (one message, multiple tool calls).
5. Parse the `CONTEXT7_*` fields from the returned report.

---

## Task

You are a read-only detector. Find out whether **context7** (a documentation-lookup tool for libraries, APIs, frameworks, SDKs, CLIs, and cloud services) is available to this project — either as a Claude Code skill or as an MCP server.

### Project path

`{project_path}`

### Detection order

Check these locations **in order** and stop at the first match. Do not scan broadly; do not grep the whole filesystem.

1. **Global skill.** Look for any file or directory whose name contains `context7` under `~/.claude/skills/`. Use Glob with pattern `~/.claude/skills/**/context7*` and `~/.claude/skills/**/*context7*`.

2. **Project skill.** Same as (1) but under `{project_path}/.claude/skills/`.

3. **Project MCP config.** Read `{project_path}/.mcp.json` if it exists. Check whether it has a top-level key `mcpServers` containing an entry whose key is `context7` (or contains `context7`).

4. **Global MCP config.** Read `~/.claude/settings.json` and `~/.claude.json` if they exist. Check for `mcpServers.context7` or any MCP entry whose key contains `context7`.

5. **Project-local Claude config.** Read `{project_path}/.claude/settings.json` and `{project_path}/.claude/settings.local.json`. Same check as (4).

If none of the above match, stop and report "not-detected". Do **not** continue searching.

### Output format (strict)

Reply with exactly this block and nothing else:

```
CONTEXT7_DETECTED: <yes|no>
DETECTION_METHOD: <skill-global|skill-project|mcp-project|mcp-global|mcp-project-local|not-detected>
DETECTION_PATH: <absolute path of the matching file or directory, or "none">
NAME: <the exact skill name or MCP server key found, or "none">
NOTES: <one short sentence — e.g., "MCP server defined with URL https://..." or "skill directory found with SKILL.md">
```

If `CONTEXT7_DETECTED` is `no`, set the other fields to `not-detected` / `none`. Do not include any other text, explanation, or analysis. Do not suggest next steps. The calling skill handles synthesis.

### Constraints

- **Read-only.** Do not modify any files.
- **Bounded scope.** Stop at the first match — do not continue checking other locations.
- **No filesystem walks.** Use targeted Glob patterns and direct Reads only.
- **Quick thoroughness.** This should complete in seconds, not minutes.
