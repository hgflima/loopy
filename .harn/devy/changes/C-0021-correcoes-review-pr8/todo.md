# Backlog: C-0021 — Correções do review do PR #8

> Consumido pelo motor (`- [ ]` pendente / `- [x]` concluída; id `T-\d+`; corpo indentado).
> Narrativa, grafo, checkpoints e riscos: ver `plan.md` (mesma pasta); diagnóstico e
> decisões F1–F10, em `spec.md`. **Não re-litigar.**
>
> **Arestas que existem só para serializar merge (mesmo arquivo) — não remover:**
> `T-004→T-003` e `T-005→T-004` (`App.tsx`, `state/launch-args.ts` e testes),
> `T-007→T-005` (`App.tsx`), `T-008→*` (docs do código final).
>
> **Invariantes desta change:** o argv de launch da GUI (E2), o argv do sidecar
> (`--no-tui --emit-events`) e `loopy [dir]` **não mudam**; toda decisão nova é função
> pura e testada (AD-6), I/O fino em volta; erro é valor nas fronteiras (AD-5); um
> `loopy open` **nunca** mata um sidecar vivo nem grava o `loopy.yml` sem passar pelo
> aviso; nenhuma dependência nova.
>
> **TDD obrigatório:** cada task começa pelo teste que reproduz o item do review e
> **confirma que ele falha** no código atual; só então corrige.
>
> **Commits:** conventional commit `fix(...)` (ou `docs:` na T-008), **sem** trailer
> `Co-Authored-By` do Claude.
>
> **Formatação:** `prettier --write` **apenas** em arquivo NOVO — o repo está fora de
> sincronia e reformatar um arquivo existente altera código alheio. `cargo fmt` só no
> arquivo tocado (`rustfmt --check src/<arquivo>.rs`).
>
> Cada linha `Deps:` fica **isolada, ids limpos, sem ponto final** (bug D-0001 do `parseDeps`).

## Fase 1 — Bloqueadores do review

- [x] T-001: `loopy open` nunca resolve a própria CLI como GUI (B1)
    Hoje, no macOS com `npm i -g`, `src/open/launch.ts` passa
    `selfDir = dirname(process.execPath)` = a pasta `bin` do Node, onde também mora o
    link `loopy` da CLI; `siblingCandidates` (`src/open/resolve-app.ts`) testa `Loopy`,
    que casa com `loopy` no APFS (sem distinção de caixa) e ganha de
    `/Applications/Loopy.app`. Resultado: `loopy open . --yes` roda um Run headless que
    aprova o Merge sozinho. O mesmo vale no Windows (`Loopy.exe` × sidecar `loopy.exe`).
    Corrigir em duas camadas (spec F1/F2):
    (1) **pura, em `resolve-app.ts`**: nomes da GUI por plataforma — Linux
    `["loopy-menubar", "Loopy"]`, macOS `["loopy-menubar"]` (inclusive dentro de
    `X.app/Contents/MacOS/`), Windows `["loopy-menubar.exe"]`; uma `isCliName(platform, path)`
    que rejeita basename `loopy`/`loopy.exe` (comparação sem caixa em `darwin`/`win32`,
    exata no Linux) aplicada a **todo** candidato, inclusive `LOOPY_APP`; e um
    `isSelf?: (path) => boolean` opcional em `ResolveAppInput`, que pula o candidato.
    Atualize o docstring do módulo explicando por que `Loopy` sumiu no macOS/Windows.
    (2) **I/O, em `launch.ts`**: `declare const __LOOPY_BUNDLED__: boolean | undefined;`
    e `export const isBundled = typeof __LOOPY_BUNDLED__ !== "undefined" && __LOOPY_BUNDLED__ === true`;
    `selfDir` só é `dirname(process.execPath)` quando `isBundled`, senão `""`; `isSelf`
    compara `realpathSync` do candidato com o de `process.execPath` e de
    `process.argv[1]` (com fallback para o próprio path se o realpath falhar).
    `apps/menubar/scripts/build-sidecar.mjs`: acrescentar `"--define", "__LOOPY_BUNDLED__=true"`
    ao `bun build --compile`, com comentário do porquê (já testado: funciona).
    **Antes de mexer nos nomes do Windows/macOS**, confirme na doc ou na fonte do Tauri v2
    (bundler, `mainBinaryName`) que, sem `mainBinaryName`, o executável instalado pelo NSIS
    e o de `Contents/MacOS/` é o nome do crate (`loopy-menubar`). Se não for, pare e
    registre o achado (spec OQ3).
    Testes em `tests/open/resolve-app.test.ts`: atualize os casos que usavam `Loopy`/
    `Loopy.exe` em macOS/Windows para `loopy-menubar`; novos casos com um `exists` que
    ignora caixa: (a) macOS, `selfDir` = bin do nvm contendo `loopy` e `node`, `.app` em
    `/Applications` → resolve o `.app`; (b) macOS, `Contents/MacOS/loopy` sozinho → `ok:false`;
    (c) Windows, `loopy.exe` ao lado → `ok:false`; (d) `LOOPY_APP` apontando para a CLI
    (`/usr/local/bin/LOOPY`, `/usr/bin/loopy`, `C:\npm\Loopy.EXE`) cai para o default;
    (e) Linux continua aceitando `Loopy` e rejeitando `loopy`; (f) `isSelf` pula candidato.
    Acceptance: os casos (a)–(d) falham no código atual e passam depois; nenhum candidato
    `Loopy`/`Loopy.exe` em `darwin`/`win32`; sob Node, a mensagem "GUI não encontrada"
    não lista a pasta do Node; `loopy [dir]` intocado.
    Verification: npx vitest run tests/open tests/cli/open.test.ts && npm run typecheck && npm run lint && npm test
    Deps: none
    Files: src/open/resolve-app.ts, src/open/launch.ts, apps/menubar/scripts/build-sidecar.mjs, tests/open/resolve-app.test.ts
    Size: M
    Risk: H

