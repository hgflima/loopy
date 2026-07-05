/**
 * Bounded tail of the global ACP traffic log ({@link StoreState.acpLog}).
 * Each line shows `direction` + optional `method` + `summary`, prefixed by
 * `taskId` when more than one task is currently running (concurrency > 1).
 * Pure presentation — the ring bounding and event accumulation live in
 * {@link ../store#reduce} (AD-6).
 */
import { Box, Text } from "ink";
import type { AcpLogLine, StoreState } from "../store";

const DEFAULT_MAX_LINES = 12;

/** Direction arrow: `▸` for send (to agent), `◂` for recv (from agent). */
function dirGlyph(direction: AcpLogLine["direction"]): string {
  return direction === "send" ? "▸" : "◂";
}

export function AcpLogPane({
  state,
  maxLines = DEFAULT_MAX_LINES,
}: {
  readonly state: StoreState;
  readonly maxLines?: number;
}) {
  const log = state.acpLog;
  if (log.length === 0) return null;

  const tail = log.slice(-maxLines);
  const concurrent = state.tasks.filter((t) => t.status === "running").length > 1;

  return (
    <Box flexDirection="column" borderStyle="round" borderColor="gray" paddingX={1}>
      <Text dimColor>acp</Text>
      {tail.map((line, i) => (
        <Text key={i} wrap="truncate-end">
          <Text dimColor>{dirGlyph(line.direction)} </Text>
          {concurrent ? <Text color="cyan">{line.taskId} </Text> : null}
          {line.method ? <Text color="yellow">{line.method} </Text> : null}
          <Text>{line.summary}</Text>
        </Text>
      ))}
    </Box>
  );
}
