# Plano de implementação: C-0016 — `concurrency: auto` + capabilities de agente por descoberta

> Companheiro do `spec.md` (mesma pasta). Narrativa, grafo de dependências, fases, checkpoints e
> riscos. A lista executável pelo motor está em `todo.md`.

## Overview

Duas features independentes em conceito, entregues numa change só (D0):

1. **`concurrency: auto`** — o DAG decide o pool. `maxLayerWidth(graph)` (a camada topológica mais
   larga) limitada por `max_concurrency` (nova chave, default 4). Vive em `config/schema` →
   `scheduler` → `orchestrator` → CLI → GUI.
2. **Capabilities por descoberta** — o motor para de adivinhar o dialeto do agente e **pergunta**.
   A fonte é `configOptions` (não `availableModes`), o mesmo canal de onde `findConfigId` já lê
   `model` e `effort`. Vive em `acp/session` → CLI (`probe-agent`) → TUI (`warning`) → GUI.

O núcleo de cada uma é uma **função pura** (`maxLayerWidth`/`resolveConcurrency` e
`parseCapabilities`) — testável sem I/O (AD-6). O resto é fiação.

## Descobertas do código que moldam o plano (verificadas nesta sessão)

1. **As duas features COMPARTILHAM arquivo** — ao contrário do que o spec supõe ("não compartilham
   arquivo"). `src/index.ts` é tocado pelas **duas** (a flag `--concurrency auto` e o subcomando
   `probe-agent`), e o dry-run do `orchestrator.ts` também (imprime a concorrência resolvida **e**,
   por D37, o veredito das capabilities pelo cache). O `ConfigPane.tsx` idem (toggle `auto` **e**
   presets/refresh). **Consequência direta:** o `todo.md` carrega **arestas cruzadas entre as
   features** (T-008 → T-002; T-011 → T-003). Sem elas, o motor rodaria essas tasks em paralelo e o
   merge daria conflito real, não resolvível por rebase — a armadilha registrada em
   `loopy-parallel-tasks-same-file-rebase-cant-fix`. **Não remover essas arestas.**

2. **`--concurrency auto` é rejeitado hoje pelo commander, antes de chegar ao motor.** O parser é
   `parsePositiveInt` (`src/index.ts:155`), que lança `InvalidArgumentError` em qualquer não-inteiro.
   E `toFlags` (`:230`) tem uma segunda guarda (`typeof opts.concurrency === "number"`). São **dois**
   pontos, não um.

3. **A precedência `flag ?? yml` está triplicada**: `orchestrator.ts:1345` (run vivo),
   `orchestrator.ts:390` (`planDryRun`) e `src/index.ts:786` (dry-run da CLI). Introduzir `"auto"`
   nos três seria triplicar a resolução. Por isso `resolveConcurrency()` nasce **pura, no
   `scheduler/`** — e é ela, não só `maxLayerWidth`, que justifica o 6º subpath export (D12): a GUI
   precisa da **mesma** resolução, com o mesmo teto e a mesma regra de D17.

4. **O `DepsFlow` já corta a frente de onda pelo `concurrency`** (`DepsFlow.tsx:88` → `wavefront(...,
   limit)` em `flow-state.ts:37`), e o valor chega cru do draft do yml (`App.tsx:422`). Com
   `concurrency: "auto"`, `front.size >= "auto"` é **sempre `false`** — o corte some **em silêncio**.
   É o bug latente mais provável da Feature 1, e é por isso que o `DepsFlow` tem task própria
   (T-004), não um "ajuste de tipo" de tabela.

5. **Os três adapters anunciam `mode` em `configOptions`** — inclusive o OpenCode, que tem
   `modes: null`. O `session.ts` só lê `newSessionResponse.modes.availableModes` (`:187`) e só chama
   `findConfigId` para `"model"`/`"thought_level"` (`:185-186`). O bug de fundo é literalmente
   **duas linhas lendo a fonte errada** — a correção é pequena; o que é grande é a superfície que
   ela destrava (validação, aviso, CLI, GUI).

