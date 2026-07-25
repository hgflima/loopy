---
number: 0012
title: "Autoria de Change via Entrevista delegada"
status: accepted
date: 2026-07-25
status_date: 2026-07-25
supersedes: []
superseded_by: null
---

# ADR-0012 — Autoria de Change via Entrevista delegada

## Context

Até a C-0018 o motor só sabia **observar e dirigir** um Run que já tinha backlog.
A etapa anterior — produzir os inputs de uma Change (`spec.md`/`plan.md`/`todo.md`)
— vivia fora dele: um humano abria um terminal e rodava `/devy:spec`,
`/devy:refine`, `/devy:plan` à mão. A C-0018 fecha esse buraco com uma
**Entrevista**: uma conversa dirigida por um Agente ACP, uma pergunta por vez, com
opção recomendada e o porquê explícito, que termina com os três `.md` gravados na
pasta da Change — conduzida de dentro da GUI (aba `Specs`), sobre o Transport da
ADR-0007.

Duas perguntas de desenho precisavam de decisão, e é o **porquê** delas que este
ADR existe para registrar:

1. **De onde vem o roteiro das perguntas?** O motor é config-driven (AD-1): ele
   interpreta, não decide _o que_ perguntar. Escrever um questionário no motor
   seria hardcodar comportamento de produto — exatamente o que o AD-1 proíbe.

2. **Como uma pergunta com opções clicáveis atravessa o protocolo?** A GUI quer
   renderizar cartões (label, `detail`, uma opção `recommended`, o `why`). O
   caminho "correto de livro" para dados estruturados entre agente e cliente seria
   uma **tool MCP tipada**: o Agente chamaria `ask({...})` e o cliente receberia um
   objeto validado, sem parsing de texto.

Forças em tensão:

- **AD-1 (config-driven).** Nenhum roteiro pode morar no motor. As perguntas têm
  de vir do harness (`/devy:*`), não de uma tabela em `src/`.
- **Adapter-agnóstico (ADR-0006/0008/0010).** O motor fala com N adapters
  (claude/codex/opencode) por descoberta de capabilities — **sem** vocabulário
  canônico. Qualquer coisa que dependa de um adapter específico rompe essa
  neutralidade.
- **Sessão encapsulada pelo SDK.** O motor abre toda Sessão por
  `ctx.buildSession(cwd).start()` — o overload **cwd-only** do `SessionBuilder` do
  `@agentclientprotocol/sdk`, escondido dentro de `LoopySession`
  (`src/acp/session.ts`). Esse caminho **não carrega `mcpServers`**.
- **O turno já é lido como texto.** O motor já bufferiza o texto do turno
  (`TurnTextBuffer`) e já parseia blocos delimitados dele — é assim que
  `parseVerdict` lê o Verdict de um Audit hoje.

Alternativas consideradas para a pergunta estruturada:

