# Backlog: C-0018 — aba Specs (autoria de spec/plan/todo dentro da GUI)

> Consumido pelo motor (`- [ ]` pendente / `- [x]` concluída; id `T-\d+`; corpo indentado).
> Narrativa, grafo de dependências, checkpoints e riscos: ver `plan.md` (mesma pasta);
> as 26 decisões, em `spec.md`.
> **Três arestas existem só para serializar merge, não por lógica — não remover:**
> `T-008→T-007` (ambas registram comando em `src-tauri/src/main.rs`), `T-015→T-014`
> (ambas editam `apps/menubar/src/App.tsx`), `T-017`/`T-018→T-014` (dependem do código final).
> **Invariantes:** o roteiro vem do `/devy:*`, nunca do motor (D1/AD-1); o Transport só
> cresce de forma **aditiva**; nenhum comando Rust **destrói** (descartar é `rename`);
> nada de `if (agent === "claude")` no motor (a D16 vive só na GUI); erro é valor nas
> fronteiras (AD-5); formatar **só** os arquivos tocados.
> Cada linha `Deps:` fica **isolada, ids limpos, sem ponto final** (bug D-0001 do `parseDeps`).

## Fase 1 — Fundação: contrato de fio e os puros

- [x] T-001: Frames da Entrevista no Transport NDJSON
    `src/tui/transport.ts`: estender `ControlFrame` (hoje 3 variantes, `:28-37`) com as **seis**
    da spec — `phase_started` (`phase`, `command`, `changeDir?`), `change_resolved` (`changeDir`),
    `question_asked` (`questionId`, `phase`, `prompt`, `options?`, `otherLabel?`, `finding?`,
    `source?`), `agent_activity` (`phase`, `text`), `phase_finished` (`phase`, `changeDir`,
    `files`) e `interview_failed` (`reason`). Trocar `CommandFrame` (hoje **tipo único**,
    `:43-47`) por união com as **três**: `question_answer` (`questionId`, `text`,
    `attachments?`), `phase_wrap_up`, `interview_cancel`. Declarar aqui também
    `Phase = "spec" | "refine" | "plan"` e `AskOption { label, detail?, recommended?, why? }`:
    são contrato de fio, e este barrel já é subpath export com `dts` (browser-safe — nada de
    `node:`). `changeDir` é **opcional** em `phase_started` só porque a fase `spec` de uma
    Change nova ainda não o conhece (D10). `parseTransportLine` **não muda** (é genérico).
    Não repetir o erro do D-0005: `questionId` e `phase` são **sempre** preenchidos.
    `apps/menubar/src/state/store-bridge.ts:81-101`: `applyControl(ui, control): UIState` faz
    `switch` **sem `default`** — qualquer variante nova de `ControlFrame` vira **TS2366** e
    derruba `npm run typecheck` do app. Adicionar `default: return ui`: os controls da
    Entrevista não pertencem ao `BridgeState` do Run (ela roda em outro processo).
    `apps/menubar/src/state/notify.ts` já tem `default: return null` — **não mexer**.
    Acceptance: os 9 frames novos fazem round-trip `createEventTransport` → `parseTransportLine`
    preservando todos os campos; frame de tipo desconhecido continua `{ok:false}` sem lançar;
    `applyLine` com um control de entrevista devolve a **mesma referência** de `BridgeState`.
    Verification: `npm run typecheck && npm test -- tests/tui/transport.test.ts && npm test -w apps/menubar`
    Files: src/tui/transport.ts, tests/tui/transport.test.ts, apps/menubar/src/state/store-bridge.ts, apps/menubar/src/state/store-bridge.test.ts
    Size: S
    Risk: M

- [ ] T-002: `parse-ask.ts` — turno do Agente → ask | change | done | open
    `src/interview/parse-ask.ts`: função **pura** (AD-6) que lê o texto de um turno e devolve
    o que ele pede, exatamente pela tabela da spec: `<loopy-ask>{json válido}</loopy-ask>` →
    `{kind:"ask", question}`; `<loopy-change dir="…"/>` → `{kind:"change", dir}` — **pode
    coexistir** com `ask`/`done` no mesmo turno; `<loopy-done/>` → `{kind:"done"}`; nada disso
    + texto não-vazio → `{kind:"open", text}` (**o fallback da D3**); JSON malformado dentro do
    bloco → `open` + `warning`; **dois ou mais** blocos `ask` → o **primeiro** + `warning` (D25).
    Devolver também a **prosa fora dos blocos** — ela vai para o transcript, não para o card (D25).
    **Nunca lança** (AD-5). Mesmo caminho que o `parseVerdict` já usa para ler o turno
    (`src/steps/verdict.ts`); os tipos `AskOption`/`Phase` vêm de `../tui/transport`.
    Acceptance: os 6 casos da tabela cobertos; `change` + `done` no mesmo turno devolve ambos;
    entrada vazia, JSON truncado e bloco sem fechamento não lançam.
    Verification: `npm test -- tests/interview/parse-ask.test.ts && npm run typecheck`
    Deps: T-001
    Files: src/interview/parse-ask.ts, tests/interview/parse-ask.test.ts
    Size: S
    Risk: L

