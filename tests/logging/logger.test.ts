import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createLogFactory } from "../../src/logging/logger";
import type { LoggingConfig } from "../../src/types";

// A fixed clock so log lines are byte-for-byte assertable.
const FIXED = new Date("2026-07-02T12:00:00.000Z");
const now = (): Date => FIXED;
const TS = "2026-07-02T12:00:00.000Z";

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "loopy-log-"));
});

afterEach(() => {
  // The OS reclaims tmp; nothing to tear down deterministically here.
});

/** A `LoggingConfig` with the field under test overridable. */
function config(overrides: Partial<LoggingConfig> = {}): LoggingConfig {
  return {
    dir: ".loopy/logs",
    per_task: true,
    capture_acp_traffic: false,
    ...overrides,
  };
}

function readLog(taskId: string, dir = ".loopy/logs"): string {
  return readFileSync(join(root, dir, `${taskId}.log`), "utf8");
}

// ---------------------------------------------------------------------------
// Per-task line logging
// ---------------------------------------------------------------------------

describe("createLogFactory · per-task logging", () => {
  it("writes each level to <dir>/<taskId>.log with a timestamp and level tag", () => {
    const factory = createLogFactory({ config: config(), root, now });
    const logger = factory.forTask("T-001");

    logger.info("iteração 1: task T-001");
    logger.debug("step implement ok");
    logger.error("step audit falhou");

    expect(readLog("T-001")).toBe(
      `${TS} INFO iteração 1: task T-001\n` +
        `${TS} DEBUG step implement ok\n` +
        `${TS} ERROR step audit falhou\n`,
    );
  });

  it("exposes the resolved absolute log path", () => {
    const factory = createLogFactory({ config: config(), root, now });
    const logger = factory.forTask("T-007");
    expect(logger.path).toBe(join(root, ".loopy/logs", "T-007.log"));
  });

  it("creates the (nested) log directory on first write", () => {
    const factory = createLogFactory({
      config: config({ dir: ".loopy/deep/logs" }),
      root,
      now,
    });
    expect(existsSync(join(root, ".loopy/deep/logs"))).toBe(false);

    factory.forTask("T-001").info("primeira linha");

    expect(existsSync(join(root, ".loopy/deep/logs", "T-001.log"))).toBe(true);
  });

  it("keeps distinct tasks in separate files (no shared singleton)", () => {
    const factory = createLogFactory({ config: config(), root, now });
    factory.forTask("T-001").info("da T-001");
    factory.forTask("T-002").info("da T-002");

    expect(readLog("T-001")).toBe(`${TS} INFO da T-001\n`);
    expect(readLog("T-002")).toBe(`${TS} INFO da T-002\n`);
  });

  it("appends across calls rather than truncating", () => {
    const logger = createLogFactory({ config: config(), root, now }).forTask(
      "T-001",
    );
    logger.info("linha 1");
    logger.info("linha 2");
    expect(readLog("T-001")).toBe(`${TS} INFO linha 1\n${TS} INFO linha 2\n`);
  });

  it("writes to a single shared file when per_task is false", () => {
    const factory = createLogFactory({
      config: config({ per_task: false }),
      root,
      now,
    });
    factory.forTask("T-001").info("um");
    factory.forTask("T-002").info("dois");

    expect(readFileSync(join(root, ".loopy/logs", "loopy.log"), "utf8")).toBe(
      `${TS} INFO um\n${TS} INFO dois\n`,
    );
  });
});

// ---------------------------------------------------------------------------
// ACP traffic capture
// ---------------------------------------------------------------------------

describe("createLogFactory · ACP traffic capture", () => {
  it("records JSON-RPC traffic when capture_acp_traffic is true", () => {
    const factory = createLogFactory({
      config: config({ capture_acp_traffic: true }),
      root,
      now,
    });
    const logger = factory.forTask("T-001");

    logger.acp({
      direction: "send",
      method: "session/prompt",
      payload: { sessionId: "s1" },
    });
    logger.acp({
      direction: "recv",
      method: "session/update",
      payload: { update: { sessionUpdate: "agent_message_chunk" } },
    });

    expect(readLog("T-001")).toBe(
      `${TS} ACP send session/prompt {"sessionId":"s1"}\n` +
        `${TS} ACP recv session/update {"update":{"sessionUpdate":"agent_message_chunk"}}\n`,
    );
  });

  it("is a no-op when capture is disabled — no ACP line is written", () => {
    const factory = createLogFactory({
      config: config({ capture_acp_traffic: false }),
      root,
      now,
    });
    const logger = factory.forTask("T-001");

    logger.info("uma linha real");
    logger.acp({ direction: "send", method: "session/prompt", payload: {} });

    expect(readLog("T-001")).toBe(`${TS} INFO uma linha real\n`);
  });

  it("captures traffic when --verbose is set even if the config disables it", () => {
    const factory = createLogFactory({
      config: config({ capture_acp_traffic: false }),
      root,
      now,
      verbose: true,
    });
    factory.forTask("T-001").acp({ direction: "send", payload: { a: 1 } });

    expect(readLog("T-001")).toBe(`${TS} ACP send {"a":1}\n`);
  });
});
