/**
 * A fixed window onto a running task's agent stream (Success Criterion #6:
 * "o stream do agente"). Shows the last few lines of accumulated turn text so a
 * long turn does not scroll the whole tree. Always renders its titled frame
 * (fixed presence) — a placeholder line stands in until the first chunk arrives,
 * so the panel never pops in and out. The tail computation lives in the pure
 * {@link ../view#streamTail}.
 */
import { Box, Text } from "ink";
import { streamTail } from "../view";

export function StreamPane({
  title,
  stream,
  width,
  height,
  maxLines = 8,
}: {
  readonly title: string;
  readonly stream: string;
  /** Fixed panel width in columns. */
  readonly width?: number;
  /** Fixed panel height in rows (border + title + content). Omit to size to content. */
  readonly height?: number;
  /** Explicit content-line cap; else derived from `height` (or the default). */
  readonly maxLines?: number;
}) {
  const cap =
    height !== undefined ? Math.max(1, height - 3) : maxLines;
  const lines = streamTail(stream, cap);

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
      <Text dimColor>stream · {title}</Text>
      {lines.length === 0 ? (
        <Text dimColor>· aguardando…</Text>
      ) : (
        lines.map((line, index) => (
          // Stream lines have no stable id; index is the natural key for a
          // scrolling tail (order is the identity here).
          <Text key={index} wrap="truncate-end">
            {line}
          </Text>
        ))
      )}
    </Box>
  );
}
