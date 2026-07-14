# D-0004 — O control frame `approval_requested` sai com `taskId` e `stepId` vazios

> **Status:** aberto · **Severidade:** média · **Área:** `src/tui/start.ts` · consumidor: `apps/menubar/`
> **Descoberto em:** 2026-07-14 · **Origem:** sync do Intent Layer (`/write-agent-md sync`)

## Sintoma
Sob `--emit-events`, todo frame `control: "approval_requested"` chega na Native UI com `taskId: ""` e `stepId: ""`, embora o contrato do frame declare os dois campos (ADR-0007). A GUI recebe um envelope sem saber **de qual Task** é o gate.

## Causa raiz
Os campos são **hardcoded vazios** na emissão:

```ts
// src/tui/start.ts:131-137
control: "approval_requested",
requestId: ctrl.requestId,
taskId: "",     // <-- nunca preenchido
stepId: "",     // <-- nunca preenchido
summary: ctrl.summary,
```

O `UiPort` que dispara o gate não carrega a Task/Step corrente até este ponto — a informação existe no `StepContext` (é o orquestrador que sabe qual Task pediu aprovação), mas não é propagada até o `startUi`.

## Impacto
Sob `concurrency > 1` isso **quebra o roteamento do gate na GUI**: com duas Tasks aguardando aprovação, o app não consegue associar cada `ApprovalRequest` à sua Task. Hoje ele se vira pelo `requestId` (a decisão volta certa, então **não há aprovação aplicada à Task errada**), mas a UX depende do `taskId` para abrir o drawer na Task certa — com o campo vazio, o gate não tem âncora.

Na TUI Ink o impacto é nulo (ela não usa o frame). É um bug **da fronteira com a Native UI**, e é silencioso: nada falha, o campo só vem vazio.

## Reprodução
1. `loopy --emit-events <dir>` num backlog com ≥1 step `approval`.
2. Observe o stdout quando o gate abrir: a linha NDJSON traz `"taskId":"","stepId":""`.

## Correção proposta
Propagar Task/Step até o sink do control frame. O caminho mais direto: enriquecer o `ApprovalRequest` que o step `approval` entrega ao `ctx.ui` com `taskId`/`stepId` (ambos disponíveis no `StepContext`), e o `startUi` passa a ler dali em vez de hardcodar `""`. Vale um teste de transporte assertando que o frame carrega o `taskId` da Task que pediu.

## Workaround atual
A GUI casa a decisão pelo `requestId`, que é correto e único — então o fluxo funciona. Só a associação visual com a Task depende do campo vazio.
