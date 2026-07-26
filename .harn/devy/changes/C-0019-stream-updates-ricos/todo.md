# Backlog: C-0019 — Stream rico, `session/update` semântico na tela

> Consumido pelo motor (`- [ ]` pendente / `- [x]` concluída; id `T-\d+`; corpo indentado).
> Narrativa, grafo de dependências, checkpoints e riscos: ver `plan.md` (mesma pasta);
> as decisões D1–D9, o refine R1–R7 e os conflitos C1–C3, em `spec.md`. **Não re-litigar.**
>
> **Três arestas existem só para serializar merge, não por lógica — não remover:**
> `T-011→T-007` (ambas mexem em `apps/menubar/package.json`), `T-010→T-009` (ambas
> exportam em `apps/menubar/src/ui/index.ts`), `T-016→T-012,T-014` (docs do código final).
>
> **Invariantes desta change:** o motor **traduz**, a GUI **renderiza** — a shape do ACP
> nunca passa do boundary, e a GUI jamais importa `@agentclientprotocol/sdk`; a timeline
> acumula **só na GUI** (R4); **uma** implementação da mescla (`mergeToolCall`, R2); nada
> de `session/update` cai no vazio (D3); `stream_chunk` só **ganha campos opcionais** (R3);
> cor de ferramenta **só no glifo**, status no pill (C1); nunca `rehype-raw`; nunca
> streamar `agent_message_chunk` na Entrevista (R1); erro é valor nas fronteiras (AD-5).
>
> **Formatação:** `prettier --write` **apenas** em arquivo NOVO — o repo está fora de
> sincronia e reformatar um arquivo existente altera código alheio; valide suas linhas
> por diff. `cargo fmt` só no arquivo tocado (`rustfmt --check src/sidecar.rs`).
>
> Cada linha `Deps:` fica **isolada, ids limpos, sem ponto final** (bug D-0001 do `parseDeps`).

## Fase 1 — Fundação: contrato de fio, tradução e o framer

- [x] T-001: Contrato — `StreamUpdate`/`StreamItem`/`mergeToolCall` + 6 eventos + `agent_stream`
    `src/tui/store.ts` (subpath export `@hgflima/loopy/tui/store`, **browser-safe** — nada de
    `node:`) ganha o vocabulário inteiro da change, e `src/tui/transport.ts` o control frame
    da Entrevista. É a fundação: quinze tasks compilam contra isto.
    **Tipos:** `ToolKindName` (os 10 do SDK: read/edit/delete/move/search/execute/think/
    fetch/switch_mode/other), `ToolCallStatusName` (pending/in_progress/completed/failed),
    `ToolLocation {path, line?}`, `ToolContentItem` (`text` | `diff {path,oldText?,newText}`
    | `terminal {terminalId}` | `raw {payload}` — a variante `raw` existe para image/audio/
    resource **não sumirem**, D3), `ToolCallState` (toolCallId, title, kind, status,
    locations, content, rawInput?, rawOutput?), `ToolCallDelta` (mesma forma, tudo opcional
    menos `toolCallId`), `PlanEntryState {content, priority, status}`.
    **`StreamUpdate`** — o que UM `session/update` virou, já sem a shape do ACP:
    `text` | `thought` (ambos com `text` e `messageId?`) | `tool_call {call}` |
    `tool_delta {delta}` | `plan {entries}` | `mode {modeId}` | `raw {updateKind, payload}`.
    **`StreamItem`** — o item RENDERIZÁVEL: `text` | `thought` | `tool {call}` | `plan` |
    `mode` | `raw {kind, payload}` | `elided {count}` (R6: o marcador de corte do ring).
    **`mergeToolCall(current, delta): ToolCallState`** — PURA (AD-6, R2): campo `null`/
    `undefined` no delta significa "não mexi", **nunca** "apague"; `content` e `locations`
    **substituem** (não concatenam) quando presentes; `kind`/`status` que só chegam no
    update são adotados; `current === undefined` produz um card com defaults
    (`kind:"other"`, `status:"pending"`, title = `delta.title ?? toolCallId`). Ela mora
    aqui, e **não** em `stream-history.ts`, porque os DOIS redutores da GUI a importam.
    **`toStoreEvent(update, {taskId, stepId?, agent?}): StoreEvent`** — pura, o carimbo que
    o `onUpdate` do Run aplica.
    **Seis `StoreEvent` novos** (todos com `taskId` e `agent?`; os de tool também `stepId?`
    — R7a): `tool_call`, `tool_call_update`, `thought_chunk`, `plan`, `mode_changed`,
    `agent_update` (o catch-all de C2). **`stream_chunk` ganha `stepId?` e `messageId?`** —
    dois campos **opcionais**, aditivos (R3): o texto NÃO ganha evento próprio.
    **`reduce` trata os seis como no-op explícito** (`return state` + comentário citando a
    R4): a timeline acumula na GUI, e o `StoreState` continua descrevendo o turno corrente.
    O `switch` de `reduce` **não tem `default`** — é o alarme desejado: a união crescer sem
    cases derruba o `typecheck`. Consequência boa e **deliberada**: `line-reporter.ts:90`
    filtra pelo mesmo `next === state`, então o Ink **não ganha um único `case`** (D1) e
    segue byte-idêntico. Não "consertar" o fan-out de `start.ts:119` — ele emite ao
    transport **incondicionalmente**, que é como os eventos novos chegam à GUI.
    `src/tui/transport.ts`: `ControlFrame` ganha
    `{ control: "agent_stream"; phase: Phase; update: StreamUpdate }`. Carrega
    `StreamUpdate` (não `StreamItem`) porque produzir um `ToolCallState` completo exigiria
    memória no motor — o que a R2 proíbe; a R7b não muda, muda o tipo que a cumpre (ver
    `plan.md` §Architecture Decisions 3). `parseTransportLine` **não muda** (é genérico).
    `applyControl` do app já tem `default: return ui` (C-0018 T-001) — **não mexer**.
    Acceptance: `mergeToolCall` preserva o valor anterior para campo `null`/`undefined`,
    substitui `content`, adota `kind` que só chega no update, e é pura (mesma entrada,
    mesma saída, sem mutar `current`); os 6 eventos novos fazem round-trip
    `createEventTransport` → `parseTransportLine` sem perder campo; `agent_stream` idem;
    `reduce` devolve a **mesma referência** para os 6 (structural sharing); `stream_chunk`
    **sem** `stepId`/`messageId` continua reduzindo exatamente como antes.
    Verification: `npm test -- tests/tui/store.test.ts tests/tui/transport.test.ts tests/tui/line-reporter.test.ts && npm run typecheck && npm run lint`
    Files: src/tui/store.ts, src/tui/transport.ts, tests/tui/store.test.ts, tests/tui/transport.test.ts
    Size: M
    Risk: H

