/**
 * Tests for StreamPanel — streamColumns (T-009: transcript-based),
 * visiblePanes (T-008: max 4 + overflow), and the rendered panel (T-012:
 * StreamTimeline over the items, not a flattened string).
 *
 * Covers:
 * - streamColumns: pure projection of running tasks + transcript → StreamColumn[]
 * - visiblePanes: max 4 columns with overflow count
 * - render: cards + prose interleaved via StreamTimeline; the StepDivider still
 *   separates segments; the ring's cut marker survives; the "no task running"
 *   placeholder survives; auto-stick still glues to the bottom when anchored.
 *
 * Run: `npm test -w apps/menubar -- StreamPanel`
 */

import { describe, it, expect, afterEach } from "vitest";
import { render, cleanup, fireEvent } from "@testing-library/react";
import type { StoreState, TaskState } from "loopy/tui/store";
import type { StreamItem } from "loopy/tui/store";
import type { Transcript } from "../state/stream-history";
import { StreamPanel, streamColumns, visiblePanes } from "./StreamPanel";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTask(
  id: string,
  status: TaskState["status"],
  title = `Task ${id}`,
): TaskState {
  return {
    id,
    title,
    status,
    steps: [],
    stream: "",
    currentStepId: status === "running" ? "impl" : undefined,
  };
}

function makeStore(tasks: TaskState[]): StoreState {
  return {
    tasks,
    edges: [],
    acpLog: [],
    activeAgents: new Set(),
    pipeline: [],
    warnings: [],
  };
}

// ---------------------------------------------------------------------------
// streamColumns (T-009 — transcript-based)
// ---------------------------------------------------------------------------

describe("streamColumns", () => {
  it("returns empty array when no running tasks", () => {
    const store = makeStore([makeTask("T-001", "done")]);
    expect(streamColumns(store, {})).toEqual([]);
  });

  it("returns one column per running task with segments from transcript", () => {
    const store = makeStore([
      makeTask("T-001", "running"),
      makeTask("T-002", "done"),
      makeTask("T-003", "running"),
    ]);
    const transcript: Transcript = {
      "T-001": [
        { stepId: "impl", item: { item: "text", text: "hello " } },
        { stepId: "impl", item: { item: "text", text: "world" } },
      ],
      "T-003": [
        { stepId: "audit", item: { item: "text", text: "checking..." } },
      ],
    };
    const cols = streamColumns(store, transcript);
    expect(cols).toHaveLength(2);
    expect(cols[0]!.taskId).toBe("T-001");
    expect(cols[0]!.segments).toEqual([
      {
        stepId: "impl",
        label: "impl",
        items: [
          { item: "text", text: "hello " },
          { item: "text", text: "world" },
        ],
      },
    ]);
    expect(cols[1]!.taskId).toBe("T-003");
    expect(cols[1]!.segments).toEqual([
      {
        stepId: "audit",
        label: "audit",
        items: [{ item: "text", text: "checking..." }],
      },
    ]);
  });

  it("returns empty segments when task has no transcript entries", () => {
    const store = makeStore([makeTask("T-001", "running")]);
    const cols = streamColumns(store, {});
    expect(cols).toHaveLength(1);
    expect(cols[0]!.segments).toEqual([]);
  });

  it("produces multiple segments for cross-step transcript", () => {
    const store = makeStore([makeTask("T-001", "running")]);
    const transcript: Transcript = {
      "T-001": [
        { stepId: "impl", item: { item: "text", text: "code..." } },
        { stepId: "simplify", item: { item: "text", text: "simplifying..." } },
        { stepId: "audit", item: { item: "text", text: "AUDIT: PASS" } },
      ],
    };
    const cols = streamColumns(store, transcript);
    expect(cols[0]!.segments).toHaveLength(3);
    expect(cols[0]!.segments[0]!.stepId).toBe("impl");
    expect(cols[0]!.segments[1]!.stepId).toBe("simplify");
    expect(cols[0]!.segments[2]!.stepId).toBe("audit");
  });
});