- **Tool MCP tipada (`ask`).** O caminho de livro — e o rejeitado. Ver a Decision.
- **JSON-RPC/canal lateral próprio.** Rejeitada: reinventa o que o Transport
  (ADR-0007) já faz, e não resolve o roteiro (força #1).
- **Bloco de texto delimitado no turno** (`<loopy-ask>…</loopy-ask>`), parseado do
  `TurnTextBuffer`. A escolhida.

## Decision

A Entrevista é **delegada ao harness** e as perguntas estruturadas viajam como
**bloco de texto no turno**, não como tool MCP. Quatro decisões, sendo a D2 a
central:

### D1 — Delegar aos `/devy:*`, envelopar apenas a forma

O motor manda `/devy:spec …`, `/devy:refine`, `/devy:plan …` como prompt. O
**roteiro é do harness**; o motor só **prepende um Envelope** que fala de _forma da
resposta_, nunca de _conteúdo_. O Envelope instrui: "uma pergunta por turno,
encerre com um bloco `<loopy-ask>{json}</loopy-ask>`; reporte a pasta com
`<loopy-change dir=…/>`; encerre a Fase com `<loopy-done/>`". Nenhuma pergunta
mora no motor — a única tabela permitida é `Fase → comando devy`
(`src/interview/phases.ts`). **AD-1 fica intacto** porque o Envelope é instrução de
forma, não de conteúdo.

**Trade-off explícito:** a Entrevista **só funciona onde o harness devy está
instalado** (os `/devy:*` são comandos do Claude Code). Por isso o v1 é só Claude
(D16 da spec) e o `if` de adapter vive **só na GUI** — o motor segue sem
`if (agent === "claude")`.

### D2 — Pergunta estruturada = bloco no texto do turno, **não** uma tool MCP

O Agente encerra o turno emitindo um bloco delimitado; o motor o parseia do
`TurnTextBuffer` (`src/interview/parse-ask.ts`, puro, AD-6, mesmo caminho do
`parseVerdict`). **É a decisão central deste ADR**, e a razão de ele existir: o
custo de uma tool MCP é real e desproporcional ao ganho.

Para trocar o bloco de texto por uma chamada `ask` tipada, o motor teria de:

1. **Descer do overload conveniente ao `NewSessionRequest` cru.** O SDK expõe
   `mcpServers` **apenas** no overload `buildSession(request: NewSessionRequest)` —
   nunca no `buildSession(cwd)` que `LoopySession` usa hoje. Adotar MCP obriga
   abandonar a conveniência cwd-only e montar o request cru em todo caminho de
   Sessão.
2. **Rodar um servidor MCP próprio** que exponha o tool `ask` e reconcilie sua
   resposta de volta ao fluxo de turnos.
3. **Validar em 3 adapters.** Como as capabilities são por descoberta e **não há
   vocabulário canônico** (ADR-0008), não há garantia de que claude, codex e
   opencode roteiem/honrem o tool do mesmo jeito — cada um exigiria prova própria.

Tudo isso **para trocar um bloco de texto no turno por uma chamada tipada** — um
ganho de ergonomia que não paga o preço de romper a neutralidade de adapter, furar
o encapsulamento da Sessão e triplicar a superfície de validação. O parsing de um
bloco delimitado é trivial, puro, testável sem ACP, e **idêntico ao que o motor já
faz** para o Verdict. Nenhuma mudança no protocolo ACP.

### D3 — Fallback: turno sem bloco vira pergunta aberta

Um turno que **não** emite `<loopy-ask>` (ou emite JSON malformado) não é erro: o
parser devolve `{ kind: "open", text }` e a GUI mostra o texto do Agente com um
campo livre. O `/devy:refine` que pergunta em prosa continua funcionando, só sem os
cartões. **Erro como valor na fronteira (AD-5)** — `parse-ask` nunca lança. Isso é
o que torna a delegação da D1 segura mesmo quando o Agente ignora a forma pedida.

### D13 — Uma Sessão por Fase → um processo `loopy interview` por Fase

Cada Fase (`spec`/`refine`/`plan`) roda num **processo separado** (`loopy interview
<dir> --emit-events --phase <fase>`), com **uma** Sessão em `cwd = <dir>`. A Fase
termina, o processo sai com 0; o próximo passo spawna outro. Consequência de
desenho: **gate humano e retomada viram o mesmo código** — fechar o app no meio é
indistinguível de não clicar o botão do próximo passo, porque o checkpoint é a
pasta da Change em disco (não há estado novo inventado). Cada Fase relê os `.md` —
preço aceito para não carregar estado entre processos.

## Consequences

**Positivas:**

- **AD-1 preservado:** o roteiro fica 100% no harness; o motor só impõe forma. A
  única tabela do motor é `Fase → comando`.
- **Zero mudança no protocolo ACP** e zero dependência nova: o bloco de texto reusa
  `TurnTextBuffer` e o mesmo padrão de parsing do Verdict; os frames novos são
  aditivos sobre o Transport da ADR-0007.
- **Neutralidade de adapter intacta:** nada depende de um servidor MCP nem de um
  adapter honrar um tool; a restrição "só Claude no v1" é da GUI, não do motor.
- **Degradação graciosa (D3):** um Agente que responde em prosa não trava o fluxo;
  a Entrevista vale nos dois mundos (com e sem os cartões).
- **Gate e retomada de graça (D13):** o processo-por-Fase colapsa dois requisitos
  num caminho único e testável.

**Negativas / custo:**

- **Robustez por convenção, não por tipo.** Um bloco de texto pode vir malformado,
  duplicado ou ausente — o parser precisa cobrir todos esses casos (a D3 e a regra
  "dois blocos `ask` → o primeiro + warning" existem por isso). Uma tool MCP daria
  validação de graça; abrimos mão disso conscientemente.
- **Acoplamento ao harness devy.** A D1 amarra a Entrevista ao Claude Code; um dia
  suportar codex/opencode exigirá comandos de fase configuráveis (v2).
- **Drift de turno longo.** Delegar significa que o Agente pode ignorar o Envelope
  no turno 10; o combate é o "Envelope completo no 1º turno + lembrete de uma linha
  nos demais" (D15 da spec), determinístico mas não infalível.

**Neutras:**

- Se algum dia o ganho justificar (um único adapter, tráfego alto de perguntas, ou
  necessidade de payloads que texto não carrega bem), reabrir MCP é possível — mas
  a partir daqui a discussão começa **com o custo já medido** (os três itens da
  D2), não do zero.

**Relação com outros ADRs:**

- **Estende a ADR-0007** (não a supersede): a Entrevista corre sobre o mesmo
  Transport NDJSON duplex, adicionando frames `control`/`command` de forma
  **aditiva** — nenhum frame existente muda de shape. A referência cruzada fica
  registrada só aqui: a ADR-0007 está `accepted` e seu corpo é imutável pelo
  harness de ADRs, então a relação é unidirecional — como a ADR-0011 fez ao
  estender a ADR-0003 sem editá-la.
- **Apoia-se na ADR-0006/0008/0010:** o processo-por-Fase é um Processo de Agente
  com uma Sessão em `cwd = <dir>`; a neutralidade de adapter que a D2 protege é a
  mesma que a ADR-0008 (capabilities por descoberta, sem vocabulário canônico)
  estabeleceu.
