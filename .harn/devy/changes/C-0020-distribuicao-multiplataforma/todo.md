# Backlog: C-0020 — Distribuição multiplataforma

> Consumido pelo motor (`- [ ]` pendente / `- [x]` concluída; id `T-\d+`; corpo indentado).
> Narrativa, grafo, checkpoints e riscos: ver `plan.md` (mesma pasta); as decisões
> D1–D4 e E1–E11, em `spec.md`. **Não re-litigar.**
>
> **Arestas que existem só para serializar merge (mesmo arquivo) — não remover:**
> `T-003→T-001` e `T-004→T-003` (`docs/how-to/plataformas.md`), `T-011→T-001`
> (`src-tauri/src/main.rs`), `T-014→T-008,T-010,T-013` (docs do código final).
>
> **Invariantes desta change:** `loopy [dir]` e o argv do sidecar
> (`--no-tui --emit-events`) **não mudam** (D1); nenhum `hgflima/loopy` literal em
> `.github/`, `scripts/release/` ou `docs/how-to/instalar.md` — o repo vem de
> `${{ github.repository }}`/`--repo` (E11); decisões são funções puras e testadas,
> I/O fino em volta (AD-6); erro é valor nas fronteiras (AD-5); lançar a GUI **nunca**
> com `shell: true`; `identifier`/`productName`/nome do pacote npm **não mudam**;
> nenhuma dependência além das do Tech Stack da spec.
>
> **Formatação:** `prettier --write` **apenas** em arquivo NOVO — o repo está fora de
> sincronia e reformatar um arquivo existente altera código alheio. `cargo fmt` só no
> arquivo tocado (`rustfmt --check src/<arquivo>.rs`).
>
> Cada linha `Deps:` fica **isolada, ids limpos, sem ponto final** (bug D-0001 do `parseDeps`).

## Fase 1 — Linha de base e gate de CI

- [ ] T-001: Linha de base — commitar a portabilidade já feita e alinhar a versão do menubar
    O trabalho de portabilidade da sessão da spec está na working tree, sem commit:
    `mise.toml`; `apps/menubar/scripts/build-sidecar.mjs` (cross-platform, já lê
    `TAURI_ENV_TARGET_TRIPLE`) e `install-linux-desktop.mjs`; o script `build:sidecar`
    e `install:linux-desktop` em `apps/menubar/package.json`; o guard do positioner e
    demais ajustes Linux em `src-tauri/src/main.rs`; `apps/menubar/src/ui/platform.ts`
    (+ teste) usado por `main.tsx` e `specs/Attachable.tsx`; o fix do import default do
    `@dagrejs/dagre` em `src/tui/view.ts`; `docs/how-to/plataformas.md` e o link em
    `docs/how-to/README.md`; ajustes nos `CLAUDE.md` do menubar. **Não re-desenhe nada
    disso** — revise, rode a suíte, corrija só o que estiver quebrado.
    Além disso, `apps/menubar/package.json` está em `0.5.1` e a raiz em `0.6.0`, o que
    deixa `apps/menubar/src/version-single-source.test.ts` vermelho — alinhe o menubar
    para a versão da raiz (higiene; a raiz é a fonte, E4).
    A pasta `.harn/devy/changes/C-0020-distribuicao-multiplataforma/` (spec/plan/todo)
    entra no mesmo commit.
    Acceptance: toda a working tree da linha de base commitada (conventional commit
    `chore:`/`fix:` — não `feat:`); `version-single-source` verde; nenhuma mudança de
    comportamento no macOS (o guard só desliga o que não existe fora dele).
    Verification: npm run typecheck && npm run lint && npm test && npm test -w apps/menubar && mise exec -- cargo test --manifest-path apps/menubar/src-tauri/Cargo.toml
    Deps: none
    Files: mise.toml, apps/menubar/package.json, apps/menubar/scripts/build-sidecar.mjs, apps/menubar/scripts/install-linux-desktop.mjs, apps/menubar/src-tauri/src/main.rs, apps/menubar/src/ui/platform.ts, apps/menubar/src/ui/platform.test.ts, apps/menubar/src/main.tsx, apps/menubar/src/specs/Attachable.tsx, src/tui/view.ts, docs/how-to/plataformas.md, docs/how-to/README.md
    Size: M
    Risk: L

