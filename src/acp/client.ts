/**
 * ACP client-side handlers — everything the engine must answer *while* the
 * agent is mid-turn (SPEC "Code Style" wrapper snippet; AD-3).
 *
 * The agent (the `claude-agent-acp` subprocess) calls back into us during a
 * prompt turn: it asks permission before sensitive tool calls, reads and writes
 * files, opens terminals, and streams its output. This module builds the
 * {@link ClientApp} with those handlers registered **before** the connection
 * opens (they must be in place before the first callback arrives) and owns the
 * three stateful pieces that back them:
 *
 *  1. **Permission decision by `kind` (AC2).** `session/request_permission`
 *     ships a list of {@link PermissionOption}s, each tagged with a `kind`
 *     (`allow_once` / `reject_once` / ...). A {@link PermissionResolver} turns a
 *     request into an `allow` / `reject` / `cancel` *action*; the handler then
 *     picks the matching option's `optionId` ({@link resolvePermissionOutcome}).
 *     The default resolver honors `acp.permissions.on_request` (`allow` today;
 *     `policy` is a placeholder until deny-patterns land).
 *
 *  2. **Turn-scoped text buffer (OQ3).** Every `session/update` is forwarded to
 *     `onUpdate` (TUI/logs) *and*, when it is an `agent_message_chunk` with text,
 *     appended to a per-session {@link TurnTextBuffer}. This buffer — not the
 *     SDK's cumulative `readText()` — is the source of truth for an agent turn's
 *     text; the session layer (T-012) resets it before each prompt.
 *
 *  3. **Client capabilities.** `fs/read_text_file` + `fs/write_text_file` are
 *     served by a {@link FileSystemPort} (node fs by default); `terminal/*` by a
 *     {@link TerminalManager} that runs commands the agent requests. These are
 *     advertised to the agent in `initialize` (see `acp/agent.ts`).
 *
 * Errors as values only where a failure is normal (AD-5): a permission that
 * cannot be satisfied resolves to `cancelled`; an unknown terminal id is a real
 * protocol fault and throws (surfaced back to the agent as a JSON-RPC error by
 * the connection layer).
 */
import { spawn, type ChildProcess } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import {
  CLIENT_METHODS,
  client,
  type ClientApp,
} from "@agentclientprotocol/sdk";
import type {
  CreateTerminalRequest,
  CreateTerminalResponse,
  KillTerminalRequest,
  PermissionOption,
  PermissionOptionKind,
  ReleaseTerminalRequest,
  RequestPermissionRequest,
  RequestPermissionResponse,
  SessionNotification,
  SessionUpdate,
  TerminalExitStatus,
  TerminalOutputRequest,
  TerminalOutputResponse,
  WaitForTerminalExitRequest,
  WaitForTerminalExitResponse,
} from "@agentclientprotocol/sdk";
import type { AcpTrafficEntry } from "../logging/logger";
import type { LoggerPort, PermissionOnRequest } from "../types";

// ---------------------------------------------------------------------------
// Permission decision by kind (AC2)
// ---------------------------------------------------------------------------

/** Preferred `kind`s for an *allow* decision, best first. */
export const ALLOW_KINDS: readonly PermissionOptionKind[] = [
  "allow_once",
  "allow_always",
];

/** Preferred `kind`s for a *reject* decision, best first. */
export const REJECT_KINDS: readonly PermissionOptionKind[] = [
  "reject_once",
  "reject_always",
];

/** What the engine decides to do with a permission request. */
export type PermissionAction = "allow" | "reject" | "cancel";

/** A resolver's verdict (with an optional human-readable reason for logs). */
export interface PermissionDecision {
  readonly action: PermissionAction;
  readonly reason?: string;
}

/** Turns a permission request into a decision (may be async — e.g. a prompt). */
export type PermissionResolver = (
  request: RequestPermissionRequest,
) => PermissionDecision | Promise<PermissionDecision>;

/**
 * The first option whose `kind` matches `preferred`, honoring the preference
 * order (so `allow_once` wins over `allow_always`). `undefined` when none match.
 */
export function pickOptionByKind(
  options: readonly PermissionOption[],
  preferred: readonly PermissionOptionKind[],
): PermissionOption | undefined {
  for (const kind of preferred) {
    const found = options.find((option) => option.kind === kind);
    if (found) return found;
  }
  return undefined;
}