- [x] T-002: Tradutor puro `SessionUpdate → StreamUpdate` no boundary ACP
    `src/acp/client.ts` ganha `translateUpdate(update: SessionUpdate): StreamUpdate | undefined`
    — **pura**, irmã de `agentChunkText`/`usageUpdateUsed`, que já moram lá. É o **único**
    lugar novo que conhece a shape do ACP; a partir daqui só trafega vocabulário do motor.
    `switch` **exaustivo** sobre `update.sessionUpdate` com `default` mandando `raw` — assim
    um tipo novo do SDK **aparece na tela** em vez de sumir (D3), e o `tsc` avisa quando a
    união cresce. O SDK 0.29 declara **13** variantes; o mapa é:
    `agent_message_chunk` → `text` (só `content.type === "text"`; outro tipo de content →
    `raw`); `agent_thought_chunk` → `thought`; `tool_call` → `tool_call`;
    `tool_call_update` → `tool_delta`; `plan` → `plan`; `current_mode_update` → `mode`;
    `usage_update` → **`undefined`** (ele já tem caminho próprio, `usageUpdateUsed` →
    `usage_sample`; documentar no docstring que isto não é um descarte).
    Os **seis** restantes caem em `raw` por decisão (R7d): `plan_update` e `plan_removed`
    (marcados UNSTABLE/@experimental no próprio SDK), `available_commands_update`,
    `config_option_update`, `session_info_update` e `user_message_chunk`.
    `messageId` do `ContentChunk` viaja em `text`/`thought` — é ele que fecha blocos de
    mensagem do lado da GUI (chunks da mesma mensagem compartilham o id).
    `ToolCallContent` do ACP → `ToolContentItem`: `content` com `type:"text"` → `text`;
    `diff` → `diff` (`oldText` nulo/ausente = arquivo novo, preservar como `undefined`);
    `terminal` → `terminal`; qualquer outro content block → `raw`.
    **Não tocar** `agentChunkText`, `usageUpdateUsed`, `usageUpdateCost` nem
    `acpTrafficSummary`: continuam como estão, e o evento `acp_traffic` também (o painel de
    tráfego **não** volta).
    Acceptance: cada um dos 13 `sessionUpdate` produz o `StreamUpdate` esperado; os seis de
    R7d produzem `raw` com o `updateKind` correto; um `sessionUpdate` **inventado** produz
    `raw` sem lançar; `usage_update` devolve `undefined`; nenhum caso lança; a função não
    muta o `update` recebido.
    Verification: `npm test -- tests/acp/client.test.ts && npm run typecheck`
    Deps: T-001
    Files: src/acp/client.ts, tests/acp/client.test.ts
    Size: S
    Risk: M

- [x] T-003: `onUpdate` do Run deixa de filtrar — despacha tudo, carimbado por Step
    `src/index.ts` (~`:595-615`): o `onUpdate` passado ao `openAgent` hoje despacha só
    `stream_chunk` (texto) e `usage_sample`, e joga fora os outros onze updates. Passa a
    chamar `translateUpdate` (T-002) e, quando devolve um `StreamUpdate`, despachar
    `toStoreEvent(update, ctx)` (T-001).
    O contexto sai do que já existe no arquivo, **sem estrutura nova**: `infoFor(sessionId)`
    dá `{taskId, agent}` (`:560-563`) e o mapa `taskCurrentStep` (`:552-555`) dá o `stepId`
    — ele já é mantido pelo stream de eventos e já carimba o `usage_sample`. Sem `stepId` no
    card, o divisor por Step do `StreamPanel` separaria só a prosa (R7a).
    O `stream_chunk` continua sendo emitido **como sempre**, agora com `stepId`/`messageId`
    quando existirem — `stepId` ausente (task entre dois Steps) é legítimo e a GUI degrada
    para `task.currentStepId`.
    O caminho do `usage_sample` **não muda** (`usageUpdateUsed` continua sendo consultado
    em paralelo, como hoje). O `onTraffic` **não muda**.
    Acceptance: um `tool_call` no `onUpdate` vira um `StoreEvent` `tool_call` com `taskId`,
    `stepId` e `agent` corretos; sem `stepId` conhecido o evento sai sem o campo (não com
    string vazia — o D-0005 é o precedente do que não fazer); `usage_sample` continua
    saindo exatamente como antes; sem `--emit-events` e sem GUI, `RunLoopResult` é
    **byte-idêntico** (AD-1).
    Verification: `npm test && npm run typecheck && npm run lint`
    Deps: T-002
    Files: src/index.ts, tests/cli/run.test.ts
    Size: S
    Risk: M

