/**
 * Integration test for the ACP process + client handlers (T-011) against the
 * scenario-driven fake agent (OQ5). This is a *medium* test: it spawns a real
 * subprocess and drives the real JSON-RPC ndjson transport, exercising
 * spawn → initialize → session → permission → update → stop end-to-end, but
 * against the deterministic fake agent rather than the real Claude agent.
 *
 * It uses the raw SDK `ctx.buildSession(...)` to drive a prompt turn — the
 * `acp/session.ts` wrapper is a separate task (T-012); here we only prove the
 * process/handshake/handlers work.
 */
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import type { SessionNotification } from "@agentclientprotocol/sdk";
import { openAgent, type AgentHandle } from "../../src/acp/agent";
import type { FakeScenario } from "../fixtures/fake-agent";

const FAKE_AGENT = fileURLToPath(
  new URL("../fixtures/fake-agent.ts", import.meta.url),
);
const PROJECT_ROOT = fileURLToPath(new URL("../../", import.meta.url));

/** Spawn command that runs the fake agent under tsx with a JSON scenario. */
function fakeCommand(scenario: FakeScenario): string[] {
  return [
    process.execPath,
    "--import",
    "tsx",
    FAKE_AGENT,
    JSON.stringify(scenario),
  ];
}

let handle: AgentHandle | undefined;

afterEach(async () => {
  if (handle) {
    await handle.shutdown();
    handle = undefined;
  }
});

describe("openAgent (against the fake agent)", () => {
  it("spawns one process, initializes, and reports agentInfo (AC1)", async () => {
    const scenario: FakeScenario = {
      agentInfo: { name: "fake-agent", version: "1.2.3" },
    };
    handle = await openAgent({
      command: fakeCommand(scenario),
      cwd: PROJECT_ROOT,
      permissions: { on_request: "allow" },
    });

    expect(handle.agentInfo?.name).toBe("fake-agent");
    expect(handle.agentInfo?.version).toBe("1.2.3");
    expect(handle.protocolVersion).toBe(1);
  });

  it("streams session/update to onUpdate AND feeds the turn buffer (AC3/OQ3)", async () => {
    const scenario: FakeScenario = {
      defaultTurn: {
        text: ["Hello ", "from the agent."],
        stopReason: "end_turn",
      },
    };
    const updates: SessionNotification[] = [];
    handle = await openAgent({
      command: fakeCommand(scenario),
      cwd: PROJECT_ROOT,
      permissions: { on_request: "allow" },
      onUpdate: (notification) => updates.push(notification),
    });

    const session = await handle.ctx.buildSession(PROJECT_ROOT).start();
    const response = await session.prompt("implement");
    expect(response.stopReason).toBe("end_turn");

    // session/update delivery is async relative to the prompt response (the SDK
    // dispatches notifications fire-and-forget), so the turn buffer (OQ3) is
    // *eventually* consistent with the stream — poll until it has drained.
    await expect
      .poll(() => handle?.text.read(session.sessionId))
      .toBe("Hello from the agent.");
    // ...and every update was forwarded to onUpdate (stream to TUI/logs).
    expect(
      updates.some((n) => n.update.sessionUpdate === "agent_message_chunk"),
    ).toBe(true);

    session.dispose();
  });

  it("answers request_permission by kind — allow picks allow_once (AC2)", async () => {
    const scenario: FakeScenario = {
      defaultTurn: {
        permission: {
          options: [
            { optionId: "opt-allow-once", name: "Allow", kind: "allow_once" },
            {
              optionId: "opt-allow-always",
              name: "Always",
              kind: "allow_always",
            },
            {
              optionId: "opt-reject-once",
              name: "Reject",
              kind: "reject_once",
            },
          ],
        },
        stopReason: "end_turn",
      },
    };
    handle = await openAgent({
      command: fakeCommand(scenario),
      cwd: PROJECT_ROOT,
      permissions: { on_request: "allow" },
    });

    const session = await handle.ctx.buildSession(PROJECT_ROOT).start();
    await session.prompt("do something risky");
    // The fake agent echoes back whichever optionId the client selected.
    await expect
      .poll(() => handle?.text.read(session.sessionId))
      .toContain("permission=opt-allow-once");
    session.dispose();
  });

  it("honors a custom resolver — reject picks reject_once (AC2)", async () => {
    const scenario: FakeScenario = {
      defaultTurn: {
        permission: {
          options: [
            { optionId: "opt-allow-once", name: "Allow", kind: "allow_once" },
            {
              optionId: "opt-reject-once",
              name: "Reject",
              kind: "reject_once",
            },
          ],
        },
        stopReason: "end_turn",
      },
    };
    handle = await openAgent({
      command: fakeCommand(scenario),
      cwd: PROJECT_ROOT,
      permissions: { on_request: "allow" },
      permissionResolver: () => ({ action: "reject" }),
    });

    const session = await handle.ctx.buildSession(PROJECT_ROOT).start();
    await session.prompt("do something risky");
    await expect
      .poll(() => handle?.text.read(session.sessionId))
      .toContain("permission=opt-reject-once");
    session.dispose();
  });

  it("surfaces a configurable non-end_turn stop reason", async () => {
    const scenario: FakeScenario = {
      defaultTurn: { text: ["nope"], stopReason: "refusal" },
    };
    handle = await openAgent({
      command: fakeCommand(scenario),
      cwd: PROJECT_ROOT,
      permissions: { on_request: "allow" },
    });

    const session = await handle.ctx.buildSession(PROJECT_ROOT).start();
    const response = await session.prompt("go");
    expect(response.stopReason).toBe("refusal");
    session.dispose();
  });

  it("shutdown terminates the process and resolves closed (AC1)", async () => {
    handle = await openAgent({
      command: fakeCommand({}),
      cwd: PROJECT_ROOT,
      permissions: { on_request: "allow" },
    });
    await handle.shutdown();
    await expect(handle.closed).resolves.toBeUndefined();
    handle = undefined; // already shut down; skip afterEach double-shutdown.
  });
});
