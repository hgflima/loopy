# Steps — os 4 primitivos e o registry (AD-2)

## Purpose & Scope
Implementa os intérpretes dos 4 tipos de step (`agent`/`shell`/`checks`/`approval`) e o `type → interpreter` registry por onde o orquestrador roteia cada step. Cada intérprete é **mecânica pura de um tipo**; nenhum sabe a ordem do pipeline nem hardcoda comportamento (AD-1). Retorna `StepResult` (`{ ok, reason?, report?, output? }`) — erros são valores (AD-5), exceções só para faltas genuínas (var de interpolação desconhecida, `verify.run`/`checks` apontando lista de checks inexistente, `mode` inválido para o Agente, step do `type` errado via `assertStepType`).

## Entry Points & Contracts
- `createStepRegistry(steps)` / `createNonAgentRegistry(opts)` / `createFullRegistry(opts)` (`index.ts`). O registry só mapeia `type → Step`; `get(type)` retorna `undefined` para tipos sem intérprete → o orquestrador **pula** (não falha).
- **`parentMutex` entra pelo registry** (`createFullRegistry({ parentMutex })`, montado em `../index.ts`). Os três intérpretes **não-agente** envolvem sua execução em `guarded(mutex, …)` — **exceto** quando `step.parallel_safe`. O step `agent` **nunca** adquire o mutex (ele roda no worktree, isolado).
- Cada `create*Step()` retorna um `Step` sem estado por-run → uma instância é reusada entre tasks. Lê o step atual de `ctx.step`.
- **cwd de todo comando é `ctx.worktreePath`**, nunca o parent. Comando que toca o parent precisa de `-C ${workspace.root}` explícito — é exatamente o que o warning de `parallel_safe` procura no argv (`../config/warnings.ts`).

## Usage Patterns
- **`agent`** (`agent.ts`): o *inner loop* do modelo de dois níveis. Aplica na ordem `setMode(step.mode)` → `setModel` → `setEffort` (ADR-0006). **`setMode` é fail-closed** — erro do adapter é re-lançado nomeando step + agente (modo é vocabulário **por-Agente**); só `setModel`/`setEffort` são best-effort. Se `clear_context`, chama `ctx.session.clear()` antes de **cada** prompt — que **reabre a sessão** (novo `sessionId`, mode/model/effort re-aplicados pela própria sessão; ver `../acp/`). Loop `verify: { run, max_attempts }` re-prompta com `${checks.report}` fresco por tentativa; gate `expect` via `parseVerdict`. A ação em falha é governada por `step.on_fail` (default `escalate`; ou `{ goto: <step-id> }` — ADR-0002). No Desvio por goto, o motor carrega `result.report?.text ?? result.output` como carry; o agente re-entrado semeia `checksReport` do `ctx` (não `""`), `attempt = 1`, e usa `prompt` (não `retry_prompt`).
  - **Sem `verify`, `maxAttempts = 1`**: o loop interno só existe se `verify` existir. `expect` sozinho **não** re-prompta.
- **`shell`** (`shell.ts` + `tokenize.ts`): tokeniza+resolve TODOS os comandos *antes* de rodar (fail-fast, sem efeito parcial), roda argv direto via execa. Para no 1º erro — exceto `always:true` (best-effort, ex.: `cleanup` tenta `worktree remove` E `branch -D`).
- **`checks`** (`checks.ts`): roda uma lista nomeada de `checks:` standalone. Sem fail-fast: roda todos em ordem e agrega o Report.
- **`approval`** (`approval.ts`): gate humano via `ctx.ui`, opcionalmente roda `run:` após aprovar. Honra `ctx.flags.yes` **internamente** (`--yes` é comportamento *de step*, não do orquestrador); rejeição **não roda nada** e devolve `ok:false`. **A espera humana fica FORA da seção crítica** — só o `run:` entra no mutex. Inverter isso trava o Run inteiro.

## Anti-patterns
- Nunca passar dados interpolados para um shell: `shell` roda **argv sem shell** — sem pipes/redirect dentro de um comando. Ver Pitfalls.
- Não deixar o veredito de `audit` passar por ausência: `parseVerdict` é **fail-closed** (ausência = FAIL).
- Não reintroduzir estado por-run nos intérpretes (eles são singletons reusados).
- Não mover a espera de aprovação para dentro do mutex, nem fazer o step `agent` pegar o mutex.

## Dependencies & Edges
- Contrato `Step`/`StepContext`/`StepResult`: `../types.ts`. Interpolação: `../interp/`. Mutex: `../loop/mutex.ts`.
- `agent.ts` reusa `buildScopeVars` e `resolveAgentBinding` de `../loop/orchestrator.ts` (fonte única do escopo/binding) e `classifyStopReason` de `../acp/session.ts`.
- Checks: `../checks/runner.ts` (é ele quem trunca a saída que entra no prompt). Verdict: `verdict.ts`.

## Patterns & Pitfalls
- **Fix de segurança do `shell`**: uma versão antiga usava `/bin/sh -c` com a linha resolvida → o shell fazia uma SEGUNDA expansão `$` nos DADOS: um título com `${...}` dava `bad substitution`, e `$(rm -rf ~)` seria injeção. Hoje tokeniza o template RAW e resolve `${...}` *por token*, argv direto. **Não reverter para `shell: true`.**
- **`expect` ⇒ NÃO usar `mode: plan`** no mesmo step do jeito errado: o veredito precisa vir no texto do turno bufferizado; ver o buffer de turno em `../acp/`. `labelFromExpect("AUDIT: PASS")` → `"AUDIT"` (token config-driven, engine não hardcoda `"AUDIT"`).
- `agent` re-resolve `${checks.report}` por tentativa via `buildAttemptResolver` (o `ctx.resolve` do orquestrador nasce com report vazio e `attempt=1`).
- Step que auto-commita + step `commit` do yml: se o agente já commitou, a árvore está limpa e `git commit` sai 1 — proibir commit no prompt do agente e/ou usar `--allow-empty`.
- **Emit seam (C-0007, ADR-0005)**: os intérpretes espelham eventos intra-Step via `ctx.emit?` — `agent` emite `attempt_started` e encaminha `onCheckStart`/`onCheckEnd` como `check_started`/`check_finished`; `checks` idem; `shell` streama `stdout`/`stderr` via `onChunk` → `stream_chunk`. Todos aditivos: sem `emit`, o `StepResult` agregado é byte-idêntico (AD-1).
- **Débitos abertos aqui** (`.harn/devy/debts/`): **D-0003** — `check_started`/`check_finished` nunca são emitidos num run real (o `ChecksRunnerPort` de produção, inline em `../index.ts`, descarta os callbacks; o `createChecksRunner` que os encaminha não é usado). **D-0005** — `cancelSignal` é seam morto: `shell.ts` implementa o hard-stop, mas o campo não existe em `NonAgentRegistryOptions` e nunca desce pelo wiring. **D-0006** — `approval.ts` interpola o `on_fail` cru, então `{ goto }` vira `[object Object]` na `reason` (`agent.ts` usa `formatOnFail` e acerta).
