/**
 * SPIKE — capacidades ACP do **Codex**: lista models, modes e efforts que o
 * adapter `@agentclientprotocol/codex-acp` anuncia no `session/new`.
 *
 * A mecânica é genérica de ACP e mora em {@link probeAgent} (`_acp-probe.ts`);
 * aqui só fixamos o comando de spawn do Codex. Read-only: nenhum prompt.
 *
 * Rodar:
 *   npx tsx spikes/acp-codex-capabilities.ts
 *   npx tsx spikes/acp-codex-capabilities.ts codex-acp    # comando custom (argv)
 *
 * Auth: subscription do ChatGPT (`codex login`) por default — sem env key
 * (`OPENAI_API_KEY` não sequestra; ver memória `loopy-codex-acp-facts`).
 */
import { probeAgent } from "./_acp-probe.ts";

await probeAgent({
  defaultCommand: ["npx", "-y", "@agentclientprotocol/codex-acp"],
  outFile: "acp-codex-capabilities.out.json",
});
