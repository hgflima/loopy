# D-0013 — `stepId` do frame de stream é carimbado na ENTREGA, não na produção do texto

> **Status:** aberto · **Severidade:** baixa · **Área:** `src/index.ts` (`dispatchStreamUpdate`/`resolveTaskContext`) · consumidor: `apps/menubar/` e demais clientes do Transport
> **Descoberto em:** 2026-07-29 · **Origem:** investigação `corpos-loopy-transcript-empty` (corrigiu o lado consumidor, não mexeu no motor)

## Sintoma
Sob `--emit-events`, um chunk de stream que chega **tarde** — depois de o Step seguinte já ter emitido `step_started` — sai carimbado com o `stepId` **errado**: texto produzido pelo `implement` aparece no frame como se fosse do `settle`. O consumidor que agrupa a timeline por `stepId` põe o texto na gaveta errada.

Nada falha e nada some: o contrato do frame é respeitado (o campo existe e é uma string válida) e o texto continua visível. É armadilha de atribuição, não perda de dado.

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

O `session/update` do ACP é entregue por um handler de notificação **posterior** ao `prompt()` resolver — o motivo de `runTurn` cruzar uma macrotask (`flushSessionUpdates`, `src/acp/session.ts:494-508`) antes de fechar o turno. Essa barreira protege o **buffer de turno** (OQ3), não o carimbo do frame: o `dispatch` do chunk tardio ainda pode ocorrer depois de o Step seguinte ter feito `set` no mapa.

Há uma janela vizinha já coberta por convenção: entre `step_finished` e o `step_started` seguinte o mapa está vazio, então o `stepId` é **omitido** (nunca `""` — o precedente do [D-0005](D-0005-approval-requested-frame-has-empty-taskid.md)) e a GUI degrada para `task.currentStepId`. O caso ruim é o outro: o mapa já foi repovoado com o Step **seguinte**, e o chunk sai com um `stepId` plausível e errado — pior de detectar que o campo ausente.

## Impacto
Só de **atribuição na UI**: um consumidor que agrupa stream por `stepId` mostra as últimas linhas do Step anterior sob o cabeçalho do Step seguinte. O motor não lê esse campo — `RunLoopResult`, verdicts, checks e telemetria são indiferentes (o `reduce` da store trata as variantes ricas como no-op; o Ink não usa `stepId` de `stream_chunk`).

A janela é estreita (chunks in-flight na virada de Step) e o sintoma é cosmético, por isso **baixa** — mas é silencioso e enganoso: quem lê a timeline não tem como saber que aquele texto não é do Step sob o qual ele apareceu.

## Reprodução
`dispatchStreamUpdate` é exportada e pura o bastante para demonstrar sem spawnar agente:

1. Monte `taskCurrentStep = new Map([["T-001", "implement"]])`.
2. Chame `dispatchStreamUpdate(chunkDoImplement, infoFor, taskCurrentStep, "claude", dispatch)` — sai `stepId: "implement"`. ✔
3. Simule a virada de Step aplicando o que o `emit` faria: `taskCurrentStep.delete("T-001")` (step_finished) e depois `taskCurrentStep.set("T-001", "settle")` (step_started).
4. Chame de novo com **o mesmo chunk tardio do `implement`** → sai `stepId: "settle"`. ✘

Ao vivo: `loopy --emit-events <dir>` num pipeline com dois Steps de Agente seguidos e stream volumoso; compare a última linha de stream do Step N com o `stepId` do frame que a carrega.

## Correção proposta
Carimbar na **produção**, não na entrega: capturar o `stepId` no momento em que o `session/update` é traduzido para o turno corrente — isto é, associar o Step à **Sessão/turno** (o `sessionId` já resolve `taskId`/`agent` via `sessionToTask`; falta o Step do turno em voo) em vez de consultar um mapa por-Task que muda debaixo do frame. Alternativa mais barata: o step `agent` registra `taskId → stepId` ao **abrir** o turno e só libera a entrada depois da barreira `flushSessionUpdates`, de modo que chunk tardio ainda encontre o Step que o produziu. Vale um teste sobre `dispatchStreamUpdate` fixando a ordem do passo 3 acima.

## Workaround atual
No consumidor: não confiar no `stepId` do frame como âncora forte de agrupamento — ancorar a timeline pelo Step corrente que os eventos `step_started`/`step_finished` já ditam, e tratar o `stepId` do chunk como dica. Foi o caminho tomado na investigação `corpos-loopy-transcript-empty` (a citação inline desta entrada em `src/features/loopy/state/store-bridge.ts` do corpos entra em tarefa separada, naquele repo).
