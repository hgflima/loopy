# Spec: C-0016 — Concorrência automática (`concurrency: auto`) + capabilities de agente por descoberta

> Duas features numa change só (D0). Não compartilham arquivo: a primeira vive em
> `config/schema` + `scheduler` + `orchestrator` + CLI + GUI; a segunda em `acp/session` + CLI + GUI.
> Cruzam-se apenas no `loopy.yml`, em campos distintos.
>
> ⚠️ **Este spec foi reescrito na 3ª rodada de refine.** A Feature 2 era "abstração de dialeto"
> (vocabulário canônico + tradução). Uma leitura dos dados brutos das spikes derrubou a premissa —
> ver **O achado** logo abaixo. O histórico das decisões revogadas está em `§Decisões revogadas`.

## O achado que reescreveu a Feature 2

O motor valida `mode` contra `session.modes.availableModes` (`src/acp/session.ts:216`). O OpenCode
deixa esse campo **nulo** — daí a crença de que "o OpenCode não anuncia modes", que sustentava todo
o desenho anterior (vocabulário canônico + tradução + tentativa-em-ordem às cegas).

É falso. Os `*.out.json` das spikes mostram que **os três adapters anunciam tudo** — só que em
`configOptions`, não em `availableModes`:

| | `availableModes` | `configOptions[category="mode"].options` |
|---|---|---|
| claude 0.59 | `[auto, default, acceptEdits, plan, dontAsk, bypassPermissions]` | os mesmos 6 |
| codex 1.1.2 | `[read-only, agent, agent-full-access]` | os mesmos 3 |
| **opencode 1.17.9** | **`null`** ← o furo | **`[build, plan]`** ← os dados estão aqui |

`configOptions` é a **mesma** estrutura de onde o motor já lê `model` e `effort` por categoria
(`findConfigId`, `session.ts:133`). Ou seja: **o motor está lendo a fonte errada**, e a descoberta
que se acreditava impossível funciona nos três adapters, nos três eixos:

| eixo | categoria | claude | codex | opencode |
|---|---|---|---|---|
| mode | `mode` | 6 opções | 3 opções | **2 opções** |
| model | `model` | 4 (`opus[1m]`…) | 6 (`gpt-5.6-terra`…) | **146** (`provider/model`) |
| effort | `thought_level` | 6 (`low..max`, id `effort`) | 4 (`low..xhigh`, id `reasoning_effort`) | **ausente** (ausência é informação real) |
| fast | `model_config` | `fast` | `fast-mode` | ausente |

**Consequência:** não é preciso inventar vocabulário nenhum. Basta **perguntar ao agente** e
**oferecer/validar** o que ele respondeu.

## Objective

**Feature 1 — `concurrency: auto`.** Hoje `concurrency` é um inteiro escolhido a dedo
(`schema.ts:344`), aplicado num único ponto (`inFlight.size >= concurrency`,
`orchestrator.ts:1607`). O operador não tem como saber o número certo sem desenhar o DAG na cabeça:
errar para baixo serializa trabalho paralelizável; para cima, desperdiça teto. `concurrency: auto`
deixa **o grafo decidir** — a largura da camada topológica mais larga, limitada por um teto.

**Feature 2 — capabilities de agente por descoberta.** O motor é 100% agnóstico a agente (zero
`if (agent === 'claude')`; registry de chave livre; spawn por argv), então o OpenCode **já roda
hoje**. O que não funciona é o **operador saber o que escrever**: `mode`, `model` e `effort` são
vocabulário disjunto por vendor (`plan` no Claude é `-32602 Invalid params` no Codex), e o
`loopy.yml` os aceita como string livre. Pior: o OpenCode hoje **escapa de qualquer validação**
client-side (a lista que o motor consulta vem nula), e `effort`/`model` inválidos viram **no-op
silencioso** (`session.ts:258`). Esta feature faz o motor **perguntar ao adapter** o que ele
suporta e usar isso para (a) validar fail-closed com mensagem útil, (b) avisar alto quando um valor
é ignorado e (c) alimentar a GUI, que passa a oferecer **só o que aquele agente aceita**.

