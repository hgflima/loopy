# D-0013 — `stepId` do frame de stream é carimbado na ENTREGA, não na produção do texto

> **Status:** aberto · **Severidade:** média · **Área:** `src/index.ts` (`dispatchStreamUpdate`/`resolveTaskContext`) · consumidor: `apps/menubar/` e demais clientes do Transport
> **Descoberto em:** 2026-07-29 · **Origem:** investigação `corpos-loopy-transcript-empty` (corrigiu o lado consumidor, não mexeu no motor)

## Sintoma
Sob `--emit-events`, um chunk de stream que chega **tarde** — depois de o Step seguinte já ter emitido `step_started` — sai carimbado com o `stepId` **errado**: texto produzido pelo `implement` aparece no frame como se fosse do `settle`. O consumidor que agrupa a timeline por `stepId` põe o texto na gaveta errada.

O contrato do frame é respeitado (o campo, quando presente, é uma string válida) e o motor nunca falha por causa disso. Mas o sintoma tem **duas faces**, e só a primeira é cosmética:

1. **Carimbo errado** (o mapa já foi repovoado com o Step seguinte) — o texto aparece, sob o cabeçalho errado.
2. **Carimbo ausente** (o chunk cai na virada, entre `step_finished` e o `step_started` seguinte) — o `stepId` é omitido e o consumidor de referência **descarta** a entrada: o texto **some** da timeline. É o próprio sintoma `transcript empty` que originou a investigação.

## Causa raiz
O carimbo é um `Map.get` feito no **instante da entrega**, não no instante em que o texto foi produzido:

```ts
// src/index.ts:531-543
export function dispatchStreamUpdate(
  notification, infoFor, taskCurrentStep, agentName, dispatch,
): void {
  const update = translateUpdate(notification.update);
  if (update === undefined) return;
  const { taskId, agent } = infoFor(notification.sessionId);
  const stepId = taskCurrentStep.get(taskId);   // <-- lido AGORA, não quando o chunk nasceu
  dispatch(toStoreEvent(update, { taskId, stepId, agent: agent ?? agentName }));
}
```

`taskCurrentStep` é mantido pelo `emit` do orquestrador (`src/index.ts:778-786`): `step_started` faz `set`, `step_finished` faz `delete`. O `StreamUpdate` em si **não carrega** o Step de origem — `toStoreEvent` (`src/tui/store.ts:819-824`) só espalha o `ctx.stepId` que lhe entregam. `resolveTaskContext` (`src/index.ts:545-552`), usado no mesmo `onUpdate` para o `usage_sample`, tem exatamente a mesma leitura tardia.

O `session/update` do ACP é entregue por um handler de notificação **posterior** ao `prompt()` resolver — o motivo de `runTurn` cruzar uma macrotask (`flushSessionUpdates`, `src/acp/session.ts:494-508`) antes de fechar o turno. Essa barreira protege o **buffer de turno** (OQ3), não o carimbo do frame: um `session/update` que chega do pipe **depois** dela (o mesmo caminho pelo qual o `usage_update` assenta — `src/acp/client.ts:435`) ainda é despachado com o mapa já mexido.

**As duas janelas saem do mesmo defeito**, e nenhuma delas é "coberta por convenção":

- **Virada de Step** (entre `step_finished` e o `step_started` seguinte): o mapa está vazio, então o `stepId` é **omitido** — nunca `""`, o precedente do [D-0005](D-0005-approval-requested-frame-has-empty-taskid.md). Mas o consumidor **não** tem para onde degradar: `applyTimeline` tenta `route.stepId ?? task.currentStepId` (`apps/menubar/src/state/store-bridge.ts:342-343`) e o `currentStepId` também acabou de ser limpo pelo `reduce` no `step_finished` (`src/tui/store.ts:653-655`). Sem nenhum dos dois, o guard fail-closed **descarta a entrada** e o texto some da timeline.
- **Step seguinte já aberto**: o mapa foi repovoado, e o chunk sai com um `stepId` plausível e **errado** — pior de detectar que o campo ausente, porque nada denuncia a troca.

Agravante: das sete variantes de timeline, só três carregam `stepId` (`stream_chunk`, `tool_call`, `tool_call_update` — R7a, `src/tui/store.ts:813-817`). As outras quatro (`thought`, `plan`, `mode_changed`, `agent_update`) dependem **sempre** do `currentStepId` do consumidor, então na virada de Step elas são descartadas independentemente do que o motor carimbe.

> O docstring de `dispatchStreamUpdate` (`src/index.ts:525-526`) ainda afirma que "a GUI degrada para `task.currentStepId`" nessa janela. Não degrada — descarta. Corrigir o docstring faz parte do fix.