6. **As capabilities só existem depois do `session/new`**, não do `initialize`
   (`newSessionResponse.configOptions`). Logo a validação eager de D36 **precisa de uma Sessão**. O
   pool spawna processos eager (`pool.ts:81`) mas cria sessões sob demanda por `(agente, cwd)` — e
   no início do Run **nenhum worktree existe ainda**. Decisão deste plano: a sondagem eager abre uma
   **Sessão descartável no `workspace.root`** por Agente referenciado, lê as capabilities, grava o
   cache e a fecha. `session/new` não gasta token; o custo é ~1s por agente.

7. **O `LoopySession` não expõe nada do que descobre** (`parseConfigFromSession`, `:183-189`, é
   privado e devolve `void`). Um getter de capabilities é pré-requisito de **tudo** na Feature 2 —
   CLI, validação eager e GUI.

8. **A CLI não tem subcomando nenhum hoje** (`src/index.ts:164-208`): `[dir]` é argumento posicional
   do root. `probe-agent` seria o **primeiro** `.command()` do projeto — muda a semântica posicional
   e exige teste de regressão de `loopy .` e `loopy --dry-run <dir>`.

9. **O reducer do store é um `switch` exaustivo sem `default`** (`store.ts:333-478`) — o 14º evento
   (`warning`) **quebra o `tsc`** e aponta cada consumidor, que é o efeito desejado. Já o
   `store-bridge` da GUI **delega ao `reduce` do motor** (`store-bridge.ts:140`) e não re-implementa
   o switch: ele só quebra se o evento precisar de tratamento especial. O que a GUI precisa é
   **renderizar** o aviso (ela não tem painel de logs — C-0009).

10. **`initialConfigTemplate` duplica os defaults do schema à mão** (`serialize.ts:142`:
    `concurrency: 1`) e `tests/config/serialize.test.ts:15` **duplica a `CANONICAL_KEYS`**. Toda
    chave nova precisa entrar nos **três** lugares, ou sai fora de ordem no YAML — em silêncio (o
    fallback de `serialize.ts:62` a joga no fim).

## Decisões arquiteturais deste plano

- **O puro nasce antes da fiação.** `maxLayerWidth` + `resolveConcurrency` (T-001) e
  `parseCapabilities` (T-005) são tasks próprias, com teste de mesa, **antes** de qualquer mudança
  de tipo. Isso mantém o repo verde enquanto o miolo é provado, e faz a task seguinte — que quebra o
  contrato público (D11) — ser puramente mecânica.
- **A mudança de tipo é indivisível.** `LoopyConfig.concurrency: number | "auto"` (D11) quebra
  `tsc` em todos os consumidores do motor de uma vez. Não dá para fatiar sem deixar o build vermelho
  entre tasks. Por isso T-002 é a maior task da change (schema + types + serialize + orchestrator +
  CLI) — e por isso ela vem **depois** do puro, quando só resta encanar.
- **O canal do aviso antes de quem avisa.** T-007 (o `StoreEvent` `warning`) é um canal genérico e
  não depende de capabilities. Ele vem antes de T-006, que é quem passa a **emitir** — assim T-006
  não precisa inventar um mecanismo provisório de log que depois vira lixo.
- **Serialização por arquivo, não por conceito** (ver Descoberta 1): as arestas
  T-008 → T-002 e T-011 → T-003 existem só para não conflitar em `src/index.ts` e `ConfigPane.tsx`.
- **O 6º subpath export entra junto com o puro** (T-001), não com a GUI. Assim T-003 e T-004 —
  os dois consumidores no app — ficam paralelos e disjuntos, em vez de brigarem pelo `package.json`.
  (D12 é a aprovação do "Ask first" do spec; não é preciso reperguntar.)

## Grafo de dependências