- [x] T-004: `LineFramer` linear — matar a cliff quadrática do framer (C3)
    `apps/menubar/src-tauri/src/sidecar.rs:~139`: `feed()` procura o `\n` com
    `self.buf.iter().position(...)`, varrendo **o buffer acumulado inteiro a cada chunk de
    4 KB** (`:~324`). Enquanto a linha não fecha o custo é O(N²/4096): uma linha de 40 MB —
    um `rawOutput` de build, plausível com 4 tasks concorrentes — dá ~2×10¹¹ comparações de
    byte. O pipe **congela**, não "fica lento".
    Fix de ~3 linhas: guardar o offset já varrido (`scanned: usize`) e retomar a busca dali
    (`self.buf[self.scanned..].iter().position(...)`, somando `self.scanned` ao índice);
    zerar o offset ao `drain` de uma linha completa e ao `flush`. O `\r\n` opcional e o
    comportamento de `flush` continuam idênticos.
    **O limite de payload continua inexistente** — a D6 é preservada integralmente; some só
    a cliff quadrática.
    Vale para o Sidecar **e** para o Processo de Entrevista: `interview_process.rs` reusa
    `emit_lines`/`LineFramer` de propósito (`interview_process.rs:14,24`).
    `cargo fmt` **só neste arquivo** (`rustfmt --check src/sidecar.rs`) — o `src-tauri` está
    fora de sincronia e um fmt global reformata Rust alheio.
    **A linearidade é provada pelo INVARIANTE, não pelo relógio.** Nada de `Instant::now()`
    no teste: um limite de tempo é um teste que um dia pisca vermelho na CI por outro motivo.
    O que se assere é o mecanismo — `scanned` avança com o buffer e **nunca** reinicia do
    zero enquanto a linha não fecha, e zera quando ela fecha. O `#[cfg(test)] mod tests` já
    mora no próprio `sidecar.rs` (`:367`), então alcança os campos privados.
    Acceptance: dois `feed` de 4 KB sem `\n` deixam `scanned == 8192` (o segundo **não**
    revarre os 4 KB do primeiro), e o `feed` que fecha a linha zera o offset; uma linha de
    10 MB entregue em chunks de 4 KB é framada como **uma** linha, com o tamanho exato e
    nenhum byte perdido ou duplicado; linha partida entre chunks, `\r\n`, múltiplas linhas
    num chunk e `flush` de linha sem terminador continuam exatamente como antes (os dois
    testes que já existem em `interview_process.rs` seguem verdes, sem edição).
    Verification: `cargo test --manifest-path apps/menubar/src-tauri/Cargo.toml`
    Files: apps/menubar/src-tauri/src/sidecar.rs
    Size: XS
    Risk: M

## Fase 2 — Acumulação na GUI: a timeline e o ring

- [x] T-005: `stream-history.ts` — timeline de `StreamItem[]`, ring e o marcador `elided`
    `apps/menubar/src/state/stream-history.ts` deixa de acumular texto e passa a acumular
    itens. **Puro** (AD-6), sem React, sem I/O.
    **A função central, usada pelos DOIS redutores:**
    `appendStreamItem(items, update: StreamUpdate, cap = TIMELINE_CAP): readonly StreamItem[]`.
    Ela sabe as quatro regras que ninguém deve reimplementar:
    (a) `tool_delta` acha o card por **`toolCallId`**, não por adjacência — updates chegam
    intercalados com texto do agente e ainda assim voltam ao card certo — e aplica
    `mergeToolCall` **importada de `loopy/tui/store`** (R2: reescrever a mescla é o
    anti-pattern nº 1 deste app);
    (b) delta cujo `toolCallId` não existe na lista **não fabrica card** (é descartado);
    (c) `text`/`thought` com o **mesmo `messageId`** do item imediatamente anterior
    concatenam nele em vez de criar outro item (é o que preserva a memoização do
    `MarkdownStream`); `messageId` diferente, ou ausente, abre item novo;
    (d) ao passar de `cap` (**`TIMELINE_CAP = 500`**, R6) o item mais antigo sai e um item
    `{item:"elided", count}` no **topo** soma quantos sumiram — a lista pode encolher, mas
    **não** pode mentir. O `elided` nunca é contado como item cortável nem duplicado.
    Precedentes de doutrina no motor: `ACP_LOG_CAP` (200), `WARNINGS_CAP` (50).
    **A `TranscriptEntry` evolui, não é substituída:** `text: string` → `item: StreamItem`,
    mantendo `stepId` e a telemetria (`agent`/`model`/`usedTokens`/`size`). `StreamSegment`
    idem: `text: string` → `items: readonly StreamItem[]`. `segmentsFor` mantém o
    agrupamento por Step **exatamente** como hoje (contíguos com o mesmo `stepId` viram um
    segmento; o Step que reaparece depois de um Desvio vira segmento separado) e
    `overlayStepUsage` fica intacto — ele corrige um bug real (o `usage_sample` chega
    **depois** dos chunks, então o snapshot do transcript tem `usedTokens: undefined`).
    Acceptance: `tool_call` + dois `tool_delta` intercalados com `text` produzem **um** card
    com o estado final mesclado; delta órfão é descartado sem criar item; dois `text` com o
    mesmo `messageId` viram um item, com `messageId` diferente viram dois; ao ultrapassar
    `cap`, o mais antigo some **e** o `elided` do topo mostra a contagem certa (e não
    duplica ao cortar de novo); `segmentsFor` continua agrupando por Step e
    `overlayStepUsage` continua sobrepondo a telemetria viva.
    Verification: `npm test -w apps/menubar -- stream-history && npm run typecheck`
    Deps: T-001
    Files: apps/menubar/src/state/stream-history.ts, apps/menubar/src/state/stream-history.test.ts
    Size: M
    Risk: M

