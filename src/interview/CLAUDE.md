# interview — o subcomando `loopy interview`: a Entrevista que cria uma Change

## Purpose & Scope

O motor da **Entrevista** (C-0018, ADR-0012): conduz **uma Fase** de uma conversa dirigida por um Agente ACP que produz os inputs de uma Change (`spec.md`/`plan.md`/`todo.md`), falando NDJSON com a GUI. É a primeira vez que o motor **cria** uma Change em vez de só derivá-la de um path (ver `CONTEXT.md` → _Change_/_Entrevista_).

**Mecânica, não roteiro (AD-1).** As perguntas são do `/devy:*` do harness (D1); o motor impõe só a **forma** — o **Envelope** (`envelope.ts`) e o parsing do turno (`parse-ask.ts`). A única tabela permitida aqui é fase→comando (`phases.ts`). Um processo por Fase (D13), um Processo de Agente, uma Sessão em `cwd = <dir>` — **sem worktree, sem git, sem telemetria, sem checkpoint**: a Entrevista escreve a árvore de trabalho direto.

**NÃO** é: um modo terminal interativo (sem `--emit-events` sai com código 2); um chat de propósito geral (tem começo/Fases/fim); nem o dono do roteiro (isso é do `/devy:*`).

## Entry Points & Contracts

- **`runInterview(options)` → `Promise<number>`** (`run.ts`) — orquestra uma Fase ponta a ponta e devolve o **exit code** (0 = terminada ou cancelada; ≠0 = falhou). Turno 1: `fullEnvelope` + comando devy + demanda (+ anexos como blocos ACP). Turnos seguintes: `reminder()` + resposta humana. Após cada turno: `parseAsk(session.readText())` → `decideTurn` → frames + fluxo. Comandos chegam por NDJSON no stdin.
- **`decideTurn(parsed, phase, turnIndex)` → `TurnDecision`** — **puro** (AD-6): decide os `control` frames de um turno (`change_resolved` → `agent_activity` → `question_asked`, nessa ordem) e o fluxo (`await_answer` | `finish`). `phase_started`/`phase_finished` **não** saem daqui (precisam de I/O: dir resolvido + listagem).
- **`phaseCommand(phase, demand)`** (`phases.ts`) — a tabela fase→comando: `spec` → `/devy:spec <demand>`, `refine` → `/devy:refine`, `plan` → `/devy:plan spec.md`. As trilhas `bug`/`debt` **não têm entrada** (nunca spawnam) e `Phase` as exclui por tipo.
- **`fullEnvelope` / `reminder` / `wrapUp`** (`envelope.ts`) — puros, strings exatas (D15). `fullEnvelope('spec')` **omite** o `changeDir` (não existe ainda — D10); para `refine`/`plan` sem `changeDir`, **lança** (falta de programação, não dado do usuário).
- **`parseAsk(text)` → `ParsedTurn`** (`parse-ask.ts`) — puro, **nunca lança** (AD-5). Tabela do spec: `ask` | `done` | `open` (fallback D3), com `change` **ortogonal** ao `kind` (coexiste — D10) e `prose` sempre destinada ao transcript (D25). Dois blocos `ask` → o primeiro + `warning`.
- **`writeAttachment` / `attachmentBlocks`** (`attachments.ts`) — grava sob `<dir>/.loopy/attachments/` com prefixo `YYYYMMDD-HHmmss` (D19, nunca apaga); mapeia paths para `resource_link` `ContentBlock`s. Rejeita `name` com `..` ou separador.
- **Registro CLI**: `loopy interview <dir> --emit-events [--change <id>] [--phase spec|refine|plan] [--demand <texto>] [--agent <preset>] [--model <m>] [--effort <e>]` — em `src/index.ts` (`registerInterviewCommand`). Sem `--emit-events`: mensagem no stderr + exit 2.

## Usage Patterns

- Dev cru da Fase: `npm run dev -- interview . --emit-events` e responda pelo stdin com linhas `{"command":"question_answer","questionId":"…","text":"…"}`.
- Testar sem ACP: injete os seams de `RunInterviewOptions` (`transport`, `input`, `openSession`, `fs`) — `decideTurn`, `parseAsk` e o Envelope são puros e testam-se sem processo. Os testes vivem em `tests/interview/`.
- Modo é **`acceptEdits`** (dialeto Claude): a Entrevista **precisa** escrever os `.md`; `plan` é read-only e não serve (ver a memória `loopy-verdict-vs-plan-mode`). Ordem igual ao Step `agent`: `setMode` → `setModel` → `setEffort` (model/effort best-effort — ADR-0008).

## Anti-patterns