- [x] T-002: `SidecarState::start` recusa quando há um sidecar vivo (B2, defesa no Rust)
    `apps/menubar/src-tauri/src/sidecar.rs`: hoje `start` faz `self.stop()?` antes do
    spawn — "um Run por vez" implementado **matando** o vivo. Isso é o que permite a um
    `loopy open --run` matar um Run que está subindo (spec B2/F4). Trocar por: se o slot
    `inner` está ocupado, devolver `Err("Run em andamento")` sem tocar no processo. Quem
    quiser trocar de Run chama `stop_sidecar` antes (confira em `main.rs`/`main.tsx` se
    algum chamador dependia do kill implícito; hoje o botão Iniciar só aparece em idle).
    O slot já é limpo no exit quando o pid confere — preserve isso. Extraia a decisão numa
    função pura se ajudar a testar (ex.: `fn can_start(slot_busy: bool) -> Result<(), String>`),
    e teste também que o exit limpa o slot e um novo `start` passa (com um processo fake,
    no padrão dos testes existentes do arquivo). Atualize o doc comment de `start`.
    Acceptance: `start` com slot ocupado → `Err`, processo vivo intacto; depois do exit, um
    novo `start` funciona; `cargo test` verde.
    Verification: mise exec -- cargo test --manifest-path apps/menubar/src-tauri/Cargo.toml && rustfmt --check apps/menubar/src-tauri/src/sidecar.rs
    Deps: none
    Files: apps/menubar/src-tauri/src/sidecar.rs
    Size: S
    Risk: M