// ---------------------------------------------------------------------------
// visiblePanes
// ---------------------------------------------------------------------------

describe("visiblePanes", () => {
  it("returns all columns when ≤4", () => {
    const cols = [
      { taskId: "T-001", title: "A", segments: [] },
      { taskId: "T-002", title: "B", segments: [] },
    ];
    const result = visiblePanes(cols);
    expect(result.visible).toHaveLength(2);
    expect(result.overflow).toBe(0);
  });

  it("returns exactly 4 when exactly 4 columns", () => {
    const cols = Array.from({ length: 4 }, (_, i) => ({
      taskId: `T-00${i + 1}`,
      title: `Task ${i + 1}`,
      segments: [],
    }));
    const result = visiblePanes(cols);
    expect(result.visible).toHaveLength(4);
    expect(result.overflow).toBe(0);
  });

  it("caps at 4 and reports overflow when >4", () => {
    const cols = Array.from({ length: 7 }, (_, i) => ({
      taskId: `T-00${i + 1}`,
      title: `Task ${i + 1}`,
      segments: [],
    }));
    const result = visiblePanes(cols);
    expect(result.visible).toHaveLength(4);
    expect(result.overflow).toBe(3);
  });

  it("returns empty visible and 0 overflow for empty input", () => {
    const result = visiblePanes([]);
    expect(result.visible).toHaveLength(0);
    expect(result.overflow).toBe(0);
  });

  it("single column fills the space (overflow 0)", () => {
    const cols = [{ taskId: "T-001", title: "Solo", segments: [] }];
    const result = visiblePanes(cols);
    expect(result.visible).toHaveLength(1);
    expect(result.overflow).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// StreamPanel — rendered (T-012: timeline of items, not a flattened string)
// ---------------------------------------------------------------------------

/** A `tool` timeline item — the thing `segmentText` used to drop on the floor. */
function toolItem(
  toolCallId: string,
  title: string,
  kind = "read",
): StreamItem {
  return {
    item: "tool",
    call: {
      toolCallId,
      title,
      kind: kind as never,
      status: "in_progress",
      locations: [],
      content: [],
    },
  };
}

/**
 * Install a controllable layout on the scroll container so the auto-stick
 * effect is testable in jsdom (which reports 0 for every layout metric and
 * keeps `scrollTop` pinned at 0). Returns a live getter for the current
 * `scrollTop` the effect wrote.
 */
function mockScroll(
  el: HTMLElement,
  scrollHeight: number,
  clientHeight: number,
): { get scrollTop(): number; set scrollTop(v: number) } {
  let top = 0;
  Object.defineProperty(el, "scrollTop", {
    get: () => top,
    set: (v: number) => {
      top = v;
    },
    configurable: true,
  });
  Object.defineProperty(el, "scrollHeight", {
    value: scrollHeight,
    configurable: true,
  });
  Object.defineProperty(el, "clientHeight", {
    value: clientHeight,
    configurable: true,
  });
  return {
    get scrollTop() {
      return top;
    },
    set scrollTop(v: number) {
      top = v;
    },
  };
}

describe("StreamPanel — rendered", () => {
  afterEach(cleanup);

  it("renders cards and prose interleaved in arrival order (not a flattened string)", () => {
    const store = makeStore([makeTask("T-001", "running")]);
    const transcript: Transcript = {
      "T-001": [
        { stepId: "impl", item: { item: "text", text: "reading the file" } },
        { stepId: "impl", item: toolItem("tc-1", "Ler arquivo") },
        { stepId: "impl", item: { item: "text", text: "done reading" } },
      ],
    };
    const { container } = render(
      <StreamPanel store={store} transcript={transcript} />,
    );

    // The timeline dispatcher is mounted (not a bare MarkdownStream)...
    expect(container.querySelector(".stream-timeline")).not.toBeNull();
    // ...the tool call — which `segmentText` used to drop — is now a card...
    expect(container.querySelector(".tool-card")).not.toBeNull();
    // ...and the prose still renders around it.
    expect(container.textContent).toContain("reading the file");
    expect(container.textContent).toContain("done reading");

    // Arrival order preserved: prose, then card, then prose.
    const text = container.textContent ?? "";
    const idxRead = text.indexOf("reading the file");
    const idxTool = text.indexOf("Ler arquivo");
    const idxDone = text.indexOf("done reading");
    expect(idxRead).toBeGreaterThanOrEqual(0);
    expect(idxRead).toBeLessThan(idxTool);
    expect(idxTool).toBeLessThan(idxDone);
  });

  it("keeps the labeled StepDivider between cross-step segments", () => {
    const store = makeStore([makeTask("T-001", "running")]);
    const transcript: Transcript = {
      "T-001": [
        { stepId: "impl", item: { item: "text", text: "code..." } },
        { stepId: "audit", item: { item: "text", text: "AUDIT: PASS" } },
      ],
    };
    const { container } = render(
      <StreamPanel store={store} transcript={transcript} />,
    );
    // First segment has no divider; the second one (audit) does.
    const dividers = container.querySelectorAll(".step-divider");
    expect(dividers).toHaveLength(1);
    expect(dividers[0]?.textContent).toContain("audit");
  });

  it("shows the ring's cut marker when the timeline carries an `elided` item (R6)", () => {
    const store = makeStore([makeTask("T-001", "running")]);
    const transcript: Transcript = {
      "T-001": [
        { stepId: "impl", item: { item: "elided", count: 42 } },
        { stepId: "impl", item: { item: "text", text: "surviving tail" } },
      ],
    };
    const { container } = render(
      <StreamPanel store={store} transcript={transcript} />,
    );
    const marker = container.querySelector(".stream-timeline__elided");
    expect(marker?.textContent).toBe("42 itens anteriores omitidos");
  });

  it("keeps the 'no task running' placeholder when nothing is running", () => {
    const store = makeStore([makeTask("T-001", "done")]);
    const { container } = render(<StreamPanel store={store} transcript={{}} />);
    expect(
      container.querySelector(".stream-panel__placeholder"),
    ).not.toBeNull();
    expect(container.querySelector(".stream-timeline")).toBeNull();
  });

  it("auto-sticks to the bottom when new content arrives and the user is anchored", () => {
    const store = makeStore([makeTask("T-001", "running")]);
    const first: Transcript = {
      "T-001": [{ stepId: "impl", item: { item: "text", text: "line 1" } }],
    };
    const { container, rerender } = render(
      <StreamPanel store={store} transcript={first} />,
    );
    const el = container.querySelector(".stream-panel__scroll") as HTMLElement;
    const scroll = mockScroll(el, 1000, 200);

    // New chunk arrives while anchored at the bottom (the default): the effect
    // glues scrollTop to scrollHeight.
    const grown: Transcript = {
      "T-001": [
        { stepId: "impl", item: { item: "text", text: "line 1" } },
        { stepId: "impl", item: { item: "text", text: "line 2" } },
      ],
    };
    rerender(<StreamPanel store={store} transcript={grown} />);
    expect(scroll.scrollTop).toBe(1000);
  });

  it("does NOT auto-stick after the user scrolls up (no longer anchored)", () => {
    const store = makeStore([makeTask("T-001", "running")]);
    const first: Transcript = {
      "T-001": [{ stepId: "impl", item: { item: "text", text: "line 1" } }],
    };
    const { container, rerender } = render(
      <StreamPanel store={store} transcript={first} />,
    );
    const el = container.querySelector(".stream-panel__scroll") as HTMLElement;
    const scroll = mockScroll(el, 1000, 200);

    // User scrolls far from the bottom: 1000 - 100 - 200 = 700 ≥ threshold.
    scroll.scrollTop = 100;
    fireEvent.scroll(el);

    const grown: Transcript = {
      "T-001": [
        { stepId: "impl", item: { item: "text", text: "line 1" } },
        { stepId: "impl", item: { item: "text", text: "line 2" } },
      ],
    };
    rerender(<StreamPanel store={store} transcript={grown} />);
    // Unchanged — the effect must respect the user's position.
    expect(scroll.scrollTop).toBe(100);
  });
});
