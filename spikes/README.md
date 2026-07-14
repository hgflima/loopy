# spikes

Scripts experimentais/descartáveis que sondam comportamento real (ACP, adapters,
SDK) para embasar decisões do motor. Não são código de produção: ficam **fora**
do `tsconfig` (`include: ["src","tests"]`), mas são lintados. Artefatos gerados
(`*.out.json`) são gitignored.

Rodar: `npx tsx spikes/<arquivo>.ts`

Arquivos:

- **`_acp-probe.ts`** — helper compartilhado (prefixo `_` = não executável); toda
  a mecânica genérica de ACP (spawn → initialize → session/new → report). Aceita
  um `extraProbe` opcional para sondas específicas do adapter na sessão viva.
- **`acp-codex-capabilities.ts`** / **`acp-claude-capabilities.ts`** /
  **`acp-opencode-capabilities.ts`** — wrappers finos; só trocam o comando de
  spawn e o nome do artefato (o do OpenCode traz também uma sonda de mode).
  Read-only: nenhum prompt, nenhum turno.
- **`acp-opencode-clear.ts`** — prova o `clear()` (reopen) e o caminho do turno
  contra o OpenCode. ⚠️ **consome turnos** (roda em `mode: plan`, não escreve).

---

## `acp-{codex,claude,opencode}-capabilities.ts` — models / modes / efforts via ACP

Abrem uma sessão ACP contra o adapter e imprimem **de onde** cada dial vem, sem
enviar nenhum prompt (read-only: só `initialize` + `session/new`). Confirmam que,
no motor, `mode`/`model`/`effort` de um Step de Agente são **vocabulário
por-Agente descoberto em runtime**, não hardcodável.

```
npx tsx spikes/acp-codex-capabilities.ts
npx tsx spikes/acp-claude-capabilities.ts
npx tsx spikes/acp-opencode-capabilities.ts
npx tsx spikes/acp-codex-capabilities.ts codex-acp    # comando custom (argv)
```

Auth: Codex por subscription do ChatGPT (`codex login`, sem env key); Claude pela
mesma auth do Claude Code (`claude` CLI ou `ANTHROPIC_API_KEY`); OpenCode pela
auth do próprio CLI (`opencode auth login`). Cada spike escreve a resposta crua
em `acp-<agente>-capabilities.out.json` (gitignored).

### O mapa do protocolo (a resposta que as spikes provam)

| Dial   | Vem de                                          | Como aplicar no motor                                     |
| ------ | ----------------------------------------------- | --------------------------------------------------------- |
| mode   | `session/new` → `modes.availableModes[].id`     | `session/set_mode { modeId }` — **fail-hard** se inválido |
| model  | `session/new` → `configOptions[category=model]` | `session/set_config_option { configId, value }`           |
| effort | `configOptions[category=thought_level]`         | `session/set_config_option { configId, value }`           |

`src/acp/session.ts` descobre o `configId` pela **categoria** (`findConfigId`),
não pelo id literal — e isso **já se pagou**: o id do effort é `reasoning_effort`
no Codex e `effort` no Claude 0.59; `setEffort` funciona nos dois sem tocar no
motor.

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

### Achados — Claude (claude-agent-acp 0.59.0 · SDK 0.29 · capturado 2026-07-14)

> ⚠️ **Recaptura** — os achados anteriores eram da **0.26.0** (2026-07-12) e
> **envelheceram**: a 0.59 passou a anunciar `thought_level` e `fast`, que a 0.26
> não tinha. Ver "O que mudou da 0.26 → 0.59" abaixo.

**Modes** (`availableModes`, default `default`) — vocabulário PRÓPRIO, disjunto
do Codex, **inalterado** desde a 0.26: `auto` · `default` · `acceptEdits` ·
`plan` · `dontAsk` · `bypassPermissions`.

**Models** (`configOptions[category=model]`, id `model`, default `opus[1m]`):
`default` (= Opus 4.8 · 1M) · `opus[1m]` (Opus 4.8 · 1M) · `sonnet` (Sonnet 5) ·
`haiku` (Haiku 4.5).

**Efforts** (`configOptions[category=thought_level]`, id **`effort`**, default
`high`): `default` · `low` · `medium` · `high` · `xhigh` · `max`.

