/**
 * StreamTimeline — the ONE dispatcher of a Step-of-Agent timeline.
 *
 * It takes `items: readonly StreamItem[]` and renders one component per `item`:
 *   text    → MarkdownStream   (sanitized prose)
 *   thought → ThoughtBlock     (collapsed on birth, D7)
 *   tool    → ToolCallCard      (the live tool call)
 *   plan    → PlanBlock          (the turn's plan)
 *   mode    → a simple line      (a Mode switch)
 *   raw     → RawUpdateRow        (the catch-all, C2/D3)
 *   elided  → the ring's cut marker ("N itens anteriores omitidos", R6)
 *
 * The order of the timeline IS the order of arrival: the Transport is NDJSON,
 * one line per event, so text and cards interleave with no sequence field.
 *
 * This is the SINGLE component the Run's `StreamPanel` (T-012) and the
 * Interview's `ActivityLine` (T-014) both mount — one type, two channels, one
 * React component. That is what keeps the Run and the Interview from diverging.
 *
 * The wire is untrusted: a `StreamItem` with an `item` the union does not know
 * degrades to `raw` rather than breaking the list (D3 — nothing vanishes, and
 * an unmodelled variant still shows up).
 *
 * `streaming` is the phase's liveness, threaded to every `text` item and every
 * opened `thought` so a still-growing block memoizes its completed segments
 * instead of reparsing the whole markdown per chunk — the reducer concatenates
 * same-`messageId` chunks into ONE item precisely so `MarkdownStream` can do
 * this (dropping it restores an O(n²) reparse on long live output). Consumers
 * pass the current segment/phase liveness (the last live segment); an idle
 * timeline omits it (defaults to non-streaming).
 */
import { memo } from "react";
import type { StreamItem } from "loopy/tui/store";
import { MarkdownStream } from "./MarkdownStream";
import { ToolCallCard } from "./ToolCallCard";
import { ThoughtBlock } from "./ThoughtBlock";
import { PlanBlock } from "./PlanBlock";
import { RawUpdateRow } from "./RawUpdateRow";
import "./StreamTimeline.css";

/**
 * Render one timeline item — the exhaustive dispatch, with a raw fallback.
 *
 * Memoized on the `item` reference: the ring reducer shares structure, so an
 * unchanged item keeps its reference across appends and this bails out of
 * re-rendering it (only the item that actually changed — the growing text or the
 * merged tool card — re-runs).
 */
const StreamItemView = memo(function StreamItemView({
  item,
  streaming,
}: {
  readonly item: StreamItem;
  readonly streaming?: boolean;
}) {
  switch (item.item) {
    case "text":
      return <MarkdownStream text={item.text} streaming={streaming} />;
    case "thought":
      return <ThoughtBlock text={item.text} streaming={streaming} />;
    case "tool":
      return <ToolCallCard call={item.call} />;
    case "plan":
      return <PlanBlock entries={item.entries} />;
    case "mode":
      return (
        <div className="stream-timeline__mode t-label">
          Modo alterado para{" "}
          <span className="stream-timeline__mode-id t-data">{item.modeId}</span>
        </div>
      );
    case "raw":
      return <RawUpdateRow kind={item.kind} payload={item.payload} />;
    case "elided":
      return <ElidedMarker count={item.count} />;
    default: {
      return renderUnknownItem(item);
    }
  }
});

function ElidedMarker({ count }: { readonly count: number }) {
  return (
    <div className="stream-timeline__elided t-label">
      {count}{" "}
      {count === 1 ? "item anterior omitido" : "itens anteriores omitidos"}
    </div>
  );
}

function renderUnknownItem(item: StreamItem) {
  // The wire is untrusted: an unmodelled `item` degrades to raw rather than
  // breaking the list (D3). TS narrows `item` to `never` here, so cast back
  // to read the unknown discriminant for the fallback's kind.
  const unknown = item as { readonly item?: unknown };
  return (
    <RawUpdateRow kind={String(unknown.item ?? "unknown")} payload={item} />
  );
}

/**
 * A durable key for each rendered item, so an open `<details>` stays glued to
 * its own item when the ring (stream-history, R6) drops older items and shifts
 * the survivors down. `StreamItem` carries no id (the accumulated list is not
 * ours — the reducer owns it), but the ring guarantees one thing we can lean on:
 * the `elided` marker's `count` is EXACTLY how many items were dropped. So the
 * absolute sequence number of an item = (dropped so far) + (its position among
 * the non-marker items). That number is invariant under a cut — as `count` rises
 * by N, each survivor's position falls by N — which is precisely the stable
 * identity React needs to avoid handing one item's disclosure state to another.
 */
function itemKey(items: readonly StreamItem[], index: number): string {
  if (items[index]?.item === "elided") return "elided";
  const head = items[0];
  const dropped = head?.item === "elided" ? head.count : 0;
  const position = head?.item === "elided" ? index - 1 : index;
  return `i${dropped + position}`;
}

export interface StreamTimelineProps {
  readonly items: readonly StreamItem[];
  /**
   * Whether this timeline is still receiving live data. Forwarded to the `text`
   * and opened-`thought` MarkdownStreams so a growing block memoizes its
   * completed segments instead of reparsing the whole markdown per chunk (avoids
   * the O(n²) live reparse). Omit (or `false`) for an idle/finished timeline.
   */
  readonly streaming?: boolean;
}

export const StreamTimeline = memo(function StreamTimeline({
  items,
  streaming,
}: StreamTimelineProps) {
  return (
    <div className="stream-timeline">
      {items.map((item, i) => (
        <StreamItemView
          key={itemKey(items, i)}
          item={item}
          streaming={streaming}
        />
      ))}
    </div>
  );
});