```
FASE 1 (3 tasks puras, paralelas)
  T-001 maxLayerWidth + resolveConcurrency + 6º subpath ─┐
        (scheduler/graph.ts, index.ts, package.json)     │
  T-005 capabilities.ts (parse puro) + fixtures ──┐      │
  T-007 StoreEvent "warning" (canal) ─────────┐   │      │
                                              │   │      │
FASE 2 (o tipo quebra; a sessão pergunta)     │   │      │
  T-002 schema+types+serialize+CLI+orch  ◄────┼───┼──────┘
        (concurrency: number|"auto")          │   │
  T-006 session: descobre por categoria  ◄────┴───┘
        valida mode fail-closed; avisa
                    │            │
FASE 3 (as superfícies)          │
  T-003 ConfigPane (toggle auto) ◄── T-002
  T-004 DepsFlow (frente de onda) ◄── T-001, T-002
  T-008 CLI probe-agent + cache  ◄── T-002 (index.ts!), T-005, T-006
                    │
FASE 4             │
  T-009 validação eager no Run + dry-run pelo cache ◄── T-008
  T-010 GUI: ponte de sondagem + StepEditor sondado ◄── T-008
  T-012 examples/loopy.yml + docs/reference        ◄── T-002, T-008
                    │
FASE 5
  T-011 ConfigPane: presets de command + refresh   ◄── T-003, T-010

FASE 6
  T-013 CONTEXT.md + CLAUDE.md (sync) + ADR-0008 + ADR-0009 + D-0003 ◄── TODAS
```

## Fases

### Fase 1 — O puro (T-001 ∥ T-005 ∥ T-007)

Três tasks disjuntas que não mudam contrato nenhum e deixam o repo verde:
`maxLayerWidth`/`resolveConcurrency` (com o 6º export), `parseCapabilities` (com os `*.out.json` das
spikes virando fixture) e o canal `warning`.

#### Checkpoint: Fase 1
- [ ] `npm run typecheck && npm run lint && npm test && npm test -w apps/menubar` verdes.
- [ ] `npm run build` emite `dist/scheduler.js` + `.d.ts`, e um `import { maxLayerWidth } from
      "@hgflima/loopy/scheduler"` resolve.
- [ ] Os 3 fixtures de capabilities são cópias fiéis dos `spikes/*.out.json` (sem mock inventado).

### Fase 2 — O contrato quebra (T-002) e a sessão pergunta (T-006)

T-002 é a fatia vertical inteira da Feature 1 no motor: o yml aceita `auto`, a CLI aceita
`--concurrency auto`, o Run aplica e o dry-run **justifica**. T-006 é a fatia da Feature 2 no ACP: a
descoberta passa a ler `configOptions` por categoria, `mode` vira fail-closed nos **três** adapters
e `effort`/`model` inválidos emitem `warning` visível em vez de `logger.debug`.

#### Checkpoint: Fase 2
- [ ] `concurrency: 3` continua **byte-idêntico** (regressão); `concurrency: 8` + `max_concurrency:
      4` roda com **8** (D17).
- [ ] `--dry-run` num DAG de camadas [3,2,1] imprime `concorrência efetiva: 3 (auto — camada mais
      larga: …; teto: 4)`.
- [ ] Um `mode` inválido num **opencode** passa a **falhar** com a lista aceita na mensagem (hoje
      passa em silêncio).
- [ ] Todos os checks verdes, incluindo `npm test -w apps/menubar`.

### Fase 3 — As superfícies (T-003 ∥ T-004 ∥ T-008)

O `ConfigPane` ganha o toggle, o `DepsFlow` volta a cortar a frente de onda (agora resolvendo o
`auto` com a **mesma** função do motor), e a CLI ganha o `probe-agent` + o cache
`.loopy/capabilities.json`.

#### Checkpoint: Fase 3
- [ ] `loopy probe-agent opencode --json` imprime `modes: [build, plan]`, os 146 models e
      `efforts: []`.
- [ ] `loopy .` e `loopy --dry-run <dir>` **não regridem** com o subcomando novo registrado.
- [ ] O `ConfigPane` abre um yml com `auto`, mostra o toggle ligado e **salva de volta `auto`**.

### Fase 4 — Fail-fast e a GUI que sabe (T-009 ∥ T-010 ∥ T-012)

A validação eager (D36) e o dry-run que lê o cache (D37); a ponte de sondagem da GUI e os selects do
`StepEditor`; o exemplo e a doc de referência.