## Impacto
Duas coisas distintas, e por isso a severidade é **média**, não `baixa`:

- **Atribuição errada na UI** (cosmético, mas silencioso): um consumidor que agrupa stream por `stepId` mostra as últimas linhas do Step anterior sob o cabeçalho do Step seguinte. Quem lê a timeline não tem como saber que aquele texto não é do Step sob o qual ele apareceu.
- **Texto visivelmente perdido na virada de Step** (não cosmético): no consumidor entregue neste repo, o chunk sem `stepId` é descartado pelo guard fail-closed e simplesmente não aparece. Não é só "no lugar errado" — não aparece em lugar nenhum.

Não é `alta` porque **o motor não perde o dado**: o frame sai no fio com o texto íntegro, o contrato do Transport é respeitado (`stepId` é opcional) e o descarte é uma política deliberada do consumidor — um cliente que ancore a timeline de outro jeito não perde nada. Nada do que o motor decide depende desse campo: `RunLoopResult`, verdicts, checks e telemetria são indiferentes (o `reduce` da store trata as variantes ricas como no-op; o Ink não usa `stepId` de `stream_chunk`).

## Reprodução
`dispatchStreamUpdate` é exportada e pura o bastante para demonstrar sem spawnar agente:

1. Monte `taskCurrentStep = new Map([["T-001", "implement"]])`.
2. Chame `dispatchStreamUpdate(chunkDoImplement, infoFor, taskCurrentStep, "claude", dispatch)` — sai `stepId: "implement"`. ✔
3. Simule o `step_finished` aplicando o que o `emit` faria: `taskCurrentStep.delete("T-001")`. Chame de novo com **o mesmo chunk tardio do `implement`** → sai **sem** `stepId`. Alimente esse evento em `applyTimeline` com um `store` cujo `currentStepId` já foi limpo → transcript **inalterado** (entrada descartada). ✘
4. Simule agora o `step_started` do Step seguinte: `taskCurrentStep.set("T-001", "settle")`. Chame de novo com o mesmo chunk tardio → sai `stepId: "settle"`. ✘

Ao vivo: `loopy --emit-events <dir>` num pipeline com dois Steps de Agente seguidos e stream volumoso; compare a última linha de stream do Step N com o `stepId` do frame que a carrega, e confira se ela chegou a aparecer na timeline da GUI.

## Correção proposta
Carimbar na **produção**, não na entrega: capturar o `stepId` no momento em que o `session/update` é traduzido, associando o Step à **Sessão/turno** em vez de consultá-lo num mapa por-Task que muda debaixo do frame. O `sessionId` já resolve `taskId`/`agent` via `sessionToTask`; falta guardar ali o Step do turno em voo — escrito quando o step `agent` abre o turno e mantido até o turno seguinte sobrescrevê-lo, de modo que um chunk que chegue **depois** de o Step ter terminado ainda encontre o Step que o produziu.

O que **não** resolve: prender a liberação do carimbo à barreira `flushSessionUpdates`. A barreira drena as microtasks já enfileiradas, e o chunk problemático é, por construção, um `session/update` que chegou do pipe **depois** dela — soltar a entrada ali só antecipa a janela de `stepId` omitido em vez de fechá-la.

Junto do fix: corrigir o docstring de `dispatchStreamUpdate` (`src/index.ts:525-526`) e cobrir com um teste que fixe as ordens dos passos 3 e 4 acima.

## Workaround atual
**Não há workaround de consumidor para o carimbo errado.** Ancorar a timeline pelo Step corrente ditado por `step_started`/`step_finished` não ajuda: é exatamente disso que o `taskCurrentStep` do motor é feito, então o consumidor chega ao **mesmo** Step errado por outro caminho. Para o chunk tardio, os dois âncoras disponíveis concordam — e concordam errado.

O que o lado consumidor de fato consegue fazer é conviver com o carimbo **ausente**, e foi isso que a investigação `corpos-loopy-transcript-empty` endereçou (o mesmo desenho que `applyTimeline` implementa aqui): usar `stepId` do evento quando ele vem, cair para o `currentStepId` da task quando não vem, e **descartar fail-closed** quando nenhum dos dois resolve — o que evita fabricar segmento fantasma, mas paga com o texto sumido na virada de Step. Enquanto o motor não carimbar na produção, resta: (a) tratar o `stepId` do chunk como dica, não como verdade, ao investigar "de que Step é este texto?"; e (b) ler o stream bruto do log de arquivo quando a atribuição importar de verdade.

A citação inline desta entrada em `src/features/loopy/state/store-bridge.ts` do corpos entra em tarefa separada, naquele repo.
