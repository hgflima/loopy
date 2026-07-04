import { stringify } from "yaml";

/**
 * A minimal-but-complete valid config as a plain object. Tests clone this and
 * mutate a single field so each case reads as a self-contained specification.
 */
export function baseConfig(): Record<string, unknown> {
  return {
    version: "1",
    name: "test-loop",
    workspace: {
      root: ".",
      parent_branch: "main",
      worktrees_dir: ".worktrees",
    },
    acp: {
      command: ["npx", "-y", "@agentclientprotocol/claude-agent-acp"],
      request_timeout_seconds: 1800,
      permissions: {
        default_mode: "acceptEdits",
        on_request: "allow",
      },
    },
    inputs: {
      spec: "SPEC.md",
      plan: "tasks/plan.md",
      todo: "tasks/todo.md",
      backlog: {
        pending_marker: "- [ ]",
        done_marker: "- [x]",
        task_id_pattern: "T-\\d+",
        body: "indented",
        mark_done_on_success: true,
      },
    },
    checks: {
      ci: [{ name: "typecheck", run: "npm run typecheck" }],
    },
    pipeline: [
      {
        id: "implement",
        type: "agent",
        prompt: "do it",
        verify: { run: "ci", max_attempts: 4 },
      },
      { id: "cleanup", type: "shell", always: true, run: ["echo done"] },
    ],
    stop_conditions: { max_iterations: 25, stop_signal_file: ".loopy.stop" },
    concurrency: 1,
    policies: {
      escalation: { action: "pause", keep_worktree: true, notify: "stderr" },
      git: { require_clean_parent: true },
    },
    logging: { dir: ".loopy/logs", per_task: true, capture_acp_traffic: true },
  };
}

/** Clone the base config and apply a mutation before serializing to YAML. */
export function configYaml(
  mutate?: (c: Record<string, unknown>) => void,
): string {
  const cfg = structuredClone(baseConfig());
  mutate?.(cfg);
  return stringify(cfg);
}