#### Checkpoint: Fase 4
- [ ] Um yml com `mode` inválido **aborta no início do Run**, com **zero** diretório em
      `.worktrees/` criado.
- [ ] Com o adapter não instalado, o `StepEditor` **degrada para texto livre** e diz por quê.

### Fase 5 — `ConfigPane` completo (T-011)

Presets de `command` (o `["opencode","acp"]` que ninguém adivinha) e o botão de refresh do cache.

### Fase 6 — Fechar a change (T-013)

`/domain-modeling` no `CONTEXT.md` (**Capability**, **Sondagem**, **Largura do grafo**, **Teto do
auto**; e **Dialeto** passa a ser explicitamente *não-traduzido*), `/write-agent-md` em modo *sync*
nos intent nodes afetados, os dois ADRs e o fechamento do D-0003.

#### Checkpoint: Completo — verificação humana (obrigatória)

- [ ] **Re-rodar as 3 spikes** (`npx tsx spikes/acp-{claude,codex,opencode}-capabilities.ts`) — o
      vocabulário é por-agente **e por-versão**; se um adapter mudou, os fixtures e os números do
      spec (146 models, etc.) mudam com ele.
- [ ] Abrir a GUI, selecionar `agent: opencode` num step e ver o select de `mode` com **exatamente**
      `build` e `plan`.
- [ ] `npm run typecheck && npm run lint && npm test && npm test -w apps/menubar && npm run build`.

## Riscos e mitigações

| Risco | Impacto | Mitigação |
|---|---|---|
| **`src/index.ts` e `ConfigPane.tsx` tocados pelas duas features em paralelo** → conflito de merge não resolvível por rebase | Alto | Arestas **T-008 → T-002** e **T-011 → T-003** no `todo.md`. É a razão de existirem; não remover |
| **`wavefront(…, limit)` recebe `"auto"`** e para de cortar **em silêncio** (`front.size >= "auto"` = `false`) | Alto | T-004 tipa o `limit` como `number` e resolve o `auto` **antes** de chamar; teste explícito de "yml com auto ⇒ frente cortada na largura resolvida" |
| **O 1º `.command()` do projeto** muda a semântica do `[dir]` posicional | Médio | T-008 leva testes de regressão de `loopy .`, `loopy --dry-run <dir>` e `loopy -t T-001 <dir>` |
| **Validação eager exige uma Sessão** (capabilities só vêm do `session/new`) — não basta o `initialize` | Médio | Decisão 6: sessão descartável no `workspace.root`, fechada logo após; grava o cache de graça. Se o adapter falhar em subir, o pool já é fail-fast hoje |
| **Cache velho reprova um yml correto** no dry-run | Baixo | Por contrato o dry-run **reporta**, não decide (D37); a autoridade é a validação eager do Run, contra o adapter vivo |
| **Mexer no `src-tauri` (Rust) durante dogfooding** reinicia o app e mata o Run em andamento | Médio | Se T-010 precisar de comando Tauri novo, rodar o Run pelo CLI (não pela GUI) — `loopy-dogfooding-tauri-dev-restarts-app-kills-run` |
| **Três lugares duplicam os defaults/ordem do schema** (`schema.ts`, `serialize.ts:142` template, `serialize.test.ts:15`) | Baixo | Aceite de T-002 exige `max_concurrency` nos três |
| **`npm test` da raiz não roda o app** | Médio | Toda task de GUI tem `npm test -w apps/menubar` na linha de verificação |

## Fora de escopo (não fazer)

- Vocabulário canônico, tradução de dialeto, enforcement client-side de read-only — **rejeitados** na
  3ª rodada do refine (ver `spec.md` § Decisões revogadas; o ADR-0008 registra o porquê).
- `fast mode` (`category: model_config`) — D35: vira débito novo, não entra aqui.
- Flag `--max-concurrency` na CLI (D38) e auto-tuning dinâmico durante o Run.

## Open questions

Nenhuma. As duas que existiam foram fechadas no refine (D36/D37).
