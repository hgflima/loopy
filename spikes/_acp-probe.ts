/**
 * Helper compartilhado das spikes de capacidade ACP (prefixo `_` = **não** é um
 * entrypoint executável). Toda a plumbing é genérica de ACP — não conhece Codex,
 * Claude nem OpenCode —, então as spikes concretas (`acp-<agente>-capabilities.ts`)
 * são wrappers finos que só trocam o comando de spawn default, o nome do artefato
 * e, opcionalmente, uma sonda específica do adapter ({@link ProbeOptions.extraProbe}).
 *
 * O que a sonda faz (read-only, nenhum prompt, nenhum turno consumido):
 * spawn stdio → `ndJsonStream` → `client().connectWith` → `initialize` →
 * `buildSession(cwd).start()` → lê `newSessionResponse` → imprime e salva JSON.
 * O handshake espelha `src/acp/agent.ts` (autocontido, sem internals do motor).
 * O callback do `connectWith` fecha a conexão ao resolver, então todo o trabalho
 * mora dentro dele.
 *
 * O mapa do protocolo que as spikes provam (idêntico para qualquer adapter ACP):
 *   - **modes**   → `newSessionResponse.modes.availableModes[].id` (vocabulário
 *                   de `session/set_mode`, POR-Agente).
 *   - **models**  → `newSessionResponse.configOptions[category="model"]`.
 *   - **efforts** → `newSessionResponse.configOptions[category="thought_level"]`.
 *   (aplicados via `session/set_config_option { configId, value }`.)
 */