⇒ **o effort deixou de ser no-op no Claude.** Note o id: **`effort`**, não o
`reasoning_effort` do Codex — e o motor **não precisou mudar**, porque
`findConfigId` procura pela _categoria_ (`thought_level`), não pelo id.

**Extras**: `[mode]` id `mode` (mode duplicado, igual ao Codex) e
`[model_config]` id **`fast`** (toggle "Fast mode" `on`/`off`, default `off` — o
Codex chama o dele de `fast-mode`). `authMethods = []` (usa a auth do Claude
Code, sem método ACP explícito). `agentCapabilities` cresceu: `loadSession: true`,
`sessionCapabilities` (`close`/`delete`/`fork`/`list`/`resume`/
`additionalDirectories`), `mcpCapabilities` (`http`/`sse`), `auth.logout` e
`_meta.claudeCode.promptQueueing` — o motor não usa nada disso hoje.

#### O que mudou da 0.26 → 0.59

| dial       | 0.26 (2026-07-12)              | 0.59 (2026-07-14)                                   |
| ---------- | ------------------------------ | --------------------------------------------------- |
| **effort** | **ausente** (no-op)            | **presente** — id `effort`, `low`..`max`, def `high` |
| **fast**   | ausente                        | presente — `[model_config]` id `fast`               |
| **models** | + `sonnet[1m]`; Opus 4.6       | sem `sonnet[1m]`; Opus 4.8 · Sonnet 5 · Haiku 4.5   |
| **modes**  | os 6                           | os 6 (inalterado)                                    |

Consequência prática pro yml: um Step de Agente Claude **agora honra `effort:`**
(`low`/`medium`/`high`/`xhigh`/`max`) — antes era silenciosamente ignorado.
Nenhuma mudança no motor (`src/acp/session.ts` já descobre por categoria).

### Achados — OpenCode (opencode 1.17.9 · capturado 2026-07-13)

O ACP do OpenCode **não é um adapter npm**: é um subcomando do binário
(`opencode acp`), então o Agente do Registry é `command: ["opencode", "acp"]` —
sem `npx -y`. Nenhum pacote novo entra no motor.