- [ ] T-003: `envelope.ts` + `phases.ts` — a instrução de forma e a única tabela do motor
    `src/interview/envelope.ts`: `fullEnvelope(phase, changeDir?)`, `reminder()` e `wrapUp()` —
    **puros**, com o texto literal da seção "O envelope" da `spec.md`. O envelope fala de
    **forma**, nunca de conteúdo (AD-1). Turno 1 leva o texto completo; turnos seguintes, só o
    lembrete de uma linha (D15). A fase `spec` leva o parágrafo do `<loopy-change>` e **não**
    injeta `<CHANGE_DIR>` (ele não existe ainda — D10); `refine`/`plan` o substituem por
    `Grave os arquivos em: <CHANGE_DIR>`, corrigindo o `tasks/plan.md` que o `/devy:plan` diz
    sem editar o comando do harness.
    `src/interview/phases.ts`: **a única tabela que o motor tem direito de ter** — `spec` →
    `/devy:spec <demanda>`, `refine` → `/devy:refine`, `plan` → `/devy:plan spec.md`. Mais a
    constante `CHANGES_DIR = ".harn/devy/changes"` (o endereço do harness; a outra cópia vive
    no `changes.rs`, e são só essas duas). As trilhas `bug`/`debt` **não têm entrada** — elas
    nunca spawnam processo.
    Acceptance: turno 1 contém o bloco de regras completo e turno 2+ só o lembrete; `spec` não
    contém `<CHANGE_DIR>` e `refine`/`plan` contêm; cada fase mapeia para o comando devy certo;
    pedir o comando de `bug`/`debt` não existe como caminho.
    Verification: `npm test -- tests/interview/envelope.test.ts tests/interview/phases.test.ts`
    Deps: T-001
    Files: src/interview/envelope.ts, src/interview/phases.ts, tests/interview/envelope.test.ts, tests/interview/phases.test.ts
    Size: S
    Risk: L

- [x] T-004: Anexos em `.loopy/attachments/` + `promptBlocks` na Sessão
    `src/interview/attachments.ts`: gravar um anexo em
    `<dir>/.loopy/attachments/<YYYYMMDD-HHmmss>-<nome>` (D19 — o prefixo evita colisão de dois
    `print.png`, e **anexos nunca são apagados**, para nunca quebrar uma referência que o
    `spec.md` tenha escrito). `.loopy/` já é gitignored. Rejeitar nome com `..` ou separador de
    caminho. Montar `ContentBlock[]` do tipo `resource_link` a partir dos paths.
    `src/acp/session.ts`: adicionar `promptBlocks(blocks): Promise<StopReason>` a
    **`LoopySession`** — e **não** a `AgentSession` (`src/types.ts:515-545` é contrato
    congelado). O `run.ts` da Entrevista recebe um `LoopySession` do `pool.session()` e não
    passa por `StepContext`, então isso não toca `types.ts` **e não quebra nenhum fake** —
    widenizar `prompt(text: string)` para `string | ContentBlock[]` quebraria a tipagem
    contextual dos fakes em `tests/steps/support.ts`, `tests/loop/support.ts` e
    `tests/fixtures/fake-agent.ts` sem ganho. O SDK já aceita blocos
    (`ActiveSession.prompt(string | ContentBlock | ContentBlock[])`, `acp.d.ts:307`).
    Implementar reusando `runTurn` (generalizar o corpo para `string | ContentBlock[]`),
    preservando o reset do `TurnTextBuffer`, a barreira `flushSessionUpdates` (timing OQ3) e a
    acumulação de usage.
    Acceptance: o path gravado fica sob `.loopy/attachments/` com prefixo de timestamp; nome com
    `../` é rejeitado; `ContentBlock` bem-formado; `promptBlocks` resolve com o `stopReason` e
    deixa `readText()` com o turno completo; `AgentSession` em `src/types.ts` **inalterado**.
    Verification: `npm test -- tests/interview/attachments.test.ts tests/acp/session.test.ts && npm run typecheck`
    Files: src/interview/attachments.ts, src/acp/session.ts, tests/interview/attachments.test.ts, tests/acp/session.test.ts
    Size: S
    Risk: M

