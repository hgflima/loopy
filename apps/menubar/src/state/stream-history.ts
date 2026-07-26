/**
 * The GUI-side timeline of a Step-of-Agent: a list of {@link StreamItem}s, the
 * shared `appendStreamItem` reducer that both consumers (the Run's bridge and
 * the Interview's `advance`) fold updates through, and the Step-grouped
 * projection (`segmentsFor` + `overlayStepUsage`) the panes render.
 *
 * AD-6 — pure functions, no side effects, no React, no I/O; testable in
 * isolation. The tool-call merge lives in the engine (`loopy/tui/store`), not
 * here (R2): rewriting the merge is this app's anti-pattern nº 1.
 */

import { mergeToolCall } from "loopy/tui/store";
import type { StreamItem, StreamUpdate } from "loopy/tui/store";

export type { StreamItem, StreamUpdate };

// ---------------------------------------------------------------------------
// appendStreamItem — the shared timeline reducer (R2/R6)
// ---------------------------------------------------------------------------

/**
 * Ring ceiling for a task's timeline (R6). Past this many *renderable* items the
 * oldest is dropped and a single `elided` marker on top tallies how many
 * vanished — the list may shrink but never lies. Doctrine precedents in the
 * engine: `ACP_LOG_CAP` (200), `WARNINGS_CAP` (50).
 */
export const TIMELINE_CAP = 500;

/**
 * Fold one {@link StreamUpdate} onto a task's timeline, returning the next list.
 * The **single** place that knows the four rules nobody should reimplement:
 *
 * - **(a)** a `tool_delta` finds its card by `toolCallId` (never by adjacency —
 *   updates arrive interleaved with agent text and still return to the right
 *   card) and applies {@link mergeToolCall} (R2, imported from the engine).
 * - **(b)** a `tool_delta` whose `toolCallId` is absent fabricates **no** card —
 *   it is dropped (the list, and its reference, are returned untouched).
 * - **(c)** a `text`/`thought` sharing the `messageId` of the immediately
 *   previous item concatenates into it (preserving the `MarkdownStream` memo);
 *   a different or absent `messageId` opens a new item.
 * - **(d)** past `cap` the oldest item drops and an `{ item: "elided", count }`
 *   on top sums how many were dropped, accumulating across cuts — the marker is
 *   never counted as a cuttable item nor duplicated.
 *
 * Returns the same reference on a genuine no-op (an orphan delta, or a within-
 * cap append that changed nothing), so structural sharing holds.
 */
export function appendStreamItem(
  items: readonly StreamItem[],
  update: StreamUpdate,
  cap = TIMELINE_CAP,
): readonly StreamItem[] {
  return capTimeline(applyUpdate(items, update), cap);
}

/** Apply the content rules (a/b/c + plan/mode/raw); the cap is applied after. */
function applyUpdate(
  items: readonly StreamItem[],
  update: StreamUpdate,
): readonly StreamItem[] {
  switch (update.kind) {
    case "text":
    case "thought":
      return appendProse(items, update.kind, update.text, update.messageId);
    case "tool_call":
      return [...items, { item: "tool", call: update.call }];
    case "tool_delta": {
      const id = update.delta.toolCallId;
      const idx = items.findIndex(
        (it) => it.item === "tool" && it.call.toolCallId === id,
      );
      if (idx === -1) return items; // rule (b): orphan delta — no card fabricated
      const current = (items[idx] as Extract<StreamItem, { item: "tool" }>)
        .call;
      const next = [...items];
      next[idx] = { item: "tool", call: mergeToolCall(current, update.delta) };
      return next;
    }
    case "plan":
      return [...items, { item: "plan", entries: update.entries }];
    case "mode":
      return [...items, { item: "mode", modeId: update.modeId }];
    case "raw":
      return [
        ...items,
        { item: "raw", kind: update.updateKind, payload: update.payload },
      ];
  }
}

/**
 * Rule (c): concatenate `text`/`thought` into the immediately previous item when
 * they share a defined `messageId` and the same variant; otherwise open a new
 * item. Variant must match — a `text` update never merges into a `thought`, so
 * the two render as distinct blocks.
 */
function appendProse(
  items: readonly StreamItem[],
  kind: "text" | "thought",
  text: string,
  messageId: string | undefined,
): readonly StreamItem[] {
  const last = items[items.length - 1];
  if (
    last !== undefined &&
    last.item === kind &&
    last.messageId !== undefined &&
    messageId !== undefined &&
    last.messageId === messageId
  ) {
    const merged: StreamItem = {
      item: kind,
      text: last.text + text,
      messageId,
    };
    return [...items.slice(0, -1), merged];
  }
  const fresh: StreamItem =
    messageId === undefined
      ? { item: kind, text }
      : { item: kind, text, messageId };
  return [...items, fresh];
}

/**
 * Rule (d): keep at most `cap` renderable items. The `elided` marker (index 0
 * when present) is not counted toward the cap and is never duplicated — repeated
 * cuts accumulate into its `count`. Returns the same reference when nothing is
 * dropped.
 */
function capTimeline(
  items: readonly StreamItem[],
  cap: number,
): readonly StreamItem[] {
  const head = items[0];
  const hasElided = head?.item === "elided";
  const priorElided = hasElided ? head.count : 0;
  const rest = hasElided ? items.slice(1) : items;
  if (rest.length <= cap) return items;
  const overflow = rest.length - cap;
  const marker: StreamItem = { item: "elided", count: priorElided + overflow };
  return [marker, ...rest.slice(overflow)];
}

