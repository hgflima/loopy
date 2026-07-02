/**
 * Root of the live progress tree (T-017). Subscribes to the run {@link Store} via
 * {@link useStore} and renders one {@link TaskRow} per backlog task (in order),
 * a {@link StreamPane} for each running task's agent stream, and the
 * {@link ApprovalPrompt} gate. It holds no state of its own — every value comes
 * from the store or the approval controller — so the whole tree is a pure
 * function of observable state (AD-6). The engine feeds that state through
 * `store.dispatch`; this component only reads it.
 */
import { Box, Text } from "ink";
import type { ApprovalController } from "./approval";
import { ApprovalPrompt } from "./components/ApprovalPrompt";
import { StreamPane } from "./components/StreamPane";
import { TaskRow } from "./components/TaskRow";
import { useStore } from "./hooks";
import type { Store } from "./store";

export function App({
  store,
  approval,
}: {
  readonly store: Store;
  readonly approval: ApprovalController;
}) {
  const state = useStore(store);
  const running = state.tasks.filter((task) => task.status === "running");

  return (
    <Box flexDirection="column">
      <Text bold>loopy</Text>

      <Box flexDirection="column">
        {state.tasks.map((task) => (
          <TaskRow key={task.id} task={task} />
        ))}
      </Box>

      {running.map((task) => (
        <StreamPane key={task.id} title={task.id} stream={task.stream} />
      ))}

      <ApprovalPrompt controller={approval} />
    </Box>
  );
}