**Quem:** o operador — que quer parar de calibrar `concurrency` na unha e parar de descobrir por
tentativa e erro que o Codex não tem `max` e que o OpenCode fala `build`, não `acceptEdits`.

**Não-objetivos (e por quê):**
- **Vocabulário canônico / tradução de dialeto** — rejeitado na 3ª rodada. O yml passa a guardar o
  **dialeto literal** do agente: é exatamente o que vai ser enviado, sem intermediação. Mais
  honesto que um mapa que envelhece; o custo aceito é que trocar de agente exige reescolher os
  valores (a GUI ajuda; ver D28).
- **Enforcement client-side de read-only** — cai junto com o canônico: sem conceito, o motor não
  tem gatilho. O `mode` do adapter volta a ser a única fronteira, **como já é hoje** (não é
  regressão; é a melhoria que não vamos fazer).
- Traduzir/catalogar `model` por vendor (a sondagem entrega a lista real; inventar é desnecessário).
- Auto-tuning dinâmico de concorrência durante o Run.

## Decisões

### Feature 1 — `concurrency: auto`

| # | Decisão | Escolha |
|---|---------|---------|
| **D0** | Empacotamento | Uma change só (C-0016), features separadas por `Deps:` no `todo.md`. |
| **D5** | Fórmula | `auto = max(...topoLayers(graph).map(l => l.length))` — a camada topológica mais larga. `topoLayers()` já existe puro (`scheduler/graph.ts:216`) e hoje só serve ao dry-run. Nota técnica: é o *limite inferior* do paralelismo real (o pico é o maior antichain), mas coincide na prática e o exato exigiria matching bipartido. |
| **D6** | Teto | `auto = min(largura, max_concurrency)`. **`max_concurrency`** é chave nova, **default 4**. Sem teto, um `todo.md` sem `Deps:` (o caso comum) dispararia N worktrees, N sessões ACP e N× o rate-limit de uma vez. |
| **D7** | Superfícies | yml, CLI (`--concurrency auto`) e GUI (toggle no `ConfigPane` + resolução da frente de onda no `DepsFlow`). |
| **D8** | Momento | Resolvido **uma vez**, no início do Run, sobre as tasks pendentes. Recalcular não mudaria nada: o pool nunca excede o *ready set*, reavaliado a cada `Promise.race` (`orchestrator.ts:1620`). |
| **D9** | Dry-run | Imprime o resolvido **com justificativa**: `concorrência efetiva: 3 (auto — camada mais larga: T-001, T-002, T-003; teto: 4)`. `renderDag()` já tem os dados em mãos. |
| **D11** | Tipo | `LoopyConfig.concurrency: number \| "auto"`. O parse **não pode** resolver (não conhece o DAG — as tasks vêm do `todo.md`, carregado depois). **Quebra o contrato de tipo público** do subpath `@hgflima/loopy/config`; o `ConfigPane` para de compilar até ser adaptado (efeito desejado: o `tsc` aponta cada consumidor). |
| **D12** | Novo subpath `@hgflima/loopy/scheduler` (6º barrel) | O `DepsFlow` precisa resolver o `auto` no browser; `src/CLAUDE.md` manda **não reimplementar** o que o motor exporta. `scheduler/` é puro (sem `node:fs`) → browser-safe por construção. |
| **D17** | Alcance do teto | Teto **só do `auto`**. `concurrency: 8` + `max_concurrency: 4` roda com **8** — o operador escolheu 8 e o motor obedece (o ADR-0004 já chama isso de "risco do operador"). O teto protege o número que o operador **não** escolheu. Efeito: **retrocompat absoluta**. |

### Feature 2 — capabilities por descoberta

