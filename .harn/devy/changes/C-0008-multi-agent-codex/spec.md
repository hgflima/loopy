# Spec: Múltiplos agentes de código via ACP — Codex + Claude, com seleção de agente/modelo/effort por Step

> Feature spec derivada do glossário `CONTEXT.md` e do estado atual do motor.
> **Introduz** o ADR-0006 (a criar): o motor deixa de assumir **um** Agente ACP por Run
> e passa a dirigir **N Agentes nomeados** (um subprocesso adapter por Agente usado),
> selecionáveis **por Step** via `agent:`, com **modelo** e **effort** aplicados em
> runtime pela Sessão ACP — do mesmo jeito que o `mode` já é aplicado hoje.
> Invariante mantido (AD-1): o motor **interpreta** `agent`/`model`/`effort` — não
> decide *qual* agente/modelo usar, só executa o que o `loopy.yml` manda; os três são
> repassados **crus** ao adapter (o motor não valida os valores). Invariante mantido
> (AD-3, **evoluído**): continua "um processo ACP hospeda N Sessões, cwd imutável por
> Sessão" — mas agora há **um processo por Agente nomeado usado no Run** (antes: um só).
>
> **Decisões da entrevista `/devy:spec`** (perfil TDAH — uma pergunta por vez):
> (1) **forma de config** = **registry nomeado `agents:`** top-level + override por Step,
> com `acp:` legado preservado como o Agente `default` (regressão zero);
> (2) **aplicação de modelo/effort** = **runtime via ACP** (best-effort), simétrico ao
> `set_mode` — 1 processo por tipo de Agente, modelo/effort variam por Step; se o adapter
> não anuncia a capability, cai no default e **loga** (padrão "n/d" do projeto).
>
> **Fatos técnicos confirmados** (context7 `@agentclientprotocol/codex-acp`,
> `@agentclientprotocol/claude-agent-acp`, spec ACP v2, docs Codex — jul/2026):
> Codex fala ACP pelo **mesmo padrão do Claude** (um binário adapter stdio por Agente);
> só muda o comando de spawn. Seleção de modelo/effort existe em runtime (área *unstable*
> do spec: `session/set_config_option` + legado `session/set_model`) — por isso
> **best-effort**. **Effort só tem paridade no Codex** (`model_reasoning_effort`:
> `minimal…ultra`); o Claude adapter **não** expõe dial de effort via ACP (só "Fast mode").

## Objective

Permitir que um mesmo Pipeline do `loopy` dirija **mais de um agente de código** — hoje
só Claude Code, com esta feature **também o OpenAI Codex** — escolhendo **por Step**:
(1) **qual Agente** executa (`agent: codex` / `agent: claude`), (2) **qual modelo**
(`model: gpt-5-codex`), e (3) **qual effort/reasoning level** (`effort: high`), quando o
Agente suportar. Tudo com **paridade total** com o fluxo de Step de Agente atual:
`prompt`/`retry_prompt`, `mode`, `clear_context`, `verify` (loop interno + `${checks.report}`),
`expect` (Verdict/Gate de veredito), `on_fail` (escalate / `{goto}`) e `on_success`
continuam funcionando **idênticos**, independentemente de qual Agente roda o Step.

**Usuário-alvo:** quem escreve o `loopy.yml` e quer casar cada etapa do Pipeline ao
agente/modelo mais adequado — p.ex. implementar com um modelo forte de código, simplificar
com um mais barato/rápido, auditar com outro fornecedor para diversidade de julgamento —
sem trocar de motor nem manter dois `loopy.yml`.

**Critérios de aceite (do pedido), reenquadrados como Success Criteria** — ver seção
homônima. Em resumo: (1) adapter/config para invocar o Codex via ACP; (2) seleção do
Agente por Step (`agent: codex`); (3) paridade com o fluxo de Agente existente
(`expect`/`verify`/`on_fail`/`mode`); (4) exemplo funcional no `loopy.yml`; (5) escolha de
**modelo** por Step; (6) escolha de **effort** por Step **quando o ACP/adapter suportar**
(best-effort, sem quebrar quando não suporta). **Regressão zero:** todo `loopy.yml`
existente (sem `agents:`, sem `agent:`/`model:`/`effort:` nos Steps) roda **byte-idêntico**.

## Enquadramento (o que o pedido esconde)

1. **Codex via ACP é simétrico ao Claude — o "adapter" é um binário, não código nosso.**
   Nenhum dos dois fala ACP no core; cada um é exposto por um **binário adapter stdio**
   dedicado que faz a ponte ACP (JSON-RPC sobre stdio) ↔ runtime do agente. Confirmado:
   Claude = `@agentclientprotocol/claude-agent-acp` (bin `claude-agent-acp`, v0.55.0 — o que
   o loopy já spawna, `src/acp/agent.ts:49-54`); Codex = **`@agentclientprotocol/codex-acp`**
   (bin `codex-acp`, v1.1.0 — mesmo org, mesmo padrão). O antigo `@zed-industries/codex-acp`
   está **descontinuado** (README aponta para o org `agentclientprotocol`). **Implicação:**
   integrar Codex é, no essencial, **fazer spawn de outro comando** e rotear os Steps ao
   processo certo — o wire ACP, o modelo de Sessão (cwd imutável, AD-3) e a interface
   `AgentSession` (`src/types.ts:472-488`) **não mudam de forma**.