import { spawn } from "node:child_process";
import { writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { Readable, Writable } from "node:stream";
import { fileURLToPath } from "node:url";
import {
  AGENT_METHODS,
  PROTOCOL_VERSION,
  client,
  ndJsonStream,
} from "@agentclientprotocol/sdk";
import type {
  ActiveSession,
  ClientCapabilities,
  ClientContext,
  InitializeRequest,
  InitializeResponse,
  NewSessionResponse,
  SessionConfigOption,
  SessionConfigSelectGroup,
  SessionConfigSelectOption,
} from "@agentclientprotocol/sdk";

/** Capabilities anunciadas no `initialize` (mesmas de `src/acp/agent.ts`). */
export const CLIENT_CAPABILITIES: ClientCapabilities = {
  fs: { readTextFile: true, writeTextFile: true },
  terminal: true,
};

/** Aborta se o adapter não responder (ex.: auth faltando trava o `session/new`). */
const HARD_TIMEOUT_MS = 60_000;

// ---------------------------------------------------------------------------
// Formatação (pura, genérica ACP)
// ---------------------------------------------------------------------------

const bar = (title: string): string => `\n=== ${title} ===`;
const sub = (title: string): string => `\n--- ${title} ---`;

/** `true` quando a lista de opções de um select vem agrupada. */
function isGroupList(
  options: SessionConfigSelectOption[] | SessionConfigSelectGroup[],
): options is SessionConfigSelectGroup[] {
  return options.length > 0 && "group" in options[0]!;
}

/** Achata select flat-ou-agrupado numa lista única de opções. */
function flattenOptions(
  options: SessionConfigSelectOption[] | SessionConfigSelectGroup[],
): SessionConfigSelectOption[] {
  return isGroupList(options) ? options.flatMap((g) => g.options) : options;
}

/** Uma linha de opção: `• <value> (<name>) — <desc>  ← current`. */
function optionLine(o: SessionConfigSelectOption, current: string): string {
  const flag = o.value === current ? "  ← current" : "";
  const desc = o.description ? ` — ${o.description}` : "";
  const label = o.name && o.name !== o.value ? ` (${o.name})` : "";
  return `    • ${o.value}${label}${desc}${flag}`;
}

/** Bloco humano de uma config option (select ou boolean). */
function renderConfigOption(opt: SessionConfigOption): string {
  const head = `[${opt.category ?? "?"}] id=${opt.id}  name="${opt.name}"`;
  if (opt.type === "boolean") {
    return `${head}\n    current=${opt.currentValue} (toggle boolean)`;
  }
  const values = flattenOptions(opt.options);
  const lines = values.map((o) => optionLine(o, opt.currentValue)).join("\n");
  return `${head}  current=${opt.currentValue}\n${lines}`;
}

/** Relatório humano completo a partir do `initialize` + `session/new`. */
function report(init: InitializeResponse, sess: NewSessionResponse): string {
  const out: string[] = [];

  out.push(bar("INITIALIZE"));
  out.push(
    `agent:            ${init.agentInfo?.name ?? "(sem agentInfo)"} ${init.agentInfo?.version ?? ""}`.trimEnd(),
  );
  out.push(`protocolVersion:  ${init.protocolVersion}`);
  out.push(`authMethods:      ${JSON.stringify(init.authMethods ?? [])}`);
  out.push(
    `agentCapabilities:${JSON.stringify(init.agentCapabilities ?? {}, null, 2)}`,
  );

  out.push(bar("SESSION (session/new)"));
  out.push(`sessionId: ${sess.sessionId}`);

  // MODES — vocabulário de session/set_mode (por-Agente).
  out.push(sub("MODES  (session/set_mode)"));
  const modes = sess.modes;
  if (!modes || modes.availableModes.length === 0) {
    out.push("  (nenhum mode anunciado)");
  } else {
    out.push(`  current: ${modes.currentModeId}`);
    for (const m of modes.availableModes) {
      const flag = m.id === modes.currentModeId ? "  ← current" : "";
      const desc = m.description ? ` — ${m.description}` : "";
      out.push(`    • ${m.id} ("${m.name}")${desc}${flag}`);
    }
  }

  // CONFIG OPTIONS — models (category model) + efforts (thought_level) + resto.
  const cfg = sess.configOptions ?? [];
  out.push(sub("CONFIG OPTIONS  (session/set_config_option)"));
  if (cfg.length === 0) {
    out.push("  (nenhuma config option anunciada)");
  } else {
    const byCat = (cat: string): SessionConfigOption[] =>
      cfg.filter((o) => o.category === cat);
    const known = new Set(["model", "thought_level"]);
    const other = cfg.filter((o) => !known.has(o.category ?? ""));

    out.push("\n  # MODELS (category: model)");
    const models = byCat("model");
    out.push(
      models.length
        ? models.map(renderConfigOption).join("\n\n")
        : "  (nenhum)",
    );

    out.push("\n  # EFFORTS (category: thought_level)");
    const efforts = byCat("thought_level");
    out.push(
      efforts.length
        ? efforts.map(renderConfigOption).join("\n\n")
        : "  (nenhum)",
    );

    if (other.length > 0) {
      out.push("\n  # OUTRAS config options");
      out.push(other.map(renderConfigOption).join("\n\n"));
    }
  }

  return out.join("\n");
}

// ---------------------------------------------------------------------------
// Probe
// ---------------------------------------------------------------------------

/** Sonda extra, rodada dentro da sessão viva (antes do `dispose`). */
export interface ExtraProbeArgs {
  /**
   * Contexto vivo do cliente: `request(method, params)` cru para exercitar
   * qualquer método ACP, e `buildSession(cwd)` para reabrir sessão (é o que o
   * `clear()` do motor faz — `dispose()` + `session/new`).
   */
  readonly ctx: ClientContext;
  /** A sessão aberta pela sonda (tem `prompt()`/`readText()`/`dispose()`). */
  readonly active: ActiveSession;
  readonly sessionId: string;
  readonly session: NewSessionResponse;
}

/** Opções de uma spike concreta. */
export interface ProbeOptions {
  /** Comando de spawn default; sobreponível por `process.argv.slice(2)`. */
  readonly defaultCommand: readonly string[];
  /** Basename do artefato JSON escrito ao lado (em `spikes/`). */
  readonly outFile: string;
  /**
   * Sonda opcional específica do adapter, rodada na sessão viva depois do
   * `session/new`. Use para exercitar o que a sonda genérica não cobre (ex.:
   * `session/set_mode` vs. `session/set_config_option`, ou o ciclo de reopen do
   * `clear()`). O retorno entra no artefato JSON sob `extra`. **Se a sonda mandar
   * `prompt()`, ela consome turnos** — diga isso no docstring da spike.
   */
  readonly extraProbe?: (args: ExtraProbeArgs) => Promise<unknown>;
  /** Suprime o relatório de capacidades (útil quando o foco é o `extraProbe`). */
  readonly quiet?: boolean;
  /** Teto de tempo total (default {@link HARD_TIMEOUT_MS}); suba se houver prompts. */
  readonly timeoutMs?: number;
}

/**
 * Sonda um adapter ACP e imprime models/modes/efforts. Resolve o comando de
 * `process.argv.slice(2)` (override) ou de `defaultCommand`. Sai com código != 0
 * em falha de spawn ou timeout.
 */
export async function probeAgent(opts: ProbeOptions): Promise<void> {
  const argv = process.argv.slice(2);
  const command = argv.length > 0 ? argv : [...opts.defaultCommand];
  const file = command[0]!;
  console.error(`[spike] spawn: ${command.join(" ")}`);

  const child = spawn(file, command.slice(1), {
    env: process.env,
    stdio: ["pipe", "pipe", "pipe"],
  });
  child.stderr?.setEncoding("utf8");
  child.stderr?.on("data", (c: string) =>
    process.stderr.write(`[${file}] ${c}`),
  );
  child.once("error", (e) => {
    console.error(`[spike] falha ao spawnar '${file}':`, e);
    process.exit(1);
  });

  if (!child.stdin || !child.stdout) {
    child.kill();
    throw new Error("stdin/stdout do processo ACP indisponíveis.");
  }

  const stream = ndJsonStream(
    Writable.toWeb(child.stdin) as WritableStream<Uint8Array>,
    Readable.toWeb(child.stdout) as ReadableStream<Uint8Array>,
  );

  const app = client({ name: "loopy-spike" });

  const timeoutMs = opts.timeoutMs ?? HARD_TIMEOUT_MS;
  const timer = setTimeout(() => {
    console.error(
      `[spike] timeout ${timeoutMs}ms — adapter não respondeu (auth?).`,
    );
    child.kill();
    process.exit(2);
  }, timeoutMs);

  const captured = await app.connectWith(stream, async (ctx) => {
    const init = await ctx.request<InitializeResponse, InitializeRequest>(
      AGENT_METHODS.initialize,
      {
        protocolVersion: PROTOCOL_VERSION,
        clientCapabilities: CLIENT_CAPABILITIES,
        clientInfo: { name: "loopy-spike", version: "0.0.0" },
      },
    );

    const active = await ctx.buildSession(process.cwd()).start();
    const sess = active.newSessionResponse;
    const extra = opts.extraProbe
      ? await opts.extraProbe({
          ctx,
          active,
          sessionId: active.sessionId,
          session: sess,
        })
      : undefined;
    // Uma sonda de reopen já dispôs esta sessão — dispor de novo é inofensivo,
    // mas não pode derrubar a spike.
    try {
      active.dispose();
    } catch {
      /* já disposta pelo extraProbe */
    }
    return { init, sess, extra };
  });

  clearTimeout(timer);
  child.kill();

  if (!opts.quiet) console.log(report(captured.init, captured.sess));

  // Artefato cru para inspeção/diff futuro (gitignored).
  const here = dirname(fileURLToPath(import.meta.url));
  const outPath = join(here, opts.outFile);
  await writeFile(
    outPath,
    JSON.stringify(
      {
        command,
        initialize: captured.init,
        session: captured.sess,
        extra: captured.extra,
      },
      null,
      2,
    ),
  );
  console.error(`\n[spike] JSON cru salvo em: ${outPath}`);
}