## Fase 2 — O subcomando `loopy interview`

- [ ] T-005: `run.ts` — uma Fase da Entrevista, ponta a ponta
    `src/interview/run.ts`: orquestra **UMA** Fase e sai (D13 — o gate e a retomada viram o
    mesmo código). Um `createAgentProcessPool` com **um** Agente; **uma** Sessão em
    `cwd = <dir>` (não há worktree: a Entrevista escreve na árvore de trabalho).
    `setMode("acceptEdits")` — a Entrevista **precisa** escrever os `.md`, e `plan` é read-only
    (memória `loopy-verdict-vs-plan-mode`); depois `setModel` → `setEffort`, nessa ordem e
    best-effort, como o step de agente já faz (`src/steps/agent.ts:332-350`).
    Emite `phase_started` (sem `changeDir` na fase `spec` — D10). Turno 1: `fullEnvelope` +
    comando devy de `phases.ts` + a demanda (+ anexos via `promptBlocks`). Turnos seguintes:
    `reminder()` + a resposta humana. Após **cada** turno, `parseTurn(session.readText())`:
    `change` → `change_resolved` (fallback: snapshot de `CHANGES_DIR` antes × depois da fase);
    prosa → `agent_activity`; `ask`/`open` → `question_asked` e **espera** o `question_answer`;
    `done` → `phase_finished` + **exit 0**.
    Comandos por stdin em NDJSON (readline, o padrão de `createStdinApproval`,
    `src/tui/approval.ts:228-252`): `question_answer` destrava o próximo turno,
    `phase_wrap_up` manda o `wrapUp()` e a fase termina no `<loopy-done/>` normal (D17),
    `interview_cancel` encerra **sem apagar nada** (D25 — o que foi gravado fica).
    Falha (stopReason ≠ `end_turn`, spawn, adapter) → `interview_failed` + exit ≠ 0 (AD-5:
    valor na fronteira, não stack trace). **Sem telemetria, sem checkpoint, sem git.**
    A decisão de turno fica numa função **pura** no próprio arquivo (AD-6), testável sem ACP.
    Acceptance: com uma sessão fake, uma fase completa emite na ordem `phase_started` →
    (`agent_activity`|`question_asked`)* → `phase_finished` e resolve com exit 0; um turno sem
    bloco vira `question_asked` aberta (D3) e o fluxo continua; `phase_wrap_up` faz o turno
    seguinte ser o de encerramento; `interview_cancel` encerra sem emitir `phase_finished`;
    `interview_failed` sai ≠ 0.
    Verification: `npm test -- tests/interview/run.test.ts && npm run typecheck && npm run lint`
    Deps: T-002, T-003, T-004
    Files: src/interview/run.ts, tests/interview/run.test.ts
    Size: L
    Risk: H

- [ ] T-006: Subcomando `loopy interview` no commander
    `src/index.ts`: registrar `interview` ao lado do `probe-agent` (`:1593`) — o commander casa
    subcomando **antes** do `[dir]` posicional, então não há ambiguidade (mesma mecânica do
    T-008 original). Assinatura: `loopy interview <dir> --emit-events [--change <id>]
    [--phase <spec|refine|plan>] [--agent <preset>] [--model <m>] [--effort <e>]`.
    **Sem `--emit-events`**: imprime a mensagem dizendo que o processo existe para falar com a
    GUI e sai com **código 2** (um modo terminal interativo é outro produto — fora de escopo).
    `--change` + `--phase` entram numa fase específica (D12/D13); sem eles, começa uma Change
    nova pela fase `spec`. Monta `createEventTransport` sobre o stdout, manda todo texto de log
    para o **stderr** (stdout é o canal NDJSON — ADR-0007) e chama `runInterview`.
    Zero colisão com o `loopy change` que **já existe** (`src/index.ts:1188`, anotação de
    telemetria) — a D23 escolheu `interview` justamente por isso.
    Acceptance: `interview <dir>` sem `--emit-events` sai 2 com mensagem; `--phase` fora do
    conjunto é erro de usage; `--help` lista as flags; nada é escrito no stdout que não seja
    NDJSON.
    Verification: `npm test -- tests/cli/ && npm run typecheck && npm run lint`
    Deps: T-005
    Files: src/index.ts, tests/cli/interview.test.ts
    Size: S
    Risk: M

