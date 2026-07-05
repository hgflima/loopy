/**
 * The Tasks frame (Success Criterion #4): one row per backlog task in
 * registration order, with status glyph + color, and — while running — the
 * current step, `try k/max` attempt, and per-check status list. Reuses
 * {@link TaskRow} for each entry. Pure presentation over {@link StoreState}.
 */
import { Box, Text } from "ink";
import type { StoreState } from "../store";
import { TaskRow } from "./TaskRow";

export function TaskListPane({ state }: { readonly state: StoreState }) {
  if (state.tasks.length === 0) return null;

  return (
    <Box flexDirection="column" borderStyle="round" borderColor="gray" paddingX={1}>
      <Text dimColor>tasks</Text>
      {state.tasks.map((task) => (
        <TaskRow key={task.id} task={task} />
      ))}
    </Box>
  );
}