| # | Decisão | Escolha |
|---|---------|---------|
| **D28** | **Fonte da verdade** | **`configOptions`**, não `availableModes`. O motor descobre `mode`/`model`/`effort` **por categoria** (`mode` / `model` / `thought_level`) — o mecanismo que `findConfigId` (`session.ts:133`) já usa para model e effort, agora estendido a `mode`. Corrige o bug de fundo: hoje o OpenCode **não é validado** (lista nula ⇒ o `if` de `session.ts:218` não roda). |
| **D29** | **Sem canônico, sem tradução** | O yml guarda o **dialeto literal** do agente (`mode: plan`, `mode: build`). O motor **não traduz nada** — o arquivo diz exatamente o que será enviado. Trocar de agente exige reescolher os valores; a GUI torna isso trivial (D30) e o motor falha alto se você esquecer. |
| **D30** | **Sondagem para a GUI** | Novo comando **`loopy probe-agent <nome> [--json]`**: spawna o adapter, faz `initialize` + `session/new`, imprime as capabilities e encerra. A GUI o chama ao selecionar um agente e popula os selects de `mode`/`model`/`effort` com **os valores reais daquele agente**. Reaproveita o motor (é o que as spikes já fazem); zero tabela hardcoded, zero coisa que envelhece. |
| **D31** | **Degradação da sondagem** | Se o `probe-agent` falhar (adapter não instalado, offline, timeout), a GUI **degrada para o campo de texto livre de hoje** e mostra o motivo. Nunca bloqueia a edição do yml. |
| **D32** | **Cache das capabilities** | Resultado cacheado em `.loopy/capabilities.json`, keyed pelo `command` (argv), com botão de refresh na GUI. Sondar custa segundos (o `npx -y` pode baixar o pacote) — sondar a cada clique seria inviável. É Artefato (gitignored). |
| **D33** | **Validação de `mode`** | **Fail-closed** contra a lista anunciada, **nos três adapters** (hoje só em dois). Mensagem útil: `mode 'acceptEdits' não é aceito por 'opencode' (aceita: build, plan)`. |
| **D18** | **`effort`/`model` inválidos** | **Ignora** (não chama `set_config_option`) e **avisa alto**. Não clampa: o motor não finge que o `xhigh` do Codex "equivale" ao `max` do Claude — são escalas de vendors diferentes. Mantém a assimetria documentada em `src/acp/CLAUDE.md:26` (`mode` = segurança → fail-closed; `effort`/`model` = best-effort → warn). O que muda é o **volume**: de `logger.debug` silencioso para aviso visível. |
| **D15** | **Canal do aviso** | Novo `StoreEvent` **`warning`** (14º tipo da união) — aditivo no Transport, mas obriga tratar no reducer da TUI e no `store-bridge` da GUI (o `switch` exaustivo aponta onde). Sem ele o aviso seria invisível para quem opera pela GUI, que **não tem painel de logs** (C-0009). |
| **D26** | **`agent` no `StepEditor`** | **Select fechado, sem escape**, das chaves do registry + `(default: <nome>)`. É o único campo em que fechar é correto: o `superRefine` (`schema.ts:351-412`) já **exige** que `step.agent` exista no registry — fora dele não é exótico, é **inválido**. |
| **D27** | **Presets de `command`** | "Adicionar agente" oferece Claude / Codex / OpenCode / Em branco, preenchendo o `command`. Existe por causa do **OpenCode**: é `["opencode", "acp"]` — **subcomando do binário**, não pacote npm como os outros dois — e ninguém adivinha isso num formulário em branco. Nomes de agente entram **só na GUI**, como atalho de digitação; jamais no motor. |
| **D16** | **ADRs** | Dois, monotema: **ADR-0008** (capabilities por descoberta — por que `configOptions` e não `availableModes`; **e por que o vocabulário canônico foi rejeitado**) e **ADR-0009** (concorrência derivada do DAG). |
| **D36** | **Momento da validação** | **Eager, no início do Run.** O pool já spawna todos os agentes referenciados de forma eager e fail-fast (`pool.ts:81`); assim que cada Processo de Agente sobe, o motor valida **todos os steps que o referenciam** contra as capabilities dele. Um yml errado aborta em segundos — **zero worktree, zero token** — em vez de estourar na 3ª task depois de meia hora. Sem isso, a validação fail-closed (D33) chegaria tarde demais para ser útil. |
| **D37** | **Dry-run valida pelo cache** | O `--dry-run` **não sonda** (D23 — zero processo, por contrato), mas **lê** `.loopy/capabilities.json` quando existe e valida offline. Ler cache não é sondar. Sem cache, imprime `capabilities: não verificadas (rode 'loopy probe-agent')` — nunca finge ter checado. |
| **D34** | **Débito D-0003** | **Fechado como resolvido por outro caminho.** O débito pedia "uma interface única que faça o de/para das particularidades de cada agente". A resposta é: **não fazer de/para** — expor. O arquivo registra a decisão e o porquê (o de/para envelhece; a descoberta, não). |