## Fase 3 — A ponte Rust

- [x] T-007: `changes.rs` — listar e descartar Changes
    `apps/menubar/src-tauri/src/changes.rs` (novo): `ChangeSummary { id, slug, has_spec,
    has_plan, has_todo, task_count, done_count }` (serde snake_case, como o resto de
    `project_fs.rs`).
    `read_changes(dir)` lê `<dir>/.harn/devy/changes/*/` — **só diretórios** (há um `index.md`
    solto lá) —, deriva `id`/`slug` do nome da pasta, checa os três `.md`, conta as linhas
    `- [ ]` / `- [x]` do `todo.md`, e ordena por id **decrescente**. **Diretório ausente →
    `Ok(vec![])`, não erro** — é a mesma disciplina de `read_optional` (`project_fs.rs:180`), e
    é assim que o app decide empty-state.
    `discard_change(dir, id)` (D21): **`rename`** da pasta para
    `<dir>/.loopy/trash/<id>-<slug>-<epoch>/`. **Nunca `remove_dir_all`** — o boundary desta
    change é "nenhum comando Rust **destrói**". Reversível com um `mv`, gitignored, e com
    precedente direto no `write_loopy_yml`, que já faz isso com `.loopy/backups/`. Confinar por
    `resolve_within` (`project_fs.rs:163`) — promovê-lo a `pub(crate)` em vez de duplicar o guard.
    `main.rs`: `mod changes;` + as duas entradas no `generate_handler![]` (`:291-322`).
    Acceptance: `cargo test` cobre pasta ausente → vazio; `index.md` ignorado; Change parcial
    (só `spec.md`) → flags certas; contagem de tasks/done; ordem decrescente; `discard_change`
    move a pasta (origem some, destino existe) e **recusa** `..` e path absoluto.
    Verification: `cd apps/menubar/src-tauri && cargo test`
    Files: apps/menubar/src-tauri/src/changes.rs, apps/menubar/src-tauri/src/project_fs.rs, apps/menubar/src-tauri/src/main.rs
    Size: M
    Risk: M

- [ ] T-008: `interview_process.rs` — o segundo processo gerenciado
    `apps/menubar/src-tauri/src/interview_process.rs` (novo): `InterviewState` espelhando o
    `SidecarState` (`sidecar.rs:184-311`) — `start(app, dir, args)`, `send_command(payload)`
    (uma linha NDJSON no stdin), `stop()` idempotente — com eventos
    `interview://line | interview://stderr | interview://exit`. Reusar `LineFramer`,
    `resolve_sidecar_path()` e `login_shell_path()` de `sidecar.rs` (o `.app` aberto pelo tray
    não herda o PATH do usuário; o `-i` do login shell é obrigatório).
    **A razão de existir**: `SidecarState::start` **mata o sidecar anterior**
    (`sidecar.rs:211`, "one Run at a time"). A Entrevista **não pode** matar um Run em
    andamento (Boundary "Never"), então ela é um estado gerenciado **separado** e nunca toca no
    do Run. O efeito da Entrevista sobre o Run é o do parent sujo (D22), não o de um kill.
    O Rust **sempre injeta** `--emit-events` no argv (como já injeta `--no-tui --emit-events`
    para o Run); as demais flags vêm do React.
    `main.rs`: `mod interview_process;` + `.manage(InterviewState::new())` + os três comandos
    no `generate_handler![]`.
    Acceptance: `cargo test` cobre o framing de linha e o formato dos comandos NDJSON (uma
    linha, sem `\n` interno); iniciar a Entrevista **não** limpa o `SidecarState`; `stop()` é
    idempotente.
    Verification: `cd apps/menubar/src-tauri && cargo test`
    Deps: T-007
    Files: apps/menubar/src-tauri/src/interview_process.rs, apps/menubar/src-tauri/src/main.rs
    Size: M
    Risk: M

## Fase 4 — A GUI

