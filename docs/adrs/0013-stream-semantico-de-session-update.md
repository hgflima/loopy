---
number: 0013
title: "Stream semântico de session/update"
status: accepted
date: 2026-07-26
status_date: 2026-07-26
supersedes: []
superseded_by: null
---

# ADR-0013 — Stream semântico de session/update

## Context

A ADR-0007 deu um **Transport NDJSON duplex** que carrega cada `StoreEvent` até
a Native UI. O gargalo não estava no Transport, mas **antes dele**, no
`onUpdate` do motor (`src/index.ts`): das **13** variantes de
`session/update` que o `@agentclientprotocol/sdk` 0.29 declara, o handler
traduzia exatamente **duas** — `stream_chunk` (só o texto de
`agent_message_chunk`) e `usage_sample`. As outras **onze** (chamada de
ferramenta, atualização de ferramenta, pensamento, plano do turno, troca de Modo,
e o resto) morriam no boundary antes de tocarem um frame.

O efeito na tela é silêncio: um Step de Agente que passa quatro minutos lendo
arquivos, editando e rodando testes aparece como nada, seguido de um parágrafo de
prosa no fim. O trabalho existe, o motor o vê, e nada disso chega ao humano — nem
no `StreamPanel` do Run, nem na `ActivityLine` da Entrevista (o silêncio dos ~5
min do primeiro turno; o D14 em aberto).

Forças em tensão:

- **AD-1 (config-driven, paridade on/off).** Sem GUI e sem `--emit-events`, o
  `RunLoopResult` tem de ficar **byte-idêntico**. Nada disto pode virar
  comportamento de loop nem estado no motor.
- **Motor sem memória.** O motor traduz um update por vez; ele **não** deve
  acumular o estado de uma tool call entre notificações. Guardar
  `Map<toolCallId, ToolCallState>` seria inventar um reaper e um ciclo de vida que
  o motor não tem.
- **A shape do ACP não passa do boundary.** A GUI **nunca** importa de
  `@agentclientprotocol/sdk` (neutralidade herdada da ADR-0006/0008); o que
  atravessa o fio é vocabulário do motor.
- **Uma mescla, não duas.** `tool_call` + N `tool_call_update` precisam virar um
  card só; a regra de mescla tem de existir em **um** lugar, importável pelos dois
  consumidores (o Run e a Entrevista), ou eles divergem.
- **Contagem de itens limitada (não os bytes).** Um turno longo pode emitir
  centenas de itens; a lista precisa de teto **na quantidade** sem mentir sobre o
  que cortou. O teto morde o **número de itens**, não o payload por campo — esse
  fica sem teto de propósito (ver a alternativa rejeitada abaixo e o risco aceito
  nas Consequências).

Alternativas consideradas:

- **Uma variante tipada de `StoreEvent` por update (13 no total).** Rejeitada: um
  contrato impraticável, e desnecessário — promover um tipo do catch-all para
  tipado depois é **aditivo** (não quebra o `dts` publicado), então a fronteira
  pode se mover sem custo de contrato.
- **Acumular a timeline no `StoreState` do motor.** Rejeitada: fere o motor-sem-
  memória e o AD-1 (`task.stream` já é zerado a cada Step/Tentativa, e sob o
  sidecar o motor sequer cria store). Quem tem história é a GUI.
- **O frame de controle da Entrevista carregar um `ToolCallState` pronto** (a
  leitura literal de que a Entrevista streama um item renderizável). Rejeitada:
  produzir o card completo obrigaria o motor a guardar o estado acumulado da tool
  call — exatamente o que a regra anterior proíbe — e a rodar a mescla em dois
  lugares.
- **Truncar payloads grandes no fio.** Rejeitada: envia-se tudo, sem teto por
  campo; o que se corta é a cliff **quadrática** do framer do sidecar, não o dado.

## Decision