/** A `selected` outcome for `option`, or `cancelled` when it is `undefined`. */
function selectedOrCancelled(
  option: PermissionOption | undefined,
): RequestPermissionResponse {
  return option
    ? { outcome: { outcome: "selected", optionId: option.optionId } }
    : { outcome: { outcome: "cancelled" } };
}

/**
 * Map a {@link PermissionDecision} onto a concrete
 * {@link RequestPermissionResponse} by selecting the matching option's id:
 *  - `allow` → an allow-kind option (falls back to the first option so the agent
 *    is never wedged when it offers a non-standard set),
 *  - `reject` → a reject-kind option (falls back to `cancelled` — refusing is
 *    safer than picking an arbitrary, possibly-allow option),
 *  - `cancel` → `cancelled`.
 */
export function resolvePermissionOutcome(
  options: readonly PermissionOption[],
  decision: PermissionDecision,
): RequestPermissionResponse {
  if (decision.action === "cancel") {
    return { outcome: { outcome: "cancelled" } };
  }
  const chosen =
    decision.action === "allow"
      ? pickOptionByKind(options, ALLOW_KINDS) ?? options[0]
      : pickOptionByKind(options, REJECT_KINDS);
  return selectedOrCancelled(chosen);
}

/**
 * Default permission resolver driven by `acp.permissions.on_request`. Today both
 * `allow` and `policy` resolve to `allow` — `policy` (deny-patterns) is reserved
 * for a later task; keeping it here (rather than throwing) means enabling it is a
 * config change, faithful to AD-1.
 */
export function createPermissionResolver(
  onRequest: PermissionOnRequest,
): PermissionResolver {
  const reason =
    onRequest === "policy"
      ? "on_request=policy (deny-patterns not implemented — allowing)"
      : "on_request=allow";
  return () => ({ action: "allow", reason });
}

// ---------------------------------------------------------------------------
// Turn-scoped text buffer (OQ3)
// ---------------------------------------------------------------------------

/**
 * Per-session accumulator of an agent turn's text. Keyed by `sessionId` so one
 * agent process hosting several sessions (parallel-ready, AD-3/AD-4) never mixes
 * their output. The session layer calls {@link TurnTextBuffer.reset} before each
 * prompt so `read` returns exactly the current turn's text.
 */
export interface TurnTextBuffer {
  /** Append a text chunk for a session. */
  append(sessionId: string, text: string): void;
  /** Concatenated text for a session (`""` when unseen or just reset). */
  read(sessionId: string): string;
  /** Clear a session's accumulated text (a turn boundary). */
  reset(sessionId: string): void;
}

/** Build an in-memory {@link TurnTextBuffer}. */
export function createTurnTextBuffer(): TurnTextBuffer {
  const chunks = new Map<string, string[]>();
  return {
    append(sessionId, text) {
      const existing = chunks.get(sessionId);
      if (existing) existing.push(text);
      else chunks.set(sessionId, [text]);
    },
    read(sessionId) {
      return (chunks.get(sessionId) ?? []).join("");
    },
    reset(sessionId) {
      chunks.set(sessionId, []);
    },
  };
}

/**
 * The text of an `agent_message_chunk` update, or `undefined` for any other
 * update type / non-text content. This is the only update kind that feeds the
 * turn buffer (OQ3); tool calls, plans and thoughts are streamed but not buffered.
 */
export function agentChunkText(update: SessionUpdate): string | undefined {
  if (update.sessionUpdate !== "agent_message_chunk") return undefined;
  const { content } = update;
  return content.type === "text" ? content.text : undefined;
}

/**
 * Extract cost from a `usage_update`, or `undefined` for any other update type
 * or when cost is absent. Feeds the {@link CostBuffer} (C-0005).
 */
export function usageUpdateCost(
  update: SessionUpdate,
): { readonly amount: number; readonly currency: string } | undefined {
  if (update.sessionUpdate !== "usage_update") return undefined;
  const cost = (update as { cost?: { amount: number; currency: string } | null }).cost;
  return cost ?? undefined;
}

// ---------------------------------------------------------------------------
// Per-session cost buffer (C-0005 T-003) — fed by `usage_update`
// ---------------------------------------------------------------------------