- [ ] T-009: `interview-state.ts` — o redutor puro do fluxo
    `apps/menubar/src/specs/interview-state.ts`: `advance(state, event)` **puro** — sem I/O, sem
    React, sem `Date.now()` (AD-6, o mesmo padrão de `applyLine`, `groupByStep`, `configToStore`).
    Estados: `triage` → `describe` → `phase` (`running` | `asking`) → `gate` → `saved`; trilhas
    `bug`/`debt` desviam para `handoff` e **nunca** spawnam processo. A triagem, a descrição, o
    gate e o hand-off são **locais** — nenhum processo sobe antes de uma Fase começar.
    "Outro tipo de demanda…" cai na trilha **`feature`** (D24): a trilha de bug termina num
    hand-off que não grava nada, e mandar o desconhecido para o caminho estéril é o pior default.
    Regras que a implementação não pode inventar sozinha: resposta a um `questionId` que não é o
    pendente é **no-op e devolve a MESMA referência** (um frame tardio após cancel não pode
    corromper o fluxo); `wrap_up` marca a fase como encerrando mas quem termina é o
    `<loopy-done/>`; `cancel` **não apaga nada** (o que foi gravado fica e a Change reaparece
    como parcial); `warning` acumula sem interromper.
    Acceptance: avanço triagem→demanda→fase→gate→salvo; gate oferece `Refinar`/`Ir ao plano`/
    `Fechar`; trilha `bug` chega ao hand-off sem passar por fase; resposta a `questionId`
    desconhecido devolve `toBe` a mesma referência; cancelar não zera o que foi gravado.
    Verification: `npm test -w apps/menubar -- interview-state`
    Deps: T-001
    Files: apps/menubar/src/specs/interview-state.ts, apps/menubar/src/specs/interview-state.test.ts
    Size: M
    Risk: L

- [ ] T-010: `useInterviewProcess.ts` — a ponte com o processo `interview://`
    `apps/menubar/src/specs/useInterviewProcess.ts`: hook que spawna `loopy interview` via
    `invoke("start_interview", …)`, escuta `interview://line|stderr|exit`, parseia cada linha
    com `parseTransportLine` (do motor — **não reimplementar**) e alimenta o `advance` do T-009;
    envia `question_answer` / `phase_wrap_up` / `interview_cancel` por
    `invoke("send_interview_command", { payload })`.
    Uma Fase = **um processo**: `interview://exit` com código 0 após `phase_finished` é o
    encerramento normal; exit sem `phase_finished` é falha (classificar como o
    `applySidecarExit` já faz para o Run, `store-bridge.ts:205-221`).
    Não capturar `isTauri()` no escopo do módulo — chamar no ponto de uso (o padrão-alvo do
    `popover/Glance.tsx`), senão o hook fica não-mockável em teste.
    Acceptance: uma sequência de linhas NDJSON injetada produz os estados esperados; comando
    enviado tem o shape do `CommandFrame`; exit 0 após `phase_finished` não vira erro; exit sem
    ele vira falha visível.
    Verification: `npm test -w apps/menubar -- useInterviewProcess`
    Deps: T-008, T-009
    Files: apps/menubar/src/specs/useInterviewProcess.ts, apps/menubar/src/specs/useInterviewProcess.test.ts
    Size: M
    Risk: M

- [ ] T-011: Componentes da Entrevista + `specs.css`
    `apps/menubar/src/specs/`: `QuestionCard.tsx` (cartão de pergunta — opções com detalhe de
    uma linha, badge `RECOMENDADA` em **exatamente uma**, o bloco `Porquê:` separado por
    hairline, `finding` + `source` quando o Agente leu o código em vez de perguntar, e o escape
    hatch de texto livre); `Attachable.tsx` (paste via `clipboardData.files`, drag-drop com
    overlay, botão 📎 com `e.target.value = ""` no fim; anexos viram chips com miniatura via
    `createObjectURL` para imagens, revogada ao remover); `PhaseGate.tsx` (D12 — mostra o que
    foi gravado e oferece `Refinar` / `Ir direto ao plano` / `Fechar`); `ActivityLine.tsx`
    (D14 — linha viva do `agent_activity` + transcript colapsável reusando o `MarkdownStream`
    do app, **fechado por padrão**); `Handoff.tsx` (trilha bug/débito: bloco `/devy:debug …`
    montado e copiável + contexto; **nenhum arquivo é criado**); `specs.css`.
    **Um único `specs.css`** — é por isso que os cinco componentes são uma task só: separá-los
    em tasks paralelas os faria colidir nesse arquivo no merge.
    **Nenhuma cor literal**: tudo de `ui/tokens.css`. O acento magenta significa exatamente três
    coisas — interativo, vivo, gate humano — e o badge `RECOMENDADA` é a terceira. Usar as
    primitivas de `ui/` (`Button`, `Pill`, …), não `<input>` solto. Texto de UI em **pt-BR**,
    identificadores e docstrings em **inglês**. Toda animação respeita
    `usePrefersReducedMotion`. **Não adicionar `rehype-raw`** a nada — o conteúdo vem de um Agente.
    Acceptance (jsdom): card com opções renderiza **um** badge `RECOMENDADA` e o porquê; card
    com `finding` renderiza a fonte (`arquivo:linha`) e o botão de decidir à mão; o escape hatch
    aceita texto; colar um arquivo produz um chip com nome e tamanho; o transcript nasce fechado.
    Verification: `npm test -w apps/menubar -- specs && npx prettier --write apps/menubar/src/specs/`
    Deps: T-009
    Files: apps/menubar/src/specs/QuestionCard.tsx, apps/menubar/src/specs/Attachable.tsx, apps/menubar/src/specs/PhaseGate.tsx, apps/menubar/src/specs/ActivityLine.tsx, apps/menubar/src/specs/Handoff.tsx, apps/menubar/src/specs/specs.css
    Size: L
    Risk: L

