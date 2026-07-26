# Spec: C-0019 — Stream rico, `session/update` semântico na tela

> Escrita em 2026-07-26 (`/devy:spec`), com a interação conduzida num artefato
> Lavish (`.lavish/c0019-stream-rico.html`). As **decisões D1–D7 foram fechadas
> pelo usuário** naquele artefato; não re-litigar.
>
> **Refinada no mesmo dia** (`/devy:refine`, artefato `.lavish/c0019-refine.html`),
> em sete perguntas ordenadas por dependência. As **respostas R1–R7 também estão
> fechadas** e aparecem em “Decisões do refine”; elas *corrigem* partes desta spec
> onde o código contradisse o desenho original. Onde R e D divergirem, **R vence**.
>
> Referência de implementação analisada:
> `~/.opensrc/repos/github.com/newioapp/acp-inspector/main` (Electron + React,
> MIT). O que dela é transferível e o que não é está registrado abaixo.

---

## Objective

Hoje o motor recebe **todo** `session/update` do Agente e joga fora tudo que não
é texto. O handler `onUpdate` (`src/index.ts:597–613`) despacha exatamente dois
eventos — `stream_chunk` (só `agent_message_chunk` de texto, via
`agentChunkText`) e `usage_sample` — e os outros **onze** tipos de update do SDK
morrem ali, antes de tocarem o Transport.

O efeito na tela: um Step de Agente que passa quatro minutos lendo arquivos,
editando e rodando testes aparece como **silêncio**, seguido de um parágrafo de
prosa no fim. O trabalho existe, o motor o vê, e nada disso chega ao humano.

Esta change atravessa esse dado até a tela: chamadas de ferramenta com status ao
vivo, diffs, pensamentos, plano do turno e troca de Modo, renderizados como uma
**timeline semântica** — com markdown correto e código visualmente diferenciado.

**Usuário:** o dono do repo, olhando a GUI enquanto o loop trabalha. Ele quer
responder “o que ele está fazendo agora?” sem abrir um log.

**Sucesso, em uma frase:** nenhum minuto de tela parada num turno que está
trabalhando, e cada ferramenta que o Agente chama visível com o desfecho dela.

### O que NÃO é

- **Não** é controle. Nada aqui altera o que o loop faz (AD-1); nenhum botão
  novo fala com o Agente. `RunLoopResult` continua byte-idêntico com e sem GUI.
- **Não** é o painel de Tráfego ACP cru de volta. Aquele foi removido na C-0007
  por bons motivos (cada chunk de texto virava uma linha, duplicando o Stream).
  Isto é **narrativa de trabalho**, não log de protocolo — e o `acp_traffic`
  continua exatamente como está, alimentando só o log de arquivo.
- **Não** é persistência. O transcript continua morrendo quando o app fecha.
- **Não** é busca/filtro dentro do stream.
- **Não** mostra `session/request_permission`: no loopy ele é resolvido por
  política (`acp.permissions.on_request`), sem humano no meio.

---

## Decisões fechadas

Tomadas com o usuário no artefato Lavish. **Não re-litigar** — se alguma se
mostrar errada durante a implementação, atualize esta spec antes do código.

| # | Decisão | Escolha |
|---|---|---|
| **D1** | Superfície | **`StreamPanel` do Run + `ActivityLine` da Entrevista.** As duas telas ganham a mesma timeline; isso **fecha o D14** (a Entrevista passa a narrar ao vivo). A TUI Ink fica de fora. |
| **D2** | Contrato do store | **Eventos tipados novos no `StoreEvent`.** O store continua sendo o domínio; a GUI nunca vê a shape crua do ACP. |
| **D3** | Allowlist | **Tudo, com fallback de JSON cru para tipos desconhecidos.** Nenhum update é silenciosamente descartado. |
| **D4** | Paleta / `DESIGN.md` | **Expansivo: hue por `kind` de ferramenta**, como o `acp-inspector`. Revoga o “No syntax decoration” e amplia a Meaning-Only Rule. |
| **D5** | Realce de código | **highlight.js via `rehype-highlight`**, tema mapeado nos tokens OKLCH. |
| **D6** | Limites de payload | **Enviar tudo, sem truncagem.** `rawInput`/`rawOutput`/diffs viajam inteiros. |
| **D7** | Pensamentos | **Colapsado por padrão**, com contador (“Pensando · N parágrafos”); abre por clique. |
| **D8** | ADR | Novo **ADR 0013 estendendo o ADR-0007**. O corpo do 0007 **não se toca** (relação mora só no ADR novo). |
| **D9** | Change | É a **C-0019**, não um adendo à C-0018. |

