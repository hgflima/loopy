# Backlog: C-0016 — `concurrency: auto` + capabilities de agente por descoberta

> Consumido pelo motor (`- [ ]` pendente / `- [x]` concluída; id `T-\d+`; corpo indentado).
> Narrativa, grafo de dependências, checkpoints e riscos: ver `plan.md` (mesma pasta).
> **As duas features compartilham `src/index.ts`, `orchestrator.ts` e `ConfigPane.tsx`** — as arestas
> cruzadas (T-008 → T-002, T-011 → T-003) existem para não conflitar no merge. **Não remover.**
> **Nunca** hardcodar `if (agent === "claude")` nem tabela estática de capabilities no motor (AD-1).
> Cada linha `Deps:` fica **isolada, ids limpos, sem ponto final** (bug D-0001 do `parseDeps`).

## Fase 1 — O puro, em paralelo (T-001 ∥ T-005 ∥ T-007)

- [x] T-001: `maxLayerWidth` + `resolveConcurrency` puros no scheduler + 6º subpath export (D5/D6/D12/D17)
    `src/scheduler/graph.ts`: duas funções puras novas. (a) `maxLayerWidth(graph: TaskGraph): number`
    = `topoLayers(graph).reduce((max, l) => Math.max(max, l.length), 0)` — grafo vazio ⇒ `0`.
    (b) `resolveConcurrency(input): ConcurrencyResolution` — a **fonte única** da resolução, que hoje
    está triplicada (`orchestrator.ts:1345`, `orchestrator.ts:390`, `index.ts:786`). Assinatura:
    `resolveConcurrency({ flag?: number | "auto"; declared: number | "auto"; maxConcurrency: number;
    graph: TaskGraph }): { value: number; auto: boolean; width: number; widestLayer: readonly
    string[]; cap: number }`. Regras: precedência **flag > declared**; se o efetivo é um **número**,
    `value` é esse número **sem clamp nenhum** (D17 — o teto só morde o `auto`; `concurrency: 8` +
    `max_concurrency: 4` ⇒ **8**); se é `"auto"`, `value = Math.max(1, Math.min(maxLayerWidth(graph),
    maxConcurrency))` (o `max(1, …)` cobre o grafo vazio) e `widestLayer` = a camada mais larga (a
    **primeira**, em caso de empate — determinismo), para o dry-run justificar. `auto: true` só
    quando o efetivo foi `"auto"`. **Não** conhece flags da CLI nem config: recebe valores, devolve
    valor (AD-6).
    `src/scheduler/index.ts`: exportar `maxLayerWidth`, `resolveConcurrency` e o tipo
    `ConcurrencyResolution`.
    `package.json`: 6º subpath em `exports` — `"./scheduler": { "types": "./dist/scheduler.d.ts",
    "import": "./dist/scheduler.js" }`, **depois** de `./backlog`. `tsup.config.ts`: `"scheduler":
    "src/scheduler/index.ts"` no `entry` do segundo config (o de libs, `dts: true`). O barrel já é
    browser-safe (zero `node:fs`) — **não** importar nada de `node:` aqui, ou o build Vite do app
    quebra.
    NOVO `tests/scheduler/maxLayerWidth.test.ts`: vazio ⇒ 0; cadeia A→B→C ⇒ 1; leque (1 raiz, 4
    folhas) ⇒ 4; diamante ⇒ 2; múltiplas raízes sem aresta (5 tasks soltas) ⇒ 5.
    NOVO `tests/scheduler/resolveConcurrency.test.ts`: precedência flag > declared; `declared: 8` +
    `maxConcurrency: 4` ⇒ **8** e `auto: false` (D17 — o teste que trava a retrocompat); `"auto"` num
    DAG de camadas [3,2,1] com teto 4 ⇒ **3**; mesmo DAG com teto 2 ⇒ **2**; 20 tasks sem deps + teto
    4 ⇒ **4**; grafo vazio + `"auto"` ⇒ **1**; `flag: "auto"` sobrepõe `declared: 8`; `widestLayer`
    devolve os ids da camada e é estável no empate.
    Aceite: as duas funções puras, sem I/O; D17 travado por teste; `npm run build` emite
    `dist/scheduler.js` + `.d.ts` e `import { maxLayerWidth } from "@hgflima/loopy/scheduler"`
    resolve. **Nada** em `src/types.ts` / `schema.ts` muda nesta task (o repo segue verde).
    Verificação: `npm test -- scheduler && npm run build && npm run typecheck && npm run lint`
    Deps: nenhuma
    Files: src/scheduler/graph.ts, src/scheduler/index.ts, package.json, tsup.config.ts, tests/scheduler/maxLayerWidth.test.ts, tests/scheduler/resolveConcurrency.test.ts
    Scope: M

