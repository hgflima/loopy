/**
 * Thin wrapper that renders the DAG graph produced by {@link renderGraph} as
 * colored Ink `<Text>` spans. All layout and styling logic lives in pure
 * `view.ts` (AD-6); this component only maps {@link StyledRow}[] → JSX.
 *
 * The pulse `tick` and the panel dimensions are **owned by the parent**
 * ({@link ../App}) so the whole dashboard shares one timer and one fixed
 * geometry — the pane clips to `height` with `overflow="hidden"` and always
 * renders its titled frame (fixed presence), so nothing below it ever shifts.
 * When mounted standalone (tests) it falls back to the terminal width and the
 * graph's natural height.
 */
import { Box, Text, useStdout } from "ink";
import type { StoreState, TaskStatus } from "../store";
import { layoutGraph, renderGraph } from "../view";

export function GraphPane({
  state,
  width,
  height,
  tick = 0,
}: {
  readonly state: StoreState;
  /** Fixed panel width in columns (border + padding + content). */
  readonly width?: number;
  /** Fixed panel height in rows (border + title + content). Omit to size to content. */
  readonly height?: number;
  /** Pulse phase from the parent's single timer. */
  readonly tick?: number;
}) {
  const { stdout } = useStdout();

  const statusById = new Map<string, TaskStatus>(
    state.tasks.map((t) => [t.id, t.status]),
  );
  // Backlog order = registration order in the store.
  const order = state.tasks.map((t) => t.id);
  const geometry = layoutGraph(state.edges, statusById, order);

  // Content area excludes the round border (2) + horizontal padding (2), and the
  // title row (1) vertically.
  const outerWidth = width ?? stdout?.columns ?? 80;
  const innerWidth = Math.max(1, outerWidth - 4);
  const innerHeight =
    height !== undefined ? Math.max(0, height - 3) : geometry.height;

  const rows = renderGraph(geometry, statusById, tick, {
    width: innerWidth,
    height: innerHeight,
  });

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
      <Text dimColor>graph</Text>
      {rows.map((row, ri) => (
        <Text key={ri} wrap="truncate-end">
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
