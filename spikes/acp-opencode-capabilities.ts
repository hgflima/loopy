/**
 * SPIKE — capacidades ACP do **OpenCode**: lista models, modes e efforts que o
 * `opencode acp` anuncia no `session/new`, e sonda **como se aplica o mode**.
 *
 * A mecânica genérica mora em {@link probeAgent} (`_acp-probe.ts`); aqui fixamos
 * o comando de spawn do OpenCode e uma sonda extra. Read-only: nenhum prompt,
 * nenhum turno consumido (`set_mode`/`set_config_option` não geram turno).
 *
 * Diferente de Codex/Claude, o ACP do OpenCode **não** é um adapter npm separado:
 * é um subcomando do próprio binário (`opencode acp`, JSON-RPC sobre stdio —
 * https://open-code.ai/en/docs/acp).
 *
 * A pergunta que a sonda extra responde: o OpenCode **não** anuncia
 * `modes.availableModes` (o campo `modes` vem `null`), mas anuncia uma config
 * option `[mode] id=mode` com `build`/`plan`. O motor (`src/acp/session.ts`)
 * aplica mode via `session/set_mode` e **fail-hard** no erro. Então: `set_mode`
 * funciona mesmo sem `modes` anunciado, ou o mode só entra por
 * `session/set_config_option { configId: "mode" }`?
 *
 * Rodar:
 *   npx tsx spikes/acp-opencode-capabilities.ts
 *   npx tsx spikes/acp-opencode-capabilities.ts /caminho/opencode acp   # binário custom (argv)
 *
 * Auth: a mesma do CLI (`opencode auth login`) — a spike não injeta env key.
 */
import { probeAgent } from "./_acp-probe.ts";

/** Executa uma chamada e captura a falha como valor (queremos ver o erro cru). */
async function attempt(
  label: string,
  call: () => Promise<unknown>,
): Promise<Record<string, unknown>> {
  try {
    const result = await call();
    console.log(`  ✔ ${label} → ok  ${JSON.stringify(result)}`);
    return { label, ok: true, result };
  } catch (e) {
    const err = e as { code?: number; message?: string };
    console.log(`  ✘ ${label} → erro ${err.code ?? "?"}: ${err.message ?? e}`);
    return {
      label,
      ok: false,
      error: { code: err.code, message: err.message },
    };
  }
}

await probeAgent({
  defaultCommand: ["opencode", "acp"],
  outFile: "acp-opencode-capabilities.out.json",
  extraProbe: async ({ ctx, sessionId, session }) => {
    // O `set_config_option` do OpenCode devolve a lista inteira de config options,
    // então uma escrita idempotente do MODEL serve de "leitura" do mode corrente.
    const currentModel = (session.configOptions ?? []).find(
      (o) => o.category === "model",
    )?.currentValue as string;

    const readMode = async (): Promise<string> => {
      const res = (await ctx.request("session/set_config_option", {
        sessionId,
        configId: "model",
        value: currentModel,
      })) as { configOptions?: { id: string; currentValue?: unknown }[] };
      return String(
        res.configOptions?.find((o) => o.id === "mode")?.currentValue,
      );
    };

    console.log("\n--- SONDA: como se aplica o mode? ---");
    const before = await readMode();
    console.log(`  mode antes: ${before}`);

    // 1) `session/set_mode` é o caminho que o motor usa hoje. Aceita? APLICA?
    const setMode = await attempt("session/set_mode { modeId: 'plan' }", () =>
      ctx.request("session/set_mode", { sessionId, modeId: "plan" }),
    );
    const afterSetMode = await readMode();
    console.log(`  mode depois do set_mode('plan'): ${afterSetMode}`);

    // 2) Um modeId lixo: se também for aceito, `set_mode` não valida nada — e um
    //    mode errado passaria silencioso (o motor acharia estar em read-only).
    const setModeGarbage = await attempt(
      "session/set_mode { modeId: 'xpto-invalido' }",
      () =>
        ctx.request("session/set_mode", { sessionId, modeId: "xpto-invalido" }),
    );
    const afterGarbage = await readMode();
    console.log(`  mode depois do set_mode('xpto-invalido'): ${afterGarbage}`);

    // 3) O caminho da config option (o que a UI do OpenCode usa).
    const setConfigOption = await attempt(
      "session/set_config_option { configId: 'mode', value: 'plan' }",
      () =>
        ctx.request("session/set_config_option", {
          sessionId,
          configId: "mode",
          value: "plan",
        }),
    );
    const afterConfig = await readMode();
    console.log(`  mode depois do set_config_option('plan'): ${afterConfig}`);

    return {
      before,
      setMode: { ...setMode, modeAfter: afterSetMode },
      setModeGarbage: { ...setModeGarbage, modeAfter: afterGarbage },
      setConfigOption: { ...setConfigOption, modeAfter: afterConfig },
    };
  },
});
