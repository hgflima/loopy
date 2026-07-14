/**
 * Per-task ACP session — one session bound to one (agent, worktree) pair (AD-3
 * evolved by ADR-0006).
 *
 * The run owns one ACP process per agent referenced by the pipeline
 * (`acp/agent.ts`); this layer turns each process's long-lived
 * {@link ClientContext} into task-sized sessions. Per AD-3 a session's `cwd` is
 * fixed at `session/new` and immutable for its lifetime, so each
 * (agent, worktree) pair needs its own session — which is exactly why sessions
 * are pooled by `${agent}::${worktree}` ({@link createSessionPool}).
 *
 * A {@link LoopySession} wraps the SDK's `ActiveSession` and exposes the mechanics
 * the `agent` step (T-014) drives, nothing more (AD-1 — no loop behavior here):
 *
 *  - {@link LoopySession.setMode} → `session/set_mode` (`plan` / `acceptEdits` …).
 *  - {@link LoopySession.clear}   → reopens the session (`dispose()` +
 *    `session/new`); the wrapper is preserved but the `sessionId` changes.
 *  - {@link LoopySession.prompt}  → one prompt turn; resolves with the ACP
 *    `stopReason` only (never the text).
 *  - {@link LoopySession.readText} → the turn's text from our OWN buffer (OQ3),
 *    reset before every turn; the SDK's `readText()` is kept as a fallback.
 *  - {@link LoopySession.cancel}  → `session/cancel`.
 *
 * OQ3 timing: the turn buffer is fed asynchronously by the `session/update`
 * handler in `acp/client.ts`, so it is only *eventually* consistent with a
 * resolved `prompt()`. To make {@link LoopySession.readText} a reliable
 * synchronous read, {@link LoopySession.prompt} drives the SDK's `readText()`
 * (which drains the update queue up to the turn's `stop`) alongside the prompt
 * response; once that settles every `agent_message_chunk` has been dispatched and
 * our buffer holds the complete turn.
 *
 * Errors as values (AD-5): a non-`end_turn` stop reason is *returned*, not
 * thrown — {@link classifyStopReason} tells the caller whether it is a failure
 * (`refusal` / `max_tokens` / `max_turn_requests`) or our own stop-signal
 * (`cancelled`). Exceptions are reserved for infra/transport faults.
 */
import { AGENT_METHODS } from "@agentclientprotocol/sdk";
import type {
  ActiveSession,
  ClientContext,
} from "@agentclientprotocol/sdk";
import type {
  AgentSession,
  LoggerPort,
  StepCost,
  StopReason,
  TurnUsage,
} from "../types";
import type { AcpTrafficEntry } from "../logging/logger";
import type { CostBuffer, TurnTextBuffer } from "./client";
import { parseCapabilities, type AgentCapabilities } from "./capabilities";

// ---------------------------------------------------------------------------
// Stop-reason classification (AC3) — pure, reused by the `agent` step (T-014).
// ---------------------------------------------------------------------------

/** How the engine reads a prompt turn's {@link StopReason}. */
export type StopOutcome =
  /** The turn completed normally (`end_turn`). */
  | "success"
  /** The turn ended abnormally and should fail the step. */
  | "failure"
  /** We cancelled the turn (`cancelled`) — an engine stop-signal, not a failure. */
  | "stop_signal";

/**
 * Classify an ACP {@link StopReason}: only `end_turn` is a success;
 * `cancelled` is our own stop-signal; everything else (`refusal`, `max_tokens`,
 * `max_turn_requests`) is a step failure.
 */
export function classifyStopReason(reason: StopReason): StopOutcome {
  if (reason === "end_turn") return "success";
  if (reason === "cancelled") return "stop_signal";
  return "failure";
}

/** `true` only when the turn completed normally (`end_turn`). */
export function isTurnSuccess(reason: StopReason): boolean {
  return classifyStopReason(reason) === "success";
}

/** `true` when the turn ended because we cancelled it (`cancelled`). */
export function isStopSignal(reason: StopReason): boolean {
  return classifyStopReason(reason) === "stop_signal";
}

// ---------------------------------------------------------------------------
// Session wrapper
// ---------------------------------------------------------------------------

