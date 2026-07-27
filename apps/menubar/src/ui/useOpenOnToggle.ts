import { useState, type SyntheticEvent } from "react";

/**
 * Track a native <details> that should mount its body only after the first open.
 * The returned handler matches the onToggle shape used by ThoughtBlock and RawUpdateRow.
 */
export function useOpenOnToggle(): {
  readonly opened: boolean;
  readonly onToggle: (e: SyntheticEvent<HTMLDetailsElement>) => void;
} {
  const [opened, setOpened] = useState(false);

  return {
    opened,
    onToggle: (e) => {
      if (e.currentTarget.open) setOpened(true);
    },
  };
}