D8/D9 foram propostas por mim como “decido se você não vetar”; não houve veto.

---

## Decisões do refine

Sete perguntas, uma por vez, cada uma ancorada no que o código respondeu.
**Não re-litigar** — mesma regra das D.

| # | Pergunta | Escolha |
|---|---|---|
| **R1** | O que a Entrevista streama ao vivo | **Só ferramentas e pensamentos.** O `onUpdate` da Entrevista deixa passar tudo **menos** `agent_message_chunk`. A prosa continua chegando limpa, no fim do turno, pelo `agent_activity` — o Envelope (`<loopy-ask>{json}`) **nunca** aparece sendo digitado. |
| **R2** | Quem mescla `tool_call` + `tool_call_update` | **Deltas no fio; a mescla é uma função pura compartilhada.** `mergeToolCall` nasce em `src/tui/store.ts` (browser-safe, já exportado) e é importada pelo `reduce()` do Run **e** pelo `advance()` da Entrevista. O motor segue sem memória. |
| **R3** | Por qual evento o texto entra | **Estender o `stream_chunk`** com `stepId?` e `messageId?` (aditivo). Um evento só para texto: o Ink não muda, e nenhum token atravessa o pipe duas vezes. |
| **R4** | Onde a timeline acumula | **Na GUI.** `BridgeState.transcript` deixa de ser `string` e vira `StreamItem[]` por task. O `StoreState` continua descrevendo **o turno corrente**. |
| **R5** | Como o diff é produzido | **Entra o `diff` (jsdiff)** no `apps/menubar`. Hunks com contexto, calculados no render por função pura. Segunda e **última** dependência da change. |
| **R6** | Teto de itens da timeline | **Ring por task com marcador.** Teto da ordem de 500 itens; o mais antigo sai e um item `elided` no topo declara quantos foram omitidos. |
| **R7** | As três Open Questions + duas menores | **Ratificadas as cinco** (detalhe abaixo). |

**R7 em detalhe** — as cinco ratificações, todas confirmadas pelo código:

- **a (OQ1)** — os eventos de tool **carregam `stepId`**. O mapa `taskCurrentStep`
  (`src/index.ts:552–555`) já existe e já carimba o `usage_sample`; sem `stepId` no
  card, o divisor por Step separaria só a prosa.
- **b (OQ2)** — a Entrevista ganha um **control frame novo**, `agent_stream`.
  Aditivo: o `agent_activity` **não muda de shape**. **Correção do `/devy:plan`
  (§Architecture Decisions 3), registrada na T-001:** o frame carrega um
  `StreamUpdate`, **não** um `StreamItem`. Produzir um `ToolCallState` completo
  exigiria que o motor guardasse o estado acumulado da tool call — exatamente o
  que a R2 proíbe. O mesmo tipo (`StreamUpdate`) atravessa os dois canais
  (evento no Run, este frame na Entrevista) e a mesma `mergeToolCall` do outro
  lado o consome. **A decisão R7b não muda; muda o tipo que a cumpre.**
- **c (OQ3)** — **sete** ícones SVG inline em `ui/icons.tsx`, sem `lucide-react`.
  São sete, não dez: a C1 colapsou os `ToolKind` em famílias.
- **d** — o que a UI não desenha cai no **`raw`**: `plan_update` e `plan_removed`
  (marcados `UNSTABLE`/`@experimental` no próprio SDK), `available_commands_update`,
  `config_option_update`, `session_info_update` e `user_message_chunk`. Consequência
  aceita: na Entrevista o `user_message_chunk` é **o nosso Envelope voltando** — não
  some (D3), mas nasce atrás do disclosure fechado, como todo `raw`.
- **e** — realce com o conjunto **`common`** default do `rehype-highlight`, sem curar
  linguagens: o custo é disco num app empacotado, e curar arrisca um bloco sair sem
  realce.

