# Plano de implementação: C-0015 — Navegação e leitura de fluxo no grafo de deps

> Companheiro do `spec.md` (mesma pasta). Narrativa, grafo de dependências, fases, checkpoints e
> riscos. A lista executável pelo motor está em `todo.md`.

## Overview

Três eixos independentes sobre o canvas de deps que a C-0013 entregou, **sem tocar o motor e sem
tocar a geometria** (AD-6): (a) a aresta passa a contar **direção** — o que alimenta a task viva
(cyan, marchando) × o que ela destrava (âmbar, parada); (b) **todo card ganha um anel na cor do seu
status**, derivado do `TASK_STATUS_META` que já pinta o dot; (c) o canvas **responde à roda do
mouse** (pan/zoom/pinch), o que hoje simplesmente não acontece.

O diff é cirúrgico e vive inteiro em `apps/menubar/src/graph/`. Um único arquivo novo
(`useShiftWheelPan.ts`) e uma reescrita localizada do bloco de anéis do `TaskNode.css` — que sai da
change **menor** do que entrou (SC7).

## Descobertas do código que moldam o plano (verificadas nesta sessão)

1. **Os defaults do React Flow v12.11.2 que a spec assume são todos reais** (conferidos em
   `apps/menubar/node_modules/@xyflow/react/dist/esm/index.js:3728`): `panActivationKeyCode =
   'Space'`, `zoomActivationKeyCode = isMacOs() ? 'Meta' : 'Control'`, `panOnScrollSpeed = 0.5`,
   `minZoom = 0.5`, `maxZoom = 2`, `preventScrolling = true`, `panOnScroll = false`. Isto sustenta
   o **D8** (não passar as duas `*ActivationKeyCode`) e o **D6** (`minZoom={0.25}` é o que libera o
   `fitView` num backlog grande). `PanOnScrollMode` é exportado **como valor** pelo `@xyflow/react`
   (não é só tipo) — `PanOnScrollMode.Free === "free"`.

2. **`DepsFlow` já vive dentro de um `<ReactFlowProvider>`** (`panes/ViewSwitcher.tsx:118`), e já
   chama `useReactFlow()` para o `fitView`. Logo `getViewport`/`setViewport` do `useShiftWheelPan`
   estão disponíveis sem nenhuma mudança de árvore — o hook mora **dentro** do `DepsFlow`.

3. **O `DepsFlow` hoje retorna o `<ReactFlow>` pelado**, e o pai já o envolve num
   `<div style={{width:"100%",height:"100%"}}>`. O wrapper `.deps-flow` (que hospeda o listener
   nativo) entra **dentro** do `DepsFlow` e precisa do `width/height: 100%` para não encolher o
   canvas.

4. **`TASK_STATUS_META` (`src/ui/StatusIndicator.tsx:33`) é exaustivo sobre os 7 status** e já é
   importado pelo `TaskNode` (é ele que dá `tone`/`hollow`/`label` ao dot). O anel deriva de
   `meta.tone` — **nenhuma prop nova**, nenhum segundo mapa, `DepsFlow` não muda por causa do anel.

5. **A classe `deps-node--running` só existe em `TaskNode.css` + `TaskNode.test.tsx`** (nada mais no
   app a consome). Ela é redundante depois do `--tone-running`: some, e as 7 permutações de
   `box-shadow` (running × selected × focus × pulse-off) colapsam numa regra base + overrides da var
   `--_ring`. O `isRunning`/`pulse-off` **continuam** — são o gatilho do pulso, não do anel.

6. **Os testes de `graph/` já mockam `@xyflow/react` inteiro e capturam as props do `<ReactFlow>`**
   (`DepsFlow.test.tsx:61`) — é exatamente o gancho da parte de navegação. O mock precisa ganhar
   `PanOnScrollMode` (valor) e `useReactFlow: () => ({ fitView, getViewport, setViewport })`, e o
   `captured` precisa passar a guardar as props de interação.

7. **O `edges` da store é `[dep, dependente]`** (`configToStore`/`orchestrator`: `edges =
   deps.map(d => [d, t.id])`), e o `computeDagreLayout` preserva isso em `{from,to}` — logo
   `e.to === "running"` é "alimenta a running" e `e.from === "running"` é "destravada pela running".
   A direção é o dado; o booleano `incident` de hoje é que estava colando as duas leituras.

## Decisões arquiteturais deste plano

- **Três fatias paralelas + uma de integração.** Arestas, anel e hook são ortogonais (arquivos
  disjuntos) e podem correr concorrentes. A quarta (props de navegação + wrapper) **integra** o hook
  e por isso é serializada.
- **Serialização por arquivo, não por conceito.** T-001 e T-004 tocam os **mesmos três arquivos**
  (`DepsFlow.tsx`, `.css`, `.test.tsx`). Sem uma aresta de dependência entre elas, o motor as
  rodaria em paralelo e o merge daria conflito real (não resolvível por rebase). Daí `T-004: Deps:
  T-001, T-003`.
- **O hook nasce antes de ser usado** (T-003 → T-004): assim ele é escrito e testado como unidade
  isolada — que é a única forma de travar a armadilha do `passive` (o teste que espiona o
  `addEventListener` é o guarda-corpo contra a regressão para `onWheelCapture`).
- **A navegação de verdade não se prova em jsdom.** O teste unitário prova o **contrato de props**
  (incluindo as duas props que *não* passamos); o comportamento vive no WKWebView. Por isso o
  checkpoint final é **humano e obrigatório**, com o roteiro de 10 itens da spec.

