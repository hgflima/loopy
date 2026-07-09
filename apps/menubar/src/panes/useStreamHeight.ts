/**
 * useStreamHeight — hook for the draggable Kanban↔Stream divider (T-011).
 *
 * Manages a stream-height fraction persisted in localStorage.
 * Returns the current fraction, a mousedown handler for the divider,
 * and a reset handler (double-click → default).
 *
 * The fraction drives `--stream-h` via inline style on the container;
 * it does NOT rewrite `tokens.css`.
 *
 * State is **separate** from the fold toggle (C-0010).
 */

import { useState, useCallback, useRef, useEffect } from "react";
import {
  DEFAULT_FRACTION,
  clampFraction,
  readFraction,
  writeFraction,
} from "./resize-helpers";

export interface StreamHeightAPI {
  /** Current stream height as a fraction (0.20 – 0.70). */
  fraction: number;
  /** Attach to the divider's `onMouseDown`. */
  onDragStart: (e: React.MouseEvent) => void;
  /** Attach to the divider's `onDoubleClick` — resets to default. */
  onReset: () => void;
  /** True while the user is actively dragging. */
  dragging: boolean;
}

export function useStreamHeight(): StreamHeightAPI {
  const [fraction, setFraction] = useState(readFraction);
  const [dragging, setDragging] = useState(false);
  const containerRef = useRef<HTMLElement | null>(null);
  // Mirror fraction in a ref so handleUp can read it without a state updater.
  const fractionRef = useRef(fraction);
  fractionRef.current = fraction;

  const onDragStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    // Find the `.app-body__left` container to compute relative positions.
    const container = (e.target as HTMLElement).closest<HTMLElement>(
      ".app-body__left",
    );
    if (!container) return;
    containerRef.current = container;
    setDragging(true);
  }, []);

  // Global mousemove/mouseup during drag — attached via effect.
  useEffect(() => {
    if (!dragging) return;

    const handleMove = (e: MouseEvent) => {
      const container = containerRef.current;
      if (!container) return;
      const rect = container.getBoundingClientRect();
      // fraction = how much of the container the stream occupies (from bottom).
      const fromBottom = rect.bottom - e.clientY;
      const newFraction = clampFraction(fromBottom / rect.height);
      setFraction(newFraction);
    };

    const handleUp = () => {
      setDragging(false);
      writeFraction(fractionRef.current);
    };

    document.addEventListener("mousemove", handleMove);
    document.addEventListener("mouseup", handleUp);
    return () => {
      document.removeEventListener("mousemove", handleMove);
      document.removeEventListener("mouseup", handleUp);
    };
  }, [dragging]);

  const onReset = useCallback(() => {
    setFraction(DEFAULT_FRACTION);
    writeFraction(DEFAULT_FRACTION);
  }, []);

  return { fraction, onDragStart, onReset, dragging };
}