- **Nunca hardcodar o roteiro** (AD-1): a única tabela é `phaseCommand`. O Envelope fala de forma, jamais de conteúdo. Perguntas novas = editar o `/devy:*`, não este código.
- **Nunca lançar na fronteira** (AD-5): `parseAsk` devolve `open`; `runInterview` emite `interview_failed` + exit ≠0; `fs` ausente → lista vazia. Exceção só em falta genuína (spawn/adapter), sempre virando valor no boundary.
- **Não declarar `Phase`/`AskOption`/frames aqui** — moram em `../tui/transport.ts` (contrato de fio, subpath export que a GUI consome). Importar de cá obrigaria o transport a puxar de um módulo não-exportado.
- **Não widenizar `AgentSession.prompt`** em `../types.ts` (contrato congelado): `promptBlocks` é **aditivo** em `LoopySession` (`../acp/session.ts`). Widenizar para `string | ContentBlock[]` quebraria os fakes de teste sem ganho.
- **Nenhum `if (agent === 'claude')` no motor**: a restrição "só Claude no v1" (D16) vive **só** na GUI.
- **Não escrever fora** de `<dir>/.harn/devy/changes/<change>/` (via `fs/write_text_file`, que o Agente aciona) e `<dir>/.loopy/attachments/` (via `writeAttachment`). O motor nunca destrói arquivo.
- **`attachments.ts` é node-only**: usa `node:fs/promises`. **Não** está nos barrels browser-safe (`config`/`backlog`) — não o importe de módulo que roda no browser.
- **Não interpolar dado do usuário em string de shell**: a demanda flui como **argv** (`--demand`), único canal GUI→processo; o Rust spawna argv direto (D23).

## Dependencies & Edges

- **Contrato de fio**: `../tui/transport.ts` — `Phase`, `AskOption`, os seis `control` e três `command` frames da Entrevista (ADR-0012 estende ADR-0007). Mudar a shape de um frame quebra `apps/menubar/` em tempo de build.
- **Ponte ACP**: `../acp/` — `createAgentProcessPool`/`openAgent` (Processo de Agente), `LoopySession` (com `promptBlocks`, aditivo), `classifyStopReason`. Reusa a mesma infra do Step de Agente.
- **CLI**: `../index.ts` registra o subcomando; escolhe o preset (`AGENT_PRESET_IDS`) e resolve `--change` → `changeDir`.
- **Consumidor (GUI)**: `apps/menubar/src/specs/` (aba `Specs`, `useInterviewProcess`, redutor `advance`) e `apps/menubar/src-tauri/src/{changes.rs,interview_process.rs}` (comandos `read_changes`/`discard_change` e o **segundo estado gerenciado** `InterviewState`, que **não** mata o sidecar do Run).
- **Constante `CHANGES_DIR`**: declarada **exatamente duas vezes** no repo — aqui (`phases.ts`) e em `changes.rs`. É o endereço do harness devy (preço explícito da D1), não comportamento de loop.
- **Decisão**: `docs/adrs/0012-autoria-de-change-via-entrevista.md` (o **porquê não uma tool MCP** — D2/D26).

## Patterns & Pitfalls

- **`spec` não conhece o `changeDir`** (D10): a numeração `C-XXXX` é do `/devy:spec`, então o motor não sabe a pasta antes do 1.º turno. `fullEnvelope('spec')` pede ao Agente que a reporte (`<loopy-change dir=…/>`); `phase_started` da `spec` sai **sem** `changeDir`, resolvido depois por `change_resolved`.
- **Fallback de snapshot** (`resolveFinalChangeDir`): se o Agente nunca reportou, `phase_finished` usa o primeiro diretório que **apareceu** em `CHANGES_DIR` durante a Fase; se nada apareceu, degrada para `CHANGES_DIR` (valor, não throw).
- **`change_resolved` sai uma vez só**: mesmo que o Agente reporte `<loopy-change>` em turnos repetidos, `runInterview` deduplica (`changeResolvedEmitted`).
- **`ask` vence `done` no mesmo turno**: pergunta pendente = o Agente ainda quer input; o humano usa o botão "Chega" (`phase_wrap_up` → `wrapUp`) para forçar o fim (D17).
- **Pergunta aberta não duplica prosa**: em `decideTurn`, quando `kind === 'open'` a prosa **é** o `prompt`, então não sai também um `agent_activity` (senão o texto iria duas vezes no fio).
- **Prova de vida vem do `session/update` ao vivo** (D14): a spike viu ~5 min até a 1.ª pergunta e ~1.4k chars de prosa concatenados sem quebra de linha. `agent_activity` alimenta a linha viva, mas fatiar o texto final do turno produz um blocão colado — a linha de atividade tem de vir do stream ao vivo, não do `readText()` final.
- **O leitor de stdin bufferiza** wrap-up/answer que chegam antes do `take`; resposta a `questionId` que não casa é descartada (órfã). Um `interview_cancel` encerra a Fase **sem apagar nada** (o que foi gravado fica; a Change reaparece como parcial — D25).
