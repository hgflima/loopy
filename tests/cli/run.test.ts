/**
 * The Run's `onUpdate` dispatch (C-0019 / T-003) — `dispatchStreamUpdate`, the
 * "stamp and dispatch" the Run's `onUpdate` applies to every ACP `session/update`.
 *
 * The translation (`translateUpdate`, T-002) and the StoreEvent shaping
 * (`toStoreEvent`, T-001) are pure and tested in their own suites. What lives
 * here is the **wiring**: taskId/agent come from the sessionId map (`infoFor`),
 * stepId from `taskCurrentStep`, and `translateUpdate` returning `undefined`
 * (only `usage_update` does) means nothing is dispatched — that update keeps its
 * own parallel `usage_sample` path in the closure. Factored out of the closure so
 * the stamping is provable without spawning an agent (AD-6).
 */
import { describe, expect, it } from "vitest";
import type {
  SessionNotification,
  SessionUpdate,
} from "@agentclientprotocol/sdk";
import { dispatchStreamUpdate } from "../../src/index";
import type { StoreEvent } from "../../src/tui/store";

/** A capturing dispatch, mirroring `ui.dispatch`. */
function recorder(): {
  readonly dispatch: (event: StoreEvent) => void;
  readonly events: StoreEvent[];
} {
  const events: StoreEvent[] = [];
  return { dispatch: (event) => events.push(event), events };
}

/** Wrap a `SessionUpdate` into the notification the boundary hands `onUpdate`. */
function notify(sessionId: string, update: SessionUpdate): SessionNotification {
  return { sessionId, update };
}

/** A sessionId→{taskId,agent} resolver, like the Run's `infoFor`. */
const infoFor = () => ({
  taskId: "T-001",
  agent: "claude" as string | undefined,
});

const TOOL_CALL: SessionUpdate = {
  sessionUpdate: "tool_call",
  toolCallId: "tc-1",
  title: "Edit file",
  content: [],
};

describe("dispatchStreamUpdate — the Run's onUpdate stamping (T-003)", () => {
  it("turns a tool_call into a `tool_call` StoreEvent with taskId, stepId and agent", () => {
    const rec = recorder();
    const steps = new Map<string, string>([["T-001", "implement"]]);

    dispatchStreamUpdate(
      notify("s1", TOOL_CALL),
      infoFor,
      steps,
      "fallback",
      rec.dispatch,
    );

    expect(rec.events).toHaveLength(1);
    expect(rec.events[0]).toMatchObject({
      type: "tool_call",
      taskId: "T-001",
      stepId: "implement",
      agent: "claude",
      call: { toolCallId: "tc-1", title: "Edit file" },
    });
  });

  it("omits stepId (no empty string) when the task has no current Step — D-0005 precedent", () => {
    const rec = recorder();
    const steps = new Map<string, string>(); // task between two Steps

    dispatchStreamUpdate(
      notify("s1", TOOL_CALL),
      infoFor,
      steps,
      "fallback",
      rec.dispatch,
    );

    const event = rec.events[0]!;
    expect(event.type).toBe("tool_call");
    expect("stepId" in event).toBe(false);
  });

  it("dispatches NOTHING for usage_update — it keeps its own parallel usage_sample path", () => {
    const rec = recorder();
    const steps = new Map<string, string>([["T-001", "implement"]]);
    const usage: SessionUpdate = {
      sessionUpdate: "usage_update",
      used: 1000,
      size: 200000,
    };

    dispatchStreamUpdate(
      notify("s1", usage),
      infoFor,
      steps,
      "fallback",
      rec.dispatch,
    );

    expect(rec.events).toHaveLength(0);
  });

  it("keeps emitting stream_chunk for text, now stamped with stepId and messageId", () => {
    const rec = recorder();
    const steps = new Map<string, string>([["T-001", "implement"]]);
    const chunk: SessionUpdate = {
      sessionUpdate: "agent_message_chunk",
      content: { type: "text", text: "hi" },
      messageId: "m1",
    };

    dispatchStreamUpdate(
      notify("s1", chunk),
      infoFor,
      steps,
      "fallback",
      rec.dispatch,
    );

    expect(rec.events[0]).toMatchObject({
      type: "stream_chunk",
      taskId: "T-001",
      stepId: "implement",
      agent: "claude",
      text: "hi",
      messageId: "m1",
    });
  });

  it("falls back to the process's agentName when the sessionId is not yet mapped", () => {
    const rec = recorder();
    const steps = new Map<string, string>([["T-001", "implement"]]);
    const infoNoAgent = () => ({
      taskId: "T-001",
      agent: undefined as string | undefined,
    });

    dispatchStreamUpdate(
      notify("s1", TOOL_CALL),
      infoNoAgent,
      steps,
      "codex",
      rec.dispatch,
    );

    expect(rec.events[0]).toMatchObject({ agent: "codex" });
  });

  it("routes an update the UI does not model to the `agent_update` catch-all, never throwing", () => {
    const rec = recorder();
    const steps = new Map<string, string>();
    const unmodeled: SessionUpdate = {
      sessionUpdate: "session_info_update",
    } as unknown as SessionUpdate;

    expect(() =>
      dispatchStreamUpdate(
        notify("s1", unmodeled),
        infoFor,
        steps,
        "fallback",
        rec.dispatch,
      ),
    ).not.toThrow();
    expect(rec.events[0]).toMatchObject({
      type: "agent_update",
      taskId: "T-001",
      updateKind: "session_info_update",
    });
  });
});