- [ ] T-012: `Interview.tsx` — o fluxo montado
    `apps/menubar/src/specs/Interview.tsx`: monta o fluxo inteiro sobre o redutor (T-009), a
    ponte (T-010) e os componentes (T-011) — triagem ("O que vamos desenvolver hoje?": Nova
    feature RECOMENDADA · Bug · Débito técnico · Outro…) → descrição em texto livre com anexos →
    Fase → gate → "✓ Salvo". A triagem e a descrição são **locais**: nenhum processo sobe até
    uma Fase começar, e as trilhas `bug`/`debt` **nunca** spawnam nada.
    Barra de progresso da fase com o botão **"Chega, grave o que temos" sempre visível** (D17) —
    ele manda `phase_wrap_up`, e a fase termina no `<loopy-done/>` normal. Sem contador, sem
    config: o humano é o teto.
    O `PICK_FOLDER` do protótipo **não existe** (D6): o `dir` do header é a fonte única do
    projeto. O componente é casca — nenhuma decisão de fluxo aqui (AD-6).
    Acceptance (jsdom): triagem → descrição → o primeiro `question_asked` renderiza um
    `QuestionCard`; "Chega" envia `phase_wrap_up`; `phase_finished` leva ao `PhaseGate`; trilha
    `bug` chega ao `Handoff` sem que a ponte tenha sido chamada; fechar volta para a lista.
    Verification: `npm test -w apps/menubar -- Interview && npm run typecheck`
    Deps: T-010, T-011
    Files: apps/menubar/src/specs/Interview.tsx, apps/menubar/src/specs/Interview.test.tsx
    Size: M
    Risk: M

- [ ] T-013: `SpecsPane.tsx` — a aba (lista, seletores, aviso, descarte)
    `apps/menubar/src/specs/SpecsPane.tsx`: a lista de Changes via `read_changes` (T-007) —
    ordenada decrescente, com o estado dos três `.md` e a contagem de tasks —, o botão
    `+ Nova spec`, `Continuar` numa Change parcial (entra na **fase escolhida**, não em `spec` —
    D12/D13) e `Descartar` (chama `discard_change`, com confirmação).
    Seletor de **Agente + model + effort** ao lado (D16/D18): lista **apenas presets `claude`**
    (+ `command` custom, que o operador assume) — os `/devy:*` são do Claude Code, e o `if` de
    adapter fica **só aqui**, nunca no motor. Reusar `useAgentCapabilities`, `SelectField` e
    `ensureOption` (C-0016): a sondagem vai **pelo argv** e é por `(agente, model)`; degrada
    para texto livre quando falha, sem corromper valor já presente.
    Persistência em `launch-config.json`: adicionar `authoring_agent` / `authoring_model` /
    `authoring_effort` a `LaunchConfig` (`apps/menubar/src-tauri/src/config.rs:10-24`), todos
    com `#[serde(default)]` — os testes de default/round-trip já existentes continuam valendo.
    **Aviso de Run ativo (D22)**: com um Run em andamento, a aba **avisa e deixa decidir** — não
    bloqueia. O texto diz o que é verdade: gravar uma Change nova suja o parent e, com
    `require_clean_parent: true`, pode parar o Run no próximo mark-done. **Não mexer** em
    `require_clean_parent` nem em `isParentClean` para acomodar isso.
    Funciona **sem `loopy.yml`** — daí a T-014.
    Acceptance (jsdom): lista renderiza Changes com flags e contagem; `+ Nova spec` monta a
    Entrevista; `Continuar` oferece as fases restantes; `Descartar` pede confirmação e chama o
    comando; o seletor persiste as três chaves; o aviso aparece só com Run ativo.
    Verification: `npm test -w apps/menubar -- SpecsPane && cd apps/menubar/src-tauri && cargo test`
    Deps: T-012
    Files: apps/menubar/src/specs/SpecsPane.tsx, apps/menubar/src/specs/SpecsPane.test.tsx, apps/menubar/src-tauri/src/config.rs
    Size: M
    Risk: M