### Derivadas (não perguntadas)

| # | Decisão | Por quê |
|---|---------|---------|
| **D23** | O `--dry-run` **não** sonda (mas lê o cache — D37). | Dry-run é zero-processo/zero-escrita por contrato; sondar spawnaria adapters. |
| **D38** | **Não** haverá flag `--max-concurrency` na CLI. | Assimetria consciente com `--concurrency`: o teto é política do projeto (mora no yml, versionado), não algo que se ajusta por invocação. Ninguém pediu; adicionar depois é aditivo. |
| **D24** | `examples/loopy.yml` ganha um agente **opencode**; o `loopy.yml` da raiz permanece com dialeto literal (já está). | O exemplo canônico é a doc de fato do `agents:`; e o dogfooding do repo não precisa migrar nada — sem canônico, o que está lá já é o formato final. |
| **D35** | `fast mode` (`category: model_config`) fica **fora**. | A sondagem o revela nos 3 adapters, mas expô-lo no yml é feature nova (novo campo no schema, no registry e no step). Registrar como débito, não fazer aqui. |

### Decisões revogadas (3ª rodada — mantidas para o ADR-0008)

| # | Era | Por que caiu |
|---|---|---|
| ~~D1/D2/D13/D14~~ | Vocabulário canônico (`read-only`/`write`/`full-access`) + tabela de sinônimos por conceito | A premissa era "a descoberta falha no OpenCode". **Falsa**: falha só em `availableModes`; `configOptions` tem os dados. Sem o furo, o canônico vira uma camada de tradução que só adiciona indireção e envelhece. |
| ~~D3~~ | Fallback por **tentativa em ordem** via `set_mode` | Era um remendo às cegas para o furo que não existe. O match agora é determinístico contra a lista anunciada. |
| ~~D4~~ | `mode` traduz | Não traduz mais: valida. |
| ~~D19/D20~~ | **Enforcement client-side** em read-only (permissionResolver nega `edit`/`delete`/`move`; fs port rejeita write) | Dependia do conceito canônico como gatilho. Sem conceito, o motor vê `mode: plan` como string opaca do vendor. Decisão consciente: **confiar no adapter**, que é o comportamento de hoje — não é regressão, é a melhoria que não será feita. |
| ~~D21/D25~~ | `mode`/`effort` como selects de vocabulário canônico/união | Substituídos por selects **sondados** (D30): valores reais do agente, não um vocabulário inventado nem uma união que mistura escalas. |
| ~~D22~~ | Cache do dialeto resolvido por agente | Sem tradução, não há dialeto a resolver. O cache que resta é o das capabilities (D32). |

## Tech Stack

Sem dependência nova. TypeScript/Node ≥20, ESM. `zod`, `@agentclientprotocol/sdk`, `vitest`,
React + Tauri v2 (`apps/menubar`).

## Commands