2. **"Um processo ACP por Run" (AD-3) precisa evoluir para "um por Agente usado".** Hoje
   `openAgent` é chamado **uma vez** em `defaultRunLive` (`src/index.ts:368`) e o pool de
   Sessões é keyed **só por worktree** (`createSessionPool`, `src/acp/session.ts:301-346`).
   Com dois Agentes no mesmo Pipeline (ex.: `implement` com Codex, `review` com Claude, na
   **mesma** Task/Worktree), são precisos **dois processos** e **duas Sessões** para aquela
   Task — cada Sessão com o **mesmo** cwd (o worktree da Task), em processos diferentes.
   **Decisão:** um **Registry de Agentes** normalizado (`name → {command, env, model?, effort?}`);
   um **pool de processos** keyed por **nome do Agente** (**eager**: todo Agente **referenciado**
   pelo Pipeline sobe no início do Run — o conjunto referenciado é estático; Agentes não
   referenciados nunca sobem); e o **pool de Sessões**
   passa a ser keyed por **`(nome do Agente, worktree)`**. O orquestrador resolve, para cada
   Step de Agente, `ctx.session = pool.session(agenteResolvido, worktree)`. `StepContext.session`
   **continua sendo uma Sessão** (a do Agente daquele Step) — muda **quem a fornece**.

3. **Modelo e effort vivem na área *unstable* do ACP — por isso são best-effort, como
   usage/cost.** O `session/new` estável **não** tem campo de modelo (só `cwd`+`mcpServers`).
   A seleção em runtime é `session/set_config_option` (categorias reservadas `model`,
   `model_config`, `thought_level`) + o legado `session/set_model`, ambos negociados no
   `initialize`/anunciados no `session/new` (`availableModels`, config options). **Decisão:**
   `AgentSession` ganha `setModel(id)` e `setEffort(level)` **aditivos e best-effort**:
   tentam o caminho moderno (config option) com fallback ao legado; se o Agente **não**
   anuncia a capability, é **no-op + log** (nunca lança pro loop — AD-5). Isso espelha o
   contrato best-effort já adotado para métricas (ADR-0003: ausência → "n/d"), e mantém o
   motor robusto a mudanças do schema *unstable*.