- [x] T-005: `src/acp/capabilities.ts` — parse puro de `configOptions` + fixtures reais das spikes (D28)
    NOVO `src/acp/capabilities.ts`, **puro** (zero I/O, zero SDK call — só tipos do SDK):
    `export interface AgentCapabilities { readonly modes: readonly string[]; readonly models:
    readonly string[]; readonly efforts: readonly string[]; readonly modeConfigId?: string; readonly
    modelConfigId?: string; readonly effortConfigId?: string }` e `export function
    parseCapabilities(configOptions: readonly SessionConfigOption[] | undefined, fallbackModes?:
    readonly string[]): AgentCapabilities`. Mecânica: acha a option por **categoria** (`"mode"` /
    `"model"` / `"thought_level"`) — o mesmo critério de `findConfigId` (`session.ts:133`), que esta
    task **generaliza** — e extrai `options.map(o => o.value)` de cada uma, guardando também o `id`
    de cada categoria (o id **difere por adapter**: `effort` no Claude, `reasoning_effort` no Codex —
    é ele que vai para o `set_config_option`). Categoria **ausente ⇒ array vazio** — a ausência é
    informação real (OpenCode não tem `thought_level`), **nunca** um erro. `fallbackModes` (o legado
    `availableModes`) só é usado quando **não há** categoria `mode` nos `configOptions` — a
    precedência é `configOptions` **primeiro** (D28: é a fonte da verdade; `availableModes` é o furo,
    nulo no OpenCode). Sem `configOptions` **e** sem fallback ⇒ tudo vazio, sem lançar (degradação).
    `category: "model_config"` (fast mode) é **ignorada** — D35, fora de escopo.
    NOVOS fixtures `tests/fixtures/capabilities/{claude,codex,opencode}.json`: **cópia fiel** dos
    `spikes/acp-{claude,codex,opencode}-capabilities.out.json` (o objeto inteiro; o teste lê
    `session.configOptions` e `session.modes`). Não inventar mock nem podar as listas — os 146 models
    do OpenCode são o dado.
    NOVO `tests/acp/capabilities.test.ts`, dirigido pelos 3 fixtures: claude ⇒ 6 modes
    (`auto…bypassPermissions`), 4 models, 6 efforts, `effortConfigId === "effort"`; codex ⇒ 3 modes
    (`read-only/agent/agent-full-access`), 6 models, 4 efforts (`low..xhigh`), `effortConfigId ===
    "reasoning_effort"`; **opencode ⇒ `modes: ["build","plan"]`** (extraídos dos `configOptions`,
    **apesar** de `modes: null` — é o achado que motiva a change), 146 models no formato
    `provider/model` e **`efforts: []`**. Mais: `configOptions: undefined` + `fallbackModes` ⇒ usa o
    fallback; `configOptions` **com** categoria `mode` + `fallbackModes` divergente ⇒ vence o
    `configOptions`; entrada vazia ⇒ tudo `[]`, sem throw.
    Aceite: função pura provada contra os **3 adapters reais**; ausência de `thought_level` ⇒ `[]`
    (não erro); `configOptions` tem precedência sobre `availableModes`. **Nenhum** arquivo do motor
    passa a usá-la ainda (é o T-006) — o repo segue verde.
    Verificação: `npm test -- capabilities && npm run typecheck && npm run lint`
    Deps: nenhuma
    Files: src/acp/capabilities.ts, tests/acp/capabilities.test.ts, tests/fixtures/capabilities/claude.json, tests/fixtures/capabilities/codex.json, tests/fixtures/capabilities/opencode.json
    Scope: S

- [x] T-007: `StoreEvent` `warning` — o 14º tipo, o canal do aviso visível (D15)
    `src/tui/store.ts`: 14ª variante da união `StoreEvent` (`:148-234`) — `{ type: "warning";
    taskId?: string; stepId?: string; agentName?: string; message: string }` (`taskId`/`stepId`
    opcionais: um aviso pode nascer **antes** de qualquer task, na validação eager do Run). O
    `switch` do `reduce` (`:333-478`) é **exaustivo e sem `default`** ⇒ o `tsc` vai apontar o buraco;
    tratar acumulando em `StoreState.warnings: readonly WarningEntry[]` (campo novo, `[]` no estado
    inicial) — **cap de 50 entradas** (dedup por `message` idêntica consecutiva), para um aviso em
    loop não virar vazamento de memória num Run longo. Quando o evento tem `taskId`/`stepId`, marcar
    também `StepState.warned = true` (campo novo, opcional) — é o gancho do badge da GUI.
    `src/tui/view.ts` (puro): `renderWarnings(state): string[]` — linhas `⚠ <agente>: <mensagem>` com
    a cor de alerta já existente em `COLORS`; e o `App.tsx` do Ink renderiza a lista **abaixo** dos
    streams (não é painel novo: são N linhas no fim). Sem avisos ⇒ zero linhas, zero moldura.
    `src/tui/transport.ts`: **nada muda** — `emit` já faz o spread genérico de qualquer `StoreEvent`
    (`:98`). Só conferir que `parseTransportLine` continua roteando (o cast é frouxo por design).
    `apps/menubar/src/state/store-bridge.ts`: o bridge **delega ao `reduce` do motor** (`:140`), então
    o evento chega sozinho ao `StoreState`. O que falta é **mostrar**: expor `warnings` no `UIState` e
    marcar o card. `apps/menubar/src/graph/TaskNode.tsx` (ou o card do Kanban, o que exibe steps):
    badge `⚠` quando `step.warned`, com o texto no `title`/tooltip. Sem painel de logs (C-0009) — o
    aviso vive no card e numa linha de alerta.
    Testes: `tests/tui/store.test.ts` — evento `warning` acumula em `state.warnings`; dedup
    consecutiva; cap de 50; com `stepId` marca `warned` no step certo; sem `taskId` não quebra.
    `tests/tui/view.test.ts` — `renderWarnings` com 0/1/N avisos. `apps/menubar/**`: o store-bridge
    propaga `warnings` para o `UIState` e o card ganha o badge.
    Aceite: 14º evento na união; `tsc` verde depois de tratado; aviso aparece na TUI **e** na GUI;
    Transport intocado. **Ninguém emite `warning` ainda** — o emissor é o T-006.
    Verificação: `npm test -- tui && npm test -w apps/menubar && npm run typecheck && npm run lint`
    Deps: nenhuma
    Files: src/tui/store.ts, src/tui/view.ts, src/tui/App.tsx, apps/menubar/src/state/store-bridge.ts, apps/menubar/src/graph/TaskNode.tsx, tests/tui/store.test.ts, tests/tui/view.test.ts
    Scope: M

