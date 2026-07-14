# D-0003 — Os eventos `check_started`/`check_finished` nunca são emitidos num Run real

> **Status:** aberto · **Severidade:** média · **Área:** `src/index.ts` · `src/checks/runner.ts`
> **Descoberto em:** 2026-07-14 · **Origem:** sync do Intent Layer (`/write-agent-md sync`)

## Sintoma
Durante um Run vivo, o Dashboard (e a GUI) nunca mostram um check individual começando ou terminando. A UI salta do `attempt_started` direto para o resultado agregado do Step, mesmo com o `emit` seam ligado. Os testes de `steps` passam — porque neles os callbacks são injetados à mão.

## Causa raiz
O `ChecksRunnerPort` de produção é construído **inline** no wiring e repassa **só o `cwd`**, descartando os callbacks aditivos:

```ts
// src/index.ts:450
run: (list, opts) => runChecks(list, { cwd: resolvePath(root, opts.cwd) }),
```

`runChecks` aceita `onCheckStart`/`onCheckEnd` (`src/checks/runner.ts:280,282`), e existe uma fábrica que os encaminha corretamente — `createChecksRunner` (`src/checks/runner.ts:320-333`) — mas ela **não tem nenhum consumidor em `src/`**: só é usada em `tests/checks/runner.test.ts:365`.

Ou seja: os intérpretes `agent` e `checks` fazem a parte deles (traduzem `onCheckStart`/`onCheckEnd` em `check_started`/`check_finished` via `ctx.emit`), mas o port que chega até eles em produção nunca chama esses callbacks.

## Impacto
**Observabilidade, não corretura.** O `ChecksReport` agregado e o `StepResult` continuam corretos — o Run se comporta igual. O que se perde é o feedback ao vivo de check-a-check, justamente na parte mais demorada do pipeline (o Verify do step de agente): o usuário fica olhando um Step "rodando" sem saber se está no `lint`, no `typecheck` ou no `test`. É **silencioso**: nada falha, o evento só não existe.

Atinge as duas UIs (TUI Ink e a GUI menubar), porque ambas consomem os mesmos `StoreEvent`s.

## Reprodução
1. Rode qualquer pipeline com um step `agent` que tenha `verify: { run: ci }` (o `examples/loopy.yml` serve).
2. Observe o Painel de Tasks durante o Verify: nenhum check aparece individualmente.
3. Confirme que não é a UI: `grep -rn "createChecksRunner" src/` → zero hits fora da própria definição.

## Correção proposta
Trocar o port inline pela fábrica que já existe e já está testada:

```ts
// src/index.ts
checks: createChecksRunner({ cwd: (c) => resolvePath(root, c) /* adaptar assinatura */ }),
```

Requer conferir a assinatura de `createChecksRunner` contra o `ChecksRunnerPort` (ela recebe um `runOne` injetável) e garantir que o `resolvePath(root, opts.cwd)` continue sendo aplicado. Um teste de wiring que assere "um Run com emit recebe ≥1 `check_started`" evita a regressão — hoje nenhum teste cobre o caminho de produção, só o do runner isolado.

## Workaround atual
Nenhum pela config. Para ver o progresso dos checks, use `--verbose` e acompanhe o log de arquivo.
