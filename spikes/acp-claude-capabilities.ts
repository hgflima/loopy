/**
 * SPIKE — capacidades ACP do **Claude**: lista models, modes e efforts que o
 * adapter `@agentclientprotocol/claude-agent-acp` anuncia no `session/new`.
 *
 * Gêmea de `acp-codex-capabilities.ts` — a mecânica genérica de ACP mora em
 * {@link probeAgent} (`_acp-probe.ts`); aqui só fixamos o comando de spawn do
 * Claude. Read-only: nenhum prompt.
 *
 * O contraste que interessa ao motor (ver memória `loopy-acp-stack-facts`):
 *   - **modes** do Claude são vocabulário PRÓPRIO — `acceptEdits`/`plan`/… —,
 *     NÃO os `read-only`/`agent`/`agent-full-access` do Codex. Um `mode` válido
 *     num adapter é `-32602 Invalid params` no outro (`setMode` é fail-hard).
 *   - **effort**: o Claude adapter historicamente NÃO expõe dial de reasoning
 *     effort (`thought_level`), só um toggle "Fast mode" — esta spike confirma
 *     se a categoria aparece (ou não) nos `configOptions`.
 *
 * Rodar:
 *   npx tsx spikes/acp-claude-capabilities.ts
 *   npx tsx spikes/acp-claude-capabilities.ts claude-agent-acp   # comando custom
 *
 * Auth: usa a mesma auth do Claude Code (login via `claude` CLI ou
 * `ANTHROPIC_API_KEY`).
 */
import { probeAgent } from "./_acp-probe.ts";

await probeAgent({
  defaultCommand: ["npx", "-y", "@agentclientprotocol/claude-agent-acp"],
  outFile: "acp-claude-capabilities.out.json",
});
