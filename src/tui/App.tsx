/**
 * Fixed run dashboard (T-010). A full-screen, non-scrolling layout pinned to the
 * terminal rectangle:
 *
 *   header (1 row)
 *   graph  (graphH ≈ 60%)           ← DAG, fixed height, clipped
 *   body   (bodyH): tasks | streams ← fixed-width columns, clipped
 *
 * The graph takes ~60% of the terminal so the DAG fits without the bottom ranks
 * being clipped; the body (task list | agent streams) gets the rest. There is no
 * ACP pane — the JSON-RPC traffic seam feeds the file log and the verbose line
 * fallback, not the dashboard.
 *
 * Every region has an **explicit height** and `overflow="hidden"`, and the root
 * box is pinned to `cols × rows` — so the frame occupies one stable rectangle
 * and never grows/scrolls as tasks come and go (fixed size + fixed presence).
 * Terminal resizes update the geometry via a `resize` listener. `mount.tsx`
 * switches the terminal to the alternate screen so this reads as a real
 * dashboard, not append-only output.
 *
 * A single `tick` timer (500ms, only while tasks run) drives the running-task
 * pulse; it is threaded into {@link GraphPane} so the whole tree shares one
 * timer. No `useInput` outside the {@link ApprovalPrompt} (AD-1).
 */
import { Box, Text, useStdout } from "ink";
import { useEffect, useState } from "react";
import type { ApprovalController } from "./approval";
import { ApprovalPrompt } from "./components/ApprovalPrompt";
import { GraphPane } from "./components/GraphPane";
import { StreamPane } from "./components/StreamPane";
import { TaskListPane } from "./components/TaskListPane";
import { useStore } from "./hooks";
import type { Store } from "./store";
import { pulseFrame, renderWarnings } from "./view";

const PULSE_MS = 500;
/** Most concurrent stream panes to render; the rest fold into a `+K` note. */
const MAX_STREAMS = 3;
/** Minimum rows a stream pane needs to show a line of content (border+title+1). */
const MIN_STREAM_H = 5;
/** Fallback terminal size when stdout has no dimensions (non-TTY / tests). */
const FALLBACK_COLS = 100;
const FALLBACK_ROWS = 40;

const clamp = (v: number, lo: number, hi: number) =>
  Math.max(lo, Math.min(hi, v));

/** Live terminal dimensions, tracked across `resize` events. */
function useTerminalSize(): { readonly cols: number; readonly rows: number } {
  const { stdout } = useStdout();
  const read = () => ({
    cols: stdout?.columns ?? FALLBACK_COLS,
    rows: stdout?.rows ?? FALLBACK_ROWS,
  });
  const [size, setSize] = useState(read);
  useEffect(() => {
    if (!stdout) return;
    const onResize = () => setSize(read());
    stdout.on("resize", onResize);
    return () => {
      stdout.off?.("resize", onResize);
    };
  }, [stdout]);
  return size;
}

export function App({
  store,
  approval,
}: {
  readonly store: Store;
  readonly approval: ApprovalController;
}) {
  const state = useStore(store);
  const { cols, rows } = useTerminalSize();
  const [tick, setTick] = useState(0);

  const running = state.tasks.filter((t) => t.status === "running");
  const doneCount = state.tasks.filter((t) => t.status === "done").length;
  const total = state.tasks.length;
  const multiAgent = state.activeAgents.size > 1;

  // Single pulse timer — only active while there are running tasks.
  useEffect(() => {
    if (running.length === 0) return;
    const id = setInterval(() => setTick((t) => t + 1), PULSE_MS);
    return () => clearInterval(id);
  }, [running.length]);

  const pulsing = pulseFrame(tick) === "on";
  const warningLines = renderWarnings(state);

  // ---- Fixed geometry (derived once per render from the terminal size) -----
  const headerH = 1;
  const warningH = warningLines.length;
  // Graph gets ~60% of the terminal (the DAG was being clipped at ~40%); the
  // body (tasks | streams) gets the rest, floored so both stay visible.
  const graphH = clamp(
    Math.round(rows * 0.6),
    6,
    Math.max(6, rows - headerH - warningH - 5),
  );
  const bodyH = Math.max(5, rows - headerH - graphH - warningH);
  const leftW = clamp(Math.round(cols * 0.44), 24, Math.max(24, cols - 30));
  const rightW = cols - leftW;
  // With the ACP pane removed, the agent streams fill the whole right column.
  const streamsH = bodyH;

  // ---- Streams: fill the fixed streams region, tiled; overflow → +K note ----
  const maxFit = clamp(Math.floor(streamsH / MIN_STREAM_H), 1, MAX_STREAMS);
  const visibleStreams = running.slice(-maxFit);
  const hiddenCount = running.length - visibleStreams.length;
  const noteRows = hiddenCount > 0 ? 1 : 0;
  const paneCount = Math.max(1, visibleStreams.length);
  const paneH = Math.max(4, Math.floor((streamsH - noteRows) / paneCount));

  return (
    <Box flexDirection="column" width={cols} height={rows} overflow="hidden">
      {/* Header */}
      <Box height={headerH} gap={1}>
        <Text bold={pulsing} dimColor={!pulsing}>
          loopy
        </Text>
        <Text dimColor>·</Text>
        <Text>run</Text>
        <Text dimColor>·</Text>
        <Text color="green">
          {doneCount}/{total} done
        </Text>
        <Text dimColor>·</Text>
        <Text color="cyan">{running.length} running</Text>
      </Box>

      {/* Graph pane — full width, fixed height */}
      <GraphPane state={state} width={cols} height={graphH} tick={tick} />

      {/* Body: Tasks (left) | Streams (right) */}
      <Box height={bodyH}>
        {/* Left column */}
        <TaskListPane state={state} width={leftW} height={bodyH} />

        {/* Right column — agent streams, fixed height, tiled panes */}
        <Box
          flexDirection="column"
          width={rightW}
          height={streamsH}
          overflow="hidden"
        >
          {hiddenCount > 0 ? (
            <Text dimColor>+{hiddenCount} streams ocultas</Text>
          ) : null}
          {visibleStreams.length === 0 ? (
            <StreamPane
              title="idle"
              stream=""
              width={rightW}
              height={streamsH}
            />
          ) : (
            visibleStreams.map((task) => (
              <StreamPane
                key={task.id}
                title={task.id}
                stream={task.stream}
                agent={task.streamAgent}
                multiAgent={multiAgent}
                width={rightW}
                height={paneH}
              />
            ))
          )}
        </Box>
      </Box>

      {/* Warnings — N lines at the bottom, zero frame when empty */}
      {warningLines.length > 0 && (
        <Box flexDirection="column">
          {warningLines.map((line, i) => (
            <Text key={i} color="yellow">
              {line}
            </Text>
          ))}
        </Box>
      )}

      {/* Approval gate */}
      <ApprovalPrompt controller={approval} />
    </Box>
  );
}
