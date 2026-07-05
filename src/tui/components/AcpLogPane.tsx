/**
 * Fixed-size tail of the global ACP traffic log ({@link StoreState.acpLog}).
 *
 * The panel is **meaningful, not raw**: a bare `session/update` says nothing (it
 * fires dozens of times per turn), so the store already collapses identical
 * consecutive events into one line with a `count`, and `acpTrafficSummary`
 * (upstream, in `index.ts`) surfaces the update's sub-kind
 * (`agent_message_chunk`, `tool_call`, `plan`, …) as the summary. Here we render
 * structural RPCs (prompt, set_mode, permission, fs, terminal) with a bright
 * `method`, and the streamy `session/update` sub-kinds dimmed — so the eye
 * separates "the bridge did something" from "the agent is streaming".
 *
 * Always renders its titled frame (fixed presence) at a caller-fixed `height`
 * with `overflow="hidden"` so the dashboard geometry never shifts. Pure
 * presentation — ring bounding + collapsing live in {@link ../store#reduce}.
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
  width,
  height,
  maxLines,
}: {
  readonly state: StoreState;
  /** Fixed panel width in columns. */
  readonly width?: number;
  /** Fixed panel height in rows (border + title + content). Omit to size to content. */
  readonly height?: number;
  /** Explicit content-line cap; else derived from `height` (or the default). */
  readonly maxLines?: number;
}) {
  const cap =
    maxLines ??
    (height !== undefined ? Math.max(1, height - 3) : DEFAULT_MAX_LINES);
  const tail = state.acpLog.slice(-cap);
  const concurrent =
    state.tasks.filter((t) => t.status === "running").length > 1;

  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor="gray"
      paddingX={1}
      width={width}
      height={height}
      overflow="hidden"
    >
      <Text dimColor>acp</Text>
      {tail.length === 0 ? (
        <Text dimColor>· sem tráfego</Text>
      ) : (
        tail.map((line, i) => {
          const isUpdate = line.method === "session/update";
          return (
            <Text key={i} wrap="truncate-end">
              <Text dimColor>{dirGlyph(line.direction)} </Text>
              {concurrent ? <Text color="cyan">{line.taskId} </Text> : null}
              {isUpdate ? (
                // Streamy update: just the sub-kind, dimmed.
                <Text dimColor>{line.summary}</Text>
              ) : (
                <>
                  {line.method ? (
                    <Text color="yellow">{line.method}</Text>
                  ) : null}
                  {line.summary ? (
                    <Text>
                      {line.method ? " " : ""}
                      {line.summary}
                    </Text>
                  ) : null}
                </>
              )}
              {line.count && line.count > 1 ? (
                <Text dimColor> ×{line.count}</Text>
              ) : null}
            </Text>
          );
        })
      )}
    </Box>
  );
}