- [x] T-003: Run ativo desde o clique em Iniciar — `runStatus: "starting"` (B2)
    Hoje `App.tsx` usa `isRunning = ui.runStatus === "running"`, e `running` só chega com o
    frame `run_started`, segundos depois do spawn. Nesse intervalo `planLaunchArgs` acha
    que não há Run e um `--run` chama `handleLaunch` (spec B2/F3).
    `state/store-bridge.ts`: `runStatus` ganha `"starting"`; exporte o tipo `RunStatus`;
    exporte uma transição pura (ex.: `markStarting(state)`) que o `handleStartRun` de
    `main.tsx` usa no lugar do `setState(initialBridgeState)`; `run_started` leva de
    `starting` a `running`; `applySidecarExit` com `starting` = **start-fail** (como `idle`
    hoje); a falha de spawn em `main.tsx` continua indo para start-fail.
    `state/launch-args.ts`: `export function isRunActive(status: RunStatus): boolean`
    (`starting` ou `running`); `LaunchContext.isRunning` passa a ser preenchido com
    `isRunActive(ui.runStatus)` no `App.tsx`, e o efeito do `pendingStart` e o efeito
    "The Run ended" também usam `isRunActive`. `RUN_PILL` ganha `starting` ("Iniciando",
    tom `running`). `popover/Glance.tsx`: `starting` não pode cair no ramo idle.
    Faça `grep -rn runStatus apps/menubar/src` e trate cada uso (o `LaunchConfig.tsx` é
    código morto — não mexa).
    Testes (vermelhos antes): `store-bridge.test.ts` (transições e exit em `starting`);
    `launch-args.test.ts` (`isRunActive`); `App.test.tsx`: clicar Iniciar e, antes de
    qualquer `run_started`, entregar `--run` pela fonte fake → `onStartRun` chamado **uma**
    vez e o aviso de Run ativo aparece. Atenção: no `App.test.tsx` o `state` vem por prop —
    simule o `starting` como o `Root` faria.
    Acceptance: um `--run` entre o clique e o `run_started` vira aviso, nunca outro start;
    exit em `starting` = start-fail; pill "Iniciando"; suítes verdes.
    Verification: npm test -w apps/menubar && npm run typecheck && npm run lint
    Deps: none
    Files: apps/menubar/src/state/store-bridge.ts, apps/menubar/src/state/store-bridge.test.ts, apps/menubar/src/state/launch-args.ts, apps/menubar/src/state/launch-args.test.ts, apps/menubar/src/main.tsx, apps/menubar/src/App.tsx, apps/menubar/src/App.test.tsx, apps/menubar/src/popover/Glance.tsx
    Size: L
    Risk: H

- [x] T-004: `--run` sempre recarrega o projeto pelo dirty guard (B3)
    Hoje, sem troca de dir, `planLaunchArgs` não emite `switchDir`, o `startAfterLoad`
    nasce `loaded: true` e o `handleLaunch` faz auto-save do rascunho sujo por cima do
    `loopy.yml` em disco (spec B3/F5). Também acontece com Run `finished` e o mesmo dir.
    `state/launch-args.ts`: com `--run` que vai iniciar, o plano **sempre** inclui o
    carregamento do dir, mesmo igual ao atual — por exemplo `switchDir` com
    `reload: true` quando o dir não muda (escolha o nome, documente). `startAfterLoad`
    vem depois dele, como na troca.
    `App.tsx`: esse carregamento passa por `requestDir` (dirty guard). O
    `startAfterLoad` deixa de assumir `loaded: true` — só o `loadDir` marca `loaded`.
    Salvar → grava, recarrega e inicia; Descartar → relê do disco e inicia; Cancelar →
    mantém tudo e descarta o `--run` (já é o que `handleDirtyConfirmCancel` faz). Sem
    rascunho sujo, relê do disco e inicia. O texto do aviso distingue os dois contextos:
    "trocar de projeto" × "iniciar um Run" (guarde o motivo junto do `dirtyConfirm`).
    Testes (vermelhos antes): `launch-args.test.ts` (mesmo dir + `--run` → recarga +
    start); `App.test.tsx`: mesmo dir + rascunho sujo + `--run` → aviso; Cancelar não
    chama save nem `onStartRun`; Descartar recarrega e inicia sem gravar; Salvar grava e
    inicia; e o mesmo com `runStatus: "finished"`.
    Acceptance: nenhum caminho de `--run` grava o yml sem passar pelo aviso quando o
    rascunho está sujo; o texto do aviso fala em iniciar Run nesse caso; suítes verdes.
    Verification: npm test -w apps/menubar && npm run typecheck && npm run lint
    Deps: T-003
    Files: apps/menubar/src/state/launch-args.ts, apps/menubar/src/state/launch-args.test.ts, apps/menubar/src/App.tsx, apps/menubar/src/App.test.tsx
    Size: M
    Risk: M

## Checkpoint: depois de T-001–T-004
- [ ] Gate completo verde (typecheck, lint, as duas suítes TS, `cargo test`)
- [ ] Os testes de regressão de B1/B2/B3 foram vistos vermelhos antes da correção
- [ ] O review não tem mais bloqueador

## Fase 2 — Menores

