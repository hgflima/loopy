/**
 * Dashboard fixo do run (T-010). Layout vertical:
 *   header → GraphPane → split (TaskListPane | StreamPane(s) + AcpLogPane)
 *
 * O pulso (`tick`) anima tasks running via `setInterval(500ms)` — a fase vem de
 * `pulseFrame(tick)` (pura, AD-6). StreamPanes são bounded: no máximo ~3 mais
 * recentes + contador `+K`. Nenhum `useInput` além do `ApprovalPrompt` (AD-1).
 */
import { Box, Text } from "ink";
import { useEffect, useState } from "react";
import type { ApprovalController } from "./approval";
import { AcpLogPane } from "./components/AcpLogPane";
import { ApprovalPrompt } from "./components/ApprovalPrompt";
import { GraphPane } from "./components/GraphPane";
import { StreamPane } from "./components/StreamPane";
import { TaskListPane } from "./components/TaskListPane";
import { useStore } from "./hooks";
import type { Store } from "./store";
import { pulseFrame } from "./view";

const PULSE_MS = 500;
const MAX_STREAMS = 3;

export function App({
  store,
  approval,
}: {
  readonly store: Store;
  readonly approval: ApprovalController;
}) {
  const state = useStore(store);
  const [tick, setTick] = useState(0);

  const running = state.tasks.filter((t) => t.status === "running");
  const doneCount = state.tasks.filter((t) => t.status === "done").length;
  const total = state.tasks.length;

  // Pulse timer — only active while there are running tasks
  useEffect(() => {
    if (running.length === 0) return;
    const id = setInterval(() => setTick((t) => t + 1), PULSE_MS);
    return () => clearInterval(id);
  }, [running.length]);

  const pulsing = pulseFrame(tick) === "on";

  // Bounded stream panes: show the ~3 most recent running tasks
  const visibleStreams = running.slice(-MAX_STREAMS);
  const hiddenCount = running.length - visibleStreams.length;

  return (
    <Box flexDirection="column">
      {/* Header */}
      <Box gap={1}>
        <Text bold={pulsing} dimColor={!pulsing}>
          loopy
        </Text>
        <Text dimColor>·</Text>
        <Text>run</Text>
        <Text dimColor>·</Text>
        <Text color="green">{doneCount}/{total} done</Text>
        <Text dimColor>·</Text>
        <Text color="cyan">{running.length} running</Text>
      </Box>

      {/* Graph pane */}
      <GraphPane state={state} />

      {/* Split: TaskList (left) | Streams + AcpLog (right) */}
      <Box>
        {/* Left column */}
        <Box flexDirection="column" flexGrow={1}>
          <TaskListPane state={state} />
        </Box>

        {/* Right column */}
        <Box flexDirection="column" flexGrow={1}>
          {hiddenCount > 0 && (
            <Text dimColor>+{hiddenCount} more streams</Text>
          )}
          {visibleStreams.map((task) => (
            <StreamPane key={task.id} title={task.id} stream={task.stream} />
          ))}
          <AcpLogPane state={state} />
        </Box>
      </Box>

      {/* Approval gate */}
      <ApprovalPrompt controller={approval} />
    </Box>
  );
}
