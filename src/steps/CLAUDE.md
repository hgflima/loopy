# Steps — os 4 primitivos e o registry (AD-2)

## Purpose & Scope
Implementa os intérpretes dos 4 tipos de step (`agent`/`shell`/`checks`/`approval`) e o `type → interpreter` registry por onde o orquestrador roteia cada step. Cada intérprete é **mecânica pura de um tipo**; nenhum sabe a ordem do pipeline nem hardcoda comportamento (AD-1). Retorna `StepResult` (`{ ok, reason?, report?, output? }`) — erros são valores (AD-5), exceções só para faltas genuínas (var de interpolação desconhecida, `verify.run` apontando lista de checks inexistente, step do `type` errado via `assertStepType`).

## Entry Points & Contracts
- `createStepRegistry(steps)` / `createNonAgentRegistry()` / `createFullRegistry()` (`index.ts`). O registry só mapeia `type → Step`; `get(type)` retorna `undefined` para tipos sem intérprete → o orquestrador **pula** (não falha). Isso é o que permitiu construir/provar o spine sem-agente antes do `agent` existir.
- Cada `create*Step()` retorna um `Step` sem estado por-run → uma instância é reusada entre tasks. Lê o step atual de `ctx.step` (o orquestrador só roteia o `type` casado).

## Usage Patterns
- **`agent`** (`agent.ts`): o *inner loop* do modelo de dois níveis. `mode` uma vez (`session/set_mode`, persiste e sobrevive a `/clear`); `/clear` antes de **cada** prompt se `clear_context` (memória vive no disco/prompt, nunca na conversa); loop `verify: { run, max_attempts }` re-prompta com `${checks.report}` fresco por tentativa; gate `expect` via `parseVerdict`. A ação em falha (verify esgotado ou expect não-bate) é governada por `step.on_fail` (default `escalate`).
- **`shell`** (`shell.ts` + `tokenize.ts`): tokeniza+resolve TODOS os comandos *antes* de rodar (fail-fast, sem efeito parcial), roda argv direto via execa. Para no 1º erro — exceto `always:true` (best-effort, ex.: `cleanup` tenta `worktree remove` E `branch -D`).
- **`checks`** (`checks.ts`): roda uma lista nomeada de `checks:` standalone.
- **`approval`** (`approval.ts`): gate humano via `ctx.ui`, opcionalmente roda `run:` após aprovar.

## Anti-patterns
- Nunca passar dados interpolados para um shell: `shell` roda **argv sem shell** — sem pipes/redirect dentro de um comando. Ver Pitfalls.
- Não deixar o veredito de `audit` passar por ausência: `parseVerdict` é **fail-closed** (ausência = FAIL).
- Não reintroduzir estado por-run nos intérpretes (eles são singletons reusados).

## Dependencies & Edges
- Contrato `Step`/`StepContext`/`StepResult`: `../types.ts`. Interpolação: `../interp/`.
- `agent.ts` reusa `buildScopeVars` de `../loop/orchestrator.ts` (fonte única do escopo) e `classifyStopReason` de `../acp/session.ts`.
- Verdict: `verdict.ts`.

## Patterns & Pitfalls
- **Fix de segurança do `shell`** (`shell.ts` docstring): uma versão antiga usava `/bin/sh -c` com a linha resolvida → o shell fazia uma SEGUNDA expansão `$` nos DADOS: um título com `${...}` dava `bad substitution`, e `$(rm -rf ~)` seria injeção. Hoje tokeniza o template RAW e resolve `${...}` *por token*, argv direto — dado nunca é reinterpretado. **Não reverter para `shell: true`.**
- **`expect` ⇒ NÃO usar `mode: plan`** no mesmo step do jeito errado: o veredito precisa vir no texto do turno bufferizado; ver interação com o buffer de turno em `../acp/`. `labelFromExpect("AUDIT: PASS")` → `"AUDIT"` (token config-driven, engine não hardcoda `"AUDIT"`).
- `agent` re-resolve `${checks.report}` por tentativa via `buildAttemptResolver` (o `ctx.resolve` do orquestrador nasce com report vazio e `attempt=1`).
- Step que auto-commita + step `commit` do yml: se o agente já commitou, a árvore está limpa e `git commit` sai 1 — proibir commit no prompt do agente e/ou usar `--allow-empty`.