```
Typecheck:  npm run typecheck          # cobre a raiz E o menubar
Lint:       npm run lint
Test:       npm test                   # vitest, SÓ tests/** da raiz
Test (GUI): npm test -w apps/menubar   # a raiz NÃO roda estes
Build:      npm run build              # tsup -> dist/ (subpath exports com dts)
Dev:        npm run dev -- --dry-run <dir>
Sonda:      npm run dev -- probe-agent codex --json    # o comando novo (D30)
Spikes:     npx tsx spikes/acp-opencode-capabilities.ts
```

## Project Structure

```
Feature 1 — concurrency: auto
  src/config/schema.ts       concurrency: number|"auto"; nova chave max_concurrency (default 4)
  src/config/serialize.ts    "max_concurrency" na CANONICAL_KEYS (após "concurrency")
  src/types.ts               LoopyConfig.concurrency: number|"auto"; RunFlags idem
  src/scheduler/graph.ts     nova fn pura maxLayerWidth(graph): number
  src/scheduler/index.ts     export de maxLayerWidth
  src/loop/orchestrator.ts   resolveConcurrency() pura; aplicação no pool; renderDag com justificativa
  src/index.ts               --concurrency aceita "auto"
  package.json/tsup.config   novo subpath export @hgflima/loopy/scheduler
  apps/menubar/src/config/ConfigPane.tsx   toggle auto + campo max_concurrency
  apps/menubar/src/graph/DepsFlow.tsx      resolve auto sobre as edges (frente de onda)

Feature 2 — capabilities por descoberta
  src/acp/session.ts         mode/model/effort descobertos por CATEGORIA em configOptions;
                             validação de mode fail-closed contra a lista (D28/D33);
                             effort/model inválidos -> ignora + emite warning (D18)
  src/acp/capabilities.ts    NOVO — shape das capabilities + parse puro de configOptions
  src/index.ts               NOVO subcomando `probe-agent <nome> [--json]` (D30)
  src/tui/store.ts           NOVO StoreEvent "warning" (14º) + reducer
  src/tui/view.ts            renderiza o aviso
  apps/menubar/src/state/    store-bridge trata o novo evento; badge no card do step
  apps/menubar/src/config/StepEditor.tsx   agent: select FECHADO do registry (D26);
                             mode/model/effort: selects SONDADOS, degradando p/ texto livre (D30/D31)
  apps/menubar/src/config/ConfigPane.tsx   presets de command (D27); botão "sondar/refresh" (D32)
  examples/loopy.yml         ganha um agente opencode
  docs/reference/configuration.md  seção agents: (HOJE NÃO EXISTE — grep "agents" = 0 hits)
  .harn/devy/debts/D-0003-*  fechado: resolvido por descoberta, não por abstração (D34)

Ambas — ÚLTIMA TASK (Deps: em todas as outras)
  CONTEXT.md                 via /domain-modeling
  **/CLAUDE.md               via /write-agent-md (sync)
  docs/adrs/0008-capabilities-de-agente-por-descoberta.md   NOVO
  docs/adrs/0009-concorrencia-derivada-do-dag.md            NOVO
```

**A task de documentação é a última e depende de TODAS** — não por cerimônia, mas por mecânica de
merge: ela toca `CONTEXT.md` e os `CLAUDE.md`, que as duas features também tocam. Sem a aresta
`Deps:`, duas tasks paralelas editariam os mesmos arquivos e conflitariam (a armadilha registrada
em `loopy-parallel-tasks-same-file-rebase-cant-fix`). Ela roda `/domain-modeling` no `CONTEXT.md`
(termos novos: **Capability**, **Sondagem**, **Largura do grafo**, **Teto do auto**; e o termo
**Dialeto** passa a ser explicitamente *não-traduzido*) e `/write-agent-md` em modo *sync* nos
intent nodes afetados (raiz, `src/acp/`, `src/config/`, `src/loop/`, `src/tui/`, `apps/menubar/`).

## Code Style

O núcleo de cada feature é puro e testável sem I/O (AD-6); o resto é fiação.