### O que as R corrigem nas D

Três pontos desta spec ficaram **desatualizados** pelas respostas acima; onde o
texto antigo sobreviver em algum trecho, valem estes:

1. A variante `text` do `StreamItem` **não** vem de um evento novo (R3): ela é
   montada na GUI a partir do `stream_chunk` estendido.
2. O reducer do motor **não** ganha timeline (R4): quem acumula é a GUI.
3. A frase “nenhum limite” vale para **payload** (D6), não para **quantidade de
   itens** (R6).

---

## Conflitos resolvidos

Três coisas que a spec descobriu ao encostar no código e que mudam a forma de
uma decisão sem mudar o seu conteúdo. **Cada uma é vetável.**

### C1 · A roda de cores só comporta seis hues, não dez

**D4 pede um hue por `kind`.** O SDK 0.29 declara **dez** `ToolKind`
(`read`/`edit`/`delete`/`move`/`search`/`execute`/`think`/`fetch`/`switch_mode`/`other`).
O `DESIGN.md` já reserva cinco hues (accent 352, failed 28, blocked 75, done 150,
running 210) e exige ~35° de separação entre eles — a regra que impede “failed”
de ler como “interativo”.

Medindo os intervalos livres na roda com ≥30° de folga de cada hue reservado,
sobram exatamente **seis** posições: ~112, ~180, ~240, ~270, ~300, ~322. Dez
hues distintos **não cabem** sem colidir com um estado.

**Resolução:** o vocabulário fica com **cinco hues novos + duas heranças**, e o
`kind` mapeia por **família de intenção**:

| Família | `ToolKind` | Token | Light | Dark |
|---|---|---|---|---|
| Leitura | `read`, `search`, `fetch` | `--tool-read` | `oklch(0.55 0.15 240)` | `oklch(0.74 0.13 240)` |
| Escrita | `edit`, `move` | `--tool-write` | `oklch(0.55 0.14 112)` | `oklch(0.74 0.13 112)` |
| Execução | `execute` | `--tool-exec` | `oklch(0.55 0.12 180)` | `oklch(0.74 0.11 180)` |
| Raciocínio | `think` | `--tool-think` | `oklch(0.55 0.15 270)` | `oklch(0.74 0.14 270)` |
| Governo | `switch_mode` | `--tool-mode` | `oklch(0.55 0.15 322)` | `oklch(0.74 0.14 322)` |
| Destrutivo | `delete` | `--tool-danger` | herda `--state-failed-ink` | idem |
| Outro | `other` | `--tool-other` | herda `--ink-tertiary` | idem |

`delete` herdar o vermelho-laranja **não é colisão, é a semântica certa**:
destruição é a cor de perigo. `other` sem hue mantém o vocabulário pequeno.

**E a regra que segura tudo:** a cor de ferramenta vive **só no traço do ícone**.
Nunca vira fill, tint, borda ou pill. O que ocupa fill/pill continua sendo o
**status** (`pending`/`in_progress`/`completed`/`failed`), nos hues que já
existem. Assim a distinção não depende de hue: depende de **forma** (glifo ×
pill), e sobrevive a daltonismo — que é a regra que o `DESIGN.md` já exige.

### C2 · “Tudo tipado” não é 13 eventos

**D2 pede tipado; D3 pede tudo.** Treze variantes de `StoreEvent` novas seria
um contrato impraticável. A leitura combinada — e a própria frase de D3, “com
fallback de JSON cru para tipos **desconhecidos**” — resolve:

**Cinco eventos tipados** para o que a UI sabe renderizar, **mais um catch-all**
para o resto. Nenhum update é descartado; o que não tem forma própria aparece
como uma linha com o `kind` e o JSON atrás de um disclosure fechado.

Promover um `kind` do catch-all para tipado depois é **aditivo** (não quebra o
`dts` publicado), então a fronteira pode se mover sem custo de contrato.

### C3 · Sem limite de payload, o framer do Rust é quadrático