- [ ] T-006: `applyTimeline` — o transcript vira um redutor irmão do `reduce`
    **Esta é a armadilha nº 1 da change, e ela é mais sutil do que "reordenar".**
    `apps/menubar/src/state/store-bridge.ts:145-146` faz
    `const nextStore = reduce(...); if (nextStore === state.store) return state;` e **só
    depois** acumula o `stream_chunk`. Esse `if` faz **duas** coisas, e só uma é óbvia:
    (a) structural sharing — nada mudou, mesma referência, o React não reconcilia; e
    (b) **validação de graça** — o `reduce` devolve a mesma referência quando o evento é
    para uma task **não registrada** (ou um step sem `step_started`), e o guard herda essa
    validação sem escrevê-la.
    Até aqui "o `reduce` ignorou" e "não há nada a acumular" eram a **mesma** coisa. Com os
    seis eventos novos sendo no-op **por decisão** (R4, T-001), passam a ser coisas
    diferentes — e o guard, que não sabe distinguir, descarta as duas. A falha é 100%
    silenciosa: compila, roda, tela vazia. Quem reordenar ingenuamente troca um bug por
    outro: ganha a timeline e **perde** a validação, e um `tool_call` de task fantasma passa
    a criar entrada no transcript.
    **A forma:** o transcript vira um redutor **puro** irmão do `reduce`, com no-op próprio,
    e o guard passa a exigir que os dois não tenham mudado. É a estrutura que o arquivo já
    tem — `store` e `ui` já são sub-estados com redutores separados; `transcript` era o
    único enfiado no meio do outro:
    `const nextStore = reduce(state.store, ev)` →
    `const nextTx = applyTimeline(state.transcript, ev, nextStore)` →
    `if (nextStore === state.store && nextTx === state.transcript) return state`.
    `applyTimeline(transcript, event, store)` é **pura**, testada isolada e **fail-closed**:
    task ausente de `store.tasks` → devolve o **mesmo** transcript (a validação, agora
    explícita em vez de herdada por acidente).
    O roteamento dentro dela: `stream_chunk` → `{kind:"text"}`; `thought_chunk` →
    `{kind:"thought"}`; `tool_call` → `{kind:"tool_call"}`; `tool_call_update` →
    `{kind:"tool_delta"}`; `plan`/`mode_changed`/`agent_update` → os `StreamUpdate`
    correspondentes; qualquer outro `StoreEvent` → **mesma referência**. Cada um vira uma
    `TranscriptEntry` via `appendStreamItem` (T-005), taggeada pelo `stepId` **do evento** e,
    na ausência dele (agente/motor antigo), pelo `task.currentStepId` — o caminho de hoje,
    que continua funcionando. A telemetria por entrada (`agent`/`model`/`usedTokens`/`size`)
    continua derivada do step em `nextStore`, como hoje.
    `applyControl` **não muda**: os controls da Entrevista (incluindo `agent_stream`) não
    pertencem ao `BridgeState` do Run — o `default: return ui` já os ignora.
    Acceptance: um `tool_call` para task registrada **cresce** o transcript mesmo com
    `reduce` devolvendo a mesma referência (é O teste da armadilha — sem ele a falha é
    invisível); um evento de timeline para task **não registrada** devolve a **mesma**
    referência de `BridgeState` (fail-closed, agora por `applyTimeline` e não por acidente);
    um evento que não é de timeline (ex. `check_started`) devolve o **mesmo** transcript;
    `stream_chunk` sem `stepId` continua caindo no `currentStepId`; linha malformada e frame
    `command` continuam devolvendo a mesma referência.
    Verification: `npm test -w apps/menubar -- store-bridge && npm run typecheck`
    Deps: T-005
    Files: apps/menubar/src/state/store-bridge.ts, apps/menubar/src/state/store-bridge.test.ts
    Size: S
    Risk: H

## Fase 3 — Vocabulário visual: hunks, hues, glifos e os componentes

- [ ] T-007: `diff-hunks.ts` — hunks de verdade a partir de `oldText`/`newText` (jsdiff)
    O tipo `Diff` do ACP é `{ path, oldText?, newText }` — **não** existe hunk, sinal nem
    número de linha no protocolo. Sem algoritmo, o `+`/`−` do Critério 2 é impossível; a
    referência (`acp-inspector`) pinta o arquivo velho inteiro de vermelho e o novo inteiro
    de verde, o que numa edição de 3 linhas num arquivo de 2.000 são 4.000 linhas coloridas.
    **Dependência nova nº 1 (R5):** `diff` (jsdiff), MIT, no workspace `apps/menubar`.
    Myers com corte de prefixo/sufixo é o que a lib faz bem e um LCS caseiro faz mal.
    `apps/menubar/src/ui/diff-hunks.ts` — **puro** (AD-6): recebe `oldText`/`newText` e
    devolve hunks com ~3 linhas de contexto, via `diffLines`. Arquivo novo (`oldText`
    ausente ou nulo) é **um** hunk, todo adição. Cada linha do hunk carrega o sinal
    (`add`/`del`/`ctx`) e os números de linha de cada lado.
    Se o `vitest.config.ts` do app precisar de `inline` para `diff` (como já faz para
    `react-markdown`), acrescentar — é o padrão conhecido das duas cópias de React.
    Nenhuma dependência entra no **motor** (a spec é explícita: zero dep nova lá).
    Acceptance: 3 linhas trocadas num arquivo de 2.000 produzem **1** hunk com contexto —
    não 4.000 linhas coloridas; `oldText` ausente vira um hunk todo-adição; arquivo sem
    newline final não quebra; textos idênticos produzem **zero** hunks; a função é pura e
    não lança para entrada vazia dos dois lados.
    Verification: `npm test -w apps/menubar -- diff-hunks && npm run typecheck`
    Deps: T-001
    Files: apps/menubar/package.json, apps/menubar/src/ui/diff-hunks.ts, apps/menubar/src/ui/diff-hunks.test.ts, apps/menubar/vitest.config.ts
    Size: S
    Risk: M

