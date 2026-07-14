# D-0006 — `on_fail: { goto }` num step `approval` renderiza `[object Object]` na mensagem de falha

> **Status:** aberto · **Severidade:** baixa · **Área:** `src/steps/approval.ts`
> **Descoberto em:** 2026-07-14 · **Origem:** sync do Intent Layer (`/write-agent-md sync`)

## Sintoma
Quando o `run:` de um step `approval` falha e o step declara um Desvio (`on_fail: { goto: fix }`), a `reason` do `StepResult` sai assim:

```
git merge --no-ff T-001. on_fail: [object Object].
```

Com `on_fail: escalate` a mensagem é correta — o bug só aparece na forma de goto.

## Causa raiz
O `approval` interpola o `on_fail` **cru** no template, e a forma de Desvio é um objeto:

```ts
// src/steps/approval.ts:140,143
const onFail = step.on_fail ?? "escalate";
... `${failure.command}. on_fail: ${onFail}.`;
```

O `agent` já resolveu isso: usa o formatador dedicado (`src/steps/agent.ts:56,167` → `formatOnFail(onFail)`, exportado de `src/loop/orchestrator.ts`). O `approval` nunca foi migrado.

## Impacto
**Cosmético.** A `reason` é uma string de diagnóstico: ela vai para o log, para a TUI e para o Relatório — mas o motor **não** a interpreta, e o Desvio em si funciona (o PC salta certo). O que se perde é a legibilidade justamente no momento em que o usuário quer entender o que falhou.

## Reprodução
```yaml
- id: merge
  type: approval
  run: ["git merge --no-ff ${task.branch}"]
  on_fail: { goto: fix }
```
Faça o merge falhar e leia a `reason` do step.

## Correção proposta
Importar `formatOnFail` de `../loop/orchestrator` em `approval.ts` e aplicá-lo, exatamente como o `agent.ts` faz. Vale varrer os outros intérpretes (`shell.ts`, `checks.ts`) pelo mesmo padrão de interpolação crua antes de fechar.

## Workaround atual
Ignorar o `[object Object]` na mensagem — o comportamento do Desvio está correto.