**D6 escolhe enviar tudo.** Registrando o mecanismo com honestidade:
`apps/menubar/src-tauri/src/sidecar.rs:139` procura o `\n` com
`self.buf.iter().position(...)` — varrendo **o buffer acumulado inteiro a cada
chunk de 4 KB** (`sidecar.rs:324`). Enquanto a linha não fecha, o custo é
O(N²/4096). Uma linha de 40 MB (um `rawOutput` de build, plausível com 4 tasks
concorrentes) dá ~2×10¹¹ comparações de byte: o pipe congela, não “fica lento”.

**Resolução, que preserva D6 integralmente:** guardar o offset já varrido e
retomar a busca dali (mudança de ~3 linhas no `LineFramer`). O limite continua
inexistente; some só a cliff quadrática.

Mitigação adicional, **só do lado do render** (o Transport continua mandando
tudo): `content`, `rawInput` e `rawOutput` nascem dentro de `<details>` fechado,
então um payload gigante nunca é pintado até alguém pedir. Com
`content-visibility: auto` no card, o custo de layout também fica sob demanda.

**Risco residual aceito pelo usuário:** um payload extremo ainda ocupa memória
no processo Rust e no webview. Não há teto.

---

## Tech Stack

Sem stack nova além de **duas** dependências, ambas no workspace `apps/menubar`.

- Motor: TypeScript ESM, Node ≥22.13, `@agentclientprotocol/sdk` **0.29.0**.
  **Zero dependência nova no motor.**
- GUI: Tauri v2 + React 18, `react-markdown` 10 + `remark-gfm` 4.
- **Dependência nova 1:** `rehype-highlight` (+ `highlight.js` transitivo).
  Escolhida por ser **síncrona** — o texto chega em streaming e re-realça a cada
  chunk; um pipeline assíncrono (Shiki, `rehype-starry-night`) exigiria
  `MarkdownHooks` e debounce. `react-markdown` expõe `rehypePlugins` exatamente
  para isso (docs oficiais). Conjunto de linguagens: o **`common`** default,
  sem curadoria (R7e).
- **Dependência nova 2 (R5):** `diff` (jsdiff), MIT. **Por que é necessária:** o
  tipo `Diff` do ACP (`types.gen.d.ts:509–532`) é `{ path, oldText?, newText }` —
  **não** existe hunk, sinal nem número de linha no protocolo. Sem um algoritmo,
  o `+`/`−` do Critério 2 é impossível; a referência (`acp-inspector`,
  `ToolCallCard.tsx:98–131`) pinta o arquivo velho inteiro de vermelho e o novo
  inteiro de verde, que numa edição de 3 linhas num arquivo de 2.000 são 4.000
  linhas coloridas. Myers com corte de prefixo/sufixo é o que a lib faz bem e o
  que um LCS caseiro faz mal.
- **Nenhuma terceira.** O portão “perguntar antes” de Boundaries continua valendo.
- Tema do realce: **CSS puro**, mapeando as classes `hljs-*` nos tokens OKLCH
  existentes. **Não** importar folha de tema do highlight.js — as paletas dele
  são hex fixo e violariam o design system nos dois temas.

---

## Commands

```
Typecheck (raiz + menubar):  npm run typecheck
Lint:                        npm run lint
Testes do motor:             npm test
Testes da GUI:               npm test -w apps/menubar
Build do motor:              npm run build
GUI em dev (com Rust):       npm run dev -w apps/menubar
GUI em dev (só web, mock):   npm run dev:web -w apps/menubar
Empacotar o .app:            npm run menubar
```

⚠️ `npm test` na raiz **não** roda os testes do app. As duas suítes precisam
passar.

---

## Project Structure

Arquivos tocados, por camada.

### Motor

```
src/tui/store.ts          → 5 StoreEvent novos + 1 catch-all; `stream_chunk`
                            ganha stepId?/messageId? (R3); tipos StreamItem*;
                            `mergeToolCall` PURA e exportada (R2).
                            NÃO ganha timeline acumulada (R4)
src/tui/transport.ts      → control frame novo `agent_stream` da Entrevista,
                            carregando StreamItem (R7b)
src/index.ts              → onUpdate deixa de filtrar: traduz cada SessionUpdate
                            em evento (o único ponto que conhece a shape do ACP);
                            carimba stepId via taskCurrentStep (R7a)
src/acp/client.ts         → helpers puros de extração (irmãos de agentChunkText)
src/interview/run.ts      → passa onUpdate ao openAgent, FILTRANDO
                            agent_message_chunk (R1), e emite `agent_stream`
```

