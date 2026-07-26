# Plano: C-0019 — Stream rico, `session/update` semântico na tela

> Escrito em 2026-07-26 (`/devy:plan`) sobre a `spec.md` desta pasta.
> As tasks vivem em `todo.md` (mesma pasta) — este documento é a **narrativa**:
> por que o trabalho tem esta forma, em que ordem, e o que já se sabe que dói.
> As decisões **D1–D9** (spec), **R1–R7** (refine) e **C1–C3** (conflitos) estão
> **fechadas**; nada aqui as re-litiga.

---

## Overview

O `onUpdate` do motor (`src/index.ts:595-615`) recebe os **13** `sessionUpdate` que o SDK
0.29 declara e despacha exatamente **dois** eventos: `stream_chunk` (só o texto de
`agent_message_chunk`, via `agentChunkText`) e `usage_sample`. Os outros **onze** morrem
ali, antes do Transport. O efeito na tela é o silêncio que a spec descreve: quatro
minutos de trabalho real aparecem como nada, seguidos de um parágrafo de prosa no fim.

Esta change atravessa esse dado até a tela como **timeline semântica** — tool calls com
status ao vivo, diffs, pensamentos, plano do turno, troca de Modo — nas **duas**
superfícies: o `StreamPanel` do Run e a `ActivityLine` da Entrevista (o que fecha o D14).

São **16 tasks** em 5 fases. Duas dependências novas, ambas no `apps/menubar`
(`diff` e `rehype-highlight`); **zero no motor**.

---

## Architecture Decisions

Cinco decisões governam todo o resto. Elas não são novas — são a leitura operacional das
D/R da spec, escritas aqui na forma em que o código as verá.

### 1. O motor traduz; a GUI renderiza

A shape do ACP morre no boundary. A tradução `SessionUpdate → StreamUpdate` é uma função
**pura** em `src/acp/client.ts` (irmã de `agentChunkText`, que já mora lá), e não no
`onUpdate` — porque uma função exportada se testa com os 13 casos sem subir processo
nenhum, e `src/index.ts` tem 1.893 linhas. O `onUpdate` fica com o que só ele sabe:
carimbar `taskId`/`stepId`/`agent` e despachar.

A GUI **nunca** importa de `@agentclientprotocol/sdk`.

### 2. Cinco eventos tipados + um catch-all (C2)

`tool_call`, `tool_call_update`, `thought_chunk`, `plan`, `mode_changed` — mais
`agent_update`, o catch-all. Nenhum `session/update` é descartado (D3); o que a UI não
sabe desenhar vira uma linha com o `kind` e o JSON atrás de um disclosure fechado.
Promover um `kind` do catch-all para tipado depois é **aditivo**: não quebra o `dts`
publicado, então a fronteira pode se mover sem custo de contrato.

### 3. Deltas no fio; a mescla é uma função pura compartilhada (R2)

`mergeToolCall` nasce em `src/tui/store.ts` — browser-safe, já é subpath export — e é
importada pelos **dois** redutores da GUI. O motor segue **sem memória**: ele traduz
`tool_call_update` em delta e o solta no fio; quem acumula é a GUI.

Isso tem uma consequência de forma sobre a **R7b**, que vale registrar por escrito:

> A R7b diz que o control frame `agent_stream` da Entrevista carrega um `StreamItem`.
> Um `StreamItem` de tool carrega `ToolCallState` **completo** — e produzi-lo no motor
> exigiria que ele guardasse o estado acumulado da tool call, que é exatamente o que a R2
> proíbe. O frame carrega, portanto, o mesmo `StreamUpdate` que o Run coloca nos eventos:
> mesmo tipo, mesmos dois canais, mesma `mergeToolCall` do outro lado. **A decisão R7b
> não muda; muda o tipo que a cumpre.**
>
> **Confirmado pelo usuário no `/devy:plan`.** A alternativa considerada — o motor da
> Entrevista manter um `Map<toolCallId, ToolCallState>` e emitir o card pronto — cumpriria
> a letra da R7b ao custo de rodar a mescla em dois lugares e dar à GUI da Entrevista um
> caminho diferente do Run, sem simplificar nada (o ring e o `messageId` continuam sendo
> dela). Ao implementar a T-001, **registrar esta nota na `spec.md`**, como a própria spec
> manda ("se alguma se mostrar errada durante a implementação, atualize esta spec antes do
> código").

### 4. A timeline acumula na GUI (R4)

`StoreState` continua descrevendo o **turno corrente** — `task.stream` já é zerado a cada
`step_started`/`attempt_started`, e sob o sidecar o motor sequer cria store. `reduce`
trata os seis eventos novos como **no-op explícito** (`return state`), o que mantém o Ink
byte-idêntico (D1) sem custo.

Quem acumula é `BridgeState.transcript` (Run) e `InterviewState.transcript` (Entrevista),
os dois com ring por escopo, teto de **500 itens** e um item `elided` no topo declarando
quantos sumiram (R6). Precedentes de doutrina no próprio motor: `ACP_LOG_CAP` (200),
`WARNINGS_CAP` (50).

### 5. O texto não ganha evento novo (R3)

`stream_chunk` ganha `stepId?` e `messageId?` — dois campos opcionais, aditivos. O Ink não
muda, nenhum token atravessa o pipe duas vezes, e um agente antigo (sem `messageId`)
continua funcionando pelo caminho de hoje: `stepId` ausente cai no `task.currentStepId`.

### Decisão tomada neste planejamento

A única não coberta pela spec, respondida pelo usuário durante o `/devy:plan`:

**Na Entrevista, `InterviewState.transcript` deixa de ser `string` e vira
`readonly StreamItem[]`.** O `agent_activity` empurra um item `text`; o `agent_stream`
empurra tool/thought/plan/raw; a lista fica na **ordem de chegada**, que é exatamente o
que o humano quer ver (as ferramentas rodando, depois a prosa do turno). Um tipo, dois
canais, **um componente React** — que é o que impede o Run e a Entrevista de divergirem.

Isso absorve o WIP que hoje está na working tree (o `transcript: string` recém-introduzido
na `ActivityLine`): o markdown que ele já renderiza passa a sair do item `text`.

---

## As formas concretas

O contrato inteiro nasce numa task só (T-001), porque metade das outras quinze compila
contra ele.

```ts
// src/tui/store.ts

/** O que UM session/update virou, já sem a shape do ACP. Um por notificação. */
export type StreamUpdate =
  | { kind: "text";       text: string; messageId?: string }
  | { kind: "thought";    text: string; messageId?: string }
  | { kind: "tool_call";  call: ToolCallState }
  | { kind: "tool_delta"; delta: ToolCallDelta }
  | { kind: "plan";       entries: readonly PlanEntryState[] }
  | { kind: "mode";       modeId: string }
  | { kind: "raw";        updateKind: string; payload: unknown };

/** Um item RENDERIZÁVEL da timeline. Discriminado por `item`. */
export type StreamItem =
  | { item: "text";    text: string; messageId?: string }
  | { item: "thought"; text: string; messageId?: string }
  | { item: "tool";    call: ToolCallState }
  | { item: "plan";    entries: readonly PlanEntryState[] }
  | { item: "mode";    modeId: string }
  | { item: "raw";     kind: string; payload: unknown }
  | { item: "elided";  count: number };   // R6 — o corte do ring, que nunca mente

export type ToolContentItem =
  | { kind: "text";     text: string }
  | { kind: "diff";     path: string; oldText?: string; newText: string }
  | { kind: "terminal"; terminalId: string }
  | { kind: "raw";      payload: unknown };  // image/audio/resource — D3, nada some

/** A mescla. `null`/`undefined` num campo do delta = "não mexi", nunca "apague". */
export function mergeToolCall(
  current: ToolCallState | undefined,
  delta: ToolCallDelta,
): ToolCallState;

/** StreamUpdate + envelope → StoreEvent. O que o `onUpdate` do Run faz. */
export function toStoreEvent(
  update: StreamUpdate,
  ctx: { taskId: string; stepId?: string; agent?: string },
): StoreEvent;
```

O par `StreamUpdate` / `StreamItem` é o que faz a coisa fechar: **o fio carrega
`StreamUpdate`** (nos dois canais — evento no Run, control `agent_stream` na Entrevista),
**a tela consome `StreamItem`**, e uma única função pura da GUI faz a travessia com o
ring junto:

```ts
// apps/menubar/src/state/stream-history.ts (T-005)
export function appendStreamItem(
  items: readonly StreamItem[],
  update: StreamUpdate,
  cap = TIMELINE_CAP,
): readonly StreamItem[];
```

Ela é quem sabe as quatro regras que ninguém deve reimplementar: `tool_delta` procura o
card por `toolCallId` (não por adjacência — updates chegam intercalados com texto);
`text`/`thought` com o mesmo `messageId` concatenam no item anterior em vez de criar
outro; delta órfão **não fabrica card**; e ao estourar o teto o mais antigo sai e o
`elided` do topo soma.

No Run, cada entrada continua taggeada pelo Step — a `TranscriptEntry` de hoje sobrevive,
trocando só a carga:

```ts
interface TranscriptEntry { stepId: string; item: StreamItem; /* + telemetria */ }
interface StreamSegment  { stepId: string; label: string; items: readonly StreamItem[] }
```

`segmentsFor` e `overlayStepUsage` **não mudam de propósito** — o agrupamento por Step, o
divisor rotulado e a correção do `usage_sample` tardio continuam valendo palavra por
palavra. Só o que cada segmento carrega deixa de ser `text: string`.

---

## Dependency Graph

As arestas, lidas em ordem (`X ← Y` = "X só começa quando Y estiver merjada"):

```
T-001  contrato (store.ts + transport.ts)        ← nada
T-004  LineFramer linear (Rust)                  ← nada          [corre em paralelo com tudo]

T-002  tradutor SessionUpdate → StreamUpdate     ← T-001
T-005  timeline + ring + elided                  ← T-001
T-007  diff-hunks + jsdiff                       ← T-001
T-008  tool-kind + 7 glifos + 5 tokens           ← T-001
T-015  ADR-0013                                  ← T-001

T-003  onUpdate do Run (index.ts)                ← T-002
T-013  Entrevista no motor (interview/run.ts)    ← T-002
T-006  applyLine acumula itens                   ← T-005
T-009  ToolCallCard + DiffView                   ← T-007, T-008
T-011  MarkdownStream + rehype-highlight         ← T-007

T-010  Thought/Plan/Raw + StreamTimeline         ← T-009
T-012  StreamPanel                               ← T-006, T-010, T-011
T-014  Entrevista na GUI                         ← T-013, T-010, T-011
T-016  docs (DESIGN.md + 4 intent nodes)         ← T-012, T-014
```

**Largura do grafo: 5** — verificado com o `buildGraph`/`topoLayers` do próprio motor
(DAG acíclico, nenhuma Dep órfã). As camadas topológicas são:

```
1: T-001, T-004
2: T-002, T-005, T-007, T-008, T-015     ← a mais larga (5)
3: T-003, T-006, T-009, T-011, T-013
4: T-010
5: T-012, T-014
6: T-016
```

Acima do `max_concurrency` default (4), então o `auto` da ADR-0009 tem o que morder.

**Três arestas existem só para serializar merge, não por lógica — não remover:**

| Aresta | Arquivo que as duas tocam |
|---|---|
| `T-011 → T-007` | `apps/menubar/package.json` (as duas dependências novas) |
| `T-010 → T-009` | `apps/menubar/src/ui/index.ts` (o barril) |
| `T-016 → T-012, T-014` | nenhum — a doc descreve o código final |

---

## Phases

### Fase 1 — Fundação: contrato, tradução e o framer — T-001, T-002, T-003, T-004

O contrato de fio inteiro num commit (store + transport), o tradutor puro, o `onUpdate`
que despacha, e o fix do framer Rust.

**T-004 vai cedo de propósito.** É o C3: custa ~3 linhas, não depende de nada, e é o risco
de maior impacto da change — uma linha de 40 MB não deixa o pipe "lento", ela o **congela**
(~2×10¹¹ comparações de byte). Risco alto e barato de matar resolve-se primeiro.

**Checkpoint:**
- `npm test && npm run typecheck && npm run lint`
- `cargo test --manifest-path apps/menubar/src-tauri/Cargo.toml`
- Um Run real com `--emit-events | head -50` mostra `tool_call`/`tool_call_update` no
  stdout NDJSON.
- `RunLoopResult` byte-idêntico sem GUI e sem `--emit-events` (AD-1).

### Fase 2 — Acumulação na GUI — T-005, T-006

`Transcript` deixa de guardar texto e passa a guardar itens, com ring por task e marcador
`elided`. É onde mora a armadilha nº 1 (abaixo).

**Checkpoint:** `npm test -w apps/menubar` — um `tool_call_update` intercalado com texto
volta ao card certo, e estourar o teto produz `elided` com a contagem certa.

### Fase 3 — Vocabulário visual — T-007, T-008, T-009, T-010, T-011

Hunks reais (não o arquivo inteiro duas vezes), cinco hues de família + sete glifos, os
cinco componentes, o despachante da timeline e o realce de código.

**Checkpoint:** `npm test -w apps/menubar`; `npm run dev:web -w apps/menubar` mostra os
cards contra o `MOCK_FEED`, com a cor **só** no glifo e o status no pill (C1).

### Fase 4 — As duas telas — T-012, T-013, T-014

`StreamPanel` renderiza itens; a Entrevista narra ao vivo sem **jamais** streamar
`agent_message_chunk`.

**Checkpoint (só um run vivo prova):** critérios 1, 2 e 6 da spec — a ferramenta transiciona
sozinha de `rodando` para `ok`/`falhou` com texto intercalado; um Step de edição mostra
hunks; a aba `Specs` mostra ferramentas ao vivo durante os ~5 min do primeiro turno e
**nenhum** bloco `<loopy-…>` aparece na tela em momento algum.

### Fase 5 — Registro — T-015, T-016

ADR-0013 estendendo o 0007, `DESIGN.md` §2/§5 e os quatro intent nodes.

---

## Risks and Mitigations

| Risco | Impacto | Mitigação |
|---|---|---|
| **`applyLine` curto-circuita e a timeline nunca acumula** — `store-bridge.ts:145-146` faz `if (nextStore === state.store) return state`, e com `reduce` no-op nos eventos novos esse guard descarta **todos** eles. Falha 100% silenciosa: compila, roda, tela vazia. Pior: reordenar ingenuamente troca um bug por outro (ver abaixo). | **Alto** | T-006: o transcript vira um redutor puro irmão do `reduce` (`applyTimeline`), com no-op próprio e validação **explícita**; o guard passa a exigir que os dois não tenham mudado. Mais o teste que dispara um evento novo e exige que `transcript` cresça. |
| Linha NDJSON gigante congela o pipe (C3) | Alto | De-riscado pela **T-004**, na primeira fase. A prova é o **invariante estrutural** (`scanned` avança com o buffer e nunca reinicia), não um limite de tempo — teste com relógio dentro pisca vermelho na CI por outro motivo. Mais o teste de corretude de 10 MB em chunks de 4 KB. |
| Contrato publicado quebra o build do app (`StoreEvent`/frames são subpath export com `dts`) | Alto | Tudo é **aditivo**; T-001 roda `npm run typecheck` da raiz, que **cobre** o `apps/menubar`. Campo opcional novo é seguro; mudar shape existente é "perguntar antes". |
| Payload extremo ocupa memória no Rust e no webview | Médio | **Risco aceito de olhos abertos** (D6, spec §Riscos). Mitigação só no render: `<details>` fechado + `content-visibility: auto`. Não há teto por campo. |
| 4 colunas × centenas de cards viram problema de performance | Médio | Ring com teto (R6) corta DOM e memória; `content-visibility` corta pintura. Virtualizar é change própria (spec §Fora de escopo) — **não** improvisar aqui. |
| Terceira dependência entra sem querer | Médio | O portão de Boundaries continua fechado: `diff` e `rehype-highlight`, mais nada. As duas entram em tasks distintas com aresta entre elas. |
| Regressão silenciosa na TUI Ink | Médio | `reduce` no-op ⇒ `line-reporter.ts:90` (`next === state`) já filtra os eventos novos: o Ink não ganha um único `case`. Teste de regressão em T-001. |
| `prettier --write` reformata código alheio (repo fora de sincronia) | Baixo | `--write` **apenas** em arquivo novo; em arquivo existente, validar as próprias linhas por diff. Idem `cargo fmt` (conformar só `sidecar.rs`). |

### Por que o guard do `applyLine` merece um parágrafo

O `if (nextStore === state.store) return state` faz **duas** coisas, e só uma é óbvia:
**structural sharing** (nada mudou, o React não reconcilia) e **validação de graça** — o
`reduce` devolve a mesma referência quando o evento é para uma task não registrada, e o
guard herda essa validação sem escrevê-la.

Até esta change, "o `reduce` ignorou" e "não há nada a acumular" eram a **mesma** coisa.
Com os seis eventos novos sendo no-op **por decisão** (R4), passam a ser coisas diferentes
— e o guard, que não sabe distinguir, descarta as duas. É por isso que reordenar
ingenuamente não resolve: ganha-se a timeline e **perde-se** a validação, e um `tool_call`
de task fantasma passa a criar entrada no transcript.

A T-006 separa as duas responsabilidades: `applyTimeline` é um redutor **puro** irmão do
`reduce`, com no-op próprio e a validação **explícita** (fail-closed), e o guard passa a
exigir que os dois não tenham mudado. Espelha a estrutura que o arquivo já tem — `store` e
`ui` já são sub-estados com redutores separados; `transcript` era o único enfiado no meio
do outro.

### Pré-requisito operacional

Há **WIP não commitado** em `apps/menubar/src/specs/{ActivityLine,Interview,interview-state,specs}.*`,
`src/index.ts` (a flag `--demand`) e `tests/cli/interview.test.ts`. Os worktrees saem do
**parent branch** — esse WIP precisa estar **commitado** antes do run, ou a T-014 parte de
um `ActivityLine.tsx` que, no worktree dela, não existe.

---

## Open Questions

**Nenhuma.** As três da spec viraram a R7 no refine; a única que restava — a forma do
`transcript` da Entrevista — foi respondida durante este planejamento (Timeline única) e
está registrada acima em *Decisão tomada neste planejamento*.