/** Dependencies a session needs from the run's single agent connection. */
export interface SessionDeps {
  /** Long-lived client context from {@link AgentHandle} (`acp/agent.ts`). */
  readonly ctx: ClientContext;
  /** Turn-scoped text buffer (OQ3), keyed by `sessionId`. */
  readonly text: TurnTextBuffer;
  /** Per-session cumulative cost buffer (C-0005), keyed by `sessionId`. */
  readonly cost?: CostBuffer;
  /** Called for every ACP JSON-RPC message (send/recv); pure observation (AD-1). */
  readonly onTraffic?: (entry: AcpTrafficEntry, sessionId: string) => void;
  /**
   * Called when `clear()` reopens the session (`dispose()` + `session/new`).
   * The wrapper's identity is preserved, but the underlying `sessionId` changes.
   * Consumers keyed by `sessionId` (e.g. `sessionToTask` in `index.ts`) must
   * re-register here.
   */
  readonly onReopen?: (oldSessionId: string, newSessionId: string) => void;
  /**
   * Called when a best-effort config option is silently skipped or rejected.
   * The engine wires this to a `StoreEvent` `warning` so the user sees it in
   * the TUI/GUI — not just in the debug log (T-006, D18/D28/D33).
   */
  readonly onWarning?: (message: string) => void;
  readonly logger?: LoggerPort;
}

/** A worktree-bound ACP session plus explicit teardown. */
export interface LoopySession extends AgentSession {
  /** What this agent announced it supports (modes, models, efforts). */
  readonly capabilities: AgentCapabilities;
  /** Stop routing this session's updates (teardown). Idempotent. */
  dispose(): void;
}

/** Zero-valued usage accumulator — reused on init and reset. */
const ZERO_USAGE = {
  inputTokens: 0,
  outputTokens: 0,
  cachedReadTokens: 0,
  cachedWriteTokens: 0,
  thoughtTokens: 0,
  totalTokens: 0,
};

class SessionWrapper implements LoopySession {
  private lastTurnText = "";
  private usageAcc = { ...ZERO_USAGE };
  private usageAvailable = false;

  /**
   * Discovered capabilities from `session/new` — the single source of truth
   * for modes, models, efforts, and their `configId`s. Replaces the old
   * `modelConfigId`/`effortConfigId`/`availableModeIds` triple (T-006).
   */
  private _capabilities!: AgentCapabilities;

  // Stored config values for replay after reopen (session/new resets to defaults).
  private appliedMode: string | undefined;
  private appliedModel: string | undefined;
  private appliedEffort: string | undefined;

  /**
   * Cumulative cost carry-over across reopens. The `CostBuffer` is keyed by
   * `sessionId` and resets to zero on a new session; this field preserves
   * the total across the wrapper's lifetime.
   */
  private costCarry: { amount: number; currency: string } | null = null;

  /** The cwd this session is bound to (immutable, needed for reopen). */
  private readonly cwd: string;

  constructor(
    private readonly deps: SessionDeps,
    private active: ActiveSession,
    cwd: string,
  ) {
    this.cwd = cwd;
    this.parseConfigFromSession(active);
  }

  /** Extract capabilities from a (possibly new) session via `parseCapabilities` (T-006). */
  private parseConfigFromSession(session: ActiveSession): void {
    const opts = session.newSessionResponse.configOptions ?? undefined;
    const fallbackModes =
      session.newSessionResponse.modes?.availableModes.map((m) => m.id);
    this._capabilities = parseCapabilities(opts, fallbackModes);
  }

  get capabilities(): AgentCapabilities {
    return this._capabilities;
  }

  get sessionId(): string {
    return this.active.sessionId;
  }

  /** Session-scoped debug line, e.g. `[acp] cancel (<sessionId>)`. */
  private logAction(action: string): void {
    this.deps.logger?.debug(`[acp] ${action} (${this.sessionId})`);
  }

  /** Fire-and-forget send traffic entry (observation only — AD-1). */
  private send(method: string, payload?: unknown): void {
    this.deps.onTraffic?.({ direction: "send", method, payload }, this.sessionId);
  }