Traduzir **todo** `session/update` _renderizável_ em vocabulário do motor e
levá-lo à tela como **timeline semântica**, sobre o mesmo Transport da ADR-0007,
de forma **aditiva**. A única exceção é o `usage_update`: ele **não é descartado**
e **não vira timeline** — segue o caminho de telemetria que já existia
(`usage_sample` + buffer de custo, sub-decisão 2), que o tradutor não pode
contabilizar em dobro.
Seis sub-decisões.

### 1. Cinco eventos tipados + um catch-all

O que a UI sabe desenhar ganha evento próprio; o resto cai num catch-all. Nenhum
update **renderizável** é descartado — um `switch` exaustivo sobre
`update.sessionUpdate` manda o `default` para o catch-all, então um tipo novo no
SDK **aparece na tela** em vez de sumir, e o `tsc` avisa quando a união cresce. O
único braço que devolve `undefined` é o `usage_update` (a exceção acima:
telemetria, não timeline); os outros doze viram um item.

| Evento             | Cobre                                                    |
| ------------------ | -------------------------------------------------------- |
| `tool_call`        | abertura de uma chamada de ferramenta                    |
| `tool_call_update` | um delta sobre uma chamada já aberta                     |
| `thought_chunk`    | pensamento do Agente                                     |
| `plan`             | o plano do turno                                         |
| `mode_changed`     | troca de Modo da Sessão                                  |
| `agent_update`     | catch-all: `kind` + JSON cru atrás de disclosure fechado |

Promover um `kind` do catch-all para tipado é aditivo: a fronteira anda sem custo
de contrato.

### 2. O motor traduz; a GUI renderiza

A tradução `SessionUpdate → StreamUpdate` é uma **função pura** em
`src/acp/client.ts` (irmã de `agentChunkText`), testável com os 13 casos sem subir
processo. O `onUpdate` fica com o que só ele sabe: carimbar `taskId`/`stepId`/
`agent` e despachar. A GUI nunca vê a shape crua do ACP.

### 3. Deltas no fio; a mescla é uma função pura compartilhada

O motor solta `tool_call_update` como **delta** e segue **sem memória**. A mescla
`mergeToolCall(current, delta)` mora em `src/tui/store.ts` — browser-safe, já é
subpath export — e é importada pelos **dois** redutores da GUI: o do Run e o da
Entrevista. Uma implementação, um teste, zero divergência; `null`/`undefined` num
campo do delta significam "não mexi", nunca "apague". O agrupamento é por
`toolCallId`, não por adjacência: updates chegam intercalados com texto e ainda
voltam para o card certo.

### 4. A timeline acumula na GUI, com ring e marcador de corte

O `StoreState` continua descrevendo o **turno corrente**; `reduce` trata os seis
eventos novos como **no-op explícito**, o que mantém a TUI Ink byte-idêntica (o
`next === state` já os filtra, o Ink não ganha um único `case`). Quem acumula a
história é a GUI, num `StreamItem[]` por escopo (Run e Entrevista), com **ring de
teto da ordem de 500 itens**: ao cortar, o mais antigo sai e um item `elided` no
topo declara quantos sumiram — a lista pode encolher, mas não pode mentir.
Precedentes de doutrina no próprio motor: `ACP_LOG_CAP` (200), `WARNINGS_CAP`
(50). O ring limita a **contagem** de itens, não os bytes de um item: um chunk
longo concatenado por `messageId` ou um `rawOutput` cru fica sem teto — o risco
aceito nas Consequências, não uma promessa quebrada aqui.

### 5. O texto não ganha evento novo

`stream_chunk` ganha `stepId?` e `messageId?` — dois campos **opcionais,
aditivos**. O texto atravessa o pipe **uma vez só**, a TUI Ink não muda, e um
agente antigo (sem `messageId`) continua funcionando: `stepId` ausente cai no
`task.currentStepId`. A GUI converte o `stream_chunk` estendido no item `text` da
timeline; chunks com o mesmo `messageId` fecham um bloco em vez de concatenar tudo
do Step.

### 6. A Entrevista streama ao vivo pelo control frame `agent_stream`

