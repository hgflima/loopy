/**
 * ACP subprocess + connection lifecycle — the engine's link to an agent.
 *
 * Per AD-3 (evolved by ADR-0006), `loopy` spawns **one process per Agent
 * referenced** by the pipeline (the `npx` cold start is paid once per agent
 * type) and each process hosts N sessions over its lifetime (one per
 * agent+worktree pair). This module owns a single process and the JSON-RPC
 * connection on top of it: it wires the child's stdio into an ndjson
 * {@link ndJsonStream}, builds the {@link ClientApp} with all handlers
 * registered *before* connecting (`acp/client.ts`), performs the `initialize`
 * handshake, and exposes a long-lived {@link ClientContext} (`ctx`) that the
 * session layer uses to `buildSession(cwd)`.
 *
 * Keeping the connection open with `connectWith`: the SDK closes a `connectWith`
 * connection as soon as its callback settles. Since our connection must outlive
 * many session operations, the callback resolves the handshake and then *awaits
 * a gate* that only opens on {@link AgentHandle.shutdown} — so the single
 * connection (and process) stays up until we tear it down deliberately.
 *
 * Boundaries: stdout is the transport (JSON-RPC ndjson) and is never written to
 * for anything else; the child's stderr is forwarded to logs. This is pure ACP
 * plumbing — no loop behavior lives here (AD-1).
 */
import { spawn } from "node:child_process";
import { Readable, Writable } from "node:stream";
import {
  AGENT_METHODS,
  PROTOCOL_VERSION,
  ndJsonStream,
} from "@agentclientprotocol/sdk";
import type {
  ClientCapabilities,
  ClientContext,
  Implementation,
  InitializeRequest,
  InitializeResponse,
  SessionNotification,
} from "@agentclientprotocol/sdk";
import type { AcpTrafficEntry } from "../logging/logger";
import type { LoggerPort, PermissionOnRequest } from "../types";
import {
  createClientApp,
  type CostBuffer,
  type FileSystemPort,
  type PermissionResolver,
  type TerminalManager,
  type TurnTextBuffer,
} from "./client";

/** Default ACP agent command (the `loopy.yml` `acp.command`). */
export const DEFAULT_ACP_COMMAND: readonly string[] = [
  "npx",
  "-y",
  "@agentclientprotocol/claude-agent-acp",
];

/** Capabilities advertised in `initialize` (SPEC wrapper snippet). */
export const DEFAULT_CLIENT_CAPABILITIES: ClientCapabilities = {
  fs: { readTextFile: true, writeTextFile: true },
  terminal: true,
};

/** Options for {@link openAgent}. */
export interface OpenAgentOptions {
  /** Argv of the ACP agent process (default {@link DEFAULT_ACP_COMMAND}). */
  readonly command?: readonly string[];
  /** Working directory for the spawned process. */
  readonly cwd?: string;
  /** Environment for the process (defaults to `process.env`). */
  readonly env?: NodeJS.ProcessEnv;
  /** Client identity sent in `initialize` (and used as the JSON-RPC name). */
  readonly clientInfo?: { readonly name: string; readonly version: string };
  /** Capability override; defaults to {@link DEFAULT_CLIENT_CAPABILITIES}. */
  readonly capabilities?: ClientCapabilities;
  /** How `session/request_permission` is answered (`on_request`). */
  readonly permissions: { readonly on_request: PermissionOnRequest };
  /** Override the permission resolver (tests / future policy transports). */
  readonly permissionResolver?: PermissionResolver;
  /** Called for every `session/update` (stream to TUI/logs). */
  readonly onUpdate?: (notification: SessionNotification) => void;
  /** Called for every ACP JSON-RPC message (send/recv); pure observation (AD-1). */
  readonly onTraffic?: (entry: AcpTrafficEntry, sessionId: string) => void;
  /** Filesystem behind the `fs/*` handlers (node fs by default). */
  readonly fs?: FileSystemPort;
  /** Terminal manager behind the `terminal/*` handlers. */
  readonly terminals?: TerminalManager;
  /** Called for each chunk the process writes to stderr. */
  readonly onStderr?: (chunk: string) => void;
  readonly logger?: LoggerPort;
}

/** A running ACP process + connection; the run's single agent handle. */
export interface AgentHandle {
  /** Long-lived client context for `buildSession(cwd)` etc. (T-012). */
  readonly ctx: ClientContext;
  /** Agent identity from `initialize` (`null` when the agent omitted it). */
  readonly agentInfo: Implementation | null;
  /** Protocol version the agent agreed on (`1`). */
  readonly protocolVersion: number;
  /** Turn-scoped agent text, keyed by sessionId (OQ3). */
  readonly text: TurnTextBuffer;
  /** Per-session cumulative cost buffer (C-0005). */
  readonly cost: CostBuffer;
  /** Terminal manager behind the `terminal/*` handlers. */
  readonly terminals: TerminalManager;
  /** Resolves when the underlying process has exited. */
  readonly closed: Promise<void>;
  /** Close the connection and terminate the process. Idempotent. */
  shutdown(): Promise<void>;
}