## Fase 2 — O contrato quebra (T-002) e a sessão pergunta (T-006)

- [x] T-002: `concurrency: number | "auto"` + `max_concurrency` — schema, tipos, serialize, CLI e orchestrator (D6/D7/D8/D9/D11/D17/D38)
    **A fatia vertical inteira da Feature 1 no motor.** Indivisível: mudar `LoopyConfig.concurrency`
    quebra o `tsc` em todos os consumidores de uma vez (D11 — efeito desejado).
    `src/types.ts`: `LoopyConfig.concurrency: number | "auto"` (`:322`); **nova** `LoopyConfig.
    max_concurrency: number`; `RunFlags.concurrency?: number | "auto"` (`:508`).
    `src/config/schema.ts`: `concurrency: z.union([z.literal("auto"), z.number().int().min(1)]).
    default(1)` (`:344`) e, logo abaixo, `max_concurrency: z.number().int().min(1).default(4)`. O
    `.strict()` (`:349`) rejeita chave desconhecida — sem isso o yml quebra. **Sem** regra nova no
    `superRefine` (`:350`): `max_concurrency` com `concurrency` numérico é **legal e inerte** (D17).
    `src/config/serialize.ts`: `"max_concurrency"` na `CANONICAL_KEYS` (`:21-35`), **logo após**
    `"concurrency"` — senão o fallback de `:62` o joga no fim do YAML, em silêncio. E o
    `initialConfigTemplate` (`:142`) ganha `max_concurrency: 4` (ele **duplica** os defaults do
    schema à mão; é o 3º lugar que precisa saber).
    `src/loop/orchestrator.ts`: **remover a triplicação** — os dois `?? config.concurrency`
    (`:390` no `planDryRun`, `:1345` no run vivo) passam a chamar o `resolveConcurrency` do
    `src/scheduler` (T-001), que já resolve o `auto`. O `DryRunPlan` (`:270-278`) troca `concurrency:
    number` por `concurrency: ConcurrencyResolution` (o objeto todo — o dry-run precisa da
    justificativa). `renderDag` (`:472`) imprime: número puro ⇒ `concorrência efetiva: 8` (formato de
    hoje, byte-idêntico); `auto` ⇒ `concorrência efetiva: 3 (auto — camada mais larga: T-001, T-002,
    T-003; teto: 4)`. O teto do pool (`inFlight.size >= concurrency`, `:1609`) passa a usar
    `resolution.value` — **um `number`**, nunca a união.
    `src/index.ts`: novo parser `parseConcurrency(value)` (ao lado do `parsePositiveInt`, `:155`) que
    aceita `"auto"` **ou** inteiro positivo, e lança `InvalidArgumentError` no resto — a flag
    `--concurrency <n|auto>` (`:192`) passa a usá-lo (o `--max-iterations` **continua** com
    `parsePositiveInt`). `toFlags` (`:230`): a guarda `typeof opts.concurrency === "number"` precisa
    passar a aceitar `"auto"` — **é a segunda porta**, e esquecê-la faz a flag virar `undefined` em
    silêncio. `--task` continua forçando `concurrency: 1` (`:585`). O dry-run da CLI (`:786`) delega
    ao `resolveConcurrency`. **Sem** `--max-concurrency` (D38).
    Testes: `tests/config/schema.test.ts` (`:385`) — `"auto"` aceito; `"banana"` rejeitado com path
    `"concurrency"`; `max_concurrency: 0` rejeitado; default `4` quando omitido.
    `tests/config/serialize.test.ts` (`:15` — a lista de chaves está **duplicada** ali; atualizar) —
    `max_concurrency` sai logo após `concurrency`; `initialConfigTemplate` passa no schema.
    `tests/loop/orchestrator.test.ts` — `auto` num DAG [3,2,1] roda com pool 3; `concurrency: 8` +
    `max_concurrency: 4` roda com **8** (D17); `concurrency: 3` **byte-idêntico** (regressão).
    `tests/cli/dry-run.test.ts` (`:355`) — `auto` imprime valor **e** justificativa; `--concurrency
    auto` sobrepõe `concurrency: 8` do yml; `--concurrency 4` segue funcionando; `--task X` força 1.
    Aceite: SC1–SC5 e SC13 do spec; `npm run typecheck` verde **em todos** os consumidores (o app
    inclusive — se o `ConfigPane` quebrar, é o T-003; aqui basta o mínimo para compilar, sem UI nova);
    nenhum yml existente muda de comportamento.
    Verificação: `npm run typecheck && npm run lint && npm test && npm test -w apps/menubar`
    Deps: T-001
    Files: src/types.ts, src/config/schema.ts, src/config/serialize.ts, src/loop/orchestrator.ts, src/index.ts, tests/config/schema.test.ts, tests/config/serialize.test.ts, tests/loop/orchestrator.test.ts, tests/cli/dry-run.test.ts
    Scope: L