A Entrevista ganha um frame de **controle** novo, `agent_stream` (aditivo: o
`agent_activity` **não muda de shape**), que carrega um **`StreamUpdate`** — não um
item renderizável pronto. Produzir o card completo exigiria o motor guardar o
estado acumulado da tool call, que a sub-decisão 3 proíbe; então o **mesmo tipo**
atravessa os **dois canais** (evento no Run, este control frame na Entrevista) e a
**mesma `mergeToolCall`** do outro lado o consome.

O `onUpdate` da Entrevista **filtra `agent_message_chunk`**: ferramentas,
pensamentos, plano e o catch-all viajam ao vivo; a prosa continua saindo **só**
pelo `agent_activity`, no fim do turno, já sem o Envelope. Streamar o texto cru
mostraria o `<loopy-ask>{json}</loopy-ask>` sendo digitado e entregaria o turno em
duplicata. Isso fecha o D14 **parcialmente**: ferramentas ao vivo, prosa ainda no
fim.

### Relação com a ADR-0007 (unidirecional)

Esta ADR **estende a ADR-0007, não a supersede**. Tudo corre sobre o mesmo
Transport NDJSON duplex: as cinco variantes tipadas + o catch-all viajam no frame
`event` já existente (o parser as roteia pelo `type`, automaticamente), e o
`agent_stream` é um frame `control` **aditivo** — nenhum frame existente muda de
shape. A referência cruzada fica registrada **só aqui**: a ADR-0007 está
`accepted` e seu corpo é imutável pelo harness de ADRs, então a relação é
unidirecional — como a ADR-0011 fez ao estender a ADR-0003, e como a própria
ADR-0012 fez ao estender a ADR-0007.

## Consequences

**Positivas:**

- A tela narra o trabalho real: chamadas de ferramenta com status que transiciona
  sozinho, diffs de verdade, pensamentos, plano e troca de Modo — nas **duas**
  superfícies (o D14 fecha para as ferramentas da Entrevista).
- **AD-1 preservado:** sem GUI e sem `--emit-events`, `RunLoopResult`
  byte-idêntico; o `reduce` no-op mantém a TUI Ink intocada.
- **Uma mescla** (sub-decisão 3), um tipo (`StreamUpdate`) nos dois canais, um
  componente React — o Run e a Entrevista não têm como divergir.
- **Contrato aditivo:** cinco variantes novas de evento + catch-all, dois campos
  opcionais no `stream_chunk`, um control frame novo. Nada existente muda de shape,
  então o `dts` publicado e o build do `apps/menubar` sobrevivem.
- **Nada some:** um `session/update` novo ou desconhecido do SDK aparece como linha
  `raw` em vez de sumir no vazio; o `switch` exaustivo faz o `tsc` avisar quando a
  união cresce.

**Negativas / custo:**

- **Duas dependências novas no `apps/menubar`** (`diff` para os hunks, `rehype-
highlight` para o realce) — **zero no motor**.
- **Robustez do catch-all por convenção:** um update genuinamente novo renderiza
  como JSON cru, não como card de primeira classe, até alguém o promover.
- **Payload sem teto por campo** (envia-se tudo): um `rawOutput` extremo ocupa
  memória no processo Rust e no webview. O fix do framer (offset varrido) mata a
  cliff **quadrática**, não o consumo; o render se defende com `<details>` fechado
  e `content-visibility: auto`. Risco aceito de olhos abertos.
- **A prosa da Entrevista continua chegando de uma vez** no fim do turno: o que
  mata o silêncio dos ~5 min são as ferramentas ao vivo, não o texto.

**Neutras / relação com outros ADRs:**

- **Estende a ADR-0007** (Transport NDJSON duplex), como a ADR-0012 também fez; a
  relação é registrada só neste ADR (o corpo da 0007 é imutável).
- **Apoia-se na ADR-0005** (união `StoreEvent` + `reduce` + view pura: os eventos
  novos são no-op no reducer) e na **ADR-0006/0008** (neutralidade de adapter: a
  shape do ACP morre no `onUpdate`, a GUI não importa do SDK).
- A fronteira "cinco tipados + catch-all" pode se mover depois sem custo de
  contrato — promover um `kind` é aditivo.
