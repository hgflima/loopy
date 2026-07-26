# D-0012 — Card visita a coluna `Backlog` entre dois Steps, e o realce de Desvio dispara em toda conclusão de step

> **Status:** resolvido em 2026-07-26 (`lastStepId`) · **Severidade:** média · **Área:** `apps/menubar/src/kanban/grouper.ts` · `apps/menubar/src/kanban/goto-detect.ts` · `src/tui/store.ts`
> **Descoberto em:** 2026-07-25 · **Origem:** auditoria `CONTEXT.md` vs código (`/domain-modeling`, sessão avulsa na `main`)

## Sintoma

No Kanban da Native UI, o realce de **Retorno de goto** — a peça visual do fix-loop, que deveria acender só quando um **Desvio** manda a Task para um Step anterior — pode acender a **cada Step concluído**, sem que goto nenhum tenha acontecido.

Sintoma secundário, e mais importante conceitualmente: a coluna chamada `Backlog` **não é o Backlog**. Uma Task `running`, no meio do pipeline, aparece nela.

## Causa raiz

Dois fatos que se combinam:

1. **`step_finished` zera o ponteiro** (`src/tui/store.ts:441`):

   ```ts
   return withStep.currentStepId === event.stepId
     ? { ...withStep, currentStepId: undefined }
     : withStep;
   ```

2. **O grouper usa `Backlog` como coluna de fallback** (`apps/menubar/src/kanban/grouper.ts:106`):
   ```ts
   } else if (task.currentStepId && stepBuckets.has(task.currentStepId)) {
     stepBuckets.get(task.currentStepId)!.push(toCard(task));
   } else {
     backlog.push(toCard(task));   // ← qualquer não-terminal sem posição
   }
   ```

Entre o `step_finished` de um Step e o `step_started` do seguinte, a Task `running` fica **sem posição** e cai no `Backlog` — índice de coluna 0. Como `detectGotoCards` (`goto-detect.ts`) infere Desvio comparando índices de coluna entre dois snapshots ("índice que diminuiu = recuo"), essa visita é lida como goto.

Não há guarda em nenhum dos dois módulos, e nenhum teste cobre o caso: os testes de goto existentes (`grouper.test.ts:168-186`) só exercitam **reordenação de colunas**.

## Impacto

**Correção de sinal, não de dado.** O motor não é afetado (o Kanban só observa — AD-1) e nenhum estado é corrompido. O que se perde é a confiabilidade do único indicador visual do fix-loop: um realce que acende sem motivo treina o operador a ignorá-lo, e aí ele deixa de servir quando o Desvio é real.

O defeito de **modelo** é o mais duradouro: enquanto a coluna `Backlog` for a coluna de fallback, ela terá dois significados incompatíveis ("ainda não começou" e "está entre dois Steps"), e qualquer inferência baseada em posição de coluna herda a ambiguidade.

O disparo depende de `step_finished` e `step_started` caírem em **renders separados** — se o React agrupasse os dois dispatches no mesmo tick, o estado intermediário não seria observado por `detectGotoCards`. Na prática eles caem separados: uma sessão de dogfooding viu o anel accent acender no `dev:web` (`MOCK_FEED`) para a T-001, que só anda para frente. O defeito de **modelo** (a coluna sobrecarregada) existiria de todo modo, e foi por ele que este débito foi aberto.

## Reprodução

Conceitual, sobre a função pura — não precisa subir a GUI:

```ts
const during = groupByStep(
  store(
    [task("T-001", "A", { status: "running", currentStepId: "build" })],
    PIPELINE,
  ),
);
const between = groupByStep(
  store([task("T-001", "A", { status: "running" })], PIPELINE),
); // step_finished zerou
detectGotoCards(during, between); // → Set { "T-001" }  ✗ deveria ser vazio
```

## Correção

**Aplicada em 2026-07-26** (patch preservado em `.harn/devy/handoffs/20260725-context-glossary-audit/kanban-lastStepId.patch`, aplicado sobre `baaae8a`). São 239 inserções / 7 remoções em 4 arquivos:

- **`src/tui/store.ts`** — campo **aditivo** `readonly lastStepId?: string` em `TaskState`, preenchido em todo `step_started` e nunca limpo. Aditivo de propósito: não altera a shape de nenhum `StoreEvent` (o que quebraria o build do menubar) e não toca os consumidores de `currentStepId`.
- **`apps/menubar/src/kanban/grouper.ts`** — helper `columnIdFor()` = `currentStepId ?? lastStepId`; o `Backlog` deixa de ser fallback e volta a significar "não entrou em Step nenhum".
- **+7 testes** (3 na store, 4 no grouper) e um bloco `describe("groupByStep + detectGotoCards")` com a regressão fim-a-fim: _não_ lê conclusão de step como Desvio, _ainda_ detecta o Desvio real.

**Armadilha para quem for reimplementar:** não tente derivar a última coluna do array `task.steps`. Ele é ordenado por **primeira visita** e a revisita substitui **in-place**, então depois de um Desvio (`build → test → goto build`) o _tail_ é `test` — o Step que o goto deixou para trás. Foi por isso que o campo existe.

**Ordem obrigatória (cumprida):** o patch entrou **antes** da seção `## Kanban` do `CONTEXT.md`, que documenta o invariante corrigido — sem ele, o glossário passaria a mentir sobre o código. As duas coisas foram para o mesmo commit.

**Sobre a ressalva empírica acima:** ela era pessimista demais. A sessão da auditoria não reproduziu o disparo, mas uma sessão anterior de dogfooding **observou-o** no `dev:web` com o `MOCK_FEED` — a T-001, que só anda para frente, acendia o anel accent (`.kanban-card--goto`, `GOTO_HIGHLIGHT_MS = 2_200`, `KanbanBoard.tsx:27`). Ou seja: os dois dispatches **caem** em renders separados na prática, e o falso-positivo era real, não só teórico. O que continua não verificado é o comportamento **depois** do fix na GUI viva — a regressão está coberta por teste na função pura, não no render.

## Por que só agora virou débito

O sintoma já era conhecido de uma sessão anterior de dogfooding, mas nunca foi registrado nem corrigido. A auditoria do glossário reencontrou o mesmo bug por outro caminho — pela colisão entre a coluna `Backlog` e o termo **Backlog** — e desta vez ele ficou rastreável.