### GUI

```
apps/menubar/src/state/stream-history.ts  → transcript: string → StreamItem[] por
                                            task (R4); ring com teto + item
                                            `elided` (R6); puro
apps/menubar/src/state/store-bridge.ts    → applyLine acumula ITENS, não texto;
                                            usa mergeToolCall do motor (R2)
apps/menubar/src/specs/interview-state.ts → `advance` trata `agent_stream` e usa
                                            o MESMO mergeToolCall (R2)
apps/menubar/src/ui/tokens.css            → 5 --tool-* novos (+2 heranças)
apps/menubar/src/ui/ToolCallCard.tsx      → o card (novo)
apps/menubar/src/ui/DiffView.tsx          → hunks +/− via jsdiff (novo, R5)
apps/menubar/src/ui/diff-hunks.ts         → oldText/newText → hunks (puro, R5)
apps/menubar/src/ui/ThoughtBlock.tsx      → o pensamento colapsado (novo)
apps/menubar/src/ui/PlanBlock.tsx         → o plano do turno (novo)
apps/menubar/src/ui/RawUpdateRow.tsx      → o fallback de JSON cru (novo)
apps/menubar/src/ui/MarkdownStream.tsx    → + rehypeHighlight
apps/menubar/src/ui/MarkdownStream.css    → tema hljs sobre os tokens
apps/menubar/src/ui/tool-kind.ts          → kind → {ícone, família, rótulo} (puro)
apps/menubar/src/ui/icons.tsx             → +7 glifos de família (R7c)
apps/menubar/src/panes/StreamPanel.tsx    → renderiza itens, não string
apps/menubar/src/specs/ActivityLine.tsx   → mesma timeline na Entrevista, SEM
                                            texto ao vivo (R1)
apps/menubar/src-tauri/src/sidecar.rs     → LineFramer: offset varrido (C3) —
                                            compartilhado com interview_process.rs
```

### Docs

```
docs/adrs/0013-*.md                → ADR novo, estende o 0007 (D8)
apps/menubar/DESIGN.md             → §5 Stream Panel reescrita; §2 ganha o
                                     vocabulário de ferramenta e a regra do glifo
src/tui/CLAUDE.md                  → “14 variantes” → 20 (14 + 5 tipados + o
                                     catch-all); `mergeToolCall` é API pública (R2)
src/acp/CLAUDE.md                  → onUpdate deixa de ser só texto
apps/menubar/src/CLAUDE.md         → transcript deixa de ser string e ganha ring
                                     com marcador (R4/R6)
src/interview/CLAUDE.md            → D14 fecha PARCIALMENTE: ferramentas ao vivo,
                                     prosa ainda no fim do turno (R1)
```

---

## Code Style

O motor traduz; a GUI renderiza. **A shape do ACP não passa do `onUpdate`.**

### Os eventos novos (`src/tui/store.ts`)

```ts
/** Um item da timeline de um Step de Agente. Discriminado por `item`. */
export type StreamItem =
  | { readonly item: "text"; readonly text: string; readonly messageId?: string }
  | { readonly item: "thought"; readonly text: string; readonly messageId?: string }
  | { readonly item: "tool"; readonly call: ToolCallState }
  | { readonly item: "plan"; readonly entries: readonly PlanEntryState[] }
  | { readonly item: "mode"; readonly modeId: string }
  | { readonly item: "raw"; readonly kind: string; readonly payload: unknown }
  /** R6: marca o corte do ring — a lista nunca mente sobre o que perdeu. */
  | { readonly item: "elided"; readonly count: number };

/** Estado acumulado de uma tool call (tool_call + todos os tool_call_update). */
export interface ToolCallState {
  readonly toolCallId: string;
  readonly title: string;
  readonly kind: ToolKindName;          // 10 valores do SDK; default "other"
  readonly status: ToolCallStatusName;  // default "pending"
  readonly locations: readonly { path: string; line?: number }[];
  readonly content: readonly ToolContentItem[];  // text | diff | terminal
  readonly rawInput?: unknown;
  readonly rawOutput?: unknown;
}

/**
 * R2 — a mescla mora AQUI e é pura. O motor não a usa (ele só traduz); os dois
 * consumidores importam esta função: o `reduce()` do Run e o `advance()` da
 * Entrevista. Uma implementação, um teste, zero divergência.
 * `null`/`undefined` num campo do delta significam "não mexi", nunca "apague".
 */
export function mergeToolCall(
  current: ToolCallState | undefined,
  delta: ToolCallDelta,
): ToolCallState;
```

