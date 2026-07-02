/**
 * One backlog task's live row: status glyph + id + title, and — while running —
 * the current step, its `try k/max` attempt, and the per-check status list
 * (Success Criterion #6). Reads only from a {@link TaskState}; the store keys
 * everything by task, so rows compose without any "current task" singleton.
 */
import { Box, Text } from "ink";
import type { TaskState } from "../store";
import { attemptLabel, COLORS, SYMBOLS } from "../view";
import { CheckStatus } from "./CheckStatus";

export function TaskRow({ task }: { readonly task: TaskState }) {
  const current = task.steps.find((step) => step.id === task.currentStepId);
  const attempt = current ? attemptLabel(current) : "";

  return (
    <Box flexDirection="column">
      <Box>
        <Text color={COLORS.task[task.status]}>
          {SYMBOLS.task[task.status]}{" "}
        </Text>
        <Text bold>{task.id}</Text>
        <Text> {task.title}</Text>
        {current ? (
          <Text color="cyan">
            {"  ▸ "}
            {current.id}
          </Text>
        ) : null}
        {attempt ? (
          <Text color="yellow">
            {"  "}
            {attempt}
          </Text>
        ) : null}
      </Box>

      {current && current.checks.length > 0 ? (
        <Box flexDirection="column" marginLeft={4}>
          {current.checks.map((check) => (
            <CheckStatus key={check.name} check={check} />
          ))}
        </Box>
      ) : null}

      {task.status === "escalated" && task.reason ? (
        <Box marginLeft={2}>
          <Text color="red">{task.reason}</Text>
        </Box>
      ) : null}
    </Box>
  );
}