  /**
   * Set the session mode via `session/set_mode`. Modes are per-agent vocabulary,
   * so this validates `modeId` against `capabilities.modes` and **fails-closed**
   * with an actionable message when it is not among them (T-006, D33).
   *
   * **Fail-closed semantics**: when the agent announced modes (via `configOptions`
   * or legacy `availableModes`), any `modeId` not in that list throws. This
   * closes the old hole where OpenCode (`modes: null` but `configOptions` with
   * category `mode`) escaped all validation.
   *
   * When `capabilities.modes` is **empty** (adapter announces nothing at all —
   * neither `configOptions` nor `availableModes`) we cannot validate: the call is
   * sent raw and a warning is emitted so the user knows.
   */
  async setMode(modeId: string): Promise<void> {
    const { modes } = this._capabilities;
    if (modes.length > 0 && !modes.includes(modeId)) {
      throw new Error(
        `mode '${modeId}' não é aceito por este agente ` +
          `(aceita: ${modes.join(", ")}). ` +
          `Modos são vocabulário por-agente — cheque o mode do Step contra o agente-alvo.`,
      );
    }
    if (modes.length === 0) {
      this.deps.onWarning?.(
        `mode '${modeId}' enviado cru — agente não anuncia modos (sem validação possível)`,
      );
      this.deps.logger?.debug(
        `[acp] setMode(${modeId}) — no modes announced, sending raw (${this.sessionId})`,
      );
    }
    const params = { sessionId: this.sessionId, modeId };
    this.send("session/set_mode", params);
    await this.deps.ctx.request(AGENT_METHODS.session_set_mode, params);
    this.appliedMode = modeId;
    this.logAction(`set_mode ${modeId}`);
  }

  /**
   * Best-effort model override via `session/set_config_option` (category `model`).
   * Validates the value against `capabilities.models` (T-006, D18): value outside
   * the announced list is **not sent** and emits a warning. Category absent =>
   * warning + skip. Adapter errors are swallowed (AD-5).
   */
  async setModel(modelId: string): Promise<void> {
    const sent = await this.setConfigOption(
      this._capabilities.modelConfigId,
      "model",
      modelId,
      this._capabilities.models,
    );
    if (sent) this.appliedModel = modelId;
  }

  /**
   * Best-effort effort override via `session/set_config_option` (category `thought_level`).
   * Same validation semantics as {@link setModel} (T-006, D18).
   */
  async setEffort(level: string): Promise<void> {
    const sent = await this.setConfigOption(
      this._capabilities.effortConfigId,
      "effort",
      level,
      this._capabilities.efforts,
    );
    if (sent) this.appliedEffort = level;
  }

  /**
   * Shared impl for `setModel`/`setEffort`: validates the value against the
   * announced values for the category (T-006, D18). Three outcomes:
   *
   *  1. **Category absent** (`configId` undefined) => warning + skip (not sent).
   *  2. **Value outside announced list** (non-empty) => warning + skip (not sent).
   *  3. **Value accepted** (or announced list empty — can't validate) => send.
   *
   * Never clampers, never translates values (D18): `xhigh` (Codex) is NOT `max`
   * (Claude). Returns `true` when the RPC was actually sent.
   */
  private async setConfigOption(
    configId: string | undefined,
    label: string,
    value: string,
    announcedValues: readonly string[],
  ): Promise<boolean> {
    if (configId === undefined) {
      const msg = `agente não anuncia ${label} — '${value}' ignorado`;
      this.deps.onWarning?.(msg);
      this.deps.logger?.debug(
        `[acp] set_config_option(${label}) skipped — capability not announced (${this.sessionId})`,
      );
      return false;
    }
    if (announcedValues.length > 0 && !announcedValues.includes(value)) {
      const msg =
        `${label} '${value}' não é aceito por este agente ` +
        `(aceita: ${announcedValues.join(", ")}) — ignorado`;
      this.deps.onWarning?.(msg);
      this.deps.logger?.debug(
        `[acp] set_config_option(${label}) rejected — '${value}' not in announced values (${this.sessionId})`,
      );
      return false;
    }
    const params = { sessionId: this.sessionId, configId, value };
    this.send("session/set_config_option", params);
    try {
      await this.deps.ctx.request(
        AGENT_METHODS.session_set_config_option,
        params,
      );
      this.logAction(`set_config_option(${label}) ${value}`);
      return true;
    } catch (err) {
      // AD-5: adapter error swallowed — best-effort, never propagated.
      this.deps.logger?.debug(
        `[acp] set_config_option(${label}) failed (${this.sessionId}): ${String(err)}`,
      );
      return false;
    }
  }

