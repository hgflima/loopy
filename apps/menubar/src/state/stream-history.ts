/**
 * Pure projection of the append-only transcript into step-grouped segments.
 *
 * AD-6 — pure function, no side effects, testable in isolation.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** One chunk in the append-only transcript, tagged by the step that was
 *  current when it arrived. Telemetry fields are best-effort (undefined
 *  when the step has no agent/model or no usage sample yet). */
export interface TranscriptEntry {
  readonly stepId: string;
  readonly text: string;
  readonly agent?: string;
  readonly model?: string;
  readonly usedTokens?: number;
  readonly size?: number;
}

/** Per-task transcript map (taskId → entries). */
export type Transcript = Readonly<Record<string, readonly TranscriptEntry[]>>;

/** A contiguous run of chunks that share the same stepId. Telemetry fields
 *  are propagated from the **last** entry in the segment (latest snapshot). */
export interface StreamSegment {
  readonly stepId: string;
  readonly label: string;
  readonly text: string;
  readonly agent?: string;
  readonly model?: string;
  readonly usedTokens?: number;
  readonly size?: number;
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
  let lastEntry = entries[0]!;

  for (let i = 1; i < entries.length; i++) {
    const e = entries[i]!;
    if (e.stepId === curId) {
      curText += e.text;
      lastEntry = e;
    } else {
      segments.push(buildSegment(curId, curText, lastEntry));
      curId = e.stepId;
      curText = e.text;
      lastEntry = e;
    }
  }
  segments.push(buildSegment(curId, curText, lastEntry));

  return segments;
}

/** Build a segment from accumulated text + the last entry's telemetry. */
function buildSegment(
  stepId: string,
  text: string,
  last: TranscriptEntry,
): StreamSegment {
  return {
    stepId,
    label: stepId,
    text,
    agent: last.agent,
    model: last.model,
    usedTokens: last.usedTokens,
    size: last.size,
  };
}