```ts
// src/scheduler/graph.ts — Feature 1: o "auto" inteiro é isto.
/** Largura da camada topológica mais larga: o máximo de tasks que o DAG permite em paralelo. */
export function maxLayerWidth(graph: TaskGraph): number {
  return topoLayers(graph).reduce((max, layer) => Math.max(max, layer.length), 0);
}

// src/acp/capabilities.ts — Feature 2: o que o agente disse que aceita. Nada inventado.
export interface AgentCapabilities {
  readonly modes: readonly string[];    // configOptions[category="mode"].options
  readonly models: readonly string[];   // configOptions[category="model"].options
  readonly efforts: readonly string[];  // configOptions[category="thought_level"] — [] = não suporta
}

// A validação: fail-closed com a lista do próprio agente na mensagem.
if (!caps.modes.includes(mode)) {
  throw new Error(`mode '${mode}' não é aceito por '${agent}' (aceita: ${caps.modes.join(", ")})`);
}
```

Convenções mantidas: erros como valores nas fronteiras de step (AD-5); `Result<T>` no scheduler;
mensagens em pt-BR; comentário só onde o código não mostra a restrição.

## Testing Strategy

`vitest`. Testes da raiz em `tests/**`; os do app em `apps/menubar/**` (rodam **só** com
`-w apps/menubar`).

| Nível | O quê |
|---|---|
| Unit (puro) | `maxLayerWidth`: vazio → 0; cadeia → 1; leque → N; diamante; múltiplas raízes. `resolveConcurrency`: precedência flag > task > yml > auto; clamp pelo teto; teto **não** morde número explícito (D17). `capabilities.ts`: parse dos 3 `*.out.json` reais das spikes → modes/models/efforts corretos; `thought_level` ausente → `efforts: []`. |
| Unit (session) | `mode` fora da lista → **throw** com a lista na mensagem (nos 3 adapters, inclusive OpenCode — que hoje escapa). `effort` fora da lista → **warning** + não chama `set_config_option` + segue. `model` idem. Adapter sem `configOptions` → degrada sem quebrar. Fakes de ACP, como em `tests/acp/session.test.ts`. |
| CLI | `probe-agent <nome> --json` imprime as capabilities; adapter inexistente → exit ≠ 0 com mensagem. `--dry-run` com `auto` imprime resolvido + justificativa; **com cache presente valida os modes e reporta; sem cache diz "não verificadas"** (D37); `--concurrency auto` sobrepõe o yml; `--task X` força 1. |
| Integração (eager) | Um pipeline com `mode` inválido para o agente referenciado **aborta no início do Run** (D36), **antes** de qualquer worktree — asseverar que nenhum diretório `.worktrees/` foi criado e que a mensagem lista os valores aceitos. |
| Schema | `concurrency: "auto"` aceito; `"banana"` rejeitado com path `"concurrency"`; `max_concurrency: 0` rejeitado. |
| GUI | `ConfigPane`: toggle auto preserva `max_concurrency` e **não** converte `auto` em número ao salvar. `StepEditor`: select de `agent` lista exatamente as chaves do registry; selects sondados populam com os valores reais; **sondagem falha → degrada para texto livre** (D31) e um valor fora da lista **não é corrompido** ao salvar. `DepsFlow`: frente de onda com `auto` corta na largura resolvida. |
| Regressão | `concurrency: 3` byte-idêntico; `concurrency: 8` + `max_concurrency: 4` roda com 8; `mode: acceptEdits` num claude continua funcionando; nenhum yml existente muda de comportamento. |

**Fixtures**: os `spikes/*.out.json` viram fixtures de teste — capabilities reais dos 3 adapters,
sem mock inventado.

**Verificação manual obrigatória:** re-rodar as 3 spikes antes de fechar — o vocabulário é
por-agente **e por-versão** (foi o que mudou no Claude 0.26 → 0.59, quando `effort` surgiu).

## Boundaries

