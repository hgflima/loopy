/**
 * The Tasks frame (Success Criterion #4): one row per backlog task in
 * registration order, with status glyph + color, and — while running — the
 * current step, `try k/max` attempt, and per-check status list. Reuses
 * {@link TaskRow} for each entry. Pure presentation over {@link StoreState}.
 *
 * Always renders its titled frame at the caller-fixed `width`/`height` with
 * `overflow="hidden"`, so the dashboard column keeps a stable size (fixed
 * presence). When mounted standalone (tests) it sizes to content.
 */
import { Box, Text } from "ink";
import type { StoreState } from "../store";
import { TaskRow } from "./TaskRow";

export function TaskListPane({
  state,
  width,
  height,
}: {
  readonly state: StoreState;
  /** Fixed panel width in columns. */
  readonly width?: number;
  /** Fixed panel height in rows. */
  readonly height?: number;
}) {
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
      <Text dimColor>tasks</Text>
      {state.tasks.length === 0 ? (
        <Text dimColor>· sem tasks</Text>
      ) : (
        state.tasks.map((task) => <TaskRow key={task.id} task={task} />)
      )}
    </Box>
  );
}
