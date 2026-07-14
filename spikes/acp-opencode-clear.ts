/**
 * SPIKE — o **`clear()`** do motor contra o **OpenCode**, mais o caminho completo
 * de um turno (`prompt` → `stopReason` → texto → `usage`).
 *
 * ⚠️ Ao contrário de `acp-opencode-capabilities.ts`, esta spike **consome turnos**
 * (2 prompts curtos). Roda em `mode: plan` — "disallows all edit tools" no
 * OpenCode —, então o agente **não escreve** neste repo.
 *
 * A pergunta: o `clear()` de `src/acp/session.ts` **não** manda o texto `/clear`
 * como prompt — ele **reabre a sessão** (`active.dispose()` + `session/new` no
 * mesmo cwd) e re-aplica mode/model/effort, porque `session/new` volta aos
 * defaults. Isso é mecânica pura de ACP, sem slash command: a ressalva da doc do
 * OpenCode ("some built-in slash commands like `/undo`/`/redo` are unsupported")
 * é irrelevante aqui. Mas *irrelevante em teoria* não é prova — se o OpenCode
 * persistisse contexto entre sessões do mesmo cwd (ele anuncia
 * `loadSession`/`resume`), o reopen limparia o `sessionId` sem limpar a memória,
 * e um Step de audit herdaria o contexto do Step de build.
 *
 * O teste: planta um segredo no turno 1 → reabre a sessão → pergunta o segredo no
 * turno 2. Se a resposta contiver o segredo, o reopen **não** limpa o contexto.
 *
 * Rodar:
 *   npx tsx spikes/acp-opencode-clear.ts
 *
 * Auth: `opencode auth login` (o turno bate no provider de verdade).
 */
import type { ActiveSession, ClientContext } from "@agentclientprotocol/sdk";
import { probeAgent } from "./_acp-probe.ts";

/** Segredo plantado no turno 1; procurado no turno 2. */
const SECRET = "ABACAXI-7731";
const MODE = "plan";

/** Um turno completo: prompt → stopReason + texto (espelha `runTurn` do motor). */
async function turn(
  active: ActiveSession,
  label: string,
  text: string,
): Promise<{ label: string; stopReason: string; reply: string }> {
  const [response, reply] = await Promise.all([
    active.prompt(text),
    active.readText(),
  ]);
  const stopReason = String(response.stopReason);
  console.log(`\n  [${label}] stopReason=${stopReason}`);
  console.log(`  [${label}] resposta: ${reply.trim().slice(0, 200)}`);
  return { label, stopReason, reply };
}

await probeAgent({
  defaultCommand: ["opencode", "acp"],
  outFile: "acp-opencode-clear.out.json",
  quiet: true,
  timeoutMs: 180_000,
  extraProbe: async ({ ctx, active, sessionId }) => {
    const setMode = async (s: ActiveSession): Promise<void> => {
      await ctx.request("session/set_mode", {
        sessionId: s.sessionId,
        modeId: MODE,
      });
    };

    console.log(
      `--- SONDA: clear() (reopen) contra o OpenCode [mode=${MODE}] ---`,
    );
    await setMode(active);

    const planted = await turn(
      active,
      "turno 1 · planta",
      `Guarde este código para depois: ${SECRET}. ` +
        `Não use nenhuma ferramenta. Responda apenas: OK.`,
    );

    // O que o `clear()` do motor faz: dispose + session/new no MESMO cwd, e
    // re-aplica o mode (session/new volta ao default `build`).
    const oldSessionId = sessionId;
    active.dispose();
    const reopened: ActiveSession = await (ctx as ClientContext)
      .buildSession(process.cwd())
      .start();
    await setMode(reopened);
    const changed = reopened.sessionId !== oldSessionId;
    console.log(
      `\n  reopen: ${oldSessionId} → ${reopened.sessionId}  (sessionId mudou: ${changed})`,
    );

    const asked = await turn(
      reopened,
      "turno 2 · pergunta",
      `Qual é o código que eu te dei antes? ` +
        `Se você não sabe, responda EXATAMENTE: NAO_SEI. Não use ferramentas.`,
    );

    const leaked = asked.reply.includes(SECRET);
    console.log(
      `\n  VEREDITO: ${leaked ? "❌ contexto VAZOU pelo reopen" : "✔ contexto limpo — clear() funciona"}`,
    );
    reopened.dispose();

    return {
      mode: MODE,
      secret: SECRET,
      oldSessionId,
      newSessionId: reopened.sessionId,
      sessionIdChanged: changed,
      contextLeaked: leaked,
      turns: [planted, asked],
    };
  },
});
