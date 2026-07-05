/**
 * Thin wrapper that renders the DAG graph produced by {@link renderGraph} as
 * colored Ink `<Text>` spans. All layout and styling logic lives in pure
 * `view.ts` (AD-6); this component only drives the pulse tick and maps
 * {@link StyledRow}[] → JSX.
 */
import { Box, Text, useStdout } from "ink";
import { useEffect, useState } from "react";
import type { StoreState, TaskStatus } from "../store";
import { renderGraph, layoutGraph } from "../view";

const PULSE_MS = 500;

export function GraphPane({ state }: { readonly state: StoreState }) {
  const [tick, setTick] = useState(0);
  const { stdout } = useStdout();

  // Pulse animation for running tasks
  useEffect(() => {
    const hasRunning = state.tasks.some((t) => t.status === "running");
    if (!hasRunning) return;
    const id = setInterval(() => setTick((t) => t + 1), PULSE_MS);
    return () => clearInterval(id);
  }, [state.tasks]);

  // Build status map
  const statusById = new Map<string, TaskStatus>(
    state.tasks.map((t) => [t.id, t.status]),
  );

  // Backlog order = registration order in the store
  const order = state.tasks.map((t) => t.id);

  // Layout + render
  const geometry = layoutGraph(state.edges, statusById, order);
  const panelWidth = stdout?.columns ?? 80;
  const rows = renderGraph(geometry, statusById, tick, {
    width: panelWidth,
    height: geometry.height,
  });

  if (rows.length === 0) return null;

  return (
    <Box flexDirection="column" borderStyle="round" borderColor="gray" paddingX={1}>
      <Text dimColor>graph</Text>
      {rows.map((row, ri) => (
        <Text key={ri}>
          {row.map((span, si) => (
            <Text
              key={si}
              color={span.color}
              bold={span.bold}
              dimColor={span.dim}
            >
              {span.text}
            </Text>
          ))}
        </Text>
      ))}
    </Box>
  );
}