  /**
   * Reset context by reopening the session: `dispose()` the current
   * `ActiveSession` then `buildSession(cwd).start()` a fresh one. The wrapper
   * reference is preserved (pool/orchestrator caches stay valid), but the
   * underlying `sessionId` **changes**.
   *
   * After reopen:
   *  - `_capabilities` is re-parsed from the new `newSessionResponse`.
   *  - Stored mode/model/effort are re-applied so the session resumes with the
   *    same autonomy level (critical for `mode: plan` in audit steps).
   *  - `costCarry` captures the old session's cumulative cost so `readCost()`
   *    remains monotonic across reopens.
   *  - The `onReopen` callback notifies consumers keyed by `sessionId`.
   */
  async clear(): Promise<void> {
    const oldSessionId = this.sessionId;

    // Snapshot the old session's cost before disposing.
    const oldCost = this.deps.cost?.read(oldSessionId);
    if (oldCost != null) {
      this.costCarry = {
        amount: (this.costCarry?.amount ?? 0) + oldCost.amount,
        currency: oldCost.currency,
      };
    }

    // Dispose + open a fresh session on the same cwd.
    this.active.dispose();
    this.active = await this.deps.ctx.buildSession(this.cwd).start();
    this.parseConfigFromSession(this.active);

    // Reset turn state for the new session.
    this.lastTurnText = "";
    this.deps.text.reset(this.sessionId);

    this.logAction(`reopen ${oldSessionId} → ${this.sessionId}`);

    // Re-apply stored config (session/new starts with defaults).
    if (this.appliedMode !== undefined) {
      await this.setMode(this.appliedMode);
    }
    if (this.appliedModel !== undefined) {
      await this.setModel(this.appliedModel);
    }
    if (this.appliedEffort !== undefined) {
      await this.setEffort(this.appliedEffort);
    }

    // Notify consumers keyed by sessionId (e.g. sessionToTask).
    this.deps.onReopen?.(oldSessionId, this.sessionId);
  }

  async prompt(text: string): Promise<StopReason> {
    return this.runTurn(text);
  }

  /** The current turn's text (OQ3 buffer first, SDK `readText()` as fallback). */
  readText(): string {
    const own = this.deps.text.read(this.sessionId);
    // Buffer is the source of truth; the SDK-drained text is the cross-check
    // fallback only if the buffer is somehow still shorter (it should be equal
    // after `runTurn`'s flush barrier).
    return own.length >= this.lastTurnText.length ? own : this.lastTurnText;
  }

  async cancel(): Promise<void> {
    const params = { sessionId: this.sessionId };
    this.send("session/cancel", params);
    await this.deps.ctx.notify(AGENT_METHODS.session_cancel, params);
    this.logAction("cancel");
  }

  dispose(): void {
    this.active.dispose();
  }

  /** Sum of per-turn usage since last drain; resets the accumulator. */
  drainUsage(): TurnUsage | null {
    if (!this.usageAvailable) return null;
    const { inputTokens, outputTokens, cachedReadTokens, cachedWriteTokens, thoughtTokens, totalTokens } = this.usageAcc;
    const snapshot: TurnUsage = {
      inputTokens,
      outputTokens,
      cachedReadTokens: cachedReadTokens || undefined,
      cachedWriteTokens: cachedWriteTokens || undefined,
      thoughtTokens: thoughtTokens || undefined,
      totalTokens,
      available: true,
    };
    this.usageAcc = { ...ZERO_USAGE };
    this.usageAvailable = false;
    return snapshot;
  }

  /** Cumulative cost snapshot from the cost buffer + carry from prior sessions. */
  readCost(): StepCost | null {
    const raw = this.deps.cost?.read(this.sessionId);
    const carry = this.costCarry;
    if (raw == null && carry == null) return null;
    const amount = (carry?.amount ?? 0) + (raw?.amount ?? 0);
    const currency = raw?.currency ?? carry?.currency ?? "USD";
    return { amount, currency, available: true };
  }