- [ ] T-008: Vocabulário de ferramenta — 5 hues de família, 2 heranças e 7 glifos (C1)
    O `DESIGN.md` reserva cinco hues de estado (accent 352, failed 28, blocked 75, done 150,
    running 210) e exige ~35° de separação — a regra que impede "failed" de ler como
    "interativo". Medindo os intervalos livres na roda, **dez** `ToolKind` distintos não
    cabem. O `kind` mapeia então por **família de intenção**:
    `apps/menubar/src/ui/tokens.css` — cinco tokens novos, light/dark:
    `--tool-read` (read, search, fetch) `oklch(0.55 0.15 240)` / `oklch(0.74 0.13 240)`;
    `--tool-write` (edit, move) `oklch(0.55 0.14 112)` / `oklch(0.74 0.13 112)`;
    `--tool-exec` (execute) `oklch(0.55 0.12 180)` / `oklch(0.74 0.11 180)`;
    `--tool-think` (think) `oklch(0.55 0.15 270)` / `oklch(0.74 0.14 270)`;
    `--tool-mode` (switch_mode) `oklch(0.55 0.15 322)` / `oklch(0.74 0.14 322)`;
    mais **duas heranças**: `--tool-danger` (delete) herda `--state-failed-ink` — não é
    colisão, é a semântica certa: destruição é a cor de perigo — e `--tool-other` (other)
    herda `--ink-tertiary`, mantendo o vocabulário pequeno.
    **A regra que segura tudo:** a cor de ferramenta vive **só no traço do ícone**. Nunca
    vira fill, tint, borda ou pill. O que ocupa fill/pill continua sendo o **status**, nos
    hues que já existem. Assim a distinção não depende de hue: depende de **forma** (glifo ×
    pill), e sobrevive a daltonismo — que é o que o `DESIGN.md` já exige.
    `apps/menubar/src/ui/tool-kind.ts` — **puro**: `kind → {família, token, ícone, rótulo}`,
    com `other` como default para qualquer `kind` desconhecido (nunca lançar).
    `apps/menubar/src/ui/icons.tsx` — **sete** glifos SVG inline novos (leitura, escrita,
    execução, raciocínio, governo, destrutivo, outro), seguindo o padrão que já existe ali:
    16×16, `currentColor`, `aria-hidden`, `IconSvg` compartilhado, stroke da mesma família.
    **Sem `lucide-react`** — o portão de dependências continua fechado (são duas: `diff` e
    `rehype-highlight`, e nenhuma delas é esta).
    Acceptance: os 10 `ToolKind` do SDK mapeiam nas 7 famílias sem sobra; um `kind`
    desconhecido cai em `other` sem lançar; os sete ícones renderizam com `currentColor` e
    `aria-hidden`; nenhum token novo é usado como fill/borda em CSS (grep no diff).
    Verification: `npm test -w apps/menubar -- "tool-kind|icons" && npm run typecheck`
    Deps: T-001
    Files: apps/menubar/src/ui/tokens.css, apps/menubar/src/ui/tool-kind.ts, apps/menubar/src/ui/tool-kind.test.ts, apps/menubar/src/ui/icons.tsx, apps/menubar/src/ui/icons.test.tsx
    Size: M
    Risk: L

- [ ] T-009: `ToolCallCard` + `DiffView` — o card e o diff pintado
    `apps/menubar/src/ui/ToolCallCard.tsx` (novo): renderiza um `ToolCallState`. Glifo da
    família no traço colorido (T-008) + título + **pill de status** (`pending`/`in_progress`/
    `completed`/`failed`) nos hues de estado que já existem, + `locations` quando houver.
    `content`, `rawInput` e `rawOutput` nascem dentro de `<details>` **fechado**, então um
    payload gigante nunca é pintado até alguém pedir; o card leva `content-visibility: auto`
    para o custo de layout também ficar sob demanda (mitigação de C3 **no render** — o
    Transport continua mandando tudo, D6).
    O status transiciona **sozinho** conforme os `tool_call_update` chegam (é o Critério 1
    da spec) — o componente é burro: só desenha o `ToolCallState` que recebe.
    `apps/menubar/src/ui/DiffView.tsx` (novo): consome os hunks de `diff-hunks.ts` (T-007) e
    **só pinta** — `+`/`−` com as cores de done/failed já existentes, número de linha em
    `data` mono, contexto em `ink-secondary`. Nenhum cálculo aqui.
    Ambos exportados pelo barril `apps/menubar/src/ui/index.ts`.
    Estilos em CSS próprio, com tokens — **nenhuma cor literal**.
    Acceptance: o card mostra pill diferente para cada um dos 4 status; a cor da família
    aparece **só** no glifo (nenhum fill/borda/pill colorido por `kind` — C1); `content`,
    `rawInput` e `rawOutput` nascem em `<details>` fechado; um `ToolCallState` sem `content`
    não renderiza disclosure vazio; `DiffView` pinta só os hunks recebidos, com `+`/`−`
    legíveis nos dois temas.
    Verification: `npm test -w apps/menubar -- "ToolCallCard|DiffView" && npm run typecheck`
    Deps: T-007, T-008
    Files: apps/menubar/src/ui/ToolCallCard.tsx, apps/menubar/src/ui/ToolCallCard.css, apps/menubar/src/ui/ToolCallCard.test.tsx, apps/menubar/src/ui/DiffView.tsx, apps/menubar/src/ui/DiffView.test.tsx, apps/menubar/src/ui/index.ts
    Size: M
    Risk: M