**Cinco eventos novos + um catch-all** (C2), todos com `taskId` e `agent?`, e os
de tool também com `stepId` (R7a): `tool_call`, `tool_call_update`,
`thought_chunk`, `plan`, `mode_changed` e `agent_update` (o catch-all).

**O texto NÃO tem evento novo (R3).** O `stream_chunk` existente ganha
`stepId?` e `messageId?` — dois campos opcionais, aditivos — e é ele que a GUI
converte no item `text` da timeline. Assim o texto atravessa o pipe uma vez só e
a TUI Ink continua funcionando sem tocar em nada.

**A ordem da timeline é a ordem de chegada.** O Transport é NDJSON, uma linha por
evento; texto e cards se intercalam sem precisar de campo de sequência.

**`StreamItem` mora no `store.ts` de propósito**: `transport.ts` já importa dele
(`transport.ts:27`), então o control frame `agent_stream` da Entrevista reusa
exatamente o mesmo tipo. Um tipo, dois canais, um componente React — é o que
impede o Run e a Entrevista de divergirem.

### A tradução (`src/index.ts`)

Um `switch` exaustivo sobre `update.sessionUpdate`, com o `default` mandando o
`raw` — assim um tipo novo no SDK **aparece na tela** em vez de sumir (D3), e o
`tsc` avisa quando a união cresce.

### O merge de tool call (puro, AD-6, R2)

`tool_call` abre o estado; cada `tool_call_update` faz merge ignorando
`null`/`undefined` (o padrão do `acp-inspector`, `ToolCallCard.tsx:282–292`).
O agrupamento é por **`toolCallId`**, não por adjacência: updates chegam
intercalados com texto e ainda assim voltam para o card certo
(`OutputPanel.tsx:65–97`).

A função vive em **`src/tui/store.ts`** (não no `stream-history.ts`): ela precisa
ser importável pelos **dois** redutores da GUI, e o `store.ts` já é subpath
export browser-safe. O que fica em `stream-history.ts` é a **lista** (R4) e o
ring (R6), não a regra de merge.

### A acumulação (R4/R6)

O `StoreState` do motor descreve **o turno corrente** — `task.stream` já é zerado
a cada `step_started`/`attempt_started` (`store.ts:415,421`), e sob o sidecar o
motor sequer cria store (`start.ts:145–147`). Quem acumula a história é a GUI, no
`BridgeState.transcript`, que deixa de ser `string` e vira `StreamItem[]` por
task, taggeado por Step.

O ring é por task, com teto da ordem de **500 itens**. Ao cortar, o item mais
antigo sai e um item `elided` no topo diz quantos sumiram: a lista pode encolher,
mas **não** pode mentir. Precedentes de doutrina no próprio motor: `ACP_LOG_CAP`
(200) e `WARNINGS_CAP` (50).

### Chunks de texto

`ContentChunk` do SDK 0.29 traz **`messageId`**: chunks da mesma mensagem
compartilham o id, e a troca sinaliza mensagem nova. Usar isso para fechar
blocos de texto em vez de concatenar tudo do Step. O campo viaja no
`stream_chunk` estendido (R3).

### O diff (R5)

`Diff` do ACP é `{ path, oldText?, newText }`. `diff-hunks.ts` recebe os dois
textos e devolve hunks com ~3 linhas de contexto (via `diffLines` do jsdiff);
`DiffView.tsx` só pinta. Arquivo novo (`oldText` ausente/nulo) é um hunk só, todo
adição. Puro e testado isolado (AD-6).

### A Entrevista ao vivo (R1)

O `openAgent` da Entrevista passa a receber `onUpdate`, mas ele **filtra
`agent_message_chunk`**: ferramentas, pensamentos, plano e o catch-all viajam ao
vivo no control frame `agent_stream`; a prosa continua saindo **só** pelo
`agent_activity`, depois do `parseAsk`, já sem os blocos do Envelope.