**Modes**: `sess.modes` vem **`null`** — o OpenCode **não anuncia
`availableModes`**, só a config option `[mode] id=mode` (default `build`):
`build` (executa tools conforme as permissões) · `plan` ("disallows all edit
tools" — o análogo de read-only).

⚠️ Isso _parecia_ quebrar o motor (que aplica mode via `session/set_mode` e é
fail-hard). A sonda de mode da spike provou que **não quebra** — os dois caminhos
funcionam e o adapter valida server-side:

| chamada                                                         | resultado                     | mode depois                               |
| --------------------------------------------------------------- | ----------------------------- | ----------------------------------------- |
| `session/set_mode { modeId: "plan" }`                           | ok `{}`                       | `build` → **`plan`** (aplicou de verdade) |
| `session/set_mode { modeId: "xpto-invalido" }`                  | **`-32602` "mode not found"** | inalterado                                |
| `session/set_config_option { configId: "mode", value: "plan" }` | ok (devolve os configOptions) | `plan`                                    |

⇒ `set_mode` **aplica e valida**, mesmo sem `availableModes` anunciado. A
validação client-side do motor (`availableModeIds`) simplesmente não roda (lista
vazia ⇒ passa direto), e o adapter erra alto com mensagem clara — o fail-closed
sobrevive, só a mensagem é a dele em vez da nossa. **Nenhuma mudança no motor.**
(Truque da sonda: o `set_config_option` do OpenCode devolve a lista inteira de
config options, então uma escrita idempotente do `model` serve de _leitura_ do
mode corrente — o ACP não tem `get_config`.)

**Models** (`[model]` id `model`, default `opencode/big-pickle`): **146 opções**,
ids no formato `provider/model` — `openai/*`, `zai/*`, `huggingface/*`,
`opencode/*` (OpenCode Zen), `sakana/*`. Isto é: o model do OpenCode carrega o
_provider_ no id; não há vocabulário curto tipo `sonnet`/`gpt-5.5`.

**Efforts**: **NENHUM** — não anuncia `thought_level` ⇒ `setEffort` é no-op.
Também **não** expõe toggle de fast mode. (É hoje o **único** dos três sem
effort: o Claude passou a ter na 0.59.)

**Extras**: `authMethods = [opencode-login]` ("Run `opencode auth login`").
`agentCapabilities` mais rica que a dos outros: `loadSession: true` e
`sessionCapabilities` com `close`/`fork`/`list`/`resume` (o motor não usa nada
disso hoje).

O `clear()` e o caminho do turno estão provados em
`acp-opencode-clear.ts` (seção abaixo).

### Contraste (o que o motor precisa respeitar)

|                              | Codex 1.1.2                             | Claude 0.59                                                         | OpenCode 1.17.9                                         |
| ---------------------------- | --------------------------------------- | ------------------------------------------------------------------- | ------------------------------------------------------- |
| **entrega**                  | `npx @agentclientprotocol/codex-acp`    | `npx @agentclientprotocol/claude-agent-acp`                         | `opencode acp` (subcomando do binário)                  |
| **modes**                    | `read-only`/`agent`/`agent-full-access` | `auto`/`default`/`acceptEdits`/`plan`/`dontAsk`/`bypassPermissions` | `build`/`plan` (**não** anunciados em `availableModes`) |
| **effort** (`thought_level`) | `low`..`xhigh` (id `reasoning_effort`)  | `low`..`max` (id **`effort`**)                                      | **ausente** (no-op)                                     |
| **fast mode**                | sim (id `fast-mode`)                    | sim (id `fast`)                                                     | não                                                     |
| **default model**            | `gpt-5.5`                               | `opus[1m]` (Opus 4.8)                                               | `opencode/big-pickle`                                   |

⇒ `mode` é **vocabulário por-Agente disjunto**: um `modeId` válido num adapter é
`-32602 Invalid params` no outro. Mapeamento prático entre os três — read-only ⇒
claude `plan` ↔ codex `read-only` ↔ opencode `plan`; escrita ⇒ claude
`acceptEdits` ↔ codex `agent` ↔ opencode `build`.

**Nota de SDK (0.29)**: o legado `session/set_model` + `availableModels` **não
existe mais** — models e efforts são ambos `configOptions`. `src/acp/session.ts`
descobre o `configId` pela **categoria** (`findConfigId`), então segue correto
mesmo que os ids mudem entre adapters/versões.

---

## `acp-opencode-clear.ts` — o `clear()` do motor contra o OpenCode

⚠️ **Consome turnos** (2 prompts curtos) — ao contrário das spikes de capacidade.
Roda em `mode: plan` ("disallows all edit tools"), então o agente **não escreve**
no repo. `npx tsx spikes/acp-opencode-clear.ts`.

O `clear()` de `src/acp/session.ts` **não manda o texto `/clear` como prompt** —
ele **reabre a sessão** (`dispose()` + `session/new` no mesmo cwd) e re-aplica
mode/model/effort, porque `session/new` volta aos defaults. É mecânica pura de
ACP, sem slash command ⇒ a ressalva da doc do OpenCode ("some built-in slash
commands like `/undo`/`/redo` are unsupported") **não se aplica**.

Mas _irrelevante em teoria_ não é prova: o OpenCode anuncia `loadSession` e
`sessionCapabilities.resume`, então se ele persistisse contexto entre sessões do
mesmo cwd, o reopen trocaria o `sessionId` **sem** limpar a memória — e um Step de
audit herdaria o contexto do Step de build. A spike planta um segredo no turno 1,
reabre a sessão e pergunta o segredo no turno 2.

**Achado (opencode 1.17.9 · 2026-07-13)**: reopen limpa o contexto de verdade.

```
[turno 1 · planta]   stopReason=end_turn   resposta: "OK."
reopen: ses_0a2677d5… → ses_0a2676df…      (sessionId mudou: true)
[turno 2 · pergunta] stopReason=end_turn   resposta: "NAO_SEI"
⇒ contextLeaked: false
```

De quebra, esta spike exercita o **caminho completo de um turno** contra o
OpenCode — `prompt` → `end_turn` → texto via `readText()` —, que é o que o step
`agent` do motor faz. E a working tree ficou intacta depois de dois turnos, o que
confirma na prática que o `mode: plan` aplicado por `set_mode` está mesmo ativo.