- [x] T-005: Pedidos adiados se acumulam e não escondem o resultado do Run (M1, M2)
    Hoje o efeito "The Run ended" do `App.tsx` aplica o `deferredLaunch` assim que o Run
    sai de ativo; como o status já é `finished`, `applyLaunchArgs` chama `onDismissRun` e
    o resultado (escalonamento/falha) some. E `setDeferredLaunch` guarda só o último
    pedido, descartando o anterior sem avisar (spec M1/M2, F6/F7).
    `state/launch-args.ts`: `export function coalesceLaunchArgs(a, b): LaunchArgs` pura —
    mesmo resultado de aplicar `a` e depois `b`: último `dir` não nulo vence, último
    `task` não nulo vence, `yes`/`verbose` = OR, `run` sempre `false`. O `warnRunActive`
    passa a informar, quando o dir muda, qual dir foi substituído.
    `App.tsx`: o `deferredLaunch` é **combinado** com `coalesceLaunchArgs`; o banner
    mostra o pedido corrente e o substituído. Quando o Run termina com pedido adiado,
    **nada é aplicado sozinho**: o banner vira "O Run terminou. Abrir `<dir>` agora?"
    (ou "aplicar as flags", sem dir) com **Abrir** (chama `onDismissRun` e aplica pelo
    `planLaunchArgs`) e **Descartar** (limpa o pedido). O board de resultado fica até o
    clique. Use as primitivas de `ui/` (`Button`) e tokens, como o banner atual.
    Testes (vermelhos antes): `launch-args.test.ts` — tabela de casos de
    `coalesceLaunchArgs` igual à aplicação sequencial; `App.test.tsx` — (a) Run termina
    com pedido adiado → `onDismissRun` **não** é chamado e o banner oferece Abrir; clicar
    Abrir → dismiss + troca de dir; Descartar → nada muda; (b) dois pedidos durante o Run
    → o banner cita os dois dirs e Abrir leva ao segundo, com as flags combinadas.
    Acceptance: o resultado de um Run nunca some sem ação do usuário; N pedidos durante um
    Run viram um, combinado; suítes verdes.
    Verification: npm test -w apps/menubar && npm run typecheck && npm run lint
    Deps: T-004
    Files: apps/menubar/src/state/launch-args.ts, apps/menubar/src/state/launch-args.test.ts, apps/menubar/src/App.tsx, apps/menubar/src/App.test.tsx
    Size: M
    Risk: M

- [x] T-006: Fila de argv no Rust e callback da segunda instância na main thread (M3 lado Rust, M4)
    Hoje o argv inicial vive num `LaunchArgsState(Mutex<Option<LaunchArgs>>)` lido uma vez
    por `take_launch_args`, e a segunda instância faz `emit_to("main", "launch-args", args)`,
    que se perde se o webview ainda não registrou o `listen` (spec M3/F8). Além disso,
    `on_second_instance` chama `surface_main_window` → `hide_popover_panel` →
    `panel.order_out` fora da main thread (hipótese M4/F10).
    `src-tauri/src/launch_args.rs`: uma `LaunchQueue` pura (`push`, `drain` → `Vec` em
    ordem de chegada e esvazia), com testes `#[cfg(test)]`: inicial + duas segundas
    instâncias → `drain` devolve as três em ordem e depois vazio.
    `src-tauri/src/main.rs`: o state vira `Mutex<LaunchQueue>`; o argv inicial entra na
    fila no `setup`; `on_second_instance` **enfileira primeiro** (fora de qualquer
    closure), depois emite `launch-args-pending` (sem payload) e roda o resto
    (`surface_main_window`) dentro de `app.run_on_main_thread`. O comando
    `take_launch_args` é **substituído** por `drain_launch_args() -> Vec<LaunchArgs>`
    (registre no `invoke_handler`). Atualize os doc comments (o "pull, não push" continua
    valendo, agora para todos os pedidos).
    Atenção: o frontend ainda chama `take_launch_args` até a T-007; para não quebrar o app
    entre as duas tasks, mantenha `take_launch_args` como alias (devolve o primeiro da
    fila) e marque-o para remoção na T-007.
    Acceptance: nenhum pedido de segunda instância depende do listener existir; o corpo de
    janela/painel do callback roda na main thread; `cargo test` verde.
    Verification: mise exec -- cargo test --manifest-path apps/menubar/src-tauri/Cargo.toml && rustfmt --check apps/menubar/src-tauri/src/launch_args.rs
    Deps: none
    Files: apps/menubar/src-tauri/src/launch_args.rs, apps/menubar/src-tauri/src/main.rs
    Size: S
    Risk: M