- [ ] T-010: `ThoughtBlock`, `PlanBlock`, `RawUpdateRow` e o despachante `StreamTimeline`
    Os três blocos restantes, mais a peça que impede o Run e a Entrevista de divergirem.
    `ThoughtBlock.tsx` (novo): pensamento **colapsado por padrão**, com contador
    (`Pensando · N parágrafos`), abrindo por clique (D7). Nasce fechado — é o default, não
    uma preferência persistida.
    `PlanBlock.tsx` (novo): o plano do turno — as `PlanEntryState` com status
    (pending/in_progress/completed) e prioridade.
    `RawUpdateRow.tsx` (novo): o fallback de C2/D3 — uma linha com o `kind` e o JSON atrás
    de um `<details>` **fechado**. É onde caem os seis tipos de R7d, incluindo o
    `user_message_chunk` (que, na Entrevista, é o nosso Envelope voltando: fica visível para
    quem abrir, invisível para quem só olha).
    `StreamTimeline.tsx` (novo): recebe `items: readonly StreamItem[]` e despacha por
    `item` — `text` → `MarkdownStream`, `thought` → `ThoughtBlock`, `tool` → `ToolCallCard`,
    `plan` → `PlanBlock`, `mode` → linha simples, `raw` → `RawUpdateRow`, `elided` → o
    marcador de corte ("N itens anteriores omitidos"). **A ordem da timeline é a ordem de
    chegada** — o Transport é NDJSON, uma linha por evento, e texto e cards se intercalam
    sem precisar de campo de sequência.
    Este é o **único** componente que o `StreamPanel` (T-012) e a `ActivityLine` (T-014)
    montam: um tipo, dois canais, um componente React.
    Todos exportados pelo barril `apps/menubar/src/ui/index.ts` (é por isso que esta task
    depende da T-009: as duas editam o mesmo barril).
    Acceptance: o pensamento nasce **fechado** e abre por clique, com a contagem certa de
    parágrafos; `RawUpdateRow` mostra o `kind` e esconde o JSON num `<details>` fechado; um
    `StreamItem` com `item` desconhecido **não quebra a lista** (degrada para `raw`);
    `elided` renderiza a contagem; a ordem renderizada é a ordem do array.
    Verification: `npm test -w apps/menubar -- "ThoughtBlock|PlanBlock|RawUpdateRow|StreamTimeline" && npm run typecheck`
    Deps: T-009
    Files: apps/menubar/src/ui/ThoughtBlock.tsx, apps/menubar/src/ui/PlanBlock.tsx, apps/menubar/src/ui/RawUpdateRow.tsx, apps/menubar/src/ui/StreamTimeline.tsx, apps/menubar/src/ui/StreamTimeline.css, apps/menubar/src/ui/StreamTimeline.test.tsx, apps/menubar/src/ui/index.ts
    Size: M
    Risk: M