  /**
   * Run one prompt turn: reset the turn buffer, send the prompt, and drain the
   * SDK update queue up to the turn's `stop`. Returns the ACP `stopReason`
   * (errors as values, AD-5).
   *
   * OQ3 timing: the SDK's `session/update` router enqueues a chunk synchronously,
   * but our own turn buffer is fed by a *later* notification handler whose
   * microtask can outlive a resolved `prompt()`. Every one of those handler
   * microtasks is already queued once the turn's `stop` is read, so crossing a
   * single macrotask boundary ({@link flushSessionUpdates}) after the drain
   * guarantees the buffer holds the complete turn — and that no late chunk leaks
   * into the next turn's (reset) buffer.
   */
  private async runTurn(text: string): Promise<StopReason> {
    this.send("session/prompt", { sessionId: this.sessionId, text });
    this.deps.text.reset(this.sessionId);
    // Start the prompt first so its `stop` completion is queued before the
    // concurrent drain reads it.
    const responsePromise = this.active.prompt(text);
    const [response, drained] = await Promise.all([
      responsePromise,
      this.active.readText(),
    ]);
    await flushSessionUpdates();
    this.lastTurnText = drained;

    // C-0005: accumulate per-turn usage (usage is per-turn — spike confirmed).
    const usage = response.usage;
    if (usage != null) {
      this.usageAcc.inputTokens += usage.inputTokens;
      this.usageAcc.outputTokens += usage.outputTokens;
      this.usageAcc.cachedReadTokens += usage.cachedReadTokens ?? 0;
      this.usageAcc.cachedWriteTokens += usage.cachedWriteTokens ?? 0;
      this.usageAcc.thoughtTokens += usage.thoughtTokens ?? 0;
      this.usageAcc.totalTokens += usage.totalTokens;
      this.usageAvailable = true;
    }

    return response.stopReason as StopReason;
  }
}

/**
 * Yield to a macrotask so all pending `session/update` handler microtasks flush
 * (see {@link SessionWrapper.runTurn}). A macrotask runs only after the microtask
 * queue drains, so one boundary is enough.
 */
function flushSessionUpdates(): Promise<void> {
  return new Promise<void>((resolve) => {
    setImmediate(resolve);
  });
}

/** A started {@link LoopySession} builder (mirrors `ctx.buildSession(cwd)`). */
export interface SessionStarter {
  /** Open the session (`session/new` with `cwd`) and wrap it. */
  start(): Promise<LoopySession>;
}

/**
 * Build a session bound to `cwd` (a worktree). Call {@link SessionStarter.start}
 * to actually open it — mirrors the SDK's `ctx.buildSession(cwd).start()` while
 * layering the turn buffer, reopen-on-clear, and stop-reason mechanics on top.
 */
export function buildSession(deps: SessionDeps, cwd: string): SessionStarter {
  return {
    async start(): Promise<LoopySession> {
      const active = await deps.ctx.buildSession(cwd).start();
      return new SessionWrapper(deps, active, cwd);
    },
  };
}

// ---------------------------------------------------------------------------
// Session pool — keyed by worktree (parallel-ready)
// ---------------------------------------------------------------------------

/**
 * A pool of {@link LoopySession}s keyed by worktree path. Since ACP `cwd` is
 * immutable per session, one worktree maps to exactly one session; the pool
 * de-dupes concurrent opens and owns teardown. v1 runs `concurrency: 1`, but the
 * keying is parallel-ready.
 */
export interface AgentSessionPool {
  /** Get (or open, once) the session bound to `cwd`. */
  session(cwd: string): Promise<LoopySession>;
  /** The already-open session for `cwd`, if any (no side effects). */
  peek(cwd: string): LoopySession | undefined;
  /** Dispose and forget the session for `cwd`. */
  close(cwd: string): void;
  /** Dispose every session (teardown at run end). */
  closeAll(): void;
  /** Number of distinct worktrees with a live/opening session. */
  readonly size: number;
}

/** Build an {@link AgentSessionPool} over one agent connection. */
export function createSessionPool(deps: SessionDeps): AgentSessionPool {
  // `opening` de-dupes concurrent opens; `open` holds resolved sessions for
  // synchronous `peek`/`close`.
  const opening = new Map<string, Promise<LoopySession>>();
  const open = new Map<string, LoopySession>();

  return {
    session(cwd: string): Promise<LoopySession> {
      const inFlight = opening.get(cwd);
      if (inFlight) return inFlight;

      const started = buildSession(deps, cwd)
        .start()
        .then((session) => {
          open.set(cwd, session);
          return session;
        });
      // On failure, forget the slot so a later call can retry.
      started.catch(() => {
        if (opening.get(cwd) === started) opening.delete(cwd);
      });
      opening.set(cwd, started);
      return started;
    },

    peek(cwd: string): LoopySession | undefined {
      return open.get(cwd);
    },

    close(cwd: string): void {
      open.get(cwd)?.dispose();
      open.delete(cwd);
      opening.delete(cwd);
    },

    closeAll(): void {
      for (const session of open.values()) session.dispose();
      open.clear();
      opening.clear();
    },

    get size(): number {
      return opening.size;
    },
  };
}
