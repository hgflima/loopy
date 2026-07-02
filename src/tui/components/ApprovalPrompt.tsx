/**
 * The interactive merge/approval gate rendered inside the live TUI (OQ2). It
 * reads the head-of-queue request from the {@link ApprovalController} and answers
 * it from `useInput`: `y`/`s` approve, `n`/Esc reject. When nothing is pending it
 * renders nothing, so the prompt only appears while a step is actually waiting on
 * a human. The controller (not this component) owns the promise the interpreter
 * awaits, keeping the gate transport-agnostic and testable without Ink.
 */
import { Box, Text, useInput } from "ink";
import type { ApprovalController } from "../approval";
import { usePending } from "../hooks";

export function ApprovalPrompt({
  controller,
}: {
  readonly controller: ApprovalController;
}) {
  const pending = usePending(controller);

  useInput((input, key) => {
    if (!pending) return;
    const char = input.toLowerCase();
    if (char === "y" || char === "s") {
      controller.answer(true);
    } else if (char === "n" || key.escape) {
      controller.answer(false);
    }
  });

  if (!pending) return null;

  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor="yellow"
      paddingX={1}
    >
      <Text color="yellow" bold>
        Aprovação necessária
      </Text>
      <Text>{pending.prompt}</Text>
      <Text dimColor>[y] aprovar · [n] rejeitar</Text>
    </Box>
  );
}