- [ ] T-011: Realce de código — `rehype-highlight` sobre os tokens OKLCH
    **Dependência nova nº 2:** `rehype-highlight` (+ `highlight.js` transitivo), no workspace
    `apps/menubar`. Escolhida por ser **síncrona**: o texto chega em streaming e re-realça a
    cada chunk; um pipeline assíncrono (Shiki, `rehype-starry-night`) exigiria `MarkdownHooks`
    e debounce. `react-markdown` expõe `rehypePlugins` exatamente para isto.
    `apps/menubar/src/ui/MarkdownStream.tsx`: acrescentar `rehypePlugins={[rehypeHighlight]}`.
    Conjunto de linguagens: o **`common`** default, **sem curadoria** (R7e) — o custo é disco
    num app empacotado, e curar arrisca um bloco sair sem realce.
    `apps/menubar/src/ui/MarkdownStream.css`: o tema é **CSS puro**, mapeando as classes
    `hljs-*` nos tokens OKLCH existentes. **Não** importar folha de tema do highlight.js — as
    paletas dele são hex fixo e violariam o design system nos dois temas.
    **Nunca adicionar `rehype-raw`**: sem ele, HTML embutido no output do agente vira texto.
    Essa é a barreira de XSS do app, e o conteúdo vem de um agente.
    A memoização por segmento (`\n\n`) e o `splitSentences` continuam como estão.
    Se o `vitest.config.ts` precisar de `inline` para `rehype-highlight`, acrescentar.
    Esta task **espera a T-007** só para serializar o `package.json` (as duas deps novas).
    Acceptance: um bloco ```` ```ts ```` sai com classes `hljs-*` no DOM; texto sem bloco de
    código renderiza byte-idêntico ao de hoje; nenhuma folha de tema do highlight.js é
    importada (grep); `rehype-raw` **não** está presente; HTML embutido continua saindo como
    texto; o realce é legível e AA nos dois temas (verificação visual registrada no
    `DESIGN.md` pela T-016).
    Verification: `npm test -w apps/menubar -- MarkdownStream && npm run typecheck`
    Deps: T-007
    Files: apps/menubar/package.json, apps/menubar/src/ui/MarkdownStream.tsx, apps/menubar/src/ui/MarkdownStream.css, apps/menubar/src/ui/MarkdownStream.test.tsx, apps/menubar/vitest.config.ts
    Size: S
    Risk: M

## Fase 4 — As duas telas

- [ ] T-012: `StreamPanel` renderiza a timeline, não uma string
    `apps/menubar/src/panes/StreamPanel.tsx`: cada `StreamSegment` deixa de renderizar
    `<MarkdownStream text={seg.text}>` e passa a renderizar `<StreamTimeline items={seg.items}>`
    (T-010). Tudo o mais do painel **sobrevive intacto**: o fold, o teto de 4 colunas com o
    chip "＋N rodando", o `StepDivider` rotulado com agente e uso, e o **auto-stick scroll**
    (que continua colando no fim quando o usuário está ancorado lá).
    `streamColumns` continua compondo `overlayStepUsage(segmentsFor(...), task.steps)` — a
    telemetria viva por Step segue autoritativa sobre o snapshot.
    Não virtualizar a lista: é change própria (spec §Fora de escopo). As mitigações baratas
    já estão de pé — `content-visibility: auto` no card (T-009) e o ring com teto (T-005).
    Acceptance: uma task rodando mostra cards e prosa **intercalados na ordem de chegada**;
    o divisor por Step continua separando os segmentos; o auto-stick continua colando no fim;
    com o teto estourado, a coluna mostra o marcador de corte e o app segue fluido; o
    placeholder de "nenhuma task rodando" continua aparecendo.
    Verification: `npm test -w apps/menubar -- StreamPanel && npm test -w apps/menubar && npm run typecheck`
    Deps: T-006, T-010, T-011
    Files: apps/menubar/src/panes/StreamPanel.tsx, apps/menubar/src/panes/StreamPanel.css, apps/menubar/src/panes/StreamPanel.test.tsx
    Size: S
    Risk: M

- [ ] T-013: Entrevista no motor — `onUpdate` filtrado e o control `agent_stream` (R1)
    `src/interview/run.ts`: o `defaultOpenSession` passa a dar um `onUpdate` ao `openAgent`,
    que **filtra `agent_message_chunk`** e emite os demais como
    `{ control: "agent_stream", phase, update }` (o frame de T-001) via
    `transport.emitControl`.
    **Por que filtrar** (R1, e é o item "Nunca" da spec): o Agente escreve
    `<loopy-ask>{json}</loopy-ask>` **dentro** da própria mensagem (`envelope.ts:26-31`), e
    `stripBlocks` (`parse-ask.ts:82-94`) só o remove no fim do turno. Streamar o texto cru
    mostraria o JSON da pergunta **sendo digitado** e ainda entregaria o mesmo turno duas
    vezes (cru ao vivo, limpo no fim). A prosa continua saindo **só** pelo `agent_activity`,
    depois do `parseAsk`, já sem os blocos do Envelope.
    A filtragem é sobre o `StreamUpdate` traduzido (T-002): descartar `kind === "text"` e
    deixar passar `thought`, `tool_call`, `tool_delta`, `plan`, `mode` e `raw`. Consequência
    aceita e registrada: na Entrevista o `user_message_chunk` é o nosso Envelope voltando —
    ele **não some** (D3), mas nasce como `raw`, atrás do disclosure fechado.
    A shape do `agent_activity` **não muda** (R7b), e `decideTurn` continua puro e intocado.
    Não há mapa de sessão aqui: uma Fase, um Processo de Agente, uma Sessão.
    Acceptance: o `onUpdate` da Entrevista **descarta** todo `agent_message_chunk` e emite
    `agent_stream` para tool/thought/plan/mode/raw; **nenhum** `StreamUpdate` com
    `kind: "text"` sai no canal da Entrevista; `agent_activity` continua com a mesma shape e
    o mesmo conteúdo; um turno sem update nenhum não emite `agent_stream`; o exit code e os
    demais frames da Fase não mudam.
    Verification: `npm test -- tests/interview/run.test.ts && npm test && npm run typecheck`
    Deps: T-002
    Files: src/interview/run.ts, tests/interview/run.test.ts
    Size: S
    Risk: M

- [ ] T-014: Entrevista na GUI — a mesma timeline, sem texto ao vivo
    Fecha o D14 (parcialmente, e por decisão): ferramentas ao vivo, prosa ainda no fim do
    turno. É o que mata o silêncio dos ~5 min até a primeira pergunta.
    `apps/menubar/src/specs/interview-state.ts`: `InterviewState.transcript` deixa de ser
    `string` e vira **`readonly StreamItem[]`** (decisão fechada no `/devy:plan`). O evento
    `activity` (do `agent_activity`) empurra um item `{item:"text"}`; um evento novo
    `agent_stream` empurra o resto via `appendStreamItem` (T-005) — **a mesma** função e a
    **mesma** `mergeToolCall` do Run (R2). Ordem de chegada, ring e `elided` idênticos.
    O `activityLine` continua existindo como a última narração (o header o usa). A
    de-duplicação de `activity` repetida continua: narração idêntica é frame duplicado, não
    trabalho novo. O reset por Fase (`enterPhase`/`phase_finished`) zera a timeline — cada
    Fase é um processo e uma conversa.
    `apps/menubar/src/specs/useInterviewProcess.ts`: `controlToInterviewEvent` ganha o case
    `agent_stream`. Nada mais muda ali — `parseTransportLine` continua vindo do motor.
    `apps/menubar/src/specs/ActivityLine.tsx`: o corpo passa a montar
    `<StreamTimeline items={transcript}>` (T-010) no lugar do `MarkdownStream` sobre a
    string. O header pulsante e o `headerLabel` continuam.
    **Nunca** streamar `agent_message_chunk` aqui — a barreira é a T-013, no motor, e esta
    task não a contorna.
    Acceptance: um `agent_stream` de tool aparece na timeline da Fase corrente; um
    `agent_activity` aparece como item `text` **depois** dos itens de tool que chegaram
    antes; trocar de Fase zera a timeline; um control desconhecido continua sendo no-op
    (mesma referência); nenhum bloco `<loopy-…>` aparece renderizado em nenhum estado.
    Verification: `npm test -w apps/menubar -- "interview-state|useInterviewProcess|ActivityLine|Interview" && npm test -w apps/menubar && npm run typecheck`
    Deps: T-013, T-010, T-011
    Files: apps/menubar/src/specs/interview-state.ts, apps/menubar/src/specs/interview-state.test.ts, apps/menubar/src/specs/useInterviewProcess.ts, apps/menubar/src/specs/useInterviewProcess.test.ts, apps/menubar/src/specs/ActivityLine.tsx, apps/menubar/src/specs/ActivityLine.test.tsx, apps/menubar/src/specs/specs.css
    Size: M
    Risk: M

## Fase 5 — Registro

- [ ] T-015: ADR-0013 — o stream semântico, estendendo o ADR-0007
    `docs/adrs/0013-*.md` (novo, via a skill `adr_management` / `/adrs:create`, que tem
    enforcement por hook): registra a decisão de traduzir **todo** `session/update` em
    vocabulário do motor e levá-lo à tela como timeline semântica — cinco eventos tipados
    mais um catch-all, deltas no fio com mescla pura compartilhada, acumulação na GUI, e o
    control frame `agent_stream` da Entrevista.
    **Estende o ADR-0007** (Transport NDJSON duplex). Estender é **unidirecional**: o corpo
    do 0007 **não se toca** (mexer nele dispara `immutable_body_changed`); a relação mora
    **só** no ADR novo. O precedente é o 0011 → 0003.
    `docs/adrs/README.md` é **gerado** por `reindex.mjs` — rodar o reindex, **nunca**
    `prettier --write` nele (o padding manual quebra o doctor).
    Acceptance: o ADR nasce `accepted`, declara a relação "estende ADR-0007" no próprio
    corpo, e o corpo do 0007 fica byte-idêntico; o README é reindexado pelo script; o doctor
    dos ADRs passa.
    Verification: `node docs/adrs/reindex.mjs && git diff --stat docs/adrs/0007-*.md` (deve ser vazio)
    Deps: T-001
    Files: docs/adrs/0013-stream-semantico-de-session-update.md, docs/adrs/README.md
    Size: S
    Risk: L

- [ ] T-016: Documentação — `DESIGN.md` e os quatro intent nodes
    `apps/menubar/DESIGN.md`: reescrever a **§5 Stream Panel** (hoje diz "No syntax
    decoration; this is a faithful terminal pane" — revogado pelas D4/D5) e acrescentar à
    **§2** o vocabulário de ferramenta e a regra do glifo (C1: cor de ferramenta só no
    traço do ícone; status no pill; a distinção sobrevive a daltonismo porque depende de
    **forma**, não de hue). Registrar ali a verificação **manual** de contraste AA nos dois
    temas para os cinco hues novos.
    `src/tui/CLAUDE.md`: "14 variantes de `StoreEvent`" → **20** (14 + 5 tipados + o
    catch-all); `mergeToolCall`/`StreamItem`/`StreamUpdate` são API pública do subpath;
    `agent_stream` entra na lista de control frames.
    `src/acp/CLAUDE.md`: o `onUpdate` deixa de ser só texto; `translateUpdate` é o boundary.
    `apps/menubar/src/CLAUDE.md`: `transcript` deixa de ser string, ganha ring com marcador
    (R4/R6), e a armadilha do curto-circuito do `applyLine` fica **registrada** — é a que
    falha em silêncio.
    `src/interview/CLAUDE.md`: o D14 fecha **parcialmente** — ferramentas ao vivo, prosa
    ainda no fim do turno (R1), e o porquê (o Envelope apareceria sendo digitado).
    Acceptance: nenhum dos cinco documentos contradiz o código final; o `DESIGN.md` §5 não
    diz mais "no syntax decoration"; a contagem de `StoreEvent` bate com `store.ts`; o
    contraste AA está registrado com os valores medidos.
    Verification: `npm run typecheck && npm test && npm test -w apps/menubar`
    Deps: T-012, T-014
    Files: apps/menubar/DESIGN.md, src/tui/CLAUDE.md, src/acp/CLAUDE.md, apps/menubar/src/CLAUDE.md, src/interview/CLAUDE.md
    Size: S
    Risk: L

---

## Checkpoint: depois de T-001 … T-004 (Fase 1)

- [ ] `npm test && npm run typecheck && npm run lint` verdes
- [ ] `cargo test --manifest-path apps/menubar/src-tauri/Cargo.toml` verde
- [ ] Um Run real com `--emit-events | head -50` mostra `tool_call`/`tool_call_update` no NDJSON
- [ ] Sem GUI e sem `--emit-events`, `RunLoopResult` byte-idêntico (AD-1)
- [ ] Nenhum teste novo usa `Instant::now()` nem limite de tempo (a prova do C3 é o invariante)

## Checkpoint: depois de T-005, T-006 (Fase 2)

- [ ] `npm test -w apps/menubar` verde
- [ ] Um evento novo **cresce** o transcript (a armadilha do curto-circuito está coberta por teste)
- [ ] Estourar o teto produz `elided` com a contagem certa

## Checkpoint: depois de T-007 … T-011 (Fase 3)

- [ ] `npm test -w apps/menubar` verde
- [ ] `npm run dev:web -w apps/menubar` mostra os cards contra o `MOCK_FEED`
- [ ] Cor de ferramenta **só no glifo**; status no pill (inspeção do diff de CSS)

## Checkpoint: depois de T-012 … T-014 (Fase 4) — só um run vivo prova

- [ ] Critério 1: a ferramenta transiciona sozinha de `rodando` para `ok`/`falhou`, e o card
      certo recebe o update **mesmo com texto do agente intercalado**
- [ ] Critério 2: um Step de edição mostra hunks com contexto — não o arquivo inteiro duas vezes
- [ ] Critério 6: a aba `Specs` mostra ferramentas ao vivo durante os ~5 min do primeiro turno,
      e **nenhum** bloco `<loopy-…>` aparece na tela em momento algum
- [ ] Critério 8: uma linha NDJSON de 10 MB atravessa o framer em tempo linear
- [ ] Critério 9: numa task acima do teto, o marcador de corte aparece e o app segue fluido

## Checkpoint: final (Fase 5)

- [ ] `npm test`, `npm test -w apps/menubar`, `npm run typecheck`, `npm run lint` verdes
- [ ] Contraste AA nos dois temas para os cinco hues novos, registrado no `DESIGN.md`
- [ ] Corpo do ADR-0007 byte-idêntico; o 0013 é quem declara a relação