4. **Effort não é universal — é uma capacidade por-Agente.** O Codex expõe
   `model_reasoning_effort` (`none/minimal/low/medium/high/xhigh/max/ultra`) via ACP config
   option **e** codificado no ModelId (`gpt-5.2[high]`). O **Claude adapter não** expõe dial
   de effort (só um toggle "Fast mode"). **Decisão:** `effort` é um campo **opcional
   best-effort**; quando o Agente-alvo não o suporta, o motor **loga** ("effort ignorado:
   agente `<nome>` não anuncia reasoning effort") e segue — **não** é erro de config. Assim o
   mesmo Pipeline roda em ambos os Agentes sem edição condicional.

5. **`agent`/`model`/`effort` são repassados CRUS — o motor não interpreta valores (AD-1).**
   Exatamente como `mode` hoje é uma string open-ended repassada a `session/set_mode`
   (`src/acp/session.ts:142-147`, o motor não valida `acceptEdits`/`plan`/…), `model` e
   `effort` são strings livres repassadas ao adapter via config option. `agent` é validado
   **só** referencialmente (precisa existir no Registry) — o motor não conhece "codex" nem
   "claude", só resolve o nome no Registry. Nenhuma lista fechada de modelos/efforts no motor.

6. **`acp.command` legado precisa continuar válido — regressão zero é lei no projeto.** Todo
   `loopy.yml` existente tem `acp: { command, request_timeout_seconds, permissions }` e Steps
   `agent` **sem** `agent:`. **Decisão (normalização no `load`):** se `agents:` está ausente,
   o loader **sintetiza** um Registry `{ default: { command: acp.command } }` e define o
   Agente `default` como o default do Run. Steps sem `agent:` usam o Agente default. Assim o
   exemplo canônico atual (`examples/loopy.yml`) e todas as changes anteriores validam e rodam
   **inalterados** — o novo caminho é 100% aditivo (`.strict()` mantido em ambos os formatos).

7. **Auth por subscription é o default; `env` por-Agente é opt-in para API key — segredos
   NÃO entram no yml.** O default do Codex é **login ChatGPT (subscription)**: com `codex
   login` feito, o Agente `codex` **não exige env algum** (o adapter cai em ChatGPT quando
   `auth.json` existe). Precedência de auth (fonte `codex-rs`): `CODEX_API_KEY` > store
   efêmero > `CODEX_ACCESS_TOKEN` > `auth.json` (default → ChatGPT) — **`OPENAI_API_KEY`
   sozinho NÃO sequestra** a subscription, então uma key solta no ambiente é inofensiva. O
   processo adapter herda `process.env` no spawn (`src/acp/agent.ts:147`) e o loopy **não faz
   scrubbing** (confia no default natural). O `agents.<n>.env` opcional é **opt-in de API
   key**/overrides (ex.: `CODEX_API_KEY: "${env.CODEX_API_KEY}"` — **referência**, não o
   valor). **Escopo de `env.*` (refinado):** `${env.KEY}` é resolvido **só em `agents.*.env`**
   num passe dedicado no build do pool — **NÃO** entra em `buildScopeVars`, então `${env.KEY}`
   em prompt/shell/`retry_prompt` é var desconhecida (fail-fast). Chave declarada mas ausente
   do ambiente = **`ConfigError` fail-fast** (a declaração vira pré-condição enforced).
   **Boundary:** o valor literal de um segredo **nunca** é escrito no `loopy.yml`, e nunca
   entra num prompt/log (por isso o escopo confinado).

## Linguagem ubíqua (adições/precisões — a promover em `CONTEXT.md` + ADR-0006)

- **Agente** (precisão) = um **agente de código nomeado** que o motor pode dirigir via ACP
  (ex.: `claude`, `codex`). Antes o glossário dizia "o subprocesso; 1 por Run"; agora
  **Agente** é o *perfil/tipo* declarado no Registry, e o **subprocesso** é o **Processo de
  Agente** (abaixo). Um Run pode usar **N Agentes**.
- **Registry de Agentes** = o mapa `agents:` (nome → definição) resolvido/normalizado no
  `load`. Definição de Agente = `{ command, env?, model?, effort? }`. Fonte única do que o
  motor spawna e dos defaults de modelo/effort. `acp.command` legado sintetiza o Agente
  `default`.
- **Agente default** = o Agente usado por um Step `agent` que **omite** `agent:`. Vem de
  `acp.default_agent` (se declarado) ou do `default` sintetizado do `acp.command` legado.
- **Processo de Agente** = o subprocesso adapter stdio de **um** Agente nomeado (ex.:
  `codex-acp`). **Um por Agente referenciado pelo Pipeline**, spawned **eager** no início do Run
  (conjunto referenciado é estático; Agentes não referenciados nunca sobem; falha de spawn = Run
  falha rápido). Hospeda N Sessões (AD-3 evoluído).
- **Sessão** (precisão) = uma conversa ACP presa a um **`(Agente, Worktree)`**, cwd imutável.
  Uma Task pode ter **mais de uma** Sessão se Steps distintos usam Agentes distintos — cada
  uma no seu Processo de Agente, todas com o mesmo cwd (o Worktree da Task).
- **Model** = o modelo do Agente para um Step (`model:`), aplicado via `session/set_config_option`
  (categoria `model`) / `session/set_model` (legado). String open-ended, repassada crua.
  **Best-effort.**
- **Effort** (reasoning level) = o esforço de raciocínio do Agente para um Step (`effort:`),
  aplicado via config option (categoria `thought_level`/reasoning). String open-ended.
  **Best-effort e por-Agente** — Agente sem a capability ⇒ no-op + log. Distinto de **Modo**
  (autonomia: `acceptEdits`/`plan`) e de **Modelo**.

## Design

### Config — `agents:` (Registry) + `acp:` (ponte global) + Steps

```yaml
# NOVO: registry de agentes nomeados (top-level, opcional)
agents:
  claude:
    command: ["npx", "-y", "@agentclientprotocol/claude-agent-acp"]
  codex:
    command: ["npx", "-y", "@agentclientprotocol/codex-acp"]
    # SEM env → auth por subscription (login ChatGPT via `codex login`); é o DEFAULT.
    env:                                  # OPCIONAL — opt-in de API key (senão: subscription)
      CODEX_API_KEY: "${env.CODEX_API_KEY}"   # referência, não o valor; ausente = fail-fast
    model: gpt-5-codex                    # opcional — default do agente (Step sobrepõe)
    effort: medium                        # opcional — default do agente (Step sobrepõe)

acp:                                      # ponte ACP GLOBAL (não é mais dono do command)
  default_agent: claude                   # NOVO opcional — qual agente do registry é o default
  request_timeout_seconds: 1800
  permissions: { default_mode: acceptEdits, on_request: allow }
  # command: [...]                        # LEGADO ainda aceito → sintetiza agents.default

pipeline:
  - id: implement
    type: agent
    agent: codex                          # NOVO — referencia o registry (omitir = default)
    model: gpt-5-codex                    # NOVO — override por-step (best-effort)
    effort: high                          # NOVO — override por-step (best-effort)
    mode: acceptEdits                     # inalterado
    prompt: "/devy:build ..."             # inalterado
    verify: { run: ci, max_attempts: 3 }  # inalterado (loop interno + ${checks.report})
  - id: review
    type: agent
    agent: claude                         # outro Agente no mesmo Pipeline → outro processo
    mode: plan
    effort: high                          # ignorado + log (Claude sem paridade de effort)
    expect: "REVIEW: PASS"                # inalterado (Verdict/Gate de veredito)
    on_fail: { goto: implement }          # inalterado (Desvio)
```

**Regras de resolução (normalização no `load`, determinística):**
- **Coexistência (refinado):** `agents:` e o legado `acp.command` são **mutuamente exclusivos**
  — os dois presentes = `ConfigError` fail-fast (sem precedência silenciosa). Deve haver ao
  menos um Agente resolvível: `agents:` não-vazio **ou** `acp.command` legado.
- **Default (refinado):** `agent` do Step ausente → Agente default. O default é: `acp.default_agent`
  se dado; senão o **único** Agente do Registry quando há exatamente 1; se há **>1 sem
  `default_agent`**, `agent:` passa a ser **obrigatório em todo Step de agente** (fail-fast no
  load, listando os agentes). `agent` presente → precisa existir no Registry (senão fail-fast).
  `default_agent` (se dado) precisa existir no Registry.
- `model` efetivo = `step.model ?? registry[agent].model` (senão: default do adapter). **Passado
  cru, NÃO interpolado** (mirror do `mode`). Na Sessão reusada, um Step que não resolve model/
  effort **herda** o do Step anterior; determinismo via default no registry (todo Step reafirma).
- `effort` efetivo = `step.effort ?? registry[agent].effort` (senão: default do adapter).

### Schema (`src/config/schema.ts`) + tipos (`src/types.ts`) — aditivo, `.strict()` em sincronia

- **`agentDefSchema`** (novo) = `{ command: string[].min(1), env?: record<string,string>,
  model?: string, effort?: string }.strict()`. Mirror em `types.ts`: `AgentDef`.
- **`agentsSchema`** (novo) = `z.record(nonEmptyString, agentDefSchema)`, **opcional** no
  top-level `loopyConfigSchema`. Mirror: `LoopyConfig.agents?: Readonly<Record<string, AgentDef>>`.
- **`acpSchema`**: `command` vira **opcional** (legado); `+ default_agent?: nonEmptyString`.
  Mirror: `AcpConfig.command?`, `AcpConfig.default_agent?`.
- **`agentStepSchema`**: `+ agent?: nonEmptyString`, `+ model?: nonEmptyString`,
  `+ effort?: nonEmptyString` (todos `.optional()`, open-ended). Mirror: `AgentStep.agent?`,
  `AgentStep.model?`, `AgentStep.effort?`.
- **`superRefine`** (validação cruzada): `agents:` e `acp.command` **não coexistem**; cada
  `step.agent` existe no Registry; `default_agent` (se dado) existe; ao menos um Agente
  resolvível; **quando >1 Agente sem `default_agent`, todo Step de agente exige `agent:`**.
  Mensagens claras (`ConfigError`, sem stack). Warning não-bloqueante **só** para Agente do
  Registry **nunca** referenciado (dead profile — análise de referência pura). **Sem warning
  estático de effort** (refinado): o motor não conhece capabilities por nome de Agente (AD-1);
  effort não-suportado é **no-op + log em runtime**, não aviso de config.
- **Normalização**: `loadConfig` produz um `ResolvedAgents { byName: Record<name, AgentDef>,
  default: name }` anexado ao `LoopyConfig` (ou derivável), para o runtime ser uniforme
  (nunca reprocessa o legado a jusante — fronteira de confiança, `src/config/CLAUDE.md`).
  `agents.*.env` é resolvido **aqui** (passe `env.*` dedicado, escopo env-only), não em
  `buildScopeVars`.

### Port de Sessão (`src/types.ts` `AgentSession`) — aditivo, best-effort

```ts
export interface AgentSession {
  // …sessionId, setMode, clear, prompt, readText, cancel, drainUsage, readCost… (inalterados)
  /** Seleciona o modelo via ACP (config option 'model' / legado session/set_model).
   *  Best-effort: no-op + log se o Agente não anuncia a capability. Nunca lança. */
  setModel(modelId: string): Promise<void>;
  /** Seleciona o reasoning effort via ACP (config option categoria thought_level/reasoning).
   *  Best-effort e por-Agente: no-op + log quando não suportado. Nunca lança. */
  setEffort(level: string): Promise<void>;
}
```

Implementação em `SessionWrapper` (`src/acp/session.ts`): ambas inspecionam os config options
/ `availableModels` anunciados pela Sessão (do `session/new`/`initialize`), descobrem a
**categoria** certa (`model` / `thought_level` — categorias reservadas do ACP) e chamam
`session/set_config_option` com payload `{ sessionId, configId, value }` — o param é
**`configId`**, não `id` (fallback `session/set_model` para modelo). Erro do adapter
(method-not-found, capability ausente) é **capturado, logado e engolido** (AD-5). Suporta
effort embutido no ModelId (ex.: `model: "gpt-5-codex[high]"`) naturalmente via `setModel`.

### Roteamento Agente → Processo/Sessão (`src/acp/`, `src/index.ts`, `src/loop/orchestrator.ts`)

- **`openAgent`** ganha por-Agente o `command`+`env` do Registry; passa a ser chamado por um
  **AgentProcessPool** (novo, keyed por nome do Agente) — **eager** para o conjunto referenciado
  pelo Pipeline (spawn no início do Run; **falha de spawn = Run falha rápido**, antes de
  qualquer Task). Cada processo mantém seu `gate`/`shutdown` (AD-3, hoje `src/acp/agent.ts:16-17,188-210`).
- **Session pool** (`createSessionPool`): a chave passa de `worktree` → `${agent}::${worktree}`.
  O Processo do Agente já está de pé (eager); `pool.session(agent, worktree)` cria/reusa a
  **Sessão** daquele `(agente, worktree)` (lazy — `session/new` é barato; o cold-start do npx
  do processo já foi pago no início). Uma Task com Steps de dois Agentes tem duas Sessões.
- **Orquestrador** (`buildTaskStepContext`/`ensure()`, `src/loop/orchestrator.ts:562-583`):
  para cada Step `agent`, resolve o nome do Agente (`step.agent ?? default`) e injeta
  `ctx.session = pool.session(agenteResolvido, worktreePath)`. Steps não-`agent`
  (shell/checks/approval) **não** tocam Sessão — inalterados.
- **`defaultRunLive`** (`src/index.ts`): constrói o AgentProcessPool a partir do
  `ResolvedAgents`; o `Map<sessionId, taskId>` da TUI (C-0007) ganha também o **nome do
  Agente** por sessão (para prefixar streams/tráfego ACP por Agente quando > 1). `onUpdate`/
  `onTraffic` continuam globais **por processo** (agora N processos → registra os callbacks
  por Processo de Agente).

### Aplicação por-Step (`src/steps/agent.ts` `createAgentStep`) — simétrico ao `set_mode`

No início de cada visita ao Step (antes do loop de Verify), na ordem: `setMode(step.mode)`
(já existe, `agent.ts:196-198`) → `setModel(modelEfetivo)` → `setEffort(effortEfetivo)`,
cada um **condicional** (só chama quando resolvido) e **best-effort**. Como a Sessão é reusada
entre Steps, cada Step de Agente **reafirma** seu modelo/effort resolvidos, garantindo
determinismo independente do Step anterior. O resto do interpreter (`clear`, `prompt`/
`retry_prompt`, `classifyStopReason`, Verify loop, `applyVerdictGate`/`expect`, `on_fail`)
fica **inalterado** — é aí que mora a **paridade** exigida pelo pedido.

### Métricas (ADR-0003) — precisão sob multi-Sessão

Uso (tokens) é por-turno somado por Step (só Agente) — inalterado. **Custo** é cumulativo
por **Sessão**; com N Sessões por Task (uma por Agente), o Agregado de Task passa a **somar o
snapshot final de cada Sessão** da Task (best-effort; `n/d` quando um Agente não reporta).
O rollup por Step continua não existindo (custo nunca é por-Step). Extensão aditiva, sem
mudar a forma persistida de `.loopy/metrics.json`.

## Tech Stack

**Zero dependências novas de runtime** — o adapter do Codex é um **binário externo** obtido
via `npx -y @agentclientprotocol/codex-acp` (mesmo mecanismo do adapter Claude já usado); não
entra no `package.json`. Stack inalterada: TypeScript/Node ≥20 ESM, `@agentclientprotocol/sdk`,
`commander`, `execa`, `ink`+`react`, `yaml`, `zod`, `vitest`, `tsup`. **Pré-requisito de
ambiente** (não é dep npm): para o Agente `codex`, **login ChatGPT prévio via `codex login`
(subscription — o default)**; ou, opt-in de API key, `CODEX_API_KEY` no ambiente (declarado em
`agents.codex.env`). `OPENAI_API_KEY` solto **não** dirige a auth do Codex.

## Commands

```
Dev (subscription):   npm run dev -- ../alvo               # após `codex login` (default)
Dev (API key opt-in):  CODEX_API_KEY=sk-... npm run dev -- ../alvo   # agents.codex.env
Dry-run (resolve):    npm run dev -- ../alvo --dry-run     # imprime agente/model/effort por step
Uma task:             npm run dev -- ../alvo --task T-003
Typecheck:            npm run typecheck
Lint:                 npm run lint
Test:                 npm test
Build:                npm run build
```

## Project Structure

```
src/config/schema.ts   → + agentDefSchema, agentsSchema (top-level opcional); acp.command
                          vira opcional + acp.default_agent?; agentStepSchema += agent?/model?/
                          effort?; superRefine (agent existe/default resolvível/effort warning);
                          tudo .strict() em sincronia com types.ts
src/config/load.ts     → normaliza para ResolvedAgents { byName, default } (sintetiza `default`
                          do acp.command legado); fronteira de confiança
src/types.ts           → aditivo: AgentDef; LoopyConfig.agents?; AcpConfig.command?/default_agent?;
                          AgentStep.agent?/model?/effort?; AgentSession += setModel/setEffort
src/interp/            → escopo geral INALTERADO: `env.*` NÃO entra em buildScopeVars; é
                          resolvido à parte no load/pool-build (escopo env-only p/ agents.*.env)
src/acp/agent.ts       → openAgent recebe command+env por-agente; AgentProcessPool (novo, EAGER
                          p/ o conjunto referenciado, keyed por nome do agente); N processos/Run
src/acp/session.ts     → session pool keyed por `${agent}::${worktree}`; SessionWrapper.setModel/
                          setEffort (config option + legado; best-effort; log; nunca lança)
src/loop/orchestrator.ts → resolve step.agent ?? default; injeta ctx.session do (agente,worktree);
                          steps não-agent inalterados
src/steps/agent.ts     → após setMode, aplica setModel(modelEfetivo)+setEffort(effortEfetivo)
                          condicional/best-effort; resto do interpreter inalterado (paridade)
src/index.ts           → constrói AgentProcessPool do ResolvedAgents; Map sessionId→{taskId,agent}
src/metrics/           → custo por-Task soma snapshot final de cada Sessão (multi-agente)
src/tui/               → prefixa Stream/Logs ACP por Agente quando > 1 agente ativo (C-0007)
examples/loopy.yml     → exemplo multi-agente: Claude implementa (default) + Codex simplifica + Claude audita
docs/adrs/0006-*.md    → ADR (multi-agente ACP; AD-3 evoluído; model/effort best-effort; registry)
CONTEXT.md             → precisa Agente/Processo de Agente/Sessão; + Registry/Model/Effort
```

## Code Style

Contrato **aditivo**, provado por `tsc` (`types.ts` + `schema.ts` juntos, `.strict()`);
seleção de agente/modelo/effort **repassada crua** (AD-1); efeitos best-effort **como valores**
nas fronteiras (AD-5). Ex.:

```ts
// aditivo ao AgentStep (src/types.ts) — campos existentes INALTERADOS
export interface AgentStep extends StepBase {
  readonly type: "agent";
  readonly prompt: string;
  // …retry_prompt, mode, clear_context, verify, expect, on_fail… (inalterados)
  /** Nome de um Agente no Registry `agents:`. Omitido = Agente default. */
  readonly agent?: string;
  /** Modelo do Agente para este Step (best-effort; repassado cru ao adapter). */
  readonly model?: string;
  /** Reasoning effort para este Step (best-effort, por-Agente; repassado cru). */
  readonly effort?: string;
}

// best-effort no SessionWrapper (src/acp/session.ts) — nunca lança para o loop (AD-5)
async setEffort(level: string): Promise<void> {
  const optId = this.reasoningConfigOptionId();      // categoria thought_level do session/new; undefined se ausente
  if (optId === undefined) {                          // Agente sem paridade (ex.: Claude)
    this.logger.debug(`effort ignorado: agente '${this.agentName}' não anuncia reasoning effort`);
    return;                                            // no-op — config válida, sem erro
  }
  // param é `configId` (não `id`) — payload { sessionId, configId, value }
  try { await this.ctx.request(SET_CONFIG_OPTION, { sessionId: this.sessionId, configId: optId, value: level }); }
  catch (err) { this.logger.debug(`setEffort best-effort falhou: ${String(err)}`); }
}
```

## Testing Strategy

`vitest`, testes junto ao código. Cobertura por camada:

- **Config (schema/load):** `agents:` valida; `acp.command` legado sintetiza `default`
  (regressão — exemplo canônico atual valida inalterado); `agent:`/`model:`/`effort:` aceitos
  em Step `agent` e **rejeitados** em `shell`/`checks`/`approval` (discriminated union +
  `.strict()`); `superRefine`: `agent` inexistente → `ConfigError`; `default_agent` inexistente
  → erro; nenhum Agente resolvível → erro; warning de perfil não-referenciado e de effort
  em Agente sem paridade; normalização produz `ResolvedAgents` correto (default + byName).
- **Resolução de `env.*` (agent-only):** `${env.KEY}` em `agents.*.env` resolve do ambiente;
  chave **ausente → `ConfigError` fail-fast**; `${env.KEY}` em prompt/shell **não** resolve
  (var desconhecida — escopo confinado). Auth: `codex` sem `env` sobe em subscription (mock).
- **Session port (best-effort):** `setModel`/`setEffort` chamam `session/set_config_option`
  quando a capability é anunciada; **no-op + log** quando ausente; erro do adapter é engolido
  (não lança); effort embutido no ModelId (`gpt-5-codex[high]`) via `setModel`.
- **Roteamento (pools):** AgentProcessPool sobe **um** processo por Agente **referenciado**,
  **eager** no início (Agente não referenciado não spawna; falha de spawn = Run falha rápido);
  session pool keyed por `(agente, worktree)` cria duas Sessões numa Task com dois Agentes;
  reuso correto entre Steps do mesmo Agente.
- **Step de Agente (paridade — com fakes):** com `agent`/`model`/`effort` resolvidos, o
  interpreter aplica `setMode`→`setModel`→`setEffort` na ordem e **então** roda o fluxo atual
  **idêntico**: `verify`/`${checks.report}`/retry, `expect`/Verdict, `on_fail: escalate` e
  `{goto}`, `on_success`, `clear_context`. `StepResult` igual ao de hoje quando nenhum campo
  novo é dado.
- **Orquestrador (multi-agente):** um Pipeline `implement(codex)`→`review(claude)` numa Task
  resolve as duas Sessões corretas; Steps não-agent inalterados; emit seam/TUI (C-0007)
  carimba o Agente por sessão.
- **Regressão zero:** `loopy.yml` sem `agents:`/`agent:`/`model:`/`effort:` → resolução,
  Sessão única e resultado **byte-idênticos** ao atual; typecheck/lint/test verdes.
- **Aceite (e2e leve):** `examples/loopy.yml` multi-agente carrega e `--dry-run` imprime, por
  Step, o Agente/model/effort resolvidos, sem escrever nada.

## Boundaries

- **Always:** mudanças de contrato **aditivas** (tsc prova) — `AgentDef`, `LoopyConfig.agents?`,
  `AcpConfig.command?`/`default_agent?`, `AgentStep.agent?/model?/effort?`,
  `AgentSession.setModel/setEffort`; `.strict()` em **todo** objeto do schema, em sincronia com
  `types.ts`; `agent`/`model`/`effort` **repassados crus** ao adapter (o motor não valida
  valores — AD-1); `setModel`/`setEffort` **best-effort** (no-op + log quando não suportado,
  **nunca** lançam pro loop — AD-5); **um Processo de Agente por Agente referenciado**, spawned
  **eager** no início do Run (Agente não referenciado não sobe; falha de spawn = Run falha
  rápido); cwd **imutável** por Sessão (AD-3); **regressão zero** para
  `loopy.yml` sem os campos novos (byte-idêntico); usar os pacotes do org
  **`agentclientprotocol`** (`@agentclientprotocol/codex-acp`, `@agentclientprotocol/claude-agent-acp`).
- **Ask first:** validar **valores** de `model`/`effort` contra listas fechadas (hoje: crus,
  AD-1); mudar contratos congelados **além** dos aditivos listados; expor **métricas por-Agente**
  na TUI/relatórios além do custo somado por Task; adicionar **outros Agentes** (Gemini, etc.)
  além de Codex/Claude nesta change; suportar seleção de modelo/effort **no startup via env**
  (`CODEX_CONFIG`) como caminho paralelo ao runtime — fora do MVP (decisão: runtime via ACP).
- **Never:** hardcodar comportamento de Agente/modelo/effort no motor (AD-1) — nomes de agente,
  modelos e efforts vivem **só** no `loopy.yml`; **quebrar** um `loopy.yml` existente (o
  caminho legado é obrigatório); deixar `setModel`/`setEffort` **lançar** ou **bloquear** o
  loop; escrever o **valor** de um segredo (API key) no `loopy.yml` (só `${env.*}`); subir o
  Processo de um Agente **não** referenciado por nenhum Step; passar dado interpolado a um shell
  (Steps `shell` seguem argv-sem-shell); Artefato de runtime fora do `.loopy/` gitignored.

## Success Criteria

1. **Adapter/config do Codex (crit. 1):** um Agente `codex` no Registry sobe
   `@agentclientprotocol/codex-acp` via ACP, autentica por **subscription (default, `codex
   login`)** ou `CODEX_API_KEY` opt-in, e dirige uma Sessão com cwd = Worktree da Task — sem
   código de adapter próprio (é binário externo).
2. **Seleção por Step (crit. 2):** `agent: codex` / `agent: claude` (ou omitido = default)
   roteia o Step ao Processo de Agente certo; um Pipeline pode **misturar** Agentes; Agente
   inexistente → `ConfigError` fail-fast.
3. **Paridade (crit. 3):** `prompt`/`retry_prompt`, `mode`, `clear_context`, `verify`
   (+`${checks.report}`), `expect` (Verdict/Gate), `on_fail` (escalate/`{goto}`), `on_success`
   funcionam **idênticos** sob qualquer Agente; `StepResult` igual ao atual quando nenhum campo
   novo é usado.
4. **Modelo por Step (crit. 5):** `model: <x>` aplica via ACP (`set_config_option`/legado),
   best-effort; cada Step reafirma seu modelo resolvido (`step.model ?? registry default`).
5. **Effort por Step (crit. 6):** `effort: <x>` aplica via ACP config option **quando o Agente
   suporta** (Codex: `minimal…ultra`); quando **não** suporta (Claude), é **no-op + log** — a
   config permanece válida e o Run segue.
6. **Exemplo funcional (crit. 4):** `examples/loopy.yml` traz um Pipeline multi-agente real
   (Claude implementa como default + Codex simplifica com `effort: low` + Claude audita em
   `mode: plan`) que carrega e resolve em `--dry-run`.
7. **AD-3 evoluído:** N Processos de Agente por Run (um por Agente **referenciado**, spawned
   **eager** no início; falha de spawn = Run falha rápido); Sessões keyed por `(Agente, Worktree)`;
   cwd imutável por Sessão preservado.
8. **Best-effort robusto (AD-5):** `setModel`/`setEffort` nunca derrubam nem bloqueiam o loop;
   capability ausente/erro do adapter → log + segue no default.
9. **Regressão zero:** todo `loopy.yml` sem `agents:`/`agent:`/`model:`/`effort:` roda
   byte-idêntico; `acp.command` legado sintetiza o Agente `default`.
10. `npm run typecheck`, `npm run lint`, `npm test` verdes.

## Decisões resolvidas (entrevista `/devy:spec`)

- **OQ1 — Forma de config:** **Registry nomeado `agents:`** top-level + override por Step;
  `acp:` legado preservado como Agente `default` (regressão zero). *(Alternativas: só inline
  por Step; só `agent`+`model` sem effort — descartadas.)*
- **OQ2 — Aplicação de modelo/effort:** **Runtime via ACP** (best-effort), simétrico ao
  `set_mode` — 1 Processo por tipo de Agente; modelo/effort variam por Step; capability ausente
  → default + log. *(Alternativas: fixar no startup via `CODEX_CONFIG` env — estável mas
  +processos e sem troca no meio do Run; híbrido — descartadas para o MVP; startup fica em
  "Ask first" como caminho futuro.)*
- **OQ3 — Pacote do Codex:** **`@agentclientprotocol/codex-acp`** (org `agentclientprotocol`,
  paralelo ao adapter Claude já usado); o `@zed-industries/codex-acp` está descontinuado.
- **OQ4 — Effort sem paridade no Claude:** modelado como capacidade **por-Agente best-effort**;
  Agente sem dial de effort ⇒ no-op + log (não é erro de config).
- **OQ5 — Local da spec:** `.harn/devy/changes/C-0008-multi-agent-codex/` (padrão dogfooded
  C-0001…C-0007). Introduz `docs/adrs/0006-*`.

## Refino (rodada 2 — entrevista `/devy:refine`)

Segunda passada; cada item foi decidido com o usuário e/ou verificado nos fontes (context7
ACP, npm, `codex-rs`). Onde uma decisão **muda** o corpo da spec, o corpo acima já foi
corrigido in-place (marcado "(refinado)" / "(MUDANÇA)").

- **R1 — Coexistência legado + `agents:`:** os dois presentes = **`ConfigError`** (mutuamente
  exclusivos; sem precedência silenciosa). *(Corpo: Design › Regras de resolução.)*
- **R2 — Agente default:** 1 no Registry = implícito; **>1 sem `default_agent` ⇒ `agent:`
  obrigatório em todo Step** (fail-fast, listando os agentes). *(resolve OQ-B.)*
- **R3 — Escopo `env.*` (MUDANÇA):** resolvido **só em `agents.*.env`** (passe dedicado no
  build do pool), **NÃO** em `buildScopeVars` — `${env.KEY}` em prompt/shell é var
  desconhecida. Confina o segredo ao env do processo (nunca entra em prompt/log). *(Corrige o
  ponto 7 do Enquadramento, que antes propunha escopo global de interpolação.)*
- **R4 — `${env.KEY}` ausente:** **fail-fast** — declarar a dependência a torna pré-condição
  enforced.
- **R5 — Auth (precisão):** **subscription é o default** (ChatGPT via `codex login`); `codex`
  não exige env. Precedência `codex-rs`: `CODEX_API_KEY` > efêmero > `CODEX_ACCESS_TOKEN` >
  `auth.json`(→ChatGPT). **`OPENAI_API_KEY` não sequestra**; loopy **não faz scrubbing**
  (confia no default natural). `agents.env` = opt-in de API key (`CODEX_API_KEY`).
- **R6 — Determinismo model/effort:** **mirror do `mode`** — aplica só quando resolvido;
  Sessão reusada herda o do Step anterior; determinismo via default no registry. model/effort
  **passados crus, não interpolados** (`agent.ts:197` passa `step.mode` direto, sem `resolve`).
- **R7 — Warning de effort (MUDANÇA):** **removido** o warning estático "Agente sem paridade"
  (violava AD-1 — exigia hardcodar que 'claude' não tem effort). Fica só o **no-op + log em
  runtime**. *(Corrige a seção Schema.)*
- **R8 — Custo multi-Sessão:** **somar** snapshots finais por Task (MVP); breakdown por-Agente
  = follow-up "Ask first". *(resolve OQ-C.)*
- **F1 — OQ-A resolvida:** config option descoberto por **categoria** (`model` / `thought_level`)
  nos `configOptions` anunciados; param é **`configId`**, não `id` (corrigido no snippet de
  Code Style). Robusto a renomeações do schema *unstable*.
- **F2 — Pacotes verificados (npm):** `@agentclientprotocol/codex-acp@1.1.0` (bin `codex-acp`),
  `@agentclientprotocol/claude-agent-acp@0.55.0`; `@zed-industries/codex-acp` **deprecado**
  (aponta para o novo org).
- **F3 — Refactor central (insumo p/ PLAN):** hoje há **1 sessão lazy por Task**
  (`createLazySession`, `orchestrator.ts:806`) compartilhada por todos os Steps; multi-agente
  exige sessão por-`(agente, worktree)` resolvida **por-Step** → `SessionProvider` ganha o nome
  do Agente: `(agentName, cwd) => Promise<AgentSession>`. Único wiring por-agente: `openAgent`
  em `index.ts:368-386` + `AgentProcessPool`. Orquestrador já é agnóstico ao ACP (só conhece
  o callback `sessionProvider`).
- **R9 — Spawn eager do conjunto referenciado (MUDANÇA vs. "lazy"):** todo Agente
  **referenciado** por algum Step do Pipeline sobe **eager** no início do Run (o conjunto é
  estático — computável dos `step.agent` + o default se algum Step omite `agent:`). Agentes do
  Registry não referenciados (dead profile) **nunca** sobem. Falha de spawn de qualquer um =
  **Run falha rápido no início** (regressão-zero do eager de hoje, estendido a N). As Sessões
  seguem lazy por-`(agente, worktree)`. *(Corrige o ponto 2 do Enquadramento, Roteamento,
  Boundaries, crit. 7 e a def de "Processo de Agente", que diziam "lazy".)*
- **R10 — Exemplo canônico:** `examples/loopy.yml` = **Claude implementa (default) + Codex
  simplifica + Claude audita** (`acp.default_agent: claude`; `agent: codex` só no simplify com
  `effort: low`; audit em `mode: plan`). Mostra default + override de agente, agente mais barato
  pra simplificar, e diversidade de fornecedor no audit.
- **R11 — Triviais fixados:** `agent`/`model`/`effort` são **estáticos** (validados no load,
  **não** interpolados — mirror do `mode`/`type`/`id`); `acp.permissions` e
  `request_timeout_seconds` seguem **globais** a todos os Processos de Agente (sem override
  por-Agente no MVP); prefixação de Stream/Logs por Agente na TUI só quando **>1** Agente ativo
  (single-agent = byte-idêntico).

## Open Questions (para o PLAN) — RESOLVIDAS no Refino (rodada 2)

- **OQ-A — id do config option (área *unstable*).** ✅ **Resolvida (F1):** descobrir em runtime
  pela **categoria** (`model` / `thought_level`) dos config options anunciados no `session/new`;
  o param do payload é **`configId`** (não `id`). Robusto a renomeações — nada hardcodado.
- **OQ-B — `default_agent` explícito vs. convenção.** ✅ **Resolvida (R2):** `default_agent`
  opcional; 1 Agente = default implícito; **>1 sem `default_agent` ⇒ `agent:` obrigatório em
  todo Step** (fail-fast claro, listando os agentes).
- **OQ-C — Custo somado por Task sob multi-Sessão** (ADR-0003). ✅ **Resolvida (R8):** **somar**
  os snapshots finais de cada Sessão por Task (MVP, best-effort `n/d`); discriminar custo
  **por-Agente** fica como follow-up "Ask first".