/**
 * Per-session buffer of the cumulative ACP cost (from `usage_update`).
 * The `usage_update` arrives via `session/update` after the `flushSessionUpdates`
 * barrier, so by the time `SessionWrapper.readCost()` reads it the value is
 * settled. The buffer stores the **last** snapshot per session (cost is
 * cumulative — spike confirmed); `null` when no `usage_update` with cost arrived.
 */
export interface CostBuffer {
  /** Store the latest cumulative cost snapshot for a session. */
  set(sessionId: string, amount: number, currency: string): void;
  /** Read the latest cost snapshot; `null` when none received. */
  read(sessionId: string): { readonly amount: number; readonly currency: string } | null;
}

/** Build an in-memory {@link CostBuffer}. */
export function createCostBuffer(): CostBuffer {
  const store = new Map<string, { readonly amount: number; readonly currency: string }>();
  return {
    set(sessionId, amount, currency) {
      store.set(sessionId, { amount, currency });
    },
    read(sessionId) {
      return store.get(sessionId) ?? null;
    },
  };
}

// ---------------------------------------------------------------------------
// Filesystem port (fs/read_text_file + fs/write_text_file)
// ---------------------------------------------------------------------------

/** Line/limit window for a read (both optional; ACP `line` is 1-based). */
export interface ReadWindow {
  readonly line?: number | null;
  readonly limit?: number | null;
}

/** The client's filesystem, behind `fs/read_text_file` + `fs/write_text_file`. */
export interface FileSystemPort {
  readTextFile(path: string, window: ReadWindow): Promise<string>;
  writeTextFile(path: string, content: string): Promise<void>;
}

/**
 * A {@link FileSystemPort} over `node:fs/promises`. A `line`/`limit` window
 * slices the file by lines (1-based start, `limit` lines) — matching the ACP
 * `fs/read_text_file` contract; without a window the raw file is returned
 * verbatim so a round-trip write→read is byte-exact.
 */
export function createNodeFileSystem(): FileSystemPort {
  return {
    async readTextFile(path, window) {
      const raw = await readFile(path, "utf8");
      const { line, limit } = window;
      if ((line == null || line <= 1) && limit == null) return raw;
      const lines = raw.split("\n");
      const start = line != null && line > 1 ? line - 1 : 0;
      const end = limit != null ? start + limit : lines.length;
      return lines.slice(start, end).join("\n");
    },
    async writeTextFile(path, content) {
      await writeFile(path, content, "utf8");
    },
  };
}

// ---------------------------------------------------------------------------
// Terminal manager (terminal/* handlers)
// ---------------------------------------------------------------------------

/** Runs the commands the agent requests via `terminal/create` and friends. */
export interface TerminalManager {
  create(request: CreateTerminalRequest): CreateTerminalResponse;
  output(request: TerminalOutputRequest): TerminalOutputResponse;
  waitForExit(
    request: WaitForTerminalExitRequest,
  ): Promise<WaitForTerminalExitResponse>;
  release(request: ReleaseTerminalRequest): void;
  kill(request: KillTerminalRequest): void;
  /** Kill + drop every live terminal (connection teardown / test cleanup). */
  disposeAll(): void;
}

interface TerminalState {
  readonly child: ChildProcess;
  chunks: string[];
  readonly outputByteLimit: number | null;
  truncated: boolean;
  exitStatus: TerminalExitStatus | null;
  readonly exited: Promise<void>;
}

/** UTF-8 byte length of a string. */
function byteLength(text: string): number {
  return Buffer.byteLength(text, "utf8");
}

/**
 * Keep the last bytes of `text` fitting within `maxBytes`, cutting on a
 * character boundary (the ACP contract truncates from the beginning). Returns
 * `{ text, truncated }`.
 */
function tailWithinBytes(
  text: string,
  maxBytes: number,
): { readonly text: string; readonly truncated: boolean } {
  if (byteLength(text) <= maxBytes) return { text, truncated: false };
  const chars = [...text];
  let used = 0;
  let start = chars.length;
  for (let i = chars.length - 1; i >= 0; i -= 1) {
    const cost = byteLength(chars[i] as string);
    if (used + cost > maxBytes) break;
    used += cost;
    start = i;
  }
  return { text: chars.slice(start).join(""), truncated: true };
}

