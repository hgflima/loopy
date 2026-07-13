# spikes

Scripts experimentais/descartáveis que sondam comportamento real (ACP, adapters,
SDK) para embasar decisões do motor. Não são código de produção: ficam **fora**
do `tsconfig` (`include: ["src","tests"]`), mas são lintados. Artefatos gerados
(`*.out.json`) são gitignored.

Rodar: `npx tsx spikes/<arquivo>.ts`

Arquivos:
- **`_acp-probe.ts`** — helper compartilhado (prefixo `_` = não executável); toda
  a mecânica genérica de ACP (spawn → initialize → session/new → report).
- **`acp-codex-capabilities.ts`** / **`acp-claude-capabilities.ts`** — wrappers
  finos; só trocam o comando de spawn e o nome do artefato.

---

## `acp-{codex,claude}-capabilities.ts` — models / modes / efforts via ACP

Abrem uma sessão ACP contra o adapter e imprimem **de onde** cada dial vem, sem
enviar nenhum prompt (read-only: só `initialize` + `session/new`). Confirmam que,
no motor, `mode`/`model`/`effort` de um Step de Agente são **vocabulário
por-Agente descoberto em runtime**, não hardcodável.

```
npx tsx spikes/acp-codex-capabilities.ts
npx tsx spikes/acp-claude-capabilities.ts
npx tsx spikes/acp-codex-capabilities.ts codex-acp    # comando custom (argv)
```

Auth: Codex por subscription do ChatGPT (`codex login`, sem env key); Claude pela
mesma auth do Claude Code (`claude` CLI ou `ANTHROPIC_API_KEY`). Cada spike
escreve a resposta crua em `acp-<agente>-capabilities.out.json` (gitignored).

### O mapa do protocolo (a resposta que as spikes provam)

| Dial   | Vem de                                         | Como aplicar no motor                                        |
|--------|------------------------------------------------|-------------------------------------------------------------|
| mode   | `session/new` → `modes.availableModes[].id`    | `session/set_mode { modeId }` — **fail-hard** se inválido    |
| model  | `session/new` → `configOptions[category=model]`| `session/set_config_option { configId:"model", value }`      |
| effort | `configOptions[category=thought_level]`        | `session/set_config_option { configId:"reasoning_effort", value }` |

`src/acp/session.ts` descobre o `configId` pela **categoria** (`findConfigId`),
não pelo id literal — por isso `setModel`/`setEffort` continuam corretos mesmo
que os ids mudem.

### Achados — Codex (codex-acp 1.1.2 · SDK 0.29 · capturado 2026-07-12)

**Modes** (`availableModes`, default `agent`): `read-only` · `agent` ·
`agent-full-access`.

**Models** (`configOptions[category=model]`, id `model`, default `gpt-5.5`):
`gpt-5.6-sol` · `gpt-5.6-terra` · `gpt-5.6-luna` · `gpt-5.5` · `gpt-5.4` · `gpt-5.4-mini`.

**Efforts** (`configOptions[category=thought_level]`, id `reasoning_effort`, default `xhigh`):
`low` · `medium` · `high` · `xhigh`. (⚠️ os valores `none/minimal/max/ultra`
que o ModelId embutido `gpt-5-codex[high]` sugeria **não** aparecem como opções
selecionáveis nesta versão.)

**Extras**: `[mode]` id `mode` (mode duplicado como config option — o motor usa
`set_mode`) e `[model_config]` id `fast-mode` (toggle boolean "Fast mode"
`off`/`on`, "1.5x speed"). `authMethods = [api-key, chat-gpt]`.

### Achados — Claude (claude-agent-acp 0.26.0 · SDK 0.29 · capturado 2026-07-12)

**Modes** (`availableModes`, default `default`) — vocabulário PRÓPRIO, disjunto
do Codex: `auto` · `default` · `acceptEdits` · `plan` · `dontAsk` ·
`bypassPermissions`.

**Models** (`configOptions[category=model]`, id `model`, default `opus[1m]`):
`default` (Opus 4.6 · 1M) · `sonnet` · `sonnet[1m]` · `haiku` · `opus[1m]`.

**Efforts**: **NENHUM** — o claude-agent-acp 0.26 **não** anuncia a categoria
`thought_level`. ⇒ `setEffort` é sempre no-op contra o Claude (o design
best-effort do motor está correto). Também **não** expõe `fast-mode`.

**Extras**: `[mode]` id `mode` (mode duplicado, igual ao Codex). `authMethods =
[]` (usa a auth do Claude Code, sem método ACP explícito).

### Contraste (o que o motor precisa respeitar)

| | Codex 1.1.2 | Claude 0.26 |
|---|---|---|
| **modes** | `read-only`/`agent`/`agent-full-access` | `auto`/`default`/`acceptEdits`/`plan`/`dontAsk`/`bypassPermissions` |
| **effort** (`thought_level`) | `low`..`xhigh` (id `reasoning_effort`) | **ausente** (no-op) |
| **fast-mode** | sim (`model_config`) | não |
| **default model** | `gpt-5.5` | `opus[1m]` |

⇒ `mode` é **vocabulário por-Agente disjunto**: um `modeId` válido num adapter é
`-32602 Invalid params` no outro. Um Step com `agent: claude` usa
`plan`/`acceptEdits`; com `agent: codex` usa `read-only`/`agent`. Mapeamento
prático: claude `plan` ↔ codex `read-only`; claude `acceptEdits` ↔ codex `agent`.

**Nota de SDK (0.29)**: o legado `session/set_model` + `availableModels` **não
existe mais** — models e efforts são ambos `configOptions`. `src/acp/session.ts`
descobre o `configId` pela **categoria** (`findConfigId`), então segue correto
mesmo que os ids mudem entre adapters/versões.