- [x] T-007: Boot determinístico do argv no webview (M3 lado React)
    Hoje o `App.tsx` registra o listener num `useEffect` e, em paralelo, carrega o dir
    salvo (`load_launch_config`) e só depois faz `take`. Um evento que chega antes do
    `load_launch_config` resolver é aplicado e depois sobreposto pelo `setDir(cfg.dir)` do
    dir salvo (spec M3/F9).
    `state/launch-args.ts`: `LaunchArgsSource` vira `{ drain(): Promise<LaunchArgs[]>;
    subscribe(onPending: () => void): Promise<() => void> }`. `TAURI_LAUNCH_ARGS` no
    `App.tsx` usa `drain_launch_args` e escuta `launch-args-pending`.
    `App.tsx`, nesta ordem: (1) registra o listener, que só drena se o boot terminou
    (antes disso, só marca "tem pendência"); (2) `load_launch_config` aplica as **flags**
    salvas; (3) drena; (4) se algum pedido drenado tem `dir`, **não** carrega o dir salvo;
    senão carrega; (5) aplica os pedidos drenados, combinados por `coalesceLaunchArgs`
    **preservando o `run` do último** (no boot não há Run ativo), pelo `planLaunchArgs`;
    (6) marca o boot concluído e drena de novo. Cuidado com o StrictMode (o comentário
    atual sobre o `take` não ser cancelado explica o risco: o `drain` também é consumível).
    Remova o alias `take_launch_args` do Rust (`main.rs`, `invoke_handler`).
    Testes (vermelhos antes) em `App.test.tsx` com uma fonte fake controlável: argv
    enfileirado antes do mount → aplicado; argv que chega durante o `load_launch_config`
    → aplicado depois, e o dir salvo não sobrepõe; dois argv antes do boot → o último dir
    vence; argv que chega depois do boot → aplicado ao receber o `pending`. Ajuste os
    testes existentes que usam `take`.
    Acceptance: nenhum argv aplicado antes do passo 5; o dir salvo nunca sobrepõe um
    pedido de `loopy open`; nenhum pedido perdido; suítes TS e `cargo test` verdes.
    Verification: npm test -w apps/menubar && npm run typecheck && npm run lint && mise exec -- cargo test --manifest-path apps/menubar/src-tauri/Cargo.toml
    Deps: T-005, T-006
    Files: apps/menubar/src/state/launch-args.ts, apps/menubar/src/App.tsx, apps/menubar/src/App.test.tsx, apps/menubar/src-tauri/src/main.rs
    Size: M
    Risk: M

## Checkpoint: depois de T-005–T-007
- [ ] Gate completo verde
- [ ] Smoke manual no Linux (lista no `plan.md`)

## Fase 3 — Documentação

- [x] T-008: ADR-0014, intent nodes e `cli.md` refletem as correções
    `docs/adrs/0014-distribuicao-e-release-automatico.md`: adendo datado (2026-10-30,
    C-0021) com F1/F2 (como `loopy open` acha a GUI: nomes por plataforma, nunca a CLI,
    irmãos só no binário empacotado) e F3–F10 (Run ativo desde `starting`, `start`
    recusa, `--run` pelo dirty guard, adiados combinados e confirmados, fila de argv
    drenada, main thread). `docs/reference/cli.md`: ordem de busca do `loopy open`
    atualizada. `apps/menubar/CLAUDE.md` e `apps/menubar/src/CLAUDE.md` (e
    `src-tauri/CLAUDE.md`, se citar o `take_launch_args`): substituir a descrição do
    argv de launch — fila/`drain_launch_args`/`launch-args-pending`, `starting`, banner
    "Abrir agora", `start` que recusa. Mantenha os nodes enxutos (regra do próprio
    `CLAUDE.md`). Rode `grep -rn "take_launch_args\|Loopy.exe" docs apps src` e não deixe
    referência velha.
    Acceptance: nenhum doc descreve o comportamento antigo; ADR com adendo; `cli.md` com a
    ordem nova.
    Verification: grep -rn "take_launch_args" docs apps/menubar/CLAUDE.md apps/menubar/src/CLAUDE.md apps/menubar/src-tauri/CLAUDE.md; test $? -eq 1
    Deps: T-001, T-002, T-003, T-004, T-005, T-006, T-007
    Files: docs/adrs/0014-distribuicao-e-release-automatico.md, docs/reference/cli.md, apps/menubar/CLAUDE.md, apps/menubar/src/CLAUDE.md, apps/menubar/src-tauri/CLAUDE.md
    Size: S
    Risk: L