/** Convert ACP `EnvVariable[]` into a spawn env object merged over `process.env`. */
function toEnv(
  vars: CreateTerminalRequest["env"],
): NodeJS.ProcessEnv | undefined {
  if (!vars || vars.length === 0) return undefined;
  const env: NodeJS.ProcessEnv = { ...process.env };
  for (const { name, value } of vars) env[name] = value;
  return env;
}

/** Options for {@link createTerminalManager}. */
export interface TerminalManagerOptions {
  /** Fallback working directory when a `terminal/create` omits `cwd`. */
  readonly defaultCwd?: string;
}

/**
 * Build a {@link TerminalManager} backed by `child_process.spawn`. Output from
 * stdout and stderr is merged (the agent sees one stream), retained subject to
 * the request's `outputByteLimit`, and the process exit status is recorded for
 * `terminal/output` and `terminal/wait_for_exit`.
 */
export function createTerminalManager(
  options: TerminalManagerOptions = {},
): TerminalManager {
  const terminals = new Map<string, TerminalState>();
  let counter = 0;

  function requireTerminal(id: string): TerminalState {
    const state = terminals.get(id);
    if (!state) throw new Error(`Terminal desconhecido: ${id}`);
    return state;
  }

  return {
    create(request) {
      const id = `term-${(counter += 1)}`;
      const child = spawn(request.command, request.args ?? [], {
        cwd: request.cwd ?? options.defaultCwd,
        env: toEnv(request.env),
        stdio: ["ignore", "pipe", "pipe"],
      });
      const state: TerminalState = {
        child,
        chunks: [],
        outputByteLimit: request.outputByteLimit ?? null,
        truncated: false,
        exitStatus: null,
        exited: new Promise<void>((resolve) => {
          child.on("exit", (code, signal) => {
            state.exitStatus = { exitCode: code, signal };
            resolve();
          });
          child.on("error", () => {
            // Spawn failure (e.g. ENOENT): surface as a non-zero exit so the
            // agent sees the terminal completed rather than hanging forever.
            if (state.exitStatus === null) {
              state.exitStatus = { exitCode: -1, signal: null };
            }
            resolve();
          });
        }),
      };
      const collect = (chunk: Buffer): void => {
        state.chunks.push(chunk.toString("utf8"));
      };
      child.stdout?.on("data", collect);
      child.stderr?.on("data", collect);
      terminals.set(id, state);
      return { terminalId: id };
    },

    output(request) {
      const state = requireTerminal(request.terminalId);
      let output = state.chunks.join("");
      if (state.outputByteLimit != null) {
        const tail = tailWithinBytes(output, state.outputByteLimit);
        output = tail.text;
        if (tail.truncated) state.truncated = true;
      }
      return {
        output,
        truncated: state.truncated,
        exitStatus: state.exitStatus,
      };
    },

    async waitForExit(request) {
      const state = requireTerminal(request.terminalId);
      await state.exited;
      return {
        exitCode: state.exitStatus?.exitCode ?? null,
        signal: state.exitStatus?.signal ?? null,
      };
    },

    release(request) {
      const state = terminals.get(request.terminalId);
      if (!state) return;
      if (state.exitStatus === null) state.child.kill();
      terminals.delete(request.terminalId);
    },

    kill(request) {
      requireTerminal(request.terminalId).child.kill("SIGKILL");
    },

    disposeAll() {
      for (const state of terminals.values()) {
        if (state.exitStatus === null) state.child.kill("SIGKILL");
      }
      terminals.clear();
    },
  };
}

// ---------------------------------------------------------------------------
// ClientApp assembly — register every handler BEFORE the connection opens.
// ---------------------------------------------------------------------------

/** Options for {@link createClientApp}. */
export interface ClientAppOptions {
  /** Client name in JSON-RPC diagnostics (default `"loopy"`). */
  readonly name?: string;
  /** How `session/request_permission` is answered (default: honor + allow). */
  readonly onRequest?: PermissionOnRequest;
  /** Override the permission resolver (tests, future policy transports). */
  readonly permissionResolver?: PermissionResolver;
  /** Called for every `session/update` (stream to TUI/logs). */
  readonly onUpdate?: (notification: SessionNotification) => void;
  /** Called for every ACP JSON-RPC message (send/recv); pure observation (AD-1). */
  readonly onTraffic?: (entry: AcpTrafficEntry, sessionId: string) => void;
  /** Turn buffer (OQ3) to feed; a fresh one is created when omitted. */
  readonly textBuffer?: TurnTextBuffer;
  /** Cost buffer (C-0005) to feed; a fresh one is created when omitted. */
  readonly costBuffer?: CostBuffer;
  /** Filesystem behind the `fs/*` handlers (node fs by default). */
  readonly fs?: FileSystemPort;
  /** Terminal manager behind the `terminal/*` handlers. */
  readonly terminals?: TerminalManager;
  /** Optional logger for permission decisions and fs/terminal activity. */
  readonly logger?: LoggerPort;
}

