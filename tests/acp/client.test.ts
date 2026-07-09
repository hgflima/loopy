/**
 * Unit tests for the ACP client-side handler building blocks (`acp/client.ts`).
 *
 * These are the pure / functional pieces the `ClientApp` wires up (T-011):
 *  - permission decision by `kind` (AC2),
 *  - the turn-scoped text buffer that `session/update` feeds (OQ3),
 *  - `agent_message_chunk` text extraction,
 *  - the filesystem port behind `fs/read_text_file` + `fs/write_text_file`,
 *  - the terminal manager behind the `terminal/*` handlers.
 *
 * They need no subprocess (the terminal tests spawn short `node -e` commands but
 * exercise the manager directly, not the ACP transport). The transport itself is
 * covered end-to-end against the fake agent in `agent.test.ts`.
 */
import { mkdtempSync, realpathSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type {
  CreateTerminalRequest,
  PermissionOption,
  RequestPermissionRequest,
  SessionUpdate,
} from "@agentclientprotocol/sdk";
import {
  ALLOW_KINDS,
  REJECT_KINDS,
  agentChunkText,
  createClientApp,
  createCostBuffer,
  createNodeFileSystem,
  createPermissionResolver,
  createTerminalManager,
  createTurnTextBuffer,
  pickOptionByKind,
  resolvePermissionOutcome,
  usageUpdateCost,
  usageUpdateUsed,
  type TerminalManager,
} from "../../src/acp/client";
import type { AcpTrafficEntry } from "../../src/logging/logger";

// ---------------------------------------------------------------------------
// Permission decision by kind (AC2)
// ---------------------------------------------------------------------------

const OPTIONS: readonly PermissionOption[] = [
  { optionId: "opt-allow-once", name: "Allow", kind: "allow_once" },
  { optionId: "opt-allow-always", name: "Always allow", kind: "allow_always" },
  { optionId: "opt-reject-once", name: "Reject", kind: "reject_once" },
  {
    optionId: "opt-reject-always",
    name: "Always reject",
    kind: "reject_always",
  },
];

function permissionRequest(
  options: readonly PermissionOption[] = OPTIONS,
): RequestPermissionRequest {
  return {
    sessionId: "sess-1",
    toolCall: { toolCallId: "call-1" },
    options: [...options],
  };
}

describe("pickOptionByKind", () => {
  it("returns the first option whose kind matches the preference order", () => {
    expect(pickOptionByKind(OPTIONS, ALLOW_KINDS)?.optionId).toBe(
      "opt-allow-once",
    );
    expect(pickOptionByKind(OPTIONS, REJECT_KINDS)?.optionId).toBe(
      "opt-reject-once",
    );
  });

  it("falls through to the next preferred kind when the first is absent", () => {
    const noOnce = OPTIONS.filter((o) => o.kind !== "allow_once");
    expect(pickOptionByKind(noOnce, ALLOW_KINDS)?.optionId).toBe(
      "opt-allow-always",
    );
  });

  it("returns undefined when no option matches any preferred kind", () => {
    const rejectsOnly = OPTIONS.filter((o) => o.kind.startsWith("reject"));
    expect(pickOptionByKind(rejectsOnly, ALLOW_KINDS)).toBeUndefined();
  });
});

describe("resolvePermissionOutcome", () => {
  it("selects an allow option's id for an allow decision", () => {
    const res = resolvePermissionOutcome(OPTIONS, { action: "allow" });
    expect(res.outcome).toEqual({
      outcome: "selected",
      optionId: "opt-allow-once",
    });
  });

  it("selects a reject option's id for a reject decision", () => {
    const res = resolvePermissionOutcome(OPTIONS, { action: "reject" });
    expect(res.outcome).toEqual({
      outcome: "selected",
      optionId: "opt-reject-once",
    });
  });

  it("returns a cancelled outcome for a cancel decision", () => {
    const res = resolvePermissionOutcome(OPTIONS, { action: "cancel" });
    expect(res.outcome).toEqual({ outcome: "cancelled" });
  });

  it("falls back to the first option when allow has no allow-kind", () => {
    const weird: PermissionOption[] = [
      { optionId: "only", name: "Proceed", kind: "reject_once" },
    ];
    const res = resolvePermissionOutcome(weird, { action: "allow" });
    expect(res.outcome).toEqual({ outcome: "selected", optionId: "only" });
  });

  it("cancels a reject decision when no reject-kind option exists", () => {
    const allowOnly: PermissionOption[] = [
      { optionId: "a", name: "Allow", kind: "allow_once" },
    ];
    const res = resolvePermissionOutcome(allowOnly, { action: "reject" });
    expect(res.outcome).toEqual({ outcome: "cancelled" });
  });
});

describe("createPermissionResolver", () => {
  it("allows by default under on_request=allow", async () => {
    const resolver = createPermissionResolver("allow");
    expect((await resolver(permissionRequest())).action).toBe("allow");
  });

  it("allows under on_request=policy until deny-patterns land (placeholder)", async () => {
    const resolver = createPermissionResolver("policy");
    expect((await resolver(permissionRequest())).action).toBe("allow");
  });
});

// ---------------------------------------------------------------------------
// Turn text buffer (OQ3)
// ---------------------------------------------------------------------------

describe("createTurnTextBuffer", () => {
  it("accumulates appended text per session and concatenates on read", () => {
    const buf = createTurnTextBuffer();
    buf.append("s1", "hello ");
    buf.append("s1", "world");
    expect(buf.read("s1")).toBe("hello world");
  });

  it("keeps sessions independent", () => {
    const buf = createTurnTextBuffer();
    buf.append("s1", "one");
    buf.append("s2", "two");
    expect(buf.read("s1")).toBe("one");
    expect(buf.read("s2")).toBe("two");
  });

  it("reset clears a session's text (turn boundary before a prompt)", () => {
    const buf = createTurnTextBuffer();
    buf.append("s1", "stale");
    buf.reset("s1");
    expect(buf.read("s1")).toBe("");
    buf.append("s1", "fresh");
    expect(buf.read("s1")).toBe("fresh");
  });

  it("reads an unseen session as the empty string", () => {
    expect(createTurnTextBuffer().read("never")).toBe("");
  });
});

// ---------------------------------------------------------------------------
// agentChunkText — extract text from an agent_message_chunk update
// ---------------------------------------------------------------------------

describe("agentChunkText", () => {
  it("extracts text from an agent_message_chunk with text content", () => {
    const update: SessionUpdate = {
      sessionUpdate: "agent_message_chunk",
      content: { type: "text", text: "chunk" },
    };
    expect(agentChunkText(update)).toBe("chunk");
  });

  it("ignores non-agent updates", () => {
    const update: SessionUpdate = {
      sessionUpdate: "user_message_chunk",
      content: { type: "text", text: "user" },
    };
    expect(agentChunkText(update)).toBeUndefined();
  });

  it("ignores agent chunks whose content is not text", () => {
    const update: SessionUpdate = {
      sessionUpdate: "agent_message_chunk",
      content: {
        type: "image",
        data: "AAAA",
        mimeType: "image/png",
      },
    };
    expect(agentChunkText(update)).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// usageUpdateCost — extract cost from a usage_update (C-0005)
// ---------------------------------------------------------------------------

describe("usageUpdateCost", () => {
  it("extracts cost from a usage_update with cost present", () => {
    const update: SessionUpdate = {
      sessionUpdate: "usage_update",
      used: 1000,
      size: 200000,
      cost: { amount: 0.42, currency: "USD" },
    };
    expect(usageUpdateCost(update)).toEqual({ amount: 0.42, currency: "USD" });
  });

  it("returns undefined for a usage_update without cost", () => {
    const update: SessionUpdate = {
      sessionUpdate: "usage_update",
      used: 1000,
      size: 200000,
    };
    expect(usageUpdateCost(update)).toBeUndefined();
  });

  it("returns undefined for non-usage_update updates", () => {
    const update: SessionUpdate = {
      sessionUpdate: "agent_message_chunk",
      content: { type: "text", text: "hi" },
    };
    expect(usageUpdateCost(update)).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// usageUpdateUsed — extract used/size from a usage_update (T-007)
// ---------------------------------------------------------------------------

describe("usageUpdateUsed", () => {
  it("extracts used and size from a usage_update with both present", () => {
    const update: SessionUpdate = {
      sessionUpdate: "usage_update",
      used: 50000,
      size: 200000,
    };
    expect(usageUpdateUsed(update)).toEqual({ used: 50000, size: 200000 });
  });

  it("returns undefined when used/size are non-numeric (defensive)", () => {
    // Force non-numeric values to test runtime guard (adapters may deviate).
    const update = {
      sessionUpdate: "usage_update",
      used: "not-a-number",
      size: null,
    } as unknown as SessionUpdate;
    expect(usageUpdateUsed(update)).toBeUndefined();
  });

  it("returns undefined for non-usage_update updates", () => {
    const update: SessionUpdate = {
      sessionUpdate: "agent_message_chunk",
      content: { type: "text", text: "hi" },
    };
    expect(usageUpdateUsed(update)).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Per-session cost buffer (C-0005)
// ---------------------------------------------------------------------------

describe("createCostBuffer", () => {
  it("returns null for an unseen session", () => {
    const buf = createCostBuffer();
    expect(buf.read("never")).toBeNull();
  });

  it("stores and reads the last cost snapshot per session", () => {
    const buf = createCostBuffer();
    buf.set("s1", 0.10, "USD");
    buf.set("s1", 0.25, "USD");
    expect(buf.read("s1")).toEqual({ amount: 0.25, currency: "USD" });
  });

  it("keeps sessions independent", () => {
    const buf = createCostBuffer();
    buf.set("s1", 0.10, "USD");
    buf.set("s2", 0.50, "EUR");
    expect(buf.read("s1")).toEqual({ amount: 0.10, currency: "USD" });
    expect(buf.read("s2")).toEqual({ amount: 0.50, currency: "EUR" });
  });
});

// ---------------------------------------------------------------------------
// Filesystem port (fs/read_text_file + fs/write_text_file)
// ---------------------------------------------------------------------------

describe("createNodeFileSystem", () => {
  let dir: string;
  afterEach(() => {
    // temp dirs are cleaned by the OS; nothing to hold across tests.
  });

  it("writes then reads a file round-trip", async () => {
    dir = realpathSync(mkdtempSync(join(tmpdir(), "loopy-fs-")));
    const fs = createNodeFileSystem();
    const path = join(dir, "note.txt");
    await fs.writeTextFile(path, "content\nhere");
    expect(await fs.readTextFile(path, {})).toBe("content\nhere");
    // The bytes on disk match exactly.
    expect(await readFile(path, "utf8")).toBe("content\nhere");
  });

  it("reads a 1-based line window when line/limit are given", async () => {
    dir = realpathSync(mkdtempSync(join(tmpdir(), "loopy-fs-")));
    const fs = createNodeFileSystem();
    const path = join(dir, "lines.txt");
    await fs.writeTextFile(path, "l1\nl2\nl3\nl4\nl5");
    // line 2, limit 2 => lines 2 and 3.
    expect(await fs.readTextFile(path, { line: 2, limit: 2 })).toBe("l2\nl3");
  });

  it("reads from a start line to the end when only line is given", async () => {
    dir = realpathSync(mkdtempSync(join(tmpdir(), "loopy-fs-")));
    const fs = createNodeFileSystem();
    const path = join(dir, "lines.txt");
    await fs.writeTextFile(path, "a\nb\nc");
    expect(await fs.readTextFile(path, { line: 2 })).toBe("b\nc");
  });
});

// ---------------------------------------------------------------------------
// Terminal manager (terminal/* handlers)
// ---------------------------------------------------------------------------

function createReq(
  overrides: Partial<CreateTerminalRequest> &
    Pick<CreateTerminalRequest, "command">,
): CreateTerminalRequest {
  return { sessionId: "sess-1", ...overrides };
}

describe("createTerminalManager", () => {
  let manager: TerminalManager;
  afterEach(() => {
    manager?.disposeAll();
  });

  it("runs a command and captures its stdout after exit", async () => {
    manager = createTerminalManager();
    const { terminalId } = manager.create(
      createReq({
        command: process.execPath,
        args: ["-e", "process.stdout.write('captured')"],
      }),
    );
    const exit = await manager.waitForExit({
      sessionId: "sess-1",
      terminalId,
    });
    expect(exit.exitCode).toBe(0);
    const out = manager.output({ sessionId: "sess-1", terminalId });
    expect(out.output).toContain("captured");
    expect(out.exitStatus?.exitCode).toBe(0);
  });

  it("reports a non-zero exit code", async () => {
    manager = createTerminalManager();
    const { terminalId } = manager.create(
      createReq({
        command: process.execPath,
        args: ["-e", "process.exit(3)"],
      }),
    );
    const exit = await manager.waitForExit({ sessionId: "sess-1", terminalId });
    expect(exit.exitCode).toBe(3);
  });

  it("captures stderr in the combined output", async () => {
    manager = createTerminalManager();
    const { terminalId } = manager.create(
      createReq({
        command: process.execPath,
        args: ["-e", "process.stderr.write('to-stderr')"],
      }),
    );
    await manager.waitForExit({ sessionId: "sess-1", terminalId });
    expect(
      manager.output({ sessionId: "sess-1", terminalId }).output,
    ).toContain("to-stderr");
  });

  it("truncates output beyond outputByteLimit and flags it", async () => {
    manager = createTerminalManager();
    const { terminalId } = manager.create(
      createReq({
        command: process.execPath,
        args: ["-e", "process.stdout.write('X'.repeat(1000))"],
        outputByteLimit: 100,
      }),
    );
    await manager.waitForExit({ sessionId: "sess-1", terminalId });
    const out = manager.output({ sessionId: "sess-1", terminalId });
    expect(Buffer.byteLength(out.output, "utf8")).toBeLessThanOrEqual(100);
    expect(out.truncated).toBe(true);
  });

  it("kills a long-running command", async () => {
    manager = createTerminalManager();
    const { terminalId } = manager.create(
      createReq({
        command: process.execPath,
        args: ["-e", "setTimeout(() => {}, 100000)"],
      }),
    );
    manager.kill({ sessionId: "sess-1", terminalId });
    const exit = await manager.waitForExit({ sessionId: "sess-1", terminalId });
    // Killed by signal => non-zero/undefined exit code, a signal is reported.
    expect(exit.exitCode == null || exit.exitCode !== 0).toBe(true);
  });

  it("throws for an unknown terminal id", () => {
    manager = createTerminalManager();
    expect(() =>
      manager.output({ sessionId: "sess-1", terminalId: "nope" }),
    ).toThrow();
  });
});

// ---------------------------------------------------------------------------
// onTraffic recv — createClientApp captures agent→engine traffic (T-007)
// ---------------------------------------------------------------------------

describe("createClientApp · onTraffic recv", () => {
  it("builds a ClientApp with onTraffic wired (integration in agent.test.ts)", () => {
    const traffic: Array<{ entry: AcpTrafficEntry; sessionId: string }> = [];
    const { app } = createClientApp({
      onTraffic: (entry, sessionId) => traffic.push({ entry, sessionId }),
    });
    // The full recv path is exercised end-to-end in agent.test.ts against the
    // fake agent; here we just verify the bundle builds without error.
    expect(app).toBeDefined();
  });

  it("does not alter behavior when onTraffic is absent", () => {
    const { app, textBuffer } = createClientApp({});
    expect(app).toBeDefined();
    expect(textBuffer).toBeDefined();
  });
});
