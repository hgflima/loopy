/**
 * A forma-fonte de um Agente no yml, e como se chega ao argv dela.
 *
 * `preset` e `command` são as duas maneiras de dizer a mesma coisa e são
 * exclusivas (o schema do motor recusa as duas juntas, e recusa nenhuma). O
 * `preset` empresta o argv do Catálogo de Agentes; o `command` o declara na mão.
 *
 * Espelha `AgentDefSource` (`src/types.ts`). Existe separado do `ConfigPane`
 * porque o `StepEditor` também precisa resolver o argv — e componente não é
 * lugar de lógica (AD-6).
 */

import { findAgentPreset } from "loopy/config";

/** Um agente como ele mora no `loopy.yml`. */
export interface AgentSource {
  preset?: string;
  command?: string[];
  env?: Record<string, string>;
  model?: string;
  effort?: string;
  display_name?: string;
}

/** Valor do select de preset quando o agente declara o argv na mão. */
export const CUSTOM_PRESET = "__custom__";

/**
 * O argv efetivo de um agente — `preset` resolvido pelo Catálogo, ou o `command`
 * literal. É a **chave do cache de capabilities** (keyed por argv, não por
 * nome), então precisa bater exatamente com o que `resolveAgents` produz no
 * motor. `undefined` quando o agente não tem argv resolvível (preset
 * desconhecido, ou nenhum dos dois campos) — o schema já reprova isso, mas o
 * editor vê o yml **antes** de ele ficar válido.
 */
export function agentCommandOf(agent: AgentSource | undefined): readonly string[] | undefined {
  if (!agent) return undefined;
  if (agent.preset !== undefined) return findAgentPreset(agent.preset)?.command;
  return agent.command;
}