- [ ] T-014: D20 — barra de abas sempre visível + 5.º segmento `Specs`
    Corrige a ordem do trabalho: **spec vem antes do yml**. Hoje `App.tsx:258` faz
    `showEmptyState = isIdle && configDraft.hasConfig === false` e `App.tsx:409` troca o
    **`ViewSwitcher` inteiro** pelo `EmptyState` — a barra de abas some, e a aba `Specs` não
    existiria justamente no projeto que mais precisa dela.
    `apps/menubar/src/panes/ViewSwitcher.tsx`: `ViewId` ganha `"specs"` e o `SEGMENTS` ganha o
    5.º segmento; o pane monta o `SpecsPane` (todas as views seguem montadas, escondidas por
    `display`, para não perder estado).
    `apps/menubar/src/App.tsx`: o `EmptyState` **deixa de substituir** o `ViewSwitcher`. Sem
    yml: Kanban/Deps/Insights mostram o próprio vazio, `Config` hospeda o "criar a partir do
    template" e `Specs` funciona normal.
    `apps/menubar/src/config/EmptyState.tsx`: vira o vazio **da aba Config** (o
    `seedFromTemplate` continua semeando o draft sem escrever em disco).
    Custo real de escopo assumido: as outras quatro views precisam degradar com graça.
    Acceptance: sem `loopy.yml`, a barra de abas existe e `Specs` é alcançável (SC15); com
    `loopy.yml`, nada muda de comportamento; **os 844 testes do app continuam verdes** — um que
    quebre por shape de frame é bug desta change, não teste a atualizar.
    Verification: `npm test -w apps/menubar && npm run typecheck && npm run lint`
    Deps: T-013
    Files: apps/menubar/src/App.tsx, apps/menubar/src/panes/ViewSwitcher.tsx, apps/menubar/src/config/EmptyState.tsx, apps/menubar/src/App.test.tsx, apps/menubar/src/panes/ViewSwitcher.test.tsx
    Size: M
    Risk: H

- [ ] T-015: D11 — "Abrir o board" repõe `inputs.{spec,plan,todo}` no draft
    Sem isto o SC8 é impossível: o board lê o backlog em `inputs.todo`
    (`apps/menubar/src/config/useConfigDraft.ts:154-174`), e os três `inputs.*` são campos
    **obrigatórios** do schema apontando para a Change **anterior** — o backlog recém-criado
    nunca apareceria.
    O botão "Abrir o board" da tela `✓ Salvo` chama `configDraft.patch` três vezes (ou uma, com
    o objeto `inputs`) apontando para a pasta da Change nova. **Patcha o draft, não o disco**: a
    save bar global acende `dirty` e o yml só muda quando o humano clicar Salvar — o mesmo gesto
    que a C-0014 já ensinou. Lembrar que `patch` opera sobre o objeto **cru** (pré-defaults),
    nunca sobre o `draft` validado. Depois do patch, trocar a view para o Kanban.
    Isto **não** transforma a aba num editor de yml (é a única exceção declarada na spec) e não
    abre campo nenhum para edição.
    Acceptance: após "Abrir o board", os três `inputs.*` no draft apontam para a Change nova, a
    save bar mostra "Alterações não salvas", o Kanban exibe as tasks do `todo.md` novo, e o yml
    em disco só muda depois do Salvar (SC8).
    Verification: `npm test -w apps/menubar && npm run typecheck`
    Deps: T-014
    Files: apps/menubar/src/App.tsx, apps/menubar/src/specs/Interview.tsx, apps/menubar/src/specs/SpecsPane.tsx, apps/menubar/src/App.test.tsx
    Size: S
    Risk: M

## Fase 5 — Registro e limpeza