**Always:**
- Perguntar ao agente em vez de adivinhar: `configOptions` é a fonte da verdade.
- `mode` fail-closed (com a lista do agente na mensagem); `effort`/`model` best-effort + aviso visível.
- Funções puras no scheduler e no parse de capabilities — I/O só na fiação.
- Rodar `npm run typecheck` (pega os consumidores quebrados por D11) **e** `npm test -w apps/menubar`.
- Fechar a change pela task de docs (`/domain-modeling` + `/write-agent-md`), que depende de todas.

**Ask first:**
- Mudar o default de `max_concurrency` (4).
- Adicionar o 6º subpath export (D12) — muda o contrato público do pacote.
- Reintroduzir qualquer forma de vocabulário canônico ou tradução (foi rejeitado com razão — leia o ADR-0008).

**Never:**
- Hardcodar comportamento de loop no motor (AD-1).
- `if (agent === 'claude')` / allowlist de agentes / detecção de adapter pelo `command` **no motor**
  (na GUI, presets de `command` são atalho de digitação — D27).
- Tabela estática de capabilities por adapter — ela envelhece; a sondagem, não.
- Deixar `auto` sem teto.

## Success Criteria

1. `concurrency: auto` é aceito pelo schema; `--dry-run` imprime o valor resolvido **e** a justificativa.
2. DAG com camadas [3, 2, 1] → `auto` = **3**; com `max_concurrency: 2` → **2**.
3. 20 tasks **sem** `Deps:` → `auto` = **4** (o teto), não 20.
4. `concurrency: 8` + `max_concurrency: 4` roda com **8** (D17 — o teto só morde o `auto`).
5. `--concurrency auto` sobrepõe `concurrency: 8` do yml; `--task T-003` força 1.
6. O `ConfigPane` abre um yml com `auto`, mostra o toggle ligado e **salva de volta `auto`**.
7. `loopy probe-agent opencode --json` imprime `modes: [build, plan]`, os 146 models e `efforts: []`.
8. `mode: acceptEdits` num step de **opencode** **falha** com `(aceita: build, plan)` — hoje passa
   silenciosamente sem validação alguma — e falha **no início do Run** (D36): zero worktree criado,
   zero token gasto, mesmo que o step errado seja o último de um backlog longo.
9. `effort: max` num codex emite **aviso visível** e o Run segue com o default do adapter.
10. Qualquer `effort` num opencode emite aviso visível e o Run segue.
11. No `StepEditor`, selecionar `agent: opencode` popula o select de `mode` com **exatamente**
    `build` e `plan`, e o de `model` com os 146 — sem nenhuma tabela hardcoded no código.
12. Com o adapter não instalado, o `StepEditor` **degrada para texto livre** e diz por quê (D31).
13. Nenhum `loopy.yml` existente muda de comportamento.
14. `npm run typecheck`, `npm run lint`, `npm test` e `npm test -w apps/menubar` verdes.
15. `CONTEXT.md` e os `CLAUDE.md` atualizados na última task; ADRs 0008 e 0009 escritos; D-0003
    fechado com o registro de que foi resolvido por **descoberta**, não por abstração.

## Open Questions

Nenhuma. A última — **quando validar** — foi fechada na 4ª rodada (D36/D37): eager no início do Run,
e o dry-run valida pelo cache. O que permanece em aberto **por natureza**:

- **O vocabulário é por-agente _e_ por-versão.** Um `npx -y` puxando um adapter novo muda o que ele
  anuncia. É precisamente por isso que a sondagem (runtime) venceu a tabela (estática): ela nunca
  fica velha. O cache (D32) mitiga o custo, e o refresh existe para quando o adapter mudar.
  **Corolário:** um cache velho pode reprovar um yml correto no dry-run. Por isso o dry-run apenas
  **reporta** o que o cache diz; a autoridade é a validação eager do Run (D36), que usa o adapter vivo.
- **`fast mode`** (D35) fica de fora e vira débito novo.
