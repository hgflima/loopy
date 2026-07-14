/**
 * SPIKE — o **effort do OpenCode é derivado do Model** (variants).
 *
 * Pergunta: a GUI diz "este agente não anuncia effort" para o OpenCode. Verdade?
 * O binário (1.17.9) constrói os `configOptions` assim:
 *
 *   function effortOption(e) {
 *     if (e.variants.length === 0) return;        // ← nenhum config option de effort
 *     return { id: "effort", category: "thought_level", type: "select",
 *              options: e.variants.map(...) };
 *   }
 *
 * `variants` são as variantes do **modelo corrente**. Ou seja, ao contrário de
 * Claude/Codex (que anunciam `thought_level` estaticamente no `session/new`), o
 * OpenCode só anuncia effort **quando o model corrente tem variants** — e a lista
 * de efforts **muda com o model**.
 *
 * O que esta spike prova: depois de `session/set_config_option { configId: "model" }`,
 * o response traz `configOptions` **novos**, que podem agora conter o `effort`.
 *
 * Rodar:
 *   npx tsx spikes/acp-opencode-effort.ts
 *   MODELS='zai-coding-plan/glm-5.2,anthropic/claude-sonnet-4-5' npx tsx spikes/acp-opencode-effort.ts
 */
import { probeAgent } from "./_acp-probe.ts";

interface ConfigOption {
  readonly id: string;
  readonly category?: string;
  readonly currentValue?: unknown;
  readonly options?: readonly { value: string }[];
}
interface SetResponse {
  readonly configOptions?: readonly ConfigOption[];
}

/** Resumo de um snapshot de configOptions: o que há de effort ali. */
function effortOf(cfg: readonly ConfigOption[] | undefined): {
  announced: boolean;
  configId?: string;
  current?: unknown;
  values: string[];
} {
  const o = cfg?.find((c) => c.category === "thought_level");
  return {
    announced: o !== undefined,
    configId: o?.id,
    current: o?.currentValue,
    values: (o?.options ?? []).map((v) => v.value),
  };
}

const MODELS = (
  process.env["MODELS"] ??
  "zai-coding-plan/glm-5.2,anthropic/claude-sonnet-4-5,openai/gpt-5"
)
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

await probeAgent({
  defaultCommand: ["opencode", "acp"],
  outFile: "acp-opencode-effort.out.json",
  quiet: true,
  extraProbe: async ({ ctx, sessionId, session }) => {
    const atNew = effortOf(session.configOptions as ConfigOption[] | undefined);
    const modelNew = (session.configOptions ?? []).find(
      (o) => o.category === "model",
    )?.currentValue;

    console.log(`\n=== session/new (model default: ${String(modelNew)}) ===`);
    console.log(`  effort anunciado? ${atNew.announced}  ${JSON.stringify(atNew)}`);

    const perModel: Record<string, unknown> = {};
    for (const model of MODELS) {
      console.log(`\n=== set_config_option { model: '${model}' } ===`);
      try {
        const res = (await ctx.request("session/set_config_option", {
          sessionId,
          configId: "model",
          value: model,
        })) as SetResponse;
        const e = effortOf(res.configOptions);
        console.log(
          `  effort anunciado? ${e.announced}` +
            (e.announced
              ? `  configId='${e.configId}'  current=${String(e.current)}  values=[${e.values.join(", ")}]`
              : "  (modelo sem variants)"),
        );
        perModel[model] = { ok: true, effort: e };

        // Se anunciou, o set do effort é aceito? (é o que o motor faria)
        if (e.announced && e.values.length > 0) {
          const target = e.values.at(-1)!;
          try {
            const r2 = (await ctx.request("session/set_config_option", {
              sessionId,
              configId: e.configId,
              value: target,
            })) as SetResponse;
            const after = effortOf(r2.configOptions);
            console.log(
              `  set_config_option { ${e.configId}: '${target}' } → ok, current=${String(after.current)}`,
            );
            perModel[model] = {
              ok: true,
              effort: e,
              setEffort: { value: target, ok: true, after: after.current },
            };
          } catch (err) {
            const x = err as { code?: number; message?: string };
            console.log(`  set_config_option(effort) → ERRO ${x.code}: ${x.message}`);
            perModel[model] = {
              ok: true,
              effort: e,
              setEffort: { value: target, ok: false, error: x.message },
            };
          }
        }
      } catch (err) {
        const x = err as { code?: number; message?: string };
        console.log(`  ✘ set model → erro ${x.code ?? "?"}: ${x.message ?? err}`);
        perModel[model] = { ok: false, error: x.message };
      }
    }

    return { atSessionNew: { model: modelNew, effort: atNew }, perModel };
  },
});