/** The built {@link ClientApp} plus the stateful handles callers need later. */
export interface ClientAppBundle {
  readonly app: ClientApp;
  readonly textBuffer: TurnTextBuffer;
  readonly costBuffer: CostBuffer;
  readonly terminals: TerminalManager;
}

/**
 * Build the {@link ClientApp} with all client-side handlers registered up front
 * (permission, fs, terminal, session/update). The returned `app` is not yet
 * connected — `acp/agent.ts` connects it to the subprocess stream. Callers get
 * back the `textBuffer` (turn text, OQ3) and `terminals` handles so the session
 * layer can read/reset them.
 */
export function createClientApp(
  options: ClientAppOptions = {},
): ClientAppBundle {
  const textBuffer = options.textBuffer ?? createTurnTextBuffer();
  const costBuffer = options.costBuffer ?? createCostBuffer();
  const terminals = options.terminals ?? createTerminalManager();
  const fs = options.fs ?? createNodeFileSystem();
  const resolvePermission =
    options.permissionResolver ??
    createPermissionResolver(options.onRequest ?? "allow");
  const logger = options.logger;
  const onTraffic = options.onTraffic;

  /** Fire-and-forget recv traffic entry (observation only — AD-1). */
  const recv = (method: string, sessionId: string, payload?: unknown): void => {
    onTraffic?.({ direction: "recv", method, payload }, sessionId);
  };

  const app = client({ name: options.name ?? "loopy" })
    .onRequest(
      CLIENT_METHODS.session_request_permission,
      async ({ params }) => {
        recv("session/request_permission", params.sessionId, params);
        const decision = await resolvePermission(params);
        const response = resolvePermissionOutcome(params.options, decision);
        logger?.debug(
          `[acp] permission ${decision.action} for tool ${params.toolCall.toolCallId}`,
        );
        return response;
      },
    )
    .onRequest(CLIENT_METHODS.fs_read_text_file, async ({ params }) => {
      recv("fs/read_text_file", params.sessionId, params);
      const content = await fs.readTextFile(params.path, {
        line: params.line,
        limit: params.limit,
      });
      return { content };
    })
    .onRequest(CLIENT_METHODS.fs_write_text_file, async ({ params }) => {
      recv("fs/write_text_file", params.sessionId, params);
      await fs.writeTextFile(params.path, params.content);
      return {};
    })
    .onRequest(CLIENT_METHODS.terminal_create, ({ params }) => {
      recv("terminal/create", params.sessionId, params);
      return terminals.create(params);
    })
    .onRequest(CLIENT_METHODS.terminal_output, ({ params }) => {
      recv("terminal/output", params.sessionId, params);
      return terminals.output(params);
    })
    .onRequest(CLIENT_METHODS.terminal_wait_for_exit, ({ params }) => {
      recv("terminal/wait_for_exit", params.sessionId, params);
      return terminals.waitForExit(params);
    })
    .onRequest(CLIENT_METHODS.terminal_release, ({ params }) => {
      recv("terminal/release", params.sessionId, params);
      terminals.release(params);
      return {};
    })
    .onRequest(CLIENT_METHODS.terminal_kill, ({ params }) => {
      recv("terminal/kill", params.sessionId, params);
      terminals.kill(params);
      return {};
    })
    .onNotification(CLIENT_METHODS.session_update, ({ params }) => {
      recv("session/update", params.sessionId, params);
      options.onUpdate?.(params);
      const text = agentChunkText(params.update);
      if (text !== undefined) textBuffer.append(params.sessionId, text);
      const cost = usageUpdateCost(params.update);
      if (cost !== undefined) costBuffer.set(params.sessionId, cost.amount, cost.currency);
    });

  return { app, textBuffer, costBuffer, terminals };
}