- [x] T-006: a Sessão descobre por categoria, valida `mode` fail-closed e avisa alto (D18/D28/D33)
    **O bug de fundo são duas linhas lendo a fonte errada.** `src/acp/session.ts`,
    `parseConfigFromSession` (`:183-189`): trocar o par `findConfigId(opts,"model")` +
    `newSessionResponse.modes?.availableModes` por **uma** chamada a `parseCapabilities(opts,
    fallbackModes)` (T-005), guardando um `AgentCapabilities` no wrapper. Os campos
    `modelConfigId`/`effortConfigId`/`availableModeIds` (`:147-156`) passam a **derivar** dele (não
    manter dois estados). O replay pós-`clear()` (`:315`) continua funcionando: a re-descoberta é a
    mesma chamada.
    Expor: `LoopySession` (`:113-116`) ganha `readonly capabilities: AgentCapabilities` — hoje a
    descoberta é privada e **não sai de lá** (é o que trava CLI e GUI).
    `setMode` (`:216-232`): valida contra `capabilities.modes` — **fail-closed nos três adapters**
    (hoje o `if` só roda quando `availableModeIds.length > 0`, e o OpenCode, com `modes: null`,
    **escapa de qualquer validação**). Mensagem: `mode 'acceptEdits' não é aceito por 'opencode'
    (aceita: build, plan)`. Lista **vazia** (adapter que não anuncia nada, nem em `configOptions`) ⇒
    **passa cru** e avisa — não dá para fail-close contra uma lista que não existe.
    `setConfigOption` (`:258-283`): além do no-op quando a **categoria** não existe, validar o
    **valor** contra `capabilities.efforts` / `capabilities.models`. Fora da lista ⇒ **não chama**
    `set_config_option`, **não** grava `appliedModel`/`appliedEffort` (hoje grava mesmo no no-op —
    `:241`,`:250`) e **emite `warning`** (T-007) via novo `deps.onWarning?(message)` no `SessionDeps`:
    `effort 'max' não é aceito por 'codex' (aceita: low, medium, high, xhigh) — ignorado`. Categoria
    ausente (effort no OpenCode) ⇒ mesmo aviso, texto próprio: `agente 'opencode' não anuncia effort —
    'high' ignorado`. Nunca clampar, nunca traduzir (D18) — o `xhigh` do Codex **não** é o `max` do
    Claude. `logger.debug` continua, mas **deixa de ser o único canal**.
    `src/index.ts` (fiação mínima): `onWarning` do `SessionDeps` despacha o `StoreEvent` `warning` —
    ao lado de onde o `onTraffic` já é injetado (`:431`).
    Testes em `tests/acp/session.test.ts` (fake agent real por subprocess; helper `selectOption`,
    `:500`): `mode` fora da lista ⇒ **throw** com a lista na mensagem, inclusive num cenário
    **estilo-OpenCode** (`modes: null` + `configOptions` com categoria `mode`) — o teste que prova o
    furo fechado; `effort` fora da lista ⇒ `onWarning` chamado, `set_config_option` **não** enviado
    (o spy de tráfego, `:525`), run **segue**; `model` idem; adapter **sem** `configOptions` e sem
    `modes` ⇒ degrada sem quebrar (passa cru + avisa); os testes de no-op de hoje (`:589-616`) mudam
    de expectativa (de `logger.debug` silencioso para `onWarning`) — atualizar, não deletar.
    Aceite: SC8 (parcial — a validação existe; o *eager* é o T-009), SC9, SC10; `mode: acceptEdits`
    num claude **continua** funcionando (regressão); zero `if (agent === "…")` no motor.
    Verificação: `npm test -- acp && npm run typecheck && npm run lint && npm test`
    Deps: T-005, T-007
    Files: src/acp/session.ts, src/index.ts, tests/acp/session.test.ts
    Scope: M

## Fase 3 — As superfícies (T-003 ∥ T-004 ∥ T-008)

