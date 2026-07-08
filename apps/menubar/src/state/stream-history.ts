/**
 * Pure projection of the append-only transcript into step-grouped segments.
 *
 * AD-6 — pure function, no side effects, testable in isolation.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** One chunk in the append-only transcript, tagged by the step that was
 *  current when it arrived. */
export interface TranscriptEntry {
  readonly stepId: string;
  readonly text: string;
}

/** Per-task transcript map (taskId → entries). */
export type Transcript = Readonly<Record<string, readonly TranscriptEntry[]>>;

/** A contiguous run of chunks that share the same stepId. */
export interface StreamSegment {
  readonly stepId: string;
  readonly label: string;
  readonly text: string;
}

// ---------------------------------------------------------------------------
// segmentsFor — the only export that does work
// ---------------------------------------------------------------------------

/**
 * Slice the transcript for `taskId` into contiguous segments grouped by
 * `stepId`.  Consecutive entries with the same `stepId` are merged into a
 * single segment; a step reappearing later produces a separate segment.
 *
 * Returns `[]` when the task has no transcript entries.
 */
export function segmentsFor(
  taskId: string,
  hist: Transcript,
): StreamSegment[] {
  const entries = hist[taskId];
  if (!entries?.length) return [];

  const segments: StreamSegment[] = [];
  let curId = entries[0]!.stepId;
  let curText = entries[0]!.text;

  for (let i = 1; i < entries.length; i++) {
    const e = entries[i]!;
    if (e.stepId === curId) {
      curText += e.text;
    } else {
      segments.push({ stepId: curId, label: curId, text: curText });
      curId = e.stepId;
      curText = e.text;
    }
  }
  segments.push({ stepId: curId, label: curId, text: curText });

  return segments;
}