Isso não é preciosismo: o Agente escreve `<loopy-ask>{json}</loopy-ask>` dentro
da própria mensagem (`envelope.ts:26–31`), e `stripBlocks`
(`parse-ask.ts:82–94`) é quem o remove no fim do turno. Streamar o texto cru
mostraria o JSON da pergunta sendo digitado, e ainda entregaria o mesmo turno
duas vezes (cru ao vivo, limpo no fim).

### O que **não** muda

`agentChunkText`, `usageUpdateUsed`, `usageUpdateCost`, `acpTrafficSummary` e o
evento `acp_traffic` ficam como estão. `usage_sample` permanece intacto, e
`stream_chunk` permanece **sendo emitido como sempre** — só ganha dois campos
opcionais (R3). A shape do `agent_activity` também não muda (R7b).

---

## Testing Strategy

Vitest nos dois lados; a maior parte da lógica é pura (AD-6) e não precisa de
React nem de processo.

| Nível | Onde | O que prova |
|---|---|---|
| Tradução | `tests/` (raiz) | cada um dos 13 `sessionUpdate` vira o evento certo; os seis de R7d viram `raw`; um `sessionUpdate` inventado vira `raw`; nenhum lança |
| `mergeToolCall` (R2) | `tests/` (raiz) | `null`/`undefined` no delta preservam o valor anterior; `content` substitui (não concatena); `kind` que só chega no update é adotado; delta órfão não fabrica card |
| Reducer | `tests/` (raiz) | evento para task/step não registrado é ignorado; `stream_chunk` sem `stepId` (agente antigo) continua funcionando |
| Timeline (R4/R6) | `apps/menubar` | `tool_call_update` intercalado volta ao card certo; `messageId` fecha bloco; item desconhecido não quebra a lista; ao estourar o teto, some o mais antigo **e** aparece `elided` com a contagem certa |
| Diff (R5) | `apps/menubar` | 3 linhas trocadas num arquivo de 2.000 produzem 1 hunk, não 4.000 linhas; `oldText` ausente vira hunk todo-adição; arquivo sem newline final não quebra |
| Entrevista (R1) | `tests/` (raiz) | o `onUpdate` da Entrevista **descarta** `agent_message_chunk` e emite `agent_stream` para tool/thought/plan/raw; nenhum `StreamItem` com `item: "text"` sai no canal da Entrevista |
| Transport | `tests/` (raiz) | round-trip do `StreamItem` nos dois canais; `agent_stream` desconhecido pelo parser antigo não o faz lançar; linha malformada devolve erro-valor |
| Framer (C3) | `src-tauri` (Rust) | linha de 10 MB em chunks de 4 KB fecha em tempo linear (vale para o Sidecar **e** para o Processo de Entrevista: o `LineFramer` é compartilhado) |
| Componentes | `apps/menubar` | card por status/kind; pensamento nasce fechado (D7); bloco de código sai com `hljs-*`; cor de ferramenta só no glifo (C1) |
| Regressão | `tests/` (raiz) | sem GUI e sem `--emit-events`, `RunLoopResult` byte-idêntico (AD-1) |

Contraste AA nos dois temas para os cinco hues novos é verificação **manual**,
registrada no `DESIGN.md`.

---

## Boundaries

**Sempre:**
- Traduzir no motor; a GUI nunca importa tipo do `@agentclientprotocol/sdk`.
- Manter puros `stream-history.ts`, `mergeToolCall`, `diff-hunks.ts` e
  `tool-kind.ts`.
- **Uma implementação da mescla** (R2): se a Entrevista precisar mesclar, ela
  importa `mergeToolCall` do motor. Reescrever é o anti-pattern nº 1 do app.
- Rodar as duas suítes de teste e o `typecheck` antes de fechar qualquer task.
- Cor de ferramenta só no glifo; status no pill (C1).
- Formatar com prettier **apenas arquivos novos** — o repo está fora de sincronia
  e `--write` num arquivo existente reformata código alheio.

**Perguntar antes:**
- Qualquer dependência além de `rehype-highlight` e `diff` (R5). São duas, e o
  portão continua fechado para a terceira.