## Grafo de dependências

```
T-001  arestas por direção        ─┐
       (DepsFlow.tsx/.css/.test)   │
                                   ├──►  T-004  props de navegação + wrapper
T-003  useShiftWheelPan (novo)    ─┘            (DepsFlow.tsx/.css/.test)
                                                        │
T-002  anel de estado no card      (independente)       │
       (TaskNode.tsx/.css/.test)                        │
                                                        ▼
                                          Checkpoint humano (app nativo)
```

T-002 é disjunta de todas: não compartilha arquivo com ninguém e pode fechar a qualquer momento.

## Fases

### Fase 1 — Os três eixos, em paralelo (T-001 ∥ T-002 ∥ T-003)

Cada uma entrega um caminho completo e verificável por teste:

- **T-001** — a aresta conta a direção (cyan entra / âmbar sai / resto quieto; cyan vence o empate).
- **T-002** — o card carrega o status num anel (5 tones sobre os 7 status; concêntrico com a seleção;
  pulso cyan↔cinza, nunca `transparent`).
- **T-003** — o `useShiftWheelPan`, unidade isolada, correto nos dois mundos (WebKit trocando ou não
  o eixo), com `passive: false` travado por teste.

### Checkpoint: Fase 1

- [ ] `npm run typecheck && npm run lint && npm test` verdes na raiz.
- [ ] `npm test -w apps/menubar` verde — incluindo `scale.test.ts` e o teste de não-sobreposição
      **intocados** (a prova de AD-6: geometria não se mexeu).
- [ ] Zero cor literal no diff (`git diff | grep -Ei '#[0-9a-f]{3,8}|rgb\(|oklch\('` só deve casar
      dentro de `tokens.css`, que esta change **não** toca).

### Fase 2 — Integração da navegação (T-004)

O `<ReactFlow>` ganha as props de interação, o componente ganha o wrapper `.deps-flow` que monta o
hook do T-003, e o teste prova o contrato — inclusive que `panActivationKeyCode` e
`zoomActivationKeyCode` **não** são passadas (é isso que sustenta espaço+arrastar e `cmd`+zoom).

### Checkpoint: Completo — verificação humana no app nativo (obrigatória)

Roda `npm run dev -w apps/menubar` com um Run que tenha ao menos uma task `running`, uma `done` e
uma `blocked`, e confere o roteiro de 10 itens da spec (§ Testing Strategy → Manual/visual):

- [ ] roda → pan vertical; `shift`+roda → pan horizontal; `cmd`+roda → zoom no ponteiro; pinch → zoom
- [ ] espaço + clique + arrastar → pan (**não regrediu**)
- [ ] arestas: entra-na-running marchando em cyan; sai-da-running parada em âmbar; resto quieto
- [ ] anéis: cada card na cor do seu estado, **em light e dark**; o cinza `--border` do `pending`
      lê como **moldura**, não como sinal (D9) — é a maioria dos cards no início do Run
- [ ] `prefers-reduced-motion`: nada marcha; o anel do running fica **aceso e parado**
- [ ] o wheel não vaza para o app; o botão de fit enquadra um DAG grande (≥15 tasks)
- [ ] trocar Kanban↔Deps preserva pan/zoom

## Riscos e mitigações

| Risco | Impacto | Mitigação |
|---|---|---|
| **`onWheelCapture` em vez de `addEventListener` nativo** — o React 18 registra `wheel` no root como **passivo**, então `preventDefault()` num handler React é no-op **silencioso**: passa em jsdom e falha no app | Alto | O teste do T-003 **espiona o `addEventListener`** e exige `{ passive: false }`. É o único jeito de travar isso sem browser real |
| **T-001 e T-004 em paralelo** (mesmos 3 arquivos) → conflito de merge não resolvível por rebase | Alto | Aresta `T-004 → T-001` no `todo.md`. Não remover |
| **`minZoom={0.25}`** afeta o `fitView` e o alcance do zoom-out em todo o canvas | Baixo | Item 9 do checkpoint humano (DAG grande enquadra) |
| **O anel muda o visual base do card** (hoje, em light, o card não tem contorno nenhum) | Médio | Consequência aceita de D7/D9. Item 7 do checkpoint humano existe **exatamente** para confirmar que o `--border` do `pending` lê como moldura e não clareia o grafo no dark |
| **Colisão preexistente `Space`** (card focado: seleciona **e** ativa o pan do RF) | Baixo | **Já é assim hoje**; o requisito diz "continua como está". Não mexer — só saber |
| **Mock de `@xyflow/react` desatualizado** quebra os testes ao adicionar props/hooks | Baixo | T-003/T-004 estendem o mock (`PanOnScrollMode`, `getViewport`, `setViewport`) |

## Fora de escopo (não fazer)

`scale.ts` e a geometria; `view.ts`/`store.ts` e qualquer arquivo de `src/` na raiz (o **motor**);
dependência nova; auto-layout do RF; `MiniMap`; roda pura dando zoom (`zoomOnScroll` fica `false`);
anel do running pulsando até `transparent`.

## Antes de rodar o loop

O `loopy.yml` da raiz ainda aponta `inputs.spec/plan/todo` para **C-0014**. Trocar os três paths
para `.harn/devy/changes/C-0015-deps-graph-navigation/` (e o `name:`) antes do run.

## Questões em aberto

Nenhuma — o `/devy:refine` fechou D1–D10 e os defaults de implementação (§ Decisões da entrevista).
