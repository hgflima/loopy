/**
 * A bounded window onto a running task's agent stream (Success Criterion #6:
 * "o stream do agente"). Shows the last few lines of accumulated turn text so a
 * long turn does not scroll the whole tree; renders nothing when there is no
 * stream yet. The tail computation lives in the pure {@link ../view#streamTail}.
 */
import { Box, Text } from "ink";
import { streamTail } from "../view";

export function StreamPane({
  title,
  stream,
  maxLines = 8,
}: {
  readonly title: string;
  readonly stream: string;
  readonly maxLines?: number;
}) {
  const lines = streamTail(stream, maxLines);
  if (lines.length === 0) return null;

  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor="gray"
      paddingX={1}
    >
      <Text dimColor>stream · {title}</Text>
      {lines.map((line, index) => (
        // Stream lines have no stable id; index is the natural key for a
        // scrolling tail (order is the identity here).
        <Text key={index} wrap="truncate-end">
          {line}
        </Text>
      ))}
    </Box>
  );
}
