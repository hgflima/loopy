/**
 * Frases que explicam uma sondagem ao operador — puras, compartilhadas pelo
 * `ConfigPane` (registry de agentes) e pelo `StepEditor` (override por Step).
 *
 * Existem porque **capabilities não são necessariamente estáticas**: no OpenCode
 * os níveis de effort são as *variants do model corrente* — `[high, max]` no
 * `zai-coding-plan/glm-5.2`, `[minimal…high]` no `openai/gpt-5`, nenhum num model
 * sem variants. Claude e Codex anunciam `thought_level` fixo no `session/new`.
 * Dizer "este agente não anuncia effort" no OpenCode era falso, e escondia um
 * ajuste que funciona.
 */

/** O recorte de `AgentCapabilities` que estas frases consomem. */
export interface CapsSummary {
  readonly modes: readonly string[];
  readonly models: readonly string[];
  readonly efforts: readonly string[];
}

/** Resumo inline da sondagem: `modes: … · N models · effort: …`. */
export function probeSummary(
  caps: CapsSummary,
  model: string | undefined,
): string {
  const parts: string[] = [];
  if (caps.modes.length > 0) parts.push(`modes: ${caps.modes.join(", ")}`);
  if (caps.models.length > 0) parts.push(`${caps.models.length} models`);
  parts.push(
    caps.efforts.length > 0
      ? `effort: ${caps.efforts.join(", ")}`
      : model
        ? "sem effort neste model"
        : "sem effort",
  );
  return parts.join(" · ");
}

/**
 * Hint do campo `effort` **habilitado**. Diz sob qual model os níveis foram
 * anunciados — no OpenCode eles *são* as variants desse model, então trocá-lo
 * troca (ou apaga) a lista.
 */
export function effortHint(model: string | undefined): string {
  return model
    ? `Níveis anunciados com o model '${model}' — trocar o model pode mudá-los`
    : "Reasoning effort (best-effort)";
}

/**
 * Por que o select de effort está desabilitado. São **três** motivos distintos,
 * e tratá-los como um só é o que produzia a mensagem falsa:
 *
 *  1. o agente oferece models mas nenhum foi escolhido — o effort *depende* dele;
 *  2. o model escolhido não tem níveis de effort;
 *  3. o agente realmente não anuncia effort algum.
 */
export function effortDisabledReason(
  caps: CapsSummary,
  model: string | undefined,
): string {
  if (caps.models.length > 0 && !model) {
    return "Escolha um model: neste agente o effort depende dele";
  }
  if (model) {
    return `O model '${model}' não oferece níveis de effort`;
  }
  return "Este agente não anuncia effort";
}
