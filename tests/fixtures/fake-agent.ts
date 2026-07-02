/**
 * Scenario-driven fake ACP agent (OQ5) — a lean subprocess stub that speaks the
 * real JSON-RPC ndjson protocol over stdio, so `acp/agent.ts` + `acp/client.ts`
 * can be exercised end-to-end (spawn → initialize → session → permission →
 * update → stop) without depending on the real Claude agent.
 *
 * It is **scriptable, not record/replay**: a per-test scenario (passed as
 * `argv[2]`, JSON) declares the `agentInfo`, the session modes, and, per prompt
 * turn, the text chunks to stream, an optional permission request (whose chosen
 * `optionId` is echoed back as a text chunk so the client's kind-based decision
 * is observable), optional fs writes, and the `stopReason` to return.
 *
 * Run as a script (`node --import tsx tests/fixtures/fake-agent.ts <scenario>`).
 * It writes ONLY JSON-RPC frames to stdout (the ndjson transport); any debug
 * goes to stderr.
 */
import { Readable, Writable } from "node:stream";
import {
  AGENT_METHODS,
  CLIENT_METHODS,
  PROTOCOL_VERSION,
  agent,
  ndJsonStream,
} from "@agentclientprotocol/sdk";
import type {
  PermissionOption,
  SessionModeState,
  StopReason,
} from "@agentclientprotocol/sdk";

/** One prompt turn's scripted behavior. */
export interface FakeTurn {
  /** Text chunks streamed as `agent_message_chunk` updates, in order. */
  readonly text?: readonly string[];
  /** Request a permission mid-turn; the chosen `optionId` is echoed as text. */
  readonly permission?: {
    readonly options: readonly PermissionOption[];
    /** Echo `permission=<optionId>` as a text chunk (default `true`). */
    readonly echo?: boolean;
  };
  /** Write a file mid-turn to exercise the `fs/write_text_file` handler. */
  readonly write?: { readonly path: string; readonly content: string };
  /** Stop reason returned by `session/prompt` (default `"end_turn"`). */
  readonly stopReason?: StopReason;
}

/** The full test scenario handed to the fake agent. */
export interface FakeScenario {
  readonly agentInfo?: { readonly name: string; readonly version: string };
  readonly protocolVersion?: number;
  readonly modes?: SessionModeState;
  /** Behavior per prompt turn (0-based); turns past the end use `defaultTurn`. */
  readonly turns?: readonly FakeTurn[];
  readonly defaultTurn?: FakeTurn;
}

const DEFAULT_TURN: FakeTurn = { text: ["ok"], stopReason: "end_turn" };

function parseScenario(): FakeScenario {
  const raw = process.argv[2];
  if (!raw) return {};
  try {
    return JSON.parse(raw) as FakeScenario;
  } catch (error) {
    process.stderr.write(`fake-agent: bad scenario JSON: ${String(error)}\n`);
    return {};
  }
}

async function main(): Promise<void> {
  const scenario = parseScenario();
  const agentInfo = scenario.agentInfo ?? {
    name: "fake-agent",
    version: "9.9.9",
  };
  let promptTurn = 0;
  let sessionSeq = 0;

  const app = agent({ name: "fake-agent" })
    .onRequest(AGENT_METHODS.initialize, () => ({
      protocolVersion: scenario.protocolVersion ?? PROTOCOL_VERSION,
      agentCapabilities: {},
      agentInfo,
    }))
    .onRequest(AGENT_METHODS.session_new, () => {
      sessionSeq += 1;
      const response: { sessionId: string; modes?: SessionModeState } = {
        sessionId: `fake-session-${sessionSeq}`,
      };
      if (scenario.modes) response.modes = scenario.modes;
      return response;
    })
    .onRequest(AGENT_METHODS.session_set_mode, () => ({}))
    .onRequest(AGENT_METHODS.session_prompt, async ({ params, client }) => {
      const turn =
        scenario.turns?.[promptTurn] ?? scenario.defaultTurn ?? DEFAULT_TURN;
      promptTurn += 1;
      const sessionId = params.sessionId;

      const emitText = (text: string): Promise<void> =>
        client.notify(CLIENT_METHODS.session_update, {
          sessionId,
          update: {
            sessionUpdate: "agent_message_chunk",
            content: { type: "text", text },
          },
        });

      for (const chunk of turn.text ?? []) await emitText(chunk);

      if (turn.write) {
        await client.request(CLIENT_METHODS.fs_write_text_file, {
          sessionId,
          path: turn.write.path,
          content: turn.write.content,
        });
      }

      if (turn.permission) {
        const res = await client.request(
          CLIENT_METHODS.session_request_permission,
          {
            sessionId,
            toolCall: { toolCallId: "fake-call-1" },
            options: [...turn.permission.options],
          },
        );
        const optionId =
          res.outcome.outcome === "selected"
            ? res.outcome.optionId
            : "cancelled";
        if (turn.permission.echo !== false)
          await emitText(`permission=${optionId}`);
      }

      return { stopReason: turn.stopReason ?? "end_turn" };
    })
    .onNotification(AGENT_METHODS.session_cancel, () => {
      // No-op: exercised by the session layer (T-012), harmless here.
    });

  const stream = ndJsonStream(
    Writable.toWeb(process.stdout) as WritableStream<Uint8Array>,
    Readable.toWeb(process.stdin) as ReadableStream<Uint8Array>,
  );
  const connection = app.connect(stream);
  await connection.closed;
}

main().catch((error) => {
  process.stderr.write(`fake-agent: fatal: ${String(error)}\n`);
  process.exit(1);
});