// ---------------------------------------------------------------------------
// Transcript types — the Run's per-task, Step-tagged item log
// ---------------------------------------------------------------------------

/** One item in the append-only transcript, tagged by the step that was current
 *  when it arrived. Telemetry fields are best-effort (undefined when the step
 *  has no agent/model or no usage sample yet). */
export interface TranscriptEntry {
  readonly stepId: string;
  readonly item: StreamItem;
  readonly agent?: string;
  readonly model?: string;
  readonly usedTokens?: number;
  readonly size?: number;
}

/** Per-task transcript map (taskId → entries). */
export type Transcript = Readonly<Record<string, readonly TranscriptEntry[]>>;

/** A contiguous run of entries that share the same stepId, carrying their items
 *  in order. Telemetry fields are propagated from the **last** entry in the
 *  segment (latest snapshot). */
export interface StreamSegment {
  readonly stepId: string;
  readonly label: string;
  readonly items: readonly StreamItem[];
  readonly agent?: string;
  readonly model?: string;
  readonly usedTokens?: number;
  readonly size?: number;
}

// ---------------------------------------------------------------------------
// segmentsFor — group the transcript into Step segments
// ---------------------------------------------------------------------------

/**
 * Slice the transcript for `taskId` into contiguous segments grouped by
 * `stepId`. Consecutive entries with the same `stepId` are collected into a
 * single segment (their items, in order); a step reappearing later produces a
 * separate segment. Returns `[]` when the task has no transcript entries.
 */
export function segmentsFor(taskId: string, hist: Transcript): StreamSegment[] {
  const entries = hist[taskId];
  if (!entries?.length) return [];

  const segments: StreamSegment[] = [];
  let curId = entries[0]!.stepId;
  let curItems: StreamItem[] = [entries[0]!.item];
  let lastEntry = entries[0]!;

  for (let i = 1; i < entries.length; i++) {
    const e = entries[i]!;
    if (e.stepId === curId) {
      curItems.push(e.item);
      lastEntry = e;
    } else {
      segments.push(buildSegment(curId, curItems, lastEntry));
      curId = e.stepId;
      curItems = [e.item];
      lastEntry = e;
    }
  }
  segments.push(buildSegment(curId, curItems, lastEntry));

  return segments;
}

/** Build a segment from accumulated items + the last entry's telemetry. */
function buildSegment(
  stepId: string,
  items: readonly StreamItem[],
  last: TranscriptEntry,
): StreamSegment {
  return {
    stepId,
    label: stepId,
    items,
    agent: last.agent,
    model: last.model,
    usedTokens: last.usedTokens,
    size: last.size,
  };
}

// ---------------------------------------------------------------------------
// overlayStepUsage — reconcile segments with LIVE per-step telemetry
// ---------------------------------------------------------------------------

/** Minimal live-step shape (structurally satisfied by `StepState` from
 *  `loopy/tui/store`). Kept structural so this module stays store-agnostic. */
export interface StepTelemetry {
  readonly id: string;
  readonly agentName?: string;
  readonly model?: string;
  readonly used?: number;
  readonly size?: number;
}

/**
 * Overlay live per-step telemetry (`used`/`size`, and `agent`/`model`) from the
 * task's current step state onto the item-grouped segments.
 *
 * WHY: the transcript entry snapshots `step.used` at chunk time, but
 * `usage_update` (→ `usage_sample` → `step.used`) arrives at the **end** of a
 * turn, *after* the step's chunks. So the transcript snapshot is stale/absent
 * (undefined) for the actively-streaming block and for single-block steps — the
 * raia then shows the agent but no `(used / %)`. The live step state is the
 * authoritative source of the latest sample; overlay it at render time.
 *
 * Best-effort (AD-6, pure): a segment whose `stepId` is absent from `steps`, or
 * whose live field is undefined, keeps its own snapshot value — never throws,
 * never blanks a value the snapshot did carry. The segment's `items` are left
 * untouched.
 */
export function overlayStepUsage(
  segments: readonly StreamSegment[],
  steps: readonly StepTelemetry[],
): StreamSegment[] {
  return segments.map((seg) => {
    const step = steps.find((s) => s.id === seg.stepId);
    if (!step) return seg;
    return {
      ...seg,
      agent: step.agentName ?? seg.agent,
      model: step.model ?? seg.model,
      usedTokens: step.used ?? seg.usedTokens,
      size: step.size ?? seg.size,
    };
  });
}

// ---------------------------------------------------------------------------
// segmentText — transitional bridge for the current MarkdownStream consumers
// ---------------------------------------------------------------------------

/**
 * Flatten a segment's `text` items into a single markdown string.
 *
 * Transitional (T-005): the current `StreamPanel`/`CardDetail` render one
 * `MarkdownStream` per Step segment; until the rich per-item renderer lands
 * (T-012), this reconstitutes the prose those panes used to read from
 * `segment.text`. Non-`text` items (tool cards, thoughts, plan, mode, raw) are
 * skipped — they gain their own components later.
 */
export function segmentText(items: readonly StreamItem[]): string {
  let out = "";
  for (const it of items) {
    if (it.item === "text") out += it.text;
  }
  return out;
}