## Fase 4 — Achados da verificação independente (2026-10-31)

> A verificação completa (gate + smoke da GUI de release no Linux) achou os itens
> abaixo. Mesmas regras do topo (TDD, `fix(...)`, sem co-author).

- [x] T-009: O motor sob `--emit-events` sai depois do Run (e de falha fatal no start)
    O `createStdinApproval` abre um `readline` sobre o stdin e nunca o fecha; a GUI
    mantém o stdin aberto, então o sidecar não sai depois do `run_finished` nem de um
    erro fatal no start. Antes, o `start` do Rust matava esse processo parado; com a
    T-002 ele recusa, e a GUI não inicia outro Run sem reiniciar (e fica em
    "Iniciando" para sempre num start que falha). Corrigir: a aprovação por stdin
    ganha `close()` (pendentes resolvem `false`, fail-closed), o `stop()` do `startUi`
    a fecha (idempotente), e o entrypoint libera o stdin quando `run()` termina.
    Acceptance: `sleep 30 | loopy --no-tui --emit-events <proj>` sai sozinho depois do
    `run_finished`; idem num start com agente que falha.
    Verification: npx vitest run tests/tui && npm run typecheck && npm run lint && npm test
    Deps: none
    Files: src/tui/approval.ts, src/tui/start.ts, src/index.ts, tests/tui/approval.test.ts
    Size: S
    Risk: H

- [ ] T-010: Fila de argv semeada antes do `Builder` (corrida do boot)
    Com o app fechado, `loopy open B; loopy open C` (< 0,5 s) abria em B: o
    `on_second_instance` empurrava C antes de o `setup` empurrar o argv inicial B, e o
    último dir vencia. Parsear o argv inicial em `main()` e semear a fila no `.manage`.
    Acceptance: a fila sempre começa pelo argv inicial; `cargo test` verde.
    Verification: mise exec -- cargo test --manifest-path apps/menubar/src-tauri/Cargo.toml
    Deps: none
    Files: apps/menubar/src-tauri/src/main.rs
    Size: XS
    Risk: M

- [ ] T-011: Salvar com rascunho inválido no aviso não descarta o rascunho
    `handleDirtyConfirmSave` ignorava o `false` do `save()` e seguia com o load (e o
    `--run`). Manter o aviso aberto, com mensagem, quando o save falha.
    Acceptance: save que falha → nada é carregado nem iniciado, o aviso continua.
    Verification: npm test -w apps/menubar && npm run typecheck && npm run lint
    Deps: none
    Files: apps/menubar/src/App.tsx, apps/menubar/src/App.test.tsx
    Size: S
    Risk: M

- [ ] T-012: Aviso e pedido adiado não vazam entre Runs
    O pedido adiado nunca era limpo (reaparecia num Run seguinte, com "--run
    ignorado" herdado); e um `--run` sem nada mais durante um Run guardava um pedido
    vazio ("Aplicar as flags…" sem flags). Limpar o adiado ao aplicar argv fora de Run
    e ao iniciar um Run; `--run` puro durante um Run só avisa, sem guardar nada.
    Acceptance: testes de planner e App cobrindo os três casos.
    Verification: npm test -w apps/menubar && npm run typecheck && npm run lint
    Deps: T-011
    Files: apps/menubar/src/state/launch-args.ts, apps/menubar/src/state/launch-args.test.ts, apps/menubar/src/App.tsx, apps/menubar/src/App.test.tsx
    Size: S
    Risk: L

- [ ] T-013: O popover vê o `starting`
    O popover é outro webview e nunca entrava em `starting` (o "Parar" ficava
    desabilitado durante o start). O Rust emite `sidecar://started` no spawn e o `Root`
    do popover entra em `starting`.
    Acceptance: popover habilita Parar durante o start; suítes verdes.
    Verification: npm test -w apps/menubar && mise exec -- cargo test --manifest-path apps/menubar/src-tauri/Cargo.toml
    Deps: T-010
    Files: apps/menubar/src-tauri/src/sidecar.rs, apps/menubar/src/main.tsx
    Size: XS
    Risk: L
