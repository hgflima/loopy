/**
 * Catálogo de Agentes — o argv de cada adapter ACP conhecido, num lugar só.
 *
 * **Por que existe.** O argv de um adapter não é preferência do operador: é
 * conhecimento do projeto. O Claude precisa de um pin de versão (a `0.26` não
 * anunciava `effort`; a `0.59` anuncia), o Codex é um pacote npm com outro
 * nome, e o OpenCode **não é npm** — é um subcomando do binário. Errar qualquer
 * um desses três detalhes dá um processo que não sobe. Fazer o operador digitar
 * `npx -y @agentclientprotocol/…` é pedir que ele adivinhe o que o código já
 * sabe.
 *
 * **O que este módulo NÃO é (AD-1).** Não é allowlist e não é comportamento. O
 * Registry de Agentes continua de chave livre: `command:` explícito segue
 * válido, e um Agente fora do catálogo roda igual. O motor não tem — e não pode
 * ganhar — nenhum `if (agent === 'claude')`. Um `preset` resolve para argv em
 * `resolveAgents` (`../config/parse.ts`) e **acaba ali**: da resolução em
 * diante, todo consumidor (pool, dry-run, `probe-agent`) só vê `command`.
 *
 * **Fronteira com o ADR-0008.** O ADR proíbe tabela hardcoded de
 * **capabilities** (mode/model/effort) — e continua valendo: nada aqui declara
 * mode, model ou effort. Esses três seguem vindo da **Sondagem**, do adapter
 * vivo, porque mudam por versão. Este catálogo carrega só o que *não* dá para
 * descobrir sem antes ter subido o processo: como subir o processo.
 *
 * **Browser-safe por contrato**: puro, sem `node:`. É reexportado por
 * `../config/index.ts` (o barrel `@hgflima/loopy/config`), e a GUI o consome
 * para montar o select de preset.
 */

/** Um adapter ACP conhecido: o `id` que vai no yml, o rótulo da GUI e o argv. */
export interface AgentPreset {
  /** Valor de `agents.<nome>.preset` no yml. Estável — é contrato do arquivo. */
  readonly id: string;
  /** Rótulo exibido na GUI. */
  readonly label: string;
  /** O argv do adapter, incluindo o pin de versão quando ele importa. */
  readonly command: readonly string[];
  /** Por que este argv é assim — aparece como hint na GUI. */
  readonly note: string;
}

/**
 * Os adapters conhecidos. Ordem = ordem do select na GUI.
 *
 * Ao adicionar um: rode `loopy probe-agent` contra ele antes de commitar — se o
 * argv está errado, o motor não sobe o processo, e o erro chega ao operador
 * como "spawn falhou", não como "o catálogo está errado".
 */
export const AGENT_CATALOG: readonly AgentPreset[] = [
  {
    id: "claude",
    label: "Claude",
    command: ["npx", "-y", "@agentclientprotocol/claude-agent-acp@0.59.0"],
    note: "Pin em 0.59: versões anteriores (0.26) não anunciam `effort`.",
  },
  {
    id: "codex",
    label: "Codex",
    command: ["npx", "-y", "@agentclientprotocol/codex-acp"],
    note: "Auth por subscription (`codex login`) — não precisa de `env`.",
  },
  {
    id: "opencode",
    label: "OpenCode",
    command: ["opencode", "acp"],
    note: "Subcomando do binário `opencode` — não é pacote npm.",
  },
] as const;

/** Os ids conhecidos, para mensagem de erro e para o select da GUI. */
export const AGENT_PRESET_IDS: readonly string[] = AGENT_CATALOG.map((p) => p.id);

/** O preset de um id, ou `undefined` se o id não está no catálogo. */
export function findAgentPreset(id: string): AgentPreset | undefined {
  return AGENT_CATALOG.find((p) => p.id === id);
}