- Mudar a shape de um `StoreEvent` **existente**. *Adicionar campo opcional é
  seguro* — é exatamente o que a R3 faz no `stream_chunk`.
- Mexer no `acp_traffic` ou ressuscitar o painel de tráfego.
- Virtualizar a lista (é change própria, ver Fora de escopo).
- Mexer no teto do ring ou tirar o item `elided` (R6).

**Nunca:**
- Adicionar `rehype-raw` ao `MarkdownStream`. O conteúdo vem do output de um
  agente; sem `rehype-raw`, HTML embutido vira texto. Isso é a barreira de XSS.
- **Streamar `agent_message_chunk` na Entrevista** (R1): é o caminho pelo qual o
  Envelope apareceria na tela e o turno chegaria em duplicata.
- Acumular a timeline no `StoreState` do motor (R4).
- Escrever no stdout do motor sob `--emit-events` (é o canal NDJSON).
- Editar o corpo do ADR-0007 (estender é unidirecional).
- Deixar um `session/update` novo do SDK cair no vazio (D3).

---

## Success Criteria

1. Num Run real, cada ferramenta chamada aparece com **status que transiciona
   sozinho** de `rodando` para `ok`/`falhou`, e o card certo recebe o update
   mesmo com texto do agente intercalado.
2. Um Step de edição mostra o **diff de verdade**: só os hunks que mudaram, com
   contexto, `+`/`−` coloridos — não o arquivo inteiro duas vezes (R5).
3. Um bloco de código no markdown do agente sai **realçado**, legível e AA nos
   dois temas.
4. Pensamentos nascem colapsados com contador; abrem por clique (D7).
5. Um `sessionUpdate` fora dos cinco tipados aparece como linha `raw` com JSON
   sob disclosure — **nada some** (D3).
6. Na aba `Specs`, o primeiro turno da Entrevista mostra **ferramentas rodando ao
   vivo** durante os ~5 min (D14 fechado), e **nenhum bloco `<loopy-…>` aparece
   na tela** em nenhum momento (R1).
7. Cada família de `ToolKind` tem hue e ícone distintos, com a cor só no glifo (C1).
8. Uma linha NDJSON de 10 MB atravessa o framer em tempo linear (C3).
9. Numa task com mais itens que o teto, a lista mostra o marcador de corte com a
   contagem, e o app segue fluido (R6).
10. `npm test`, `npm test -w apps/menubar` e `npm run typecheck` verdes.
11. Sem `metrics:` e sem GUI, `RunLoopResult` byte-idêntico (AD-1).

---

## Fora de escopo

- Persistir transcript ou reabrir histórico de Run encerrado.
- Busca/filtro no stream.
- Paridade na TUI Ink (D1).
- Mostrar `session/request_permission`.
- **Virtualização da lista.** Com 4 colunas × centenas de cards isto pode virar
  problema de performance. As mitigações baratas são duas — `content-visibility:
  auto` (C3, corta pintura) e o **ring com teto** (R6, corta DOM e memória). Se
  não bastarem, virtualizar é change própria.

---

## Open Questions

**Nenhuma.** As três da versão anterior foram resolvidas no refine e viraram a
R7 (a: `stepId` carregado; b: control `agent_stream` novo; c: sete ícones inline).

### Riscos aceitos, com olhos abertos

Não são perguntas — são preços já escolhidos, registrados para o plano não os
redescobrir como surpresa:

- **Payload extremo ocupa memória** no processo Rust e no webview; não há teto
  por campo (D6). O C3 mata a cliff quadrática do framer, não o consumo.
- **A prosa da Entrevista continua chegando de uma vez** no fim do turno (R1). O
  que mata o silêncio dos ~5 min são as ferramentas ao vivo, não o texto.
- **O `user_message_chunk` da Entrevista é o Envelope voltando** (R7d). Fica no
  `raw`, atrás de disclosure fechado — visível para quem abrir, invisível para
  quem só olha.
- **A TUI Ink não ganha nada** (D1) e nem paga por isso (R4).

---

## Próximo passo

`/devy:plan` sobre esta spec, gerando `plan.md` + `todo.md` nesta pasta.
