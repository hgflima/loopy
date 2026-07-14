# D-0005 — `cancelSignal` é um seam morto: o hard-stop nunca chega ao step `shell`

> **Status:** aberto · **Severidade:** média · **Área:** `src/steps/index.ts` · `src/steps/shell.ts` · `src/index.ts`
> **Descoberto em:** 2026-07-14 · **Origem:** sync do Intent Layer (`/write-agent-md sync`)

## Sintoma
Um comando `shell` longo em curso (um `npm ci`, um `git merge` travado) **não recebe SIGTERM** quando o Run é cancelado. O caminho de hard-stop existe no código, está testado isoladamente e nunca é acionado em produção.

## Causa raiz
O `shell` implementa a cancelação de ponta a ponta: o runner repassa o signal ao execa (`src/steps/shell.ts:238` → `cancelSignal: ctx.cancelSignal`), e o step lê o campo das suas próprias options (`src/steps/shell.ts:202`, tipo em `:164`).

O que falta é o **wiring**: `NonAgentRegistryOptions` (`src/steps/index.ts:47-59`) tem só `runCommand`, `timeoutMs` e `parentMutex` — **não tem `cancelSignal`**. Logo `createFullRegistry({ parentMutex })` (`src/index.ts:462`) não tem como passá-lo, e o campo nunca é populado. O `AbortSignal` também não existe em `src/types.ts` (nem no `StepContext`, nem nos ports).

O seam está cortado exatamente no meio: implementado embaixo, ausente na interface por onde teria de descer.

## Impacto
O **Cancelamento** do glossário (ADR-0004) só cobre o step `agent` (`session.cancel()`, sibling-safe). Steps `shell` — que são a maioria do pipeline canônico (worktree add, commit, merge, cleanup) — seguem rodando até terminar sozinhos. Na prática o cancelamento vira "espere o comando corrente acabar", e a parada dura depende do `child.kill()` no timeout.

Não corrompe estado (o comando termina de forma limpa), mas torna o stop lento e, num `npm ci` de minutos, aparentemente travado.

## Reprodução
1. `grep -rn "cancelSignal" src/` → aparece **só** em `src/steps/shell.ts`. Nenhum chamador o fornece.
2. Rode um pipeline com um `shell` demorado e dispare o stop: o subprocesso não recebe SIGTERM.

## Correção proposta
Adicionar `readonly cancelSignal?: AbortSignal` a `NonAgentRegistryOptions`, encaminhá-lo em `createNonAgentRegistry`/`createFullRegistry` para `createShellStep` (e `createApprovalStep`, que também roda `run:`), e passá-lo no wiring a partir do `AbortPort` que o orquestrador já expõe (`src/loop/orchestrator.ts`, `AbortPort` + `CANCEL_TIMEOUT_MS`). Um teste que assere "abortar durante um `shell` mata o subprocesso" fecha o seam.

## Workaround atual
Nenhum. O hard-stop de um `shell` em curso hoje depende do timeout da parada dura.