- [ ] T-002: `ci.yml` — gate de PR com suítes TS, `cargo test`, `actionlint` e guarda de portabilidade
    Novo `.github/workflows/ci.yml`, disparado em `pull_request` e `push` (todas as
    branches). Toolchain via `jdx/mise-action` lendo o `mise.toml` da raiz (E7); libs de
    sistema do Tauri via `apt` (a lista está em `docs/how-to/plataformas.md` §2 —
    reuse-a). Jobs (permissões mínimas e explícitas **por job**, `contents: read`;
    ações pinadas por versão maior, como no `publish.yml` atual):
    (1) `ts`: `npm ci`, `npm run typecheck`, `npm run lint`, `npm test`,
    `npm test -w apps/menubar` — atenção: o `npm test` da raiz **não** cobre o menubar;
    (2) `rust` (ubuntu): `cargo test --manifest-path apps/menubar/src-tauri/Cargo.toml`
    (o `build.rs` cria o placeholder do sidecar, então não precisa do `bun build`);
    (3) `actionlint` sobre `.github/workflows/`;
    (4) guarda de portabilidade (E11): falha se `hgflima/loopy` aparecer em
    `.github/`, `scripts/release/` ou `docs/how-to/instalar.md` — tolerante a caminho
    ainda inexistente (esses dois últimos nascem em T-006/T-014). O próprio `ci.yml` não
    pode conter o literal que procura (monte o padrão sem escrevê-lo inteiro, ou exclua o
    arquivo do grep).
    Acceptance: `actionlint` limpo sobre o próprio `ci.yml`; os comandos dos jobs passam
    localmente; a guarda acusa um `hgflima/loopy` plantado num arquivo de teste e passa
    sem ele.
    Verification: actionlint .github/workflows/ci.yml && npm run typecheck && npm run lint && npm test && npm test -w apps/menubar
    Deps: T-001
    Files: .github/workflows/ci.yml
    Size: S
    Risk: M

## Fase 2 — Release: fundações (alto risco primeiro)