- [ ] T-016: ADR-0012 — "Autoria de Change via Entrevista delegada"
    `docs/adrs/0012-autoria-de-change-via-entrevista.md`, no template de `docs/adrs/template.md`
    e no estilo dos 11 anteriores. O que **importa** registrar é o **porquê não uma tool MCP**
    (D2), com o custo real: o motor abre sessão via `ctx.buildSession(cwd).start()` do SDK e
    **não controla `mcpServers`** — uma tool MCP exigiria descer ao `session/new` cru + servidor
    próprio + validação em 3 adapters, para trocar um bloco de texto no turno por uma chamada
    tipada. Registrar também a delegação aos `/devy:*` (D1, com o trade-off de só funcionar onde
    o harness está instalado), o envelope como instrução **de forma** (AD-1 intacto), o fallback
    da D3 e a Fase-por-processo da D13. Sem isso alguém reabre a discussão em seis meses sem o dado.
    `docs/adrs/0007-transport-ndjson-duplex-native-ui.md`: nota de referência cruzada
    ("estendido pelo 0012"), e `docs/adrs/README.md` reindexado.
    Acceptance: o ADR existe, está no índice, e o 0007 aponta para ele; nenhum código muda.
    Verification: `npx prettier --write docs/adrs/0012-*.md docs/adrs/0007-*.md docs/adrs/README.md`
    Deps: T-006
    Files: docs/adrs/0012-autoria-de-change-via-entrevista.md, docs/adrs/0007-transport-ndjson-duplex-native-ui.md, docs/adrs/README.md
    Size: S
    Risk: L

- [ ] T-017: `CONTEXT.md` + intent nodes
    `CONTEXT.md` (o glossário canônico): **Change** deixa de ser "par derivado `{id,dir}`, não
    conceito do motor" — o motor agora **cria** Changes. Registrar **Entrevista** (a conversa
    dirigida por um Agente que produz os inputs de uma Change), **Trilha** (`feature` produz
    arquivos × `bug`/`débito` termina em hand-off), **Fase** (`spec`/`refine`/`plan`; uma Sessão
    e um processo por Fase), **Envelope** (a instrução de **forma** que o motor prepende; nunca
    fala de conteúdo) e **Pergunta** (o bloco `<loopy-ask>`, que degrada para **pergunta aberta**).
    `src/interview/CLAUDE.md` (novo intent node) e os nós tocados: `CLAUDE.md` da raiz (o
    subcomando novo, o 5.º segmento, a aresta para `src/interview/`), `src/tui/CLAUDE.md` (os
    frames novos), `apps/menubar/CLAUDE.md` e `apps/menubar/src/CLAUDE.md` (a aba e a 4.ª
    superfície: o processo `interview://`), `apps/menubar/src-tauri/CLAUDE.md` (os comandos e o
    segundo estado gerenciado).
    Não editar `.md` antigos por trivialidades — o prettier do repo está fora de sincronia.
    Acceptance: os cinco termos existem no glossário; `src/interview/CLAUDE.md` cobre Purpose,
    Entry Points, Anti-patterns, Edges e Pitfalls; nenhum nó afirma coisa que o código
    contradiga.
    Verification: `npx prettier --write CONTEXT.md src/interview/CLAUDE.md && npm run lint`
    Deps: T-014
    Files: CONTEXT.md, src/interview/CLAUDE.md, CLAUDE.md, src/tui/CLAUDE.md, apps/menubar/CLAUDE.md, apps/menubar/src/CLAUDE.md, apps/menubar/src-tauri/CLAUDE.md
    Size: M
    Risk: L

- [ ] T-018: Remover o protótipo da `main` (SC17)
    Apagar `apps/menubar/src/authoring-prototype/` inteiro (11 arquivos + `handoff.md`) e
    reverter o bloco `PROTOTYPE gate` de `apps/menubar/src/main.tsx:310-345` — o `IS_PROTOTYPE`,
    o `React.lazy(PrototypeRoute)` e o ramo `PrototypeRoute ? … :` do render, deixando
    `IS_ABOUT ? <About/> : <Root/>`. É o **único** arquivo de produção que o protótipo sujou.
    O que fica na `main` é o que a spec descreve, não o protótipo — a decisão foi dobrada no
    código real pelas tasks T-009 a T-015.
    Acceptance: `git status` limpo; `authoring-prototype/` não existe; `main.tsx` não contém
    `PROTOTYPE` nem `proto=authoring`; `npm run dev:web -w apps/menubar` sobe sem o switcher.
    Verification: `rg -n "PROTOTYPE|authoring-prototype" apps/menubar/src/ ; npm test -w apps/menubar && npm run typecheck`
    Deps: T-014
    Files: apps/menubar/src/main.tsx, apps/menubar/src/authoring-prototype/
    Size: S
    Risk: L