/** A promise whose `resolve`/`reject` are exposed for an external caller. */
interface Deferred<T> {
  readonly promise: Promise<T>;
  readonly resolve: (value: T) => void;
  readonly reject: (reason: unknown) => void;
}

/** Create a {@link Deferred} — a promise with externally callable settlers. */
function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/**
 * Spawn the ACP agent, connect, `initialize`, and return an {@link AgentHandle}.
 * The process and connection stay open until {@link AgentHandle.shutdown}.
 *
 * Rejects (killing the child) if the handshake fails or the process dies before
 * `initialize` completes.
 */
export async function openAgent(
  options: OpenAgentOptions,
): Promise<AgentHandle> {
  const command = options.command ?? DEFAULT_ACP_COMMAND;
  const file = command[0];
  if (file === undefined) {
    throw new Error("openAgent: comando ACP vazio.");
  }

  const child = spawn(file, command.slice(1), {
    cwd: options.cwd,
    env: options.env ?? process.env,
    stdio: ["pipe", "pipe", "pipe"],
  });

  // stderr -> logs. stdout is the ndjson transport and is never used for logs.
  child.stderr?.setEncoding("utf8");
  child.stderr?.on("data", (chunk: string) => {
    options.onStderr?.(chunk);
    options.logger?.debug(`[acp:stderr] ${chunk.trimEnd()}`);
  });

  const closed = new Promise<void>((resolve) => {
    child.once("exit", () => resolve());
  });

  // Kill the child only if it hasn't already exited (idempotent teardown).
  const killIfRunning = (): void => {
    if (child.exitCode === null && child.signalCode === null) child.kill();
  };

  if (child.stdin === null || child.stdout === null) {
    child.kill();
    throw new Error("openAgent: falha ao abrir stdin/stdout do processo ACP.");
  }

  const stream = ndJsonStream(
    Writable.toWeb(child.stdin) as WritableStream<Uint8Array>,
    Readable.toWeb(child.stdout) as ReadableStream<Uint8Array>,
  );

  const { app, textBuffer, costBuffer, terminals } = createClientApp({
    name: options.clientInfo?.name,
    onRequest: options.permissions.on_request,
    permissionResolver: options.permissionResolver,
    onUpdate: options.onUpdate,
    onTraffic: options.onTraffic,
    fs: options.fs,
    terminals: options.terminals,
    logger: options.logger,
  });

  // Gate that keeps the `connectWith` callback pending — and thus the single
  // connection open (AD-3) — until shutdown opens it.
  const gate = deferred<void>();
  const ready = deferred<{ ctx: ClientContext; init: InitializeResponse }>();

  // A spawn error (e.g. ENOENT) never reaches the transport — surface it here.
  child.once("error", ready.reject);

  const run = app.connectWith(stream, async (ctx) => {
    // Explicit <Response, Params> pins the typed overload (the bare call
    // resolves to the generic `unknown` overload here) and type-checks the
    // request body against InitializeRequest.
    const init = await ctx.request<InitializeResponse, InitializeRequest>(
      AGENT_METHODS.initialize,
      {
        protocolVersion: PROTOCOL_VERSION,
        clientCapabilities: options.capabilities ?? DEFAULT_CLIENT_CAPABILITIES,
        clientInfo: options.clientInfo ?? { name: "loopy", version: "0.1.0" },
      },
    );
    ready.resolve({ ctx, init });
    await gate.promise;
  });
  // If the connection closes before `initialize` resolves, don't hang `ready`.
  // (After ready settles this is a harmless no-op.)
  run.catch(ready.reject);

  let value: { ctx: ClientContext; init: InitializeResponse };
  try {
    value = await ready.promise;
  } catch (error) {
    killIfRunning();
    throw error;
  }

  let shuttingDown = false;
  async function shutdown(): Promise<void> {
    if (!shuttingDown) {
      shuttingDown = true;
      gate.resolve(); // let `connectWith` close the connection
    }
    try {
      await run;
    } catch {
      // A close-time rejection is expected while tearing the connection down.
    }
    killIfRunning();
    await closed;
  }

  return {
    ctx: value.ctx,
    agentInfo: value.init.agentInfo ?? null,
    protocolVersion: value.init.protocolVersion,
    text: textBuffer,
    cost: costBuffer,
    terminals,
    closed,
    shutdown,
  };
}