- [ ] T-003: GUI compila no Windows — placeholder `.exe` no `build.rs` (W7) e `EXE_SUFFIX` no `sidecar.rs` (W8)
    Mínimo para o job Windows do release gerar o NSIS (escopo: compilar, não rodar).
    `apps/menubar/src-tauri/build.rs`: o placeholder hoje é `bin/loopy-<triple>`; quando
    `CARGO_CFG_TARGET_OS == "windows"` o `tauri_build` espera `bin/loopy-<triple>.exe`.
    `apps/menubar/src-tauri/src/sidecar.rs` `resolve_sidecar_path`: anexar
    `std::env::consts::EXE_SUFFIX` a cada candidato (`loopy`, `loopy-<triple>`,
    `bin/loopy-<triple>`). Extraia a montagem dos candidatos numa função pura
    `sidecar_candidates(dir, triple, exe_suffix)` e teste-a com `""` e `".exe"`
    (estende os testes existentes de `is_executable_file`).
    `docs/how-to/plataformas.md`: marcar W7 e W8 como resolvidos (mover para "Já
    resolvido") e ajustar a tabela de status.
    Acceptance: candidatos com `.exe` quando o sufixo é `.exe`, idênticos aos de hoje
    quando vazio; `cargo test` verde no Linux; W7/W8 marcados no mapa.
    Verification: mise exec -- cargo test --manifest-path apps/menubar/src-tauri/Cargo.toml && rustfmt --check apps/menubar/src-tauri/src/sidecar.rs apps/menubar/src-tauri/build.rs
    Deps: T-001
    Files: apps/menubar/src-tauri/build.rs, apps/menubar/src-tauri/src/sidecar.rs, docs/how-to/plataformas.md
    Size: S
    Risk: L

- [ ] T-004: `bundle.targets` por plataforma via `tauri.<os>.conf.json`
    Hoje `tauri.conf.json` tem `"targets": "all"`. Crie os arquivos de config por
    plataforma que o Tauri v2 mescla por cima (confirme o mecanismo e os nomes na doc
    oficial do Tauri v2 antes — source-driven): `tauri.linux.conf.json` →
    `["appimage", "deb"]`; `tauri.macos.conf.json` → `["app", "dmg"]`;
    `tauri.windows.conf.json` → `["nsis"]` (instala por usuário, sem admin). **Não**
    mexa no `version` path-ref do `tauri.conf.json` (o teste `version-single-source`
    guarda isso). Rode `npm run menubar` no Linux e confirme que saem um `.AppImage` e um
    `.deb` em `src-tauri/target/release/bundle/` (e **não** um `.rpm`). Anote os nomes
    reais dos artefatos gerados (formato `Loopy_<versão>_<arch>.<ext>`) em
    `docs/how-to/plataformas.md` — T-006 e T-008 dependem dessa convenção.
    Acceptance: build Linux gera exatamente AppImage + deb; os três arquivos por SO
    existem e são JSON válido; `version-single-source` continua verde.
    Verification: npm run menubar && ls apps/menubar/src-tauri/target/release/bundle/appimage/*.AppImage apps/menubar/src-tauri/target/release/bundle/deb/*.deb && npm test -w apps/menubar -- version-single-source
    Deps: T-003
    Files: apps/menubar/src-tauri/tauri.linux.conf.json, apps/menubar/src-tauri/tauri.macos.conf.json, apps/menubar/src-tauri/tauri.windows.conf.json, docs/how-to/plataformas.md
    Size: S
    Risk: M

- [ ] T-005: Spike + config do semantic-release com sincronização de versão (E4)
    Prova, localmente e sem efeitos, o cálculo de versão do qual o `release.yml` (T-008)
    vai depender. Adicione como devDependencies da raiz **somente** `semantic-release`,
    `@semantic-release/{commit-analyzer,release-notes-generator,changelog,github,git,exec}`
    (aprovadas na spec). Crie `.releaserc.json`: `branches: ["main"]`, `tagFormat: "v${version}"`;
    plugins na ordem commit-analyzer → release-notes-generator → changelog (`CHANGELOG.md`)
    → exec (`prepareCmd: node scripts/release/sync-version.mjs ${nextRelease.version}`)
    → git (assets: `package.json`, `package-lock.json`, `apps/menubar/package.json`,
    `CHANGELOG.md`; mensagem `chore(release): ${nextRelease.version} [skip ci]`) →
    github com **`draftRelease: true`** (E5) e sem `successComment`/`failComment`
    (ruído). Sem `@semantic-release/npm`: o publish é um job próprio (E5/E10).
    `scripts/release/sync-version.mjs <versão>`: grava a versão na raiz, em
    `apps/menubar/package.json` e nas entradas correspondentes do `package-lock.json`;
    a lógica é uma função pura exportada (`syncVersion(files, version) → files`) com
    `.d.mts` ao lado (o `tsconfig` strict sem `allowJs` recusa `.mjs` sem tipos nos
    testes); o CLI só roda quando o módulo é o entrypoint. Teste em
    `tests/release/sync-version.test.ts`.
    Acceptance: `npx semantic-release --dry-run --no-ci` (na `main` local) calcula a
    próxima versão a partir dos commits desde `v0.6.0` sem criar tag nem commit;
    `syncVersion` deixa raiz e menubar iguais e rejeita versão não-semver; nenhum
    `hgflima/loopy` literal na config.
    Verification: npm test -- tests/release/sync-version && npx semantic-release --dry-run --no-ci && npm run typecheck && npm run lint
    Deps: T-001
    Files: package.json, package-lock.json, .releaserc.json, scripts/release/sync-version.mjs, scripts/release/sync-version.d.mts, tests/release/sync-version.test.ts
    Size: M
    Risk: H

- [ ] T-006: `instructions_install.txt` — template versionado + renderizador puro (E9)
    `scripts/release/instructions_install.template.txt`: um **prompt autocontido para um
    modelo agêntico** instalar o loopy numa máquina: detectar SO/arch; pré-requisitos
    (Node ≥22.13; no Linux `libfuse2` para o AppImage, checar antes de instalar);
    baixar e instalar o app (Linux: AppImage em `~/Applications` + `chmod +x` +
    integração ao menu de apps, ou o `.deb`; macOS: `.dmg` + remover quarentena **só do
    app** com `xattr -dr com.apple.quarantine /Applications/Loopy.app` — **nunca**
    `spctl --master-disable`; Windows: o setup NSIS e o aviso do SmartScreen); instalar
    a CLI com `npm i -g <pacote>@<versão>`; e **verificar cada passo** com comando +
    saída esperada (`loopy --version` = a versão do release, `loopy open --help`).
    macOS e Windows marcados como **experimentais** (spec, Riscos aceitos).
    Placeholders: versão, repo (`owner/name`), nome do pacote npm, e a URL de download
    de **cada** asset (por plataforma).
    `scripts/release/render-instructions.mjs`: função pura exportada
    `renderInstructions({ template, version, repo, npmPackage, assets }) → string` (+
    `.d.mts`), onde `assets` é a lista `{ name, url }` do release; classifica os assets
    por plataforma pela extensão/arch (`.AppImage`, `.deb`, `.dmg`, `-setup.exe` —
    convenção do `tauri-action`; confira em `docs/how-to/plataformas.md` se T-004 já
    anotou os nomes reais) e **falha** (erro, não string) se faltar alguma plataforma —
    release incompleto não gera instrução mentirosa. CLI:
    `node scripts/release/render-instructions.mjs --version X --repo o/r --npm-package P --assets assets.json`
    → stdout; ler o template relativo ao próprio script.
    Acceptance: renderizado contém versão, repo, pacote e uma URL por plataforma, sem
    placeholder sobrando; faltar o `.dmg` (ou qualquer um) é erro; renderizado com
    `--repo outra-org/loopy` não contém `hgflima`; template sem `hgflima/loopy` literal.
    Verification: npm test -- tests/release/render-instructions && npm run typecheck && npm run lint
    Deps: none
    Files: scripts/release/instructions_install.template.txt, scripts/release/render-instructions.mjs, scripts/release/render-instructions.d.mts, tests/release/render-instructions.test.ts
    Size: M
    Risk: M

- [ ] T-007: `set-repo.mjs` — apontar `repository`/`bugs`/`homepage` para outro `owner/repo` (E11)
    `scripts/release/set-repo.mjs <owner/repo>`: reescreve os campos `repository.url`,
    `bugs.url` e `homepage` do `package.json` da raiz para o repo dado, preservando o
    resto do arquivo (ordem de chaves, indentação de 2 espaços, newline final). Lógica
    em função pura exportada `setRepo(pkg, repo) → pkg` (+ `.d.mts`), que **rejeita**
    um argumento fora do formato `owner/repo`. **Não rode** o script contra o
    `package.json` real nesta task (trocar o owner é decisão em aberto — D4).
    Acceptance: `setRepo` produz as três URLs do repo novo e não toca outros campos;
    entrada inválida (`foo`, `a/b/c`, URL) é erro; script sem `hgflima/loopy` literal.
    Verification: npm test -- tests/release/set-repo && npm run typecheck && npm run lint
    Deps: none
    Files: scripts/release/set-repo.mjs, scripts/release/set-repo.d.mts, tests/release/set-repo.test.ts
    Size: S
    Risk: L

## Fase 3 — O workflow de release

- [ ] T-008: `release.yml` — draft → build em 3 SOs → instruções → npm + publicar; remove o `publish.yml`
    Novo `.github/workflows/release.yml` (E5), `on: push: branches: [main]` +
    `workflow_dispatch` (recuperação, E10). `concurrency` por workflow sem cancelar em
    andamento. Repo **sempre** de `${{ github.repository }}` (E11). Jobs encadeados,
    permissões mínimas por job, toolchain via `jdx/mise-action`:
    (1) `release` (`contents: write`): checkout com histórico e tags (`fetch-depth: 0`),
    `npm ci`, `npx semantic-release` (config de T-005 — cria commit de versão, tag e
    **draft**). Outputs: `published` (houve release?), `version`, `tag` e o **id do
    draft** — a API `GET /releases/tags/{tag}` **não** vê drafts; liste `/releases` e
    filtre por `tag_name`. Sem release (só `docs:`/`chore:`) → os demais jobs são pulados.
    (2) `build` (matriz `ubuntu-22.04`/`macos-14`/`windows-latest`, E6; `fail-fast:
    false`): checkout **da tag** (não do `github.sha` — a versão nova está no commit de
    release), libs `apt` no Linux, `npm ci`, `npm run build:sidecar -w apps/menubar`
    com `TAURI_ENV_TARGET_TRIPLE` do runner, e `tauri-apps/tauri-action` com
    `projectPath: apps/menubar` e `releaseId` do draft (anexa os bundles de T-004).
    (3) `instructions` (needs `build`): lista os assets do draft (`gh api`), roda
    `render-instructions.mjs` (T-006) com versão, repo, pacote npm e assets, e anexa
    `instructions_install.txt` ao draft.
    (4) `publish` (needs `instructions`; `contents: write`, `id-token: write`): se
    `vars.NPM_PUBLISH_ENABLED == 'true'`, faz checkout da tag, `npm ci`, aplica
    `vars.NPM_PACKAGE_NAME` ao `name` quando definida (`npm pkg set`) e `npm publish
    --provenance` via OIDC (preserve as notas do `publish.yml` atual: Node 24, **sem**
    `npm i -g npm@latest`); senão emite `::warning::` e segue. Por fim, promove o draft a
    público (`gh release edit <tag> --draft=false`). Falha em qualquer job anterior →
    draft fica, npm não publica (critério 5).
    Remova `.github/workflows/publish.yml` (senão o npm publicaria duas vezes — E10).
    Acceptance: `actionlint` limpo; nenhum `hgflima/loopy` literal; o grafo de `needs`
    garante que publicar e tornar público só acontecem com os 3 builds e as instruções
    ok; `publish.yml` removido; npm desabilitado = aviso, não falha.
    Verification: actionlint .github/workflows/release.yml .github/workflows/ci.yml && ! grep -rn "hgflima/loopy" .github/ scripts/release/ && test ! -e .github/workflows/publish.yml
    Deps: T-002, T-004, T-005, T-006, T-007
    Files: .github/workflows/release.yml, .github/workflows/publish.yml
    Size: L
    Risk: H

## Fase 4 — `loopy open` e a GUI que o recebe

- [ ] T-009: `resolveApp` — resolução pura do executável da GUI (E1)
    `src/open/resolve-app.ts` (função pura sobre `(platform, env, selfDir, home,
    exists)` — a assinatura está no "Code Style" da spec): candidatos em ordem —
    (1) `env.LOOPY_APP`; (2) GUI **irmã** do executável corrente (`selfDir`: o caso do
    sidecar embutido no bundle — macOS `…/Loopy.app/Contents/MacOS/Loopy`, Linux/Windows
    o executável da GUI no mesmo dir); (3) defaults por SO: macOS `/Applications/Loopy.app`
    e `~/Applications/Loopy.app` (resolvidos para o binário em `Contents/MacOS/`); Linux
    `loopy-menubar`/`Loopy` do `.deb` em cada dir do `PATH`, `~/Applications/Loopy*.AppImage`
    e `~/.local/bin/Loopy*.AppImage` (glob: receba um `list(dir)` injetado, ou peça o
    padrão ao chamador — mantenha a função pura); Windows
    `%LOCALAPPDATA%\Programs\Loopy\Loopy.exe` e `%ProgramFiles%\Loopy\Loopy.exe`.
    Confira o nome real do binário instalado pelo `.deb` (é o `mainBinaryName`/nome do
    crate — veja `Cargo.toml`/`tauri.conf.json`). `LOOPY_APP` apontando para algo
    inexistente **cai** para o próximo candidato. Nada achado →
    `{ ok:false, searched }` com a lista na ordem tentada. `src/open/index.ts` (barrel).
    Use `path.posix`/`path.win32` conforme `platform` (testes rodam no Linux simulando os
    três SOs).
    Acceptance: ordem env → sibling → default por SO coberta nos 3 SOs; `LOOPY_APP`
    inexistente cai para o próximo; vazio lista tudo que buscou; zero `node:fs` dentro da
    função (`exists`/`list` injetados).
    Verification: npm test -- tests/open/resolve-app && npm run typecheck && npm run lint
    Deps: none
    Files: src/open/resolve-app.ts, src/open/index.ts, tests/open/resolve-app.test.ts
    Size: S
    Risk: L

- [ ] T-010: Subcomando `loopy open [dir] [flags]` — spawn destacado da GUI (D1, E2)
    Registre `open` em `src/index.ts` (commander) no mesmo padrão dos subcomandos
    existentes (`probe-agent`, `interview`): `loopy open [dir] [--task <id>] [--yes]
    [--verbose] [--run]`. `dir` é resolvido para **absoluto** contra o cwd de quem chamou;
    **sem dir** = só abre/foca o app, sem passar dir (Open Question 4 da spec — proposta
    adotada). Resolve a GUI com `resolveApp` (T-009, `exists` real) e lança via
    `src/open/launch.ts`: `spawn(path, argv, { detached: true, stdio: "ignore", shell:
    false })` + `unref()` — **nunca** `shell: true`. No macOS, lançar o binário em
    `Contents/MacOS/` diretamente (não `open -a`, que engole o argv numa instância
    já aberta). Argv no contrato E2: `[dir] [--task <id>] [--yes] [--verbose] [--run]`.
    GUI não achada → stderr em português listando onde procurou + dica de instalação
    (aponte para o `instructions_install.txt` do release / `docs/how-to/instalar.md`) e
    exit ≠ 0. O `launch` é **injetável** em `run()` (como o runner do `interview`) para o
    teste não fazer spawn real. `loopy [dir]` (sem `open`) **inalterado**.
    Documente em `docs/reference/cli.md`: o subcomando, as flags, a ordem de busca e
    `LOOPY_APP`, e o caso da pasta chamada `open/` (`loopy ./open` roda o loop nela).
    Acceptance: `open` registrado; `dir` relativo vira absoluto; flags repassadas na
    ordem do contrato; GUI ausente = exit ≠ 0 com a lista do que buscou; `loopy <dir>`
    continua rodando o loop (teste de regressão).
    Verification: npm test -- tests/cli/open && npm test && npm run typecheck && npm run lint
    Deps: T-009
    Files: src/index.ts, src/open/launch.ts, src/open/index.ts, tests/cli/open.test.ts, docs/reference/cli.md
    Size: M
    Risk: M

- [ ] T-011: `parse_launch_args` — parsing puro do argv da GUI no Rust (E2)
    Novo `apps/menubar/src-tauri/src/launch_args.rs` com `LaunchArgs { dir, task, yes,
    verbose, run }` (serde `Serialize`, `Clone`, `Default`, `PartialEq`) e
    `parse_launch_args(argv: &[String], cwd: &Path) -> Result<LaunchArgs, String>` (a
    assinatura está no "Code Style" da spec). `argv[0]` é o executável e é ignorado;
    `dir` relativo é resolvido contra o `cwd` **de quem chamou** (na segunda instância,
    o cwd que o plugin single-instance repassa); `--task` exige valor; flag desconhecida
    = `Err`; argv só com o executável = `LaunchArgs::default()`. Ignore argumentos que o
    SO injeta no launch do macOS (`-psn_…`). Declare `mod launch_args;` em `main.rs`
    (só a declaração — o uso é T-012).
    Acceptance: testes `#[cfg(test)]` cobrindo dir relativo × absoluto, cada flag,
    `--task` sem valor = erro, flag desconhecida = erro, argv vazio = default, `-psn_`
    ignorado.
    Verification: mise exec -- cargo test --manifest-path apps/menubar/src-tauri/Cargo.toml launch_args && rustfmt --check apps/menubar/src-tauri/src/launch_args.rs
    Deps: T-001
    Files: apps/menubar/src-tauri/src/launch_args.rs, apps/menubar/src-tauri/src/main.rs
    Size: S
    Risk: L

- [ ] T-012: Instância única + entrega do argv ao webview (E3)
    Adicione `tauri-plugin-single-instance` (v2 — aprovado na spec) ao `Cargo.toml`.
    Registre-o **primeiro** no `Builder` (exigência do plugin). Argv inicial: no
    `setup`, `parse_launch_args(std::env::args(), cwd atual)` → guardado num `State`
    (`Mutex<Option<LaunchArgs>>`) e exposto por um comando **`take_launch_args`** que o
    webview chama ao montar (modelo *pull*: um `emit` no `setup` corre antes do listener
    existir e se perde em silêncio — ver `plan.md`). Segunda instância: no callback do
    plugin (recebe `argv` e `cwd`), parse com o `cwd` repassado, `emit` do evento
    `launch-args` para a janela `main`, e mostre/foque a janela (reuse
    `surface_main_window`). Erro de parse → loga e foca a janela sem trocar de projeto
    (não derruba o app). Registre o comando no `invoke_handler` e, se necessário, a
    permissão em `capabilities/default.json`. Sem dir **e** sem flags no argv inicial =
    comportamento de hoje (abre no tray, janela escondida).
    Acceptance: `cargo test` verde; app abre normalmente sem argv (regressão); com o app
    aberto, rodar o binário de novo com um dir **não** abre segunda janela e emite
    `launch-args` (verificar à mão no Linux com `npm run dev -w apps/menubar` + o binário
    de `target/debug`).
    Verification: mise exec -- cargo test --manifest-path apps/menubar/src-tauri/Cargo.toml && rustfmt --check apps/menubar/src-tauri/src/main.rs && npm run typecheck
    Deps: T-011
    Files: apps/menubar/src-tauri/Cargo.toml, apps/menubar/src-tauri/Cargo.lock, apps/menubar/src-tauri/src/main.rs, apps/menubar/src-tauri/capabilities/default.json
    Size: M
    Risk: M

- [ ] T-013: GUI aplica o argv recebido — troca de projeto pelo dirty guard, pré-preenche flags, `--run` controlado
    Novo `apps/menubar/src/state/launch-args.ts`: tipo `LaunchArgs` (espelho serde do
    Rust: `dir`, `task`, `yes`, `verbose`, `run`) e um planejador **puro**
    `planLaunchArgs(args, { currentDir, isRunning }) → ações` (ex.: `switchDir`,
    `setFlags`, `startAfterLoad`, `warnRunActive`). Fiação em `App.tsx`: ao montar,
    `invoke("take_launch_args")`; depois, `listen("launch-args")`. Regras:
    trocar de dir passa pelo **dirty guard existente** (`dirtyConfirm` —
    Salvar/Descartar/Cancelar), nunca por fora dele; flags pré-preenchem `flagYes`/
    `flagTaskId`/`flagVerbose`; **`--run` só inicia depois que o `loopy.yml` do dir novo
    carregou** e só se `canStart` — sem `--run`, nunca inicia; com um Run ativo em outro
    projeto, **não mata o Run**: abre o projeto e mostra um aviso (E3) — se a GUI hoje
    não permite trocar de dir com Run ativo, o aviso explica isso e a troca fica para
    quando o Run acabar (não invente um segundo Run). Cancelar no dirty guard descarta o
    `--run` pendente.
    Acceptance: testes do planejador puro (dir igual/diferente, com/sem `--run`, Run
    ativo) e de `App` (troca com config sujo abre o dirty guard; `--run` só dispara
    `start_sidecar` após o load; sem `--run` nunca dispara).
    Verification: npm test -w apps/menubar -- launch-args App && npm run typecheck && npm run lint
    Deps: T-012
    Files: apps/menubar/src/state/launch-args.ts, apps/menubar/src/state/launch-args.test.ts, apps/menubar/src/App.tsx, apps/menubar/src/App.test.tsx
    Size: M
    Risk: M

## Fase 5 — Documentação e fechamento

- [ ] T-014: Docs de instalação e troca de repo, ADR-0014 e intent nodes
    `docs/how-to/instalar.md` (humano, por SO): baixar do GitHub Release mais recente
    (`https://github.com/<owner>/<repo>/releases` — **sem** `hgflima/loopy` literal; use
    um placeholder explicado), instalar app e CLI, `loopy open .`, contornos do aviso de
    "desenvolvedor não identificado" **por app**, macOS/Windows experimentais.
    `docs/how-to/trocar-repositorio.md` (E11): `node scripts/release/set-repo.mjs
    <owner/repo>`; Variables `NPM_PACKAGE_NAME`/`NPM_PUBLISH_ENABLED`; registrar o
    Trusted Publisher do npm para o `release.yml`; permissões de Actions (escrever na
    `main`, branch protection — Open Question 2); o que acontece sem npm configurado.
    `docs/how-to/plataformas.md`: status dos bundles por SO e do CI. `docs/how-to/README.md`:
    links. **`docs/adrs/0014-distribuicao-e-release-automatico.md`** (a 0013 já existe —
    a spec erra o número) com D1–D4, E1–E11 e as decisões do `plan.md` (targets por
    arquivo de plataforma, argv *pull*, draft por id, npm opt-in por Variable) — use a
    skill `adr_management` / o template de `docs/adrs/`, e reindexe o `README` dos ADRs.
    `CLAUDE.md` da raiz: o subcomando `loopy open` em "Entry Points"; a convenção de
    conventional commits **é** o semver (`feat`→minor, `fix`/`perf`→patch, `!`→major) em
    "Usage Patterns"; `src/open/` em "Módulos de apoio". `apps/menubar/CLAUDE.md`: argv
    de launch, instância única, `take_launch_args`/`launch-args`. Mantenha os `CLAUDE.md`
    concisos (regra "Maintaining this file").
    Acceptance: guarda de portabilidade do CI passa com `instalar.md` presente; ADR-0014
    indexada; links do README de how-to resolvem; nenhum doc descreve comportamento que o
    código não tem.
    Verification: ! grep -rn "hgflima/loopy" docs/how-to/instalar.md docs/how-to/trocar-repositorio.md .github/ scripts/release/ && npm run lint
    Deps: T-008, T-010, T-013
    Files: docs/how-to/instalar.md, docs/how-to/trocar-repositorio.md, docs/how-to/plataformas.md, docs/how-to/README.md, docs/adrs/0014-distribuicao-e-release-automatico.md, docs/adrs/README.md, CLAUDE.md, apps/menubar/CLAUDE.md
    Size: M
    Risk: L
