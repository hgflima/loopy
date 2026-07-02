# Implementation Plan: `loopy` — Motor de Loop Agêntico Config-Driven via ACP

> Fase: **PLAN**. Derivado de `SPEC.md` (SPECIFY, decisões travadas) e do `loopy.yml` de exemplo.
> Repo ainda sem código: só `SPEC.md`, `loopy.yml`, `.claude/`. Não é git repo ainda.

## Overview

Construir `loopy`, um CLI TypeScript/Node que roda um loop agêntico de dois níveis sobre um diretório local, dirigindo um agente de código via ACP até concluir um backlog. O motor é um **intérprete genérico**: tudo que o loop faz vive no `loopy.yml`; o código só implementa a mecânica. A entrega é fatiada verticalmente por **capacidade demonstrável** — cada fase deixa software funcionando e testável, não uma camada horizontal solta.

O caminho de valor incremental:
`--dry-run` (config+backlog+interp) → pipeline sem-agente sobre git real (spine) → step `agent` via ACP (o coração) → TUI ao vivo → hardening + aceitação total.

## Architecture Decisions

- **AD-1 — Invariante do motor (a fronteira).** Nenhum comportamento de loop é hardcoded. O motor expõe 4 primitivas de step tipadas (`agent`/`shell`/`checks`/`approval`), validadas por zod no *shape*; o *conteúdo* (prompt, comando, mode, ordem, quantos steps) é 100% do `loopy.yml`. **Trocar o comportamento = editar o yml, nunca o motor** (Success Criterion #2). Toda task carrega esse invariante nas acceptance criteria quando aplicável.
- **AD-2 — `Step` interface + registry.** Cada primitiva implementa `execute(ctx: StepContext): Promise<StepResult>`. Um registry mapeia `type → interpreter`. O orquestrador é **agnóstico ao tipo de step**: itera a lista, resolve interpolação, chama `execute`, decide continuação por `StepResult` + `always`/`on_fail`. Isso permite **construir e testar o orquestrador com steps não-agente primeiro** (Fase 1) e plugar o step `agent` depois (Fase 2) pela mesma interface — dependency inversion, não slicing horizontal.
- **AD-3 — Modelo ACP.** 1 processo `claude-agent-acp` para a run inteira (roteador de N sessões); 1 sessão ACP por task (cwd = worktree, imutável por sessão). Pool de sessões keyed por worktree (parallel-ready, mas `concurrency: 1` no v1). `clear_context: true` envia `/clear` cru antes do prompt. `prompt()` só devolve `stopReason`; texto vem por `session/update`/`readText()`. Não-`end_turn` = falha do step; `cancelled` = stop-signal nosso. Modo via `session/set_mode`; `plan` é read-only (audit).
- **AD-4 — `StepContext` + interpolação uma vez por task/tentativa.** O contexto resolve `${task.*}`, `${worktree.*}`, `${iteration}`, `${attempt}`, `${checks.report}`, `${inputs.*}`, `${workspace.*}`, e carrega handles: session pool, git, checks runner, logger, store/UI events, config, flags. Interpolação é substituição simples com interface para estender a expressões depois.
- **AD-5 — Erros como valores nos limites de step.** `StepResult` = `{ ok, ... }` ou falha estruturada (com `report`/motivo); o orquestrador nunca depende de exceptions para fluxo normal. Exceptions só para bugs/infra.
- **AD-6 — Testabilidade.** Lógica pura e limites cobertos por `vitest`; I/O externo mockado. ACP exercitado contra um **fake agent** (subprocesso stub falando JSON-RPC ndjson) a partir da Fase 2. Git testado contra **repo temporário real** (não mockar git). Ink validado via store/estado, não render visual.
- **AD-7 — Dogfooding do backlog.** `tasks/todo.md` é escrito no formato que o próprio `loopy` parseia (`- [ ] T-NNN: título` + corpo indentado), então o plano é auto-consumível pelo motor quando ele existir.

## Dependency Graph

```
types.ts (fundação — todos dependem)
   │
   ├── config/schema.ts (zod) ── config/load.ts
   ├── interp/resolver.ts
   ├── backlog/todo.ts
   ├── checks/runner.ts (execa)
   ├── git/worktree.ts (execa)
   └── acp/agent.ts + acp/client.ts ── acp/session.ts
                                            │
   steps/ (via Step interface, AD-2):       │
     ├── shell.ts      (interp + execa)     │
     ├── checks.ts     (checks/runner)      │
     ├── verdict.ts    (parser puro)        │
     ├── approval.ts   (interp + execa + prompt humano)
     └── agent.ts      (acp/session + checks + interp + verdict)
                                            │
   loop/orchestrator.ts (backlog + registry de steps + git + stop/escalation)
                                            │
   tui/store.ts ── tui/App.tsx + components/     logging/logger.ts (cross-cutting)
                                            │
   index.ts (commander → run(); wiring + flags)
```

Ordem de implementação: bottom-up pela fundação, depois fatias verticais por capacidade.

---

## Task List

### Phase 0 — Fundação & Walking Skeleton (`--dry-run`)

#### Task T-001: Scaffold do projeto + `types.ts`
**Description:** Criar a estrutura base do repo `loopy`: `package.json` (ESM, `type: module`, scripts dev/typecheck/lint/format/test), `tsconfig.json` (estrito, ESM), eslint+prettier, vitest config, layout de diretórios do SPEC (stubs vazios) e `src/types.ts` com os tipos centrais (`Task`, `StepConfig` união, `StepResult`, `ChecksReport`, `LoopyConfig`, `StepContext`, `Step`). Sem lógica ainda.
**Acceptance criteria:**
- [ ] `npm install` instala exatamente as deps do SPEC (`@agentclientprotocol/sdk ^0.29`, `ink`, `react`, `commander`, `yaml`, `zod`, `execa`; dev: `tsx`, `typescript`, `vitest`, `eslint`, `prettier`) — nenhuma dep nova além dessas.
- [ ] `src/types.ts` declara `Step` (AD-2) e `StepContext` (AD-4) usados pelas fases seguintes.
- [ ] Layout de `src/` espelha o Project Structure do SPEC.
**Verification:**
- [ ] `npm run typecheck` passa (stubs tipados).
- [ ] `npm test` roda sem erro (0 testes ok).
- [ ] `npm run lint` e `npm run format --check` passam.
**Dependencies:** None
**Files likely touched:** `package.json`, `tsconfig.json`, `.eslintrc*`, `.prettierrc*`, `vitest.config.ts`, `.gitignore`, `src/types.ts`, stubs em `src/**`.
**Estimated scope:** M

#### Task T-002: Schema + loader do `loopy.yml` (zod)
**Description:** `config/schema.ts` com zod para todo o `loopy.yml` (`workspace`, `acp`+`permissions`, `inputs.backlog`, `checks` nomeados, `pipeline` como união discriminada das 4 primitivas incl. bloco `verify:{run,max_attempts,on_fail}`, `stop_conditions`, `concurrency`, `policies`, `logging`) e `config/load.ts` (lê YAML, valida, aplica defaults, erro claro se inválido).
**Acceptance criteria:**
- [ ] Config inválido é rejeitado com mensagem clara (path + motivo); config válido produz `LoopyConfig` tipado com defaults aplicados (ex.: `clear_context` default `true`).
- [ ] Cada primitiva de step valida seus campos específicos (discriminada por `type`); campos desconhecidos sinalizados.
- [ ] Valida o `loopy.yml` de exemplo do repo sem erro.
**Verification:**
- [ ] `npm test -- config` verde (fixtures válidas/ inválidas + defaults).
- [ ] `npm run typecheck` passa.
**Dependencies:** T-001
**Files likely touched:** `src/config/schema.ts`, `src/config/load.ts`, `tests/config/*.test.ts`, `tests/fixtures/*.yml`.
**Estimated scope:** M

#### Task T-003: Parser de backlog (`todo.md`)
**Description:** `backlog/todo.ts`: parse de checkboxes (`- [ ]`/`- [x]`), extração de `id` (`T-\d+`), `slug`, `title`, `body` (bloco indentado até o próximo item), e `mark_done` idempotente que reescreve `- [ ]` → `- [x]` preservando o resto do arquivo.
**Acceptance criteria:**
- [ ] Lista de `Task` pendentes na ordem do arquivo; ignora já-feitas quando solicitado.
- [ ] `mark_done(id)` é idempotente e não corrompe formatação/outros itens.
- [ ] `${task.body}` capturado como bloco indentado sob o checkbox.
**Verification:**
- [ ] `npm test -- backlog` verde (fixtures de `todo.md`, incluindo idempotência).
**Dependencies:** T-001
**Files likely touched:** `src/backlog/todo.ts`, `tests/backlog/*.test.ts`, `tests/fixtures/todo.md`.
**Estimated scope:** S

#### Task T-004: Resolver de interpolação `${...}`
**Description:** `interp/resolver.ts`: substituição simples de `${...}` a partir de um escopo (task/worktree/iteration/attempt/checks.report/inputs/workspace), com interface para estender a expressões. Trata variável desconhecida de forma explícita; suporta seleção `retry_prompt` vs `prompt`.
**Acceptance criteria:**
- [ ] **[OQ1]** Chave verdadeiramente **desconhecida aborta com erro claro** (variável + step), antes de qualquer efeito; chave conhecida-porém-vazia (`${checks.report}` no 1º prompt, `${worktree.diff}` sem diff) renderiza vazio.
- [ ] Resolvido **uma vez por task/tentativa** (AD-4).
**Verification:**
- [ ] `npm test -- interp` verde (substituição, desconhecidas, retry vs prompt).
**Dependencies:** T-001
**Files likely touched:** `src/interp/resolver.ts`, `tests/interp/*.test.ts`.
**Estimated scope:** S

#### Task T-005: CLI entrypoint + `--dry-run` (fatia vertical)
**Description:** `index.ts` com `commander`: `loopy [dir]` + flags (`--config`, `--dry-run`, `--task`, `--max-iterations`, `--yes`, `--no-tui`, `--verbose`). Implementa `--dry-run` fim-a-fim: carrega config (T-002) + backlog (T-003), resolve interpolação (T-004) por task e **imprime o pipeline resolvido** sem nenhuma escrita/commit/merge. Amarra T-001..T-004 numa capacidade real.
**Acceptance criteria:**
- [ ] `npx tsx src/index.ts . --dry-run` imprime, por task pendente, os steps com `${...}` já resolvidos e **não** escreve/commita/faz merge (Success Criterion #8).
- [ ] Config inválido aborta com erro claro antes de qualquer efeito.
- [ ] Flags parseadas e disponíveis para as próximas fases (mesmo que ainda no-op).
**Verification:**
- [ ] Manual: rodar `--dry-run` num fixture (repo de exemplo com `loopy.yml`+`todo.md`) e conferir o output.
- [ ] `npm test -- dry-run` verde (snapshot do pipeline resolvido).
**Dependencies:** T-002, T-003, T-004
**Files likely touched:** `src/index.ts`, `src/loop/orchestrator.ts` (esqueleto do plan/dry-run), `tests/*`.
**Estimated scope:** M

### Checkpoint A — Fundação & Dry-Run
- [ ] `npm run typecheck`, `npm run lint`, `npm test` verdes.
- [ ] `loopy . --dry-run` resolve e imprime o pipeline sem efeitos colaterais.
- [ ] Schema valida o `loopy.yml` de exemplo.
- [ ] **Revisão humana antes de prosseguir.**

---

### Phase 1 — Spine de execução sem-agente (git + checks + steps shell/checks/approval + orquestrador)

#### Task T-006: Checks runner (execa)
**Description:** `checks/runner.ts`: roda uma lista nomeada de checks via `execa` no cwd do worktree, **sem fail-fast** (roda todos), agrega exit/stdout/stderr num `ChecksReport` truncado para caber no prompt. Este report vira `${checks.report}`.
**Acceptance criteria:**
- [ ] Roda todos os checks da lista mesmo com falhas; agrega resultados; marca sucesso só se todos passam.
- [ ] **[OQ4]** Saídas grandes truncadas por **head+tail por check** (orçamento por-check + teto global ~32 KB), checks que passam colapsam para 1 linha, marcador de elisão explícito no meio; report determinístico.
**Verification:**
- [ ] `npm test -- checks` verde (comandos fake: sucesso/falha/saída grande).
**Dependencies:** T-001
**Files likely touched:** `src/checks/runner.ts`, `tests/checks/*.test.ts`.
**Estimated scope:** S

#### Task T-007: Módulo de git worktree (execa, repo temporário)
**Description:** `git/worktree.ts`: `add`/`remove` de worktree, `merge` (`--no-ff` + tratamento `on_conflict`: `git merge --abort`), `require_clean_parent` (detecta parent sujo). Testado contra repo git temporário real.
**Acceptance criteria:**
- [ ] Cria worktree em `${worktrees_dir}/<id>` a partir do `parent_branch`; remove com `--force` e apaga a branch.
- [ ] `merge` conflitante aborta limpo e sinaliza para escalonamento (preserva worktree).
- [ ] `require_clean_parent` detecta corretamente parent limpo vs sujo.
**Verification:**
- [ ] `npm test -- git` verde contra repo temporário (add/remove/merge-ok/merge-conflito/clean-check).
**Dependencies:** T-001
**Files likely touched:** `src/git/worktree.ts`, `tests/git/*.test.ts`.
**Estimated scope:** M

#### Task T-008: Interpretadores dos steps `shell` e `checks`
**Description:** `steps/shell.ts` (`run:[...]` via execa, `always`, `on_fail`) e `steps/checks.ts` (referencia lista nomeada e delega ao runner). Ambos implementam `Step.execute` (AD-2) e resolvem interpolação via `StepContext`.
**Acceptance criteria:**
- [ ] `shell` roda `run` em ordem, para na 1ª falha (salvo `always:true`), aplica `on_fail`; comandos interpolados.
- [ ] `checks` roda a lista nomeada e produz `StepResult` com o report; falha propaga `${checks.report}`.
**Verification:**
- [ ] `npm test -- steps/shell steps/checks` verde (execa mockado/real leve).
**Dependencies:** T-004, T-006
**Files likely touched:** `src/steps/shell.ts`, `src/steps/checks.ts`, `tests/steps/*.test.ts`.
**Estimated scope:** S

#### Task T-009: Interpretador do step `approval`
**Description:** `steps/approval.ts`: gate humano (`prompt`) + ação (`run:[...]`) + `on_conflict`. Lê a decisão via port `ctx.ui.requestApproval(): Promise<boolean>` **[OQ2]**, agnóstico ao transporte (TUI/readline/`--yes`). Interativo por default; `--yes` auto-aprova (não-interativo/CI). Em `pause` sem TTY, escala.
**Acceptance criteria:**
- [ ] **[OQ2]** Pausa e só executa a ação após aprovação, obtida via `requestApproval()` (mockável nos testes sem Ink); `--yes` aprova sem interação.
- [ ] Rejeição não executa a ação e sinaliza escalonamento; `on_conflict` respeitado.
**Verification:**
- [ ] `npm test -- steps/approval` verde (prompt mockado: aprovar/rejeitar/`--yes`).
**Dependencies:** T-004, T-007
**Files likely touched:** `src/steps/approval.ts`, `tests/steps/*.test.ts`.
**Estimated scope:** S

#### Task T-010: Orquestrador — laço externo sobre steps não-agente
**Description:** `loop/orchestrator.ts`: itera tasks `- [ ]` em ordem; para cada uma, interpola o contexto e executa o `pipeline` via **registry de steps** (AD-2), respeitando ordem, `always`, `on_fail`; aplica `stop_conditions` (backlog vazio, `max_iterations`, `stop_signal_file`) e `policies.escalation`; **marca `- [x]` só ao fim do pipeline inteiro** e commita a marcação. Step `agent` ainda não registrado (skip/stub) — valida a mecânica do laço com shell/checks/approval.
**Acceptance criteria:**
- [ ] Um pipeline só de shell/checks/approval roda fim-a-fim sobre repo temporário: cria worktree → commita → merge (`--yes`) → cleanup → `mark_done` + commit da marcação.
- [ ] `always:true` roda mesmo após falha anterior; falha persistente aplica escalonamento e **não** marca a task.
- [ ] Stop conditions encerram o laço externo corretamente.
**Verification:**
- [ ] `npm test -- orchestrator` verde (git + steps reais leves ou mockados; ordem, always, stop, escalation, mark_done-no-fim).
- [ ] Manual: rodar um `loopy.yml` sem step `agent` num repo temporário.
**Dependencies:** T-005, T-007, T-008, T-009
**Files likely touched:** `src/loop/orchestrator.ts`, `src/steps/index.ts` (registry), `tests/loop/*.test.ts`.
**Estimated scope:** M

### Checkpoint B — Spine sem-agente
- [ ] Pipeline não-agente roda fim-a-fim sobre repo git temporário (worktree→commit→merge→cleanup→mark_done).
- [ ] `always`, stop conditions e escalonamento comprovados em teste.
- [ ] Nenhum comportamento de loop hardcoded (AD-1): reordenar/editar steps no yml muda o comportamento sem tocar no motor.
- [ ] **Revisão humana antes de prosseguir.**

---

### Phase 2 — Fatia do agente ACP (o coração)

#### Task T-011: Processo ACP + handlers do cliente
**Description:** `acp/agent.ts` (spawn de `npx -y @agentclientprotocol/claude-agent-acp`, `ndJsonStream(Writable.toWeb(stdin), Readable.toWeb(stdout))`, builder `client({name})`, `connectWith`, `initialize` com `PROTOCOL_VERSION`/capabilities, `shutdown`) e `acp/client.ts` (handlers **antes** do connect: `session/request_permission` decidindo por `kind` conforme `permissions`, `fs/read_text_file`+`fs/write_text_file`, terminal, `session/update` → `onUpdate`). 1 processo para a run. Introduz o **fake agent** de teste.
**Acceptance criteria:**
- [ ] Sobe 1 processo, faz `initialize` e recebe `agentInfo`; `shutdown` mata o processo.
- [ ] Handler de permissão escolhe `optionId` por `kind` (`allow_once`/`reject_once`/...) conforme `on_request`; default = allow.
- [ ] `session/update` é repassado ao callback (stream para TUI/logs) **e alimenta o buffer de texto por turno [OQ3]**.
**Verification:**
- [ ] `npm test -- acp/agent` (integração marcada) verde contra o **fake agent scriptable (scenario-driven) [OQ5]**: spawn→initialize→permission→update, com stop reasons e texto configuráveis por cenário.
**Dependencies:** T-001
**Files likely touched:** `src/acp/agent.ts`, `src/acp/client.ts`, `tests/fixtures/fake-agent.ts`, `tests/acp/*.test.ts`.
**Estimated scope:** M

#### Task T-012: Sessão ACP por task
**Description:** `acp/session.ts`: `buildSession(cwd).start()` (cwd = worktree), `setMode(modeId)` via `session/set_mode`, `clear()` (envia `/clear`), `prompt(text)` → `stopReason`, `readText()` (concatena chunks do turno), `cancel()` (`session/cancel`), teardown ao fim. Não-`end_turn` sinalizado como falha; pool keyed por worktree (parallel-ready).
**Acceptance criteria:**
- [ ] Abre sessão nova por worktree; `setMode` aplica `plan`/`acceptEdits`; `/clear` zera contexto mantendo `sessionId`.
- [ ] `prompt` devolve `stopReason`; **o texto do turno vem de um buffer próprio resetado antes de cada `prompt` (acumula `agent_message_chunk`), com `readText()` como fallback [OQ3]**; `cancel` cancela.
- [ ] `refusal`/`max_tokens`/`max_turn_requests` tratados como falha; `cancelled` como stop-signal.
**Verification:**
- [ ] `npm test -- acp/session` (integração marcada) verde contra fake agent: new→set_mode→/clear→prompt→readText→cancel→teardown.
**Dependencies:** T-011
**Files likely touched:** `src/acp/session.ts`, `tests/acp/*.test.ts`, extensões ao `tests/fixtures/fake-agent.ts`.
**Estimated scope:** M

#### Task T-013: Parser de veredito (`AUDIT: PASS/FAIL`)
**Description:** `steps/verdict.ts`: parser **tolerante** de `AUDIT: PASS` / `AUDIT: FAIL: <motivo>` sobre **o buffer de texto do turno do audit [OQ3]** (não o `readText` cumulativo), considerando a **última ocorrência**. Pura, sem I/O.
**Acceptance criteria:**
- [ ] Detecta PASS/FAIL na última linha relevante mesmo com ruído antes; extrai o `<motivo>` no FAIL.
- [ ] Ausência de veredito = FAIL (barra o commit).
**Verification:**
- [ ] `npm test -- verdict` verde (casos: pass, fail+motivo, ruído, ausência, múltiplas ocorrências).
**Dependencies:** T-001
**Files likely touched:** `src/steps/verdict.ts`, `tests/steps/verdict.test.ts`.
**Estimated scope:** S (paralelizável com T-011/T-012)

#### Task T-014: Interpretador do step `agent` (loop interno)
**Description:** `steps/agent.ts` implementa `Step.execute` (AD-2): `clear_context` (default true → `/clear`), `mode` via setMode, `prompt`/`retry_prompt`, **loop interno `verify:`** (`prompt → checks → em falha, re-prompta com ${checks.report}` até passar ou esgotar `max_attempts`, então `on_fail`), gate de veredito `expect` + `on_expect_fail` (usa T-013 sobre `readText`). Não-`end_turn` = falha do step.
**Acceptance criteria:**
- [ ] Para no sucesso; em falha re-prompta com `${checks.report}`; respeita `max_attempts`; aplica `on_fail` (escalate/etc.).
- [ ] `expect` barra o step se o veredito não casar (`on_expect_fail`); `mode: plan` mantém read-only.
- [ ] `stopReason` não-`end_turn` tratado como falha.
**Verification:**
- [ ] `npm test -- steps/agent` verde (ACP + checks mockados): sucesso na 1ª, retry-até-passar, esgota-max, expect-fail, non-end_turn.
**Dependencies:** T-004, T-006, T-012, T-013
**Files likely touched:** `src/steps/agent.ts`, `tests/steps/agent.test.ts`.
**Estimated scope:** M

#### Task T-015: Registrar `agent` no orquestrador — pipeline completo E2E
**Description:** Plugar o step `agent` no registry (AD-2) e rodar o pipeline completo do `loopy.yml` de exemplo (create-worktree → implement → simplify → audit → commit → merge → cleanup) para **uma** task, contra o fake agent + repo temporário. Fecha o caminho fim-a-fim.
**Acceptance criteria:**
- [ ] Uma task percorre o pipeline inteiro e só é marcada `- [x]` com checks verdes + `AUDIT: PASS` + merge aprovado (Success Criteria #1, #3).
- [ ] Task com checks falhando `max_attempts` vezes **não** é marcada, worktree **preservado**, escalonamento aplicado e logado (Success Criterion #4).
- [ ] Trocar a ordem/prompt/mode no yml muda o comportamento sem editar o motor (AD-1 / Success Criterion #2).
**Verification:**
- [ ] `npm test -- e2e-agent` (integração marcada) verde contra fake agent + repo temporário.
- [ ] Manual (opcional): 1 task real contra o Claude via ACP.
**Dependencies:** T-010, T-014
**Files likely touched:** `src/steps/index.ts`, `src/loop/orchestrator.ts`, `tests/e2e/*.test.ts`.
**Estimated scope:** M

### Checkpoint C — Fatia do agente
- [ ] Pipeline completo roda fim-a-fim para 1 task contra o fake agent.
- [ ] Mark-done só com checks verdes + `AUDIT: PASS` + merge; falha preserva worktree e escala.
- [ ] Comportamento continua 100% dirigido pelo yml (AD-1).
- [ ] **Revisão humana antes de prosseguir.**

---

### Phase 3 — TUI ao vivo + observabilidade

#### Task T-016: Store observável + logging
**Description:** `tui/store.ts` (estado observável parallel-ready — **sem singleton de "task atual"**; keyed por task/worktree) alimentado pelos eventos do orquestrador/steps; `logging/logger.ts` (log por task em `.loopy/logs/<id>.log` + captura opcional do tráfego ACP quando `capture_acp_traffic`).
**Acceptance criteria:**
- [ ] Store reflete tasks, tentativa atual (`try k/max`), status por check e chunks do stream, sem estado global de task única.
- [ ] Logger grava por task; `--verbose`/`capture_acp_traffic` inclui tráfego JSON-RPC.
**Verification:**
- [ ] `npm test -- store logging` verde (transições de estado + escrita de log).
**Dependencies:** T-010 (eventos), T-011 (tráfego ACP)
**Files likely touched:** `src/tui/store.ts`, `src/logging/logger.ts`, `tests/tui/store.test.ts`, `tests/logging/*.test.ts`.
**Estimated scope:** M

#### Task T-017: TUI Ink + fallback de linha
**Description:** `tui/App.tsx` + `components/` (TaskRow, CheckStatus, StreamPane, ApprovalPrompt): árvore de progresso ao vivo lendo o store. Fallback para logs de linha quando não há TTY ou `--no-tui`.
**Acceptance criteria:**
- [ ] TUI mostra ao vivo: lista de tasks, `try k/max`, status por check e stream do agente (Success Criterion #6).
- [ ] Sem TTY ou com `--no-tui`, degrada para logs de linha equivalentes.
- [ ] Approval gate renderiza prompt interativo no modo TUI.
**Verification:**
- [ ] Validação via store/estado (AD-6); `npm test -- tui` verde nos componentes testáveis.
- [ ] Manual: rodar com TTY (TUI) e com `--no-tui` (linha).
**Dependencies:** T-016
**Files likely touched:** `src/tui/App.tsx`, `src/tui/components/*`, `tests/tui/*`.
**Estimated scope:** M

### Checkpoint D — UX
- [ ] TUI ao vivo funcional; fallback de linha sem TTY/`--no-tui`.
- [ ] Logs por task + tráfego ACP quando habilitado.
- [ ] **Revisão humana antes de prosseguir.**

---

### Phase 4 — Hardening & aceitação total

#### Task T-018: Stop conditions, escalonamento, git-init e flags restantes
**Description:** Completar `stop_conditions` (`max_iterations`, `stop_signal_file` → encerra após a task corrente), `policies.escalation` (`pause`/`skip_task`/`abort_loop` com `keep_worktree`, `notify`), `require_clean_parent` no início de cada task, setup git de primeiro run (`git init` + commit inicial incluindo `.claude` + `.gitignore` — **atrás de aprovação**) e as flags de CLI ainda no-op (`--task`, `--max-iterations`, `--config`, `--verbose`).
**Acceptance criteria:**
- [ ] Criar `.loopy.stop` encerra após a task corrente (Success Criterion #5); `max_iterations` limita o laço.
- [ ] Cada modo de escalonamento se comporta como especificado e é logado; `keep_worktree` preserva.
- [ ] `require_clean_parent` aborta a próxima task se o parent estiver sujo; git-init só com aprovação.
- [ ] `--task T-NNN` roda só aquela task; **[OQ6]** avisa (não bloqueia) se houver tasks `- [ ]` anteriores pendentes; `--max-iterations N` sobrescreve o teto.
**Verification:**
- [ ] `npm test -- policies stop-conditions cli` verde.
- [ ] Manual: `.loopy.stop`, `--task`, `--max-iterations`.
**Dependencies:** T-015
**Files likely touched:** `src/loop/orchestrator.ts`, `src/git/worktree.ts`, `src/index.ts`, `tests/*`.
**Estimated scope:** M

#### Task T-019: Passagem de aceitação + `loopy.yml` de exemplo + docs
**Description:** Validar todos os Success Criteria do SPEC fim-a-fim; garantir que o `loopy.yml` de exemplo casa com o schema final; README/uso do CLI; conferir `.gitignore` (`.worktrees/`, `.loopy/`, `.loopy.stop`) e que nada temporário sobra ao final.
**Acceptance criteria:**
- [ ] Success Criteria #1–#8 do SPEC demonstráveis (checklist marcado).
- [ ] Ao final de uma run limpa, `parent_branch` compila/linta/testa verde e nenhum worktree/branch temporário sobra (exceto preservados por escalonamento) (Success Criterion #7).
- [ ] `--dry-run` continua íntegro; docs de uso presentes.
**Verification:**
- [ ] Rodar a matriz de Success Criteria; `npm test` full verde; `npm run typecheck`/`lint` verdes.
- [ ] Manual/e2e (opcional): run real contra o Claude.
**Dependencies:** T-016, T-017, T-018
**Files likely touched:** `README.md`, `loopy.yml`, `.gitignore`, `tests/*`.
**Estimated scope:** M

### Checkpoint E — Completo
- [ ] Todos os Success Criteria (#1–#8) atendidos e demonstrados.
- [ ] `parent_branch` verde; sem lixo de worktree/branch.
- [ ] Comportamento do loop 100% dirigido pelo yml (AD-1).
- [ ] **Revisão humana final.**

---

## Parallelization Opportunities

- **Fase 0:** T-002, T-003, T-004 são independentes dado T-001 → paralelizáveis.
- **Fase 1:** T-006 e T-007 independentes → paralelos; T-008/T-009 dependem deles.
- **Fase 2:** T-013 (verdict, puro) paralelo a T-011/T-012; T-014 precisa de T-012+T-013.
- **Sequencial obrigatório:** T-005 (integra Fase 0), T-010 (integra spine), T-015 (integra agente) — são pontos de junção; T-001 é pré-requisito de tudo.
- **Contrato antes de paralelizar:** fixar `Step`/`StepContext`/`StepResult` (T-001) destrava steps em paralelo depois.

## Risks and Mitigations

| Risco | Impacto | Mitigação |
|---|---|---|
| Deriva de API do SDK ACP (`^0.29`) vs SPEC | Alto | API já verificada no `ralphy` (`buildSession`, `readText`, `connectWith`); pinar versão; testes de integração contra fake agent cedo (T-011). |
| Motor "vazar" comportamento hardcoded (viola AD-1) | Alto | `Step` interface + registry (AD-2); acceptance criteria de AD-1 em T-010/T-015; teste que reordena o yml e observa mudança sem tocar no motor. |
| Flakiness da integração real com Claude | Médio | Fake agent determinístico para CI; runs reais só manuais/e2e (AD-6). |
| `node_modules` por worktree (não compartilhado) lento | Médio | Instalado no step `create-worktree` do yml (config, não motor); documentar; ajustável ao gerenciador. |
| Merge conflicts no v1 sequencial | Baixo | `on_conflict: escalate` (abort + preserva worktree); raro em sequencial. |
| Render do Ink difícil de testar | Baixo | Validar via store/estado (AD-6); render é manual. |

## Decisões de implementação (OQ1–OQ6 fechadas)

As Open Questions formais do SPEC (Q1–Q7) já estavam resolvidas e travadas. As decisões abaixo (OQ1–OQ6) são as residuais de nível de implementação, fechadas explicitamente com o dono do repo:

| OQ | Decisão | Impacto |
|---|---|---|
| **OQ1 — Interpolação de chave desconhecida** | **Abortar (fail-fast)** com erro claro (variável + step), antes de qualquer efeito. Chave *conhecida-porém-vazia* (ex.: `${checks.report}` no 1º prompt, `${worktree.diff}` sem diff) renderiza vazio — não é erro. | T-004 |
| **OQ2 — Input do gate `approval` na TUI** | **`useInput` nativo do Ink + port `ctx.ui.requestApproval(): Promise<boolean>`**. TUI resolve via componente `ApprovalPrompt`; `--no-tui`/sem-TTY via `readline`; `--yes` curto-circuita. Orquestrador agnóstico ao transporte. | T-009, T-017 |
| **OQ3 — Fonte de verdade do texto do agente** | **Buffer próprio por turno**, acumulado dos `agent_message_chunk` e **resetado antes de cada `prompt`**; `readText()` só como fallback/cross-check. Turn-scoped por construção, imune a `/clear` e a semântica cumulativa. | T-011, T-012, T-013, T-014 |
| **OQ4 — Truncamento do `ChecksReport`** | **Head+tail por check** (orçamento por-check + teto global), checks que passam colapsam para 1 linha, marcador de elisão explícito no meio. Defaults ~100+100 linhas/check, teto global ~32 KB (calibrar na T-006; exponível como knob depois). | T-006 |
| **OQ5 — Fidelidade do fake agent** | **Scriptable (scenario-driven)**: stub enxuto dirigido por cenário por-teste, capaz de emitir stop reasons configuráveis, `request_permission`, `fs`/`terminal` e texto scriptado por prompt (fail-then-pass, `AUDIT: FAIL`→`PASS`). Não record/replay. | T-011, T-012, T-015 |
| **OQ6 — `--task T-NNN` vs. dependências** | **Fora de escopo + aviso não-bloqueante**: roda a task isolada (escape hatch); se houver tasks `- [ ]` anteriores na ordem, avisa sem bloquear. Sem campo de dependência no schema, sem policy escondida (fiel a AD-1). | T-018 |

Decisões menores do SPEC (node_modules por worktree, mark-done + parent limpo, setup git no 1º run) já estão endereçadas nas tasks T-010/T-018.