- [x] T-003: `ConfigPane` — toggle `auto` + campo `max_concurrency` (D7/D11)
    `apps/menubar/src/config/ConfigPane.tsx`, seção `concurrency` (`:330-343`): o `NumberField` de
    hoje é `number`-only e **não** representa `"auto"`. Adicionar um `ToggleField` **"auto (derivar
    do DAG)"**: ligado ⇒ o `NumberField` de `concurrency` **some** (o valor no draft é a string
    `"auto"`) e aparece o `NumberField` **`max_concurrency`** (`min={1}`, default 4, hint "Teto do
    auto — ignorado quando concurrency é um número"); desligado ⇒ volta o `NumberField` de
    `concurrency`. **Preservar `max_concurrency` no draft** ao alternar o toggle (não zerar: é o item
    6 dos critérios de sucesso), e **nunca** converter `"auto"` em número ao salvar (o
    `serializeConfig` precisa receber a string literal).
    `SECTION_PREFIXES` (`:44-56`) ganha `max_concurrency` na seção `concurrency`, senão o erro do zod
    para esse campo não aparece em seção nenhuma.
    `ConfigPane.test.tsx` (`:107-150`): abre um yml com `concurrency: "auto"` ⇒ toggle **ligado**,
    campo numérico de concurrency **ausente**, `max_concurrency` visível; salvar devolve **`"auto"`**
    (string), não `4` nem `1`; ligar/desligar o toggle **preserva** `max_concurrency`; yml com
    `concurrency: 3` ⇒ toggle desligado e `patch("concurrency", 4)` continua passando **number**
    (regressão); `max_concurrency: 0` mostra o erro inline do zod.
    Aceite: SC6; o pane compila contra o novo tipo (D11); zero conversão silenciosa de `auto` → número.
    Verificação: `npm test -w apps/menubar -- ConfigPane && npm run typecheck && npm run lint`
    Deps: T-002
    Files: apps/menubar/src/config/ConfigPane.tsx, apps/menubar/src/config/ConfigPane.test.tsx
    Scope: S

- [x] T-004: `DepsFlow` — a frente de onda resolve o `auto` com a MESMA função do motor (D7/D12)
    **O bug latente**: `wavefront(statusById, edges, limit)` (`flow-state.ts:37`, corte em `:51`)
    recebe hoje o `concurrency` **cru do draft** (`App.tsx:422` → `ViewSwitcher` → `DepsFlow.tsx:88`).
    Com `concurrency: "auto"`, `front.size >= "auto"` é **sempre `false`** ⇒ o corte **desaparece em
    silêncio**. Consertar resolvendo **antes** de chamar, com a função do motor — `src/CLAUDE.md`
    manda **não reimplementar** o que o motor exporta.
    `apps/menubar/src/graph/flow-state.ts`: `wavefront` mantém `limit: number` (é puro e assim
    continua — **não** aceitar a união aqui). NOVA fn `resolveWavefrontLimit(concurrency: number |
    "auto" | undefined, maxConcurrency: number | undefined, nodes, edges): number` que, no caso
    `"auto"`, chama `resolveConcurrency` de **`@hgflima/loopy/scheduler`** (o 6º subpath do T-001)
    montando o `TaskGraph` a partir dos `nodes`/`edges` que o grafo já tem em mãos (`TaskGraph` é só
    `{ nodes, edges }`); `undefined` ⇒ `Infinity` (o fallback seguro de hoje: não corta).
    `apps/menubar/src/graph/DepsFlow.tsx` (`:53`, `:88`): a prop vira `concurrency?: number | "auto"`
    e ganha `maxConcurrency?: number`; o `useMemo` passa a chamar `resolveWavefrontLimit`.
    `App.tsx` (`:422`) e `ViewSwitcher.tsx` (`:37,57,128`): encanar **também** `maxConcurrency={
    configDraft.draft?.max_concurrency}` (sem isso o teto do auto não chega à GUI e a frente corta no
    número errado).
    `flow-state.test.ts` (`:88`) e `DepsFlow.test.tsx` (`:389-400`): manter os dois testes de hoje
    (número corta; `undefined` não corta) e somar — `"auto"` num backlog **sem deps** com
    `max_concurrency: 4` ⇒ frente de **4** (não 20); `"auto"` num DAG de camadas [3,2,1] com teto 4 ⇒
    **3**; `"auto"` **sem** `max_concurrency` ⇒ usa o default 4 (a GUI não pode inventar outro teto).
    Aceite: a frente de onda corta com `auto`; **zero** reimplementação da fórmula no app (o import
    vem do subpath); `wavefront` segue puro e `number`-only; o corte com número **não regride**.
    Verificação: `npm test -w apps/menubar -- DepsFlow flow-state && npm run typecheck && npm run lint`
    Deps: T-001, T-002
    Files: apps/menubar/src/graph/flow-state.ts, apps/menubar/src/graph/DepsFlow.tsx, apps/menubar/src/App.tsx, apps/menubar/src/panes/ViewSwitcher.tsx, apps/menubar/src/graph/flow-state.test.ts, apps/menubar/src/graph/DepsFlow.test.tsx
    Scope: M

- [x] T-008: `loopy probe-agent <nome> [--json]` + cache `.loopy/capabilities.json` (D30/D32)
    **O 1º subcomando do projeto** — hoje `src/index.ts:164-208` é um comando root só, com `[dir]`
    posicional (`:828`). Registrar um `.command("probe-agent <nome>")` muda a semântica posicional:
    **teste de regressão obrigatório** de `loopy .`, `loopy --dry-run <dir>` e `loopy -t T-001 <dir>`.
    `src/index.ts`: subcomando `probe-agent <nome>` com `--json` e `-c, --config <path>` (precisa do
    yml para achar o `command` do agente no Registry). Fluxo: carrega o config → acha o Agente pelo
    nome (inexistente ⇒ **exit ≠ 0** listando as chaves do registry) → spawna **só aquele** processo
    (`openAgent`) → `initialize` + `session/new` no `workspace.root` → lê `session.capabilities`
    (T-006) → imprime → **fecha tudo** (sem worktree, sem loop). `--json` ⇒ o objeto
    `AgentCapabilities` cru em stdout; sem `--json` ⇒ texto legível (`modes: build, plan` /
    `models: 146 (opencode/…, …)` / `efforts: —`). Adapter que não sobe (não instalado, offline,
    timeout) ⇒ **exit ≠ 0** com o motivo, **nunca** um JSON vazio fingindo sucesso.
    NOVO `src/acp/capabilities-cache.ts` (o único arquivo com `node:fs` desta feature — o
    `capabilities.ts` do T-005 **fica puro**): `readCache(root)` / `writeCache(root, command,
    caps)`, keyed pelo **`command` (argv) serializado**, não pelo nome do agente (o nome é do yml; o
    argv é o que identifica de fato o adapter+versão — D32). Formato: `{ "<argv joined>": { probedAt,
    capabilities } }` em `.loopy/capabilities.json`. `.loopy/` já é Artefato gitignored. O
    `probe-agent` **grava** o cache; leitura corrompida/ausente ⇒ trata como vazio (nunca lança).
    NOVO `tests/cli/probe-agent.test.ts` (fake agent por subprocess, como `tests/acp/session.test.ts`):
    `--json` imprime as 3 listas; agente inexistente ⇒ exit ≠ 0 nomeando o registry; adapter que
    falha ao subir ⇒ exit ≠ 0; o cache é **escrito** em `.loopy/capabilities.json` com a chave = argv;
    **e as regressões**: `loopy .`, `loopy --dry-run <dir>`, `loopy -t T-001 <dir>` continuam
    roteando para o comando root.
    Aceite: SC7 (contra o adapter real, no checkpoint humano; contra o fake, no teste); zero
    worktree, zero token; o `[dir]` posicional **não** regride.
    Verificação: `npm test -- probe-agent cli && npm run typecheck && npm run lint && npm test`
    Deps: T-002, T-005, T-006
    Files: src/index.ts, src/acp/capabilities-cache.ts, tests/cli/probe-agent.test.ts
    Scope: M

## Fase 4 — Fail-fast e a GUI que sabe (T-009 ∥ T-010 ∥ T-012)

- [ ] T-009: validação **eager** no início do Run + dry-run que valida pelo cache (D36/D37/D23)
    **Sem isto, a validação do T-006 chega tarde demais para ser útil** (estouraria na 3ª task, meia
    hora depois). `src/index.ts`, `defaultRunLive` (`:335-512`): logo após o
    `createAgentProcessPool` (`:405-447`) — que já é eager e fail-fast (`pool.ts:81`) — para **cada
    Agente referenciado**: abrir uma **Sessão descartável no `workspace.root`** (as capabilities só
    existem depois do `session/new` — o `initialize` não as traz), ler `session.capabilities`,
    **gravar o cache** (T-008, de graça) e **fechar a sessão** (`pool.closeSession`). Com as
    capabilities em mãos, validar **todos os steps do pipeline que referenciam aquele agente**:
    `mode` fora da lista ⇒ **aborta o Run** com a mensagem do T-006 (agente + valor + lista aceita),
    **antes** de qualquer `git worktree add`; `effort`/`model` fora da lista ⇒ `warning` (não aborta).
    Agrupar **todos** os erros numa mensagem só (não abortar no primeiro: o operador quer ver os três
    steps errados de uma vez).
    `src/loop/orchestrator.ts` (dry-run) + `src/index.ts` (`printDryRun`): o `--dry-run` **não sonda**
    (D23 — zero processo, por contrato) mas **lê** `.loopy/capabilities.json` e valida offline. Com
    cache ⇒ reporta por step (`✓ implement: mode 'acceptEdits' ok (claude)` / `✗ simplify: mode
    'plan' não é aceito por 'opencode' (aceita: build, plan)`) e **sai ≠ 0** se houver `✗`. Sem cache
    ⇒ linha única `capabilities: não verificadas (rode 'loopy probe-agent')` e **exit 0** — nunca
    fingir que checou. Cache velho pode reprovar um yml correto: por isso o dry-run **reporta**; a
    autoridade é a validação eager, contra o adapter vivo.
    NOVO `tests/integration/eager-capability-validation.test.ts`: pipeline com `mode` inválido no
    **último** step de um backlog longo ⇒ o Run **aborta no início**, a mensagem lista os valores
    aceitos, e **nenhum diretório `.worktrees/` foi criado** (asserção direta no fs — é o coração de
    SC8); `mode` válido ⇒ o Run segue normal (regressão); `effort` inválido ⇒ **não** aborta, emite
    `warning`. `tests/cli/dry-run.test.ts`: com cache válido ⇒ reporta ✓; com cache que reprova ⇒ ✗ +
    exit ≠ 0; **sem** cache ⇒ "não verificadas" + exit 0.
    Aceite: SC8 completo (falha no início do Run, zero worktree, zero token); dry-run continua
    zero-processo; sem cache, nunca finge ter checado.
    Verificação: `npm test && npm run typecheck && npm run lint`
    Deps: T-008
    Files: src/index.ts, src/loop/orchestrator.ts, tests/integration/eager-capability-validation.test.ts, tests/cli/dry-run.test.ts
    Scope: M

- [ ] T-010: GUI — ponte de sondagem + `StepEditor` com selects sondados (D26/D30/D31)
    A ponte: a GUI precisa **rodar o `probe-agent`**. Reusar o mesmo caminho do sidecar (`externalBin`
    do Tauri) com args `probe-agent <nome> --json -c <path>`, coletando stdout — **um comando Tauri
    novo** (`probe_agent`) ou a mesma mecânica de spawn do motor, o que for menor. ⚠️ Se tocar
    `src-tauri/` (Rust), **não** rodar o Run desta change pela GUI: o watcher recompila, o app
    reinicia e mata o motor-filho (`loopy-dogfooding-tauri-dev-restarts-app-kills-run`).
    NOVO `apps/menubar/src/config/useAgentCapabilities.ts`: hook que, dado o **nome do agente**,
    devolve `{ status: "idle" | "probing" | "ok" | "failed"; caps?: AgentCapabilities; reason?:
    string }`. Lê o cache primeiro (o `probe-agent` do T-008 o mantém); sonda sob demanda. **Nunca
    bloqueia a edição** (D31).
    `apps/menubar/src/config/StepEditor.tsx` (`:334-364` — hoje **4 `TextField` livres**):
    - `agent` (`:346`) ⇒ **`SelectField` FECHADO, sem escape** com as chaves do registry +
      `(default: <nome>)`. É o único campo em que fechar é **correto**: o `superRefine`
      (`schema.ts:351-412`) já **exige** que `step.agent` exista no registry — fora dele não é
      exótico, é inválido (D26).
    - `mode` / `model` / `effort` ⇒ `SelectField` populado com **os valores sondados daquele agente**
      (`caps.modes` / `caps.models` / `caps.efforts`). `efforts: []` (OpenCode) ⇒ campo desabilitado
      com a razão ("este agente não anuncia effort"). Sondagem **falhou** ⇒ **degrada para o
      `TextField` livre de hoje** e mostra o motivo (D31).
    - **Um valor já salvo que está fora da lista NÃO pode ser corrompido ao salvar** (o select tem de
      preservar o valor desconhecido, marcando-o) — é a diferença entre avisar e destruir o yml.
    `StepEditor.test.tsx`: select de `agent` lista **exatamente** as chaves do registry (nem mais nem
    menos); `agent: opencode` ⇒ select de `mode` com **exatamente** `build` e `plan`, e `model` com os
    146 (fixture do T-005) — **sem nenhuma tabela hardcoded no código**; `efforts: []` ⇒ desabilitado
    + razão; sondagem falha ⇒ texto livre + motivo visível; valor fora da lista sobrevive ao salvar.
    Aceite: SC11, SC12; **zero** tabela estática de capabilities no app (o dado vem da sondagem).
    Verificação: `npm test -w apps/menubar -- StepEditor useAgentCapabilities && npm run typecheck && npm run lint`
    Deps: T-008
    Files: apps/menubar/src/config/useAgentCapabilities.ts, apps/menubar/src/config/StepEditor.tsx, apps/menubar/src/config/StepEditor.test.tsx, apps/menubar/src-tauri/src/lib.rs
    Scope: L

- [ ] T-012: `examples/loopy.yml` com um agente opencode + `docs/reference/configuration.md` (D24)
    `examples/loopy.yml` (o exemplo canônico é a **doc de fato** do `agents:`): adicionar um Agente
    `opencode` com `command: ["opencode", "acp"]` — **subcomando do binário**, não pacote npm como os
    outros dois (é exatamente a pegadinha que motiva os presets do T-011) — e um step que o use com
    `mode: build` (o **dialeto literal**; o motor não traduz nada — D29). O `loopy.yml` da raiz
    **não** muda (sem canônico, o que está lá já é o formato final).
    `docs/reference/configuration.md`: **a seção `agents:` hoje NÃO EXISTE** (`grep agents` = 0 hits)
    — escrever: o Registry de Agentes, `command`/`model`/`effort`/`display_name`, a exclusividade
    mútua com `acp.command` (o `superRefine`), e a regra de ouro: **`mode`/`model`/`effort` são o
    dialeto literal do agente — descubra com `loopy probe-agent <nome>`**. Documentar também
    `concurrency: auto` + `max_concurrency` (default 4; o teto **só** morde o `auto` — D17) e o
    subcomando `probe-agent` em `docs/reference/cli.md` (junto com `--concurrency <n|auto>`).
    Aceite: um leitor que só tem a doc consegue escrever um `agents:` com opencode e descobrir o
    `mode` certo sem tentativa e erro; `examples/loopy.yml` **passa no schema**
    (`tests/config/*` já valida os exemplos — se não valida, adicionar a asserção).
    Verificação: `npm test && npm run lint`
    Deps: T-002, T-008
    Files: examples/loopy.yml, docs/reference/configuration.md, docs/reference/cli.md
    Scope: S

## Fase 5 — `ConfigPane` completo (T-011)

- [ ] T-011: `ConfigPane` — presets de `command` + botão sondar/refresh (D27/D32)
    `apps/menubar/src/config/ConfigPane.tsx`, seção do Registry (`AgentEntry`, `:100-145`):
    - **"Adicionar agente"** oferece **Claude / Codex / OpenCode / Em branco**, preenchendo o
      `command`. Existe por causa do **OpenCode**: `["opencode", "acp"]` é **subcomando do binário**,
      enquanto os outros dois são `["npx","-y","@agentclientprotocol/…"]` — **ninguém adivinha isso
      num formulário em branco**. Os nomes de agente entram **só na GUI**, como atalho de digitação;
      **jamais** no motor (AD-1: nenhuma allowlist, nenhum `if (agent === …)` em `src/`).
    - Botão **"sondar"/"refresh"** por agente, que chama o hook do T-010 (`useAgentCapabilities`),
      força um re-probe (ignorando o cache) e mostra o resultado inline (`modes: build, plan · 146
      models · sem effort`) ou a falha com o motivo. Sondar custa segundos (o `npx -y` pode **baixar**
      o pacote) — por isso o cache (D32) e por isso o refresh é **explícito**, nunca a cada clique.
    - Os campos `model`/`effort` do registry (`:125-137`, hoje `TextField` livres) passam a usar os
      valores sondados quando houver, degradando para texto livre quando não (mesma regra do T-010).
    `ConfigPane.test.tsx`: os 4 presets preenchem o `command` esperado (o do opencode é
    `["opencode","acp"]`); "Em branco" não preenche nada; o refresh chama a sondagem **ignorando o
    cache**; falha mostra o motivo e **não** apaga o que está no formulário.
    Aceite: adicionar um opencode pela GUI leva **um clique**, não uma pesquisa; zero preset vazando
    para `src/` (grep `opencode` em `src/` = 0 hits fora de doc/exemplo).
    Verificação: `npm test -w apps/menubar -- ConfigPane && npm run typecheck && npm run lint && npm test`
    Deps: T-003, T-010
    Files: apps/menubar/src/config/ConfigPane.tsx, apps/menubar/src/config/ConfigPane.test.tsx
    Scope: M

## Fase 6 — Fechar a change (T-013)

- [ ] T-013: `CONTEXT.md`, `CLAUDE.md` (sync), ADR-0008, ADR-0009 e o D-0003 fechado (D16/D34)
    **É a última e depende de TODAS** — não por cerimônia, mas por **mecânica de merge**: toca
    `CONTEXT.md` e os `CLAUDE.md`, que as duas features também tocam. Sem a aresta, duas tasks
    paralelas editariam os mesmos arquivos e conflitariam
    (`loopy-parallel-tasks-same-file-rebase-cant-fix`).
    Rodar `/domain-modeling` no `CONTEXT.md` (glossário da linguagem ubíqua): termos **novos** —
    **Capability** (o que o Agente anuncia em `configOptions`: modes/models/efforts), **Sondagem**
    (`probe-agent`: `initialize` + `session/new`, ler, encerrar), **Largura do grafo** (a camada
    topológica mais larga = o `auto`), **Teto do auto** (`max_concurrency`, default 4, que **só**
    morde o `auto` — D17); e o termo **Dialeto** passa a ser explicitamente **não-traduzido** (o yml
    guarda o dialeto literal do Agente; o motor valida, **nunca** traduz — D29).
    Rodar `/write-agent-md` em modo **sync** nos intent nodes afetados: raiz (`CLAUDE.md` — a linha
    de flags, os 5→**6** subpath exports, o glossário), `src/acp/` (a assimetria de `:26` continua,
    mas agora a fonte é `configOptions`; a validação é fail-closed nos **três** adapters),
    `src/config/`, `src/loop/`, `src/tui/` (o 14º `StoreEvent`) e `apps/menubar/`.
    NOVO `docs/adrs/0008-capabilities-de-agente-por-descoberta.md`: por que **`configOptions` e não
    `availableModes`** (o `modes: null` do OpenCode era o furo, e os dados sempre estiveram lá) **e
    por que o vocabulário canônico foi rejeitado** (a premissa "a descoberta falha" era falsa; sem o
    furo, o canônico é uma camada de tradução que só adiciona indireção e **envelhece** — a
    descoberta, não). Registrar as decisões revogadas (D1/D2/D3/D4/D13/D14/D19/D20/D21/D22/D25) — o
    spec as guarda **exatamente** para este ADR.
    NOVO `docs/adrs/0009-concorrencia-derivada-do-dag.md`: a fórmula (camada mais larga), a nota
    técnica (é o *limite inferior* do paralelismo real — o pico exato é o maior antichain e exigiria
    matching bipartido; coincide na prática), o teto e **por que o teto só morde o `auto`** (D17 =
    retrocompat absoluta).
    `.harn/devy/debts/D-0003-no-unified-agent-capability-adapter.md`: **status → resolvido**,
    apontando esta change. O débito pedia "uma interface única que faça o de/para". A resposta é
    **não fazer de/para — expor**. Registrar o porquê: o de/para envelhece a cada versão de adapter;
    a descoberta, não. (D34.)
    Atualizar `.harn/devy/changes/index.md` com a C-0016 e registrar o **débito novo** do `fast mode`
    (D35: `category: model_config`, revelado nos 3 adapters, deixado de fora).
    Aceite: SC15; `CONTEXT.md` com os 4 termos novos + o Dialeto redefinido; os 2 ADRs escritos; o
    D-0003 fechado com o registro da inversão; o débito do fast mode criado.
    Verificação: `npm run typecheck && npm run lint && npm test && npm test -w apps/menubar && npm run build`
    Deps: T-001, T-002, T-003, T-004, T-005, T-006, T-007, T-008, T-009, T-010, T-011, T-012
    Files: CONTEXT.md, CLAUDE.md, src/acp/CLAUDE.md, src/config/CLAUDE.md, src/loop/CLAUDE.md, src/tui/CLAUDE.md, apps/menubar/CLAUDE.md, docs/adrs/0008-capabilities-de-agente-por-descoberta.md, docs/adrs/0009-concorrencia-derivada-do-dag.md, .harn/devy/debts/D-0003-no-unified-agent-capability-adapter.md, .harn/devy/changes/index.md
    Scope: L
