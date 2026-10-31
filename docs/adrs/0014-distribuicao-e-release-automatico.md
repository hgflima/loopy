---
number: 0014
title: "Distribuição multiplataforma e release automático"
status: accepted
date: 2026-10-27
status_date: 2026-10-27
supersedes: []
superseded_by: null
---

# ADR-0014 — Distribuição multiplataforma e release automático

## Context

Até a C-0020 o `loopy` chegava a alguém de dois jeitos: `npm i -g` da CLI
(publicada à mão — bump, tag, GitHub Release, e aí um `publish.yml` publicava
no npm) ou clonando o repo e rodando `tauri build` num Mac para ter a GUI. Não
havia instalador, nem build para Linux/Windows, e cada release dependia de
alguém lembrar a sequência certa.

Forças em tensão:

- **Não quebrar nada que já funciona.** `loopy [dir]` roda o loop, e é assim
  que a GUI spawna o sidecar (`loopy --no-tui --emit-events <dir>`, ADR-0007).
  Um comando "estilo `code .`" não pode mudar esse significado.
- **Uma versão só.** Pacote npm, GUI e tag precisam sair juntos; o
  `tauri.conf.json` já lê a versão do `package.json` da raiz.
- **Release atômico.** Um release público com instalador faltando, ou um npm
  publicado com build quebrado, é pior que nenhum release.
- **O dono do repositório não está decidido** (`hgflima` × um fork na org da
  Liber) e pode trocar depois — a troca é caso de uso, não imprevisto.
- **Sem assinatura de código.** Não há Apple Developer ID nem certificado
  Authenticode; o SO vai avisar "desenvolvedor não identificado".
- **Só o Linux é validado.** macOS e Windows precisam compilar e gerar o
  artefato; funcionar lá de ponta a ponta é trabalho futuro
  (`docs/how-to/plataformas.md`, itens W1–W17).

Alternativas consideradas e rejeitadas:

- **`loopy [dir]` abrir a GUI** (como `code .`). Rejeitada: mudaria o argv do
  sidecar, o CLI e todo uso em CI.
- **Release PR** (release-please e afins). Rejeitada: um passo humano a mais por
  release; o objetivo é zero passo.
- **Workflow separado para o npm** (o `publish.yml` antigo, por
  `release: published`). Rejeitada: publicaria antes de os instaladores
  existirem e, junto do workflow novo, publicaria duas vezes.
- **Matriz de `bundle.targets` no workflow.** Rejeitada em favor de arquivos de
  config por plataforma (abaixo).
- **Empurrar o argv inicial da GUI por evento no `setup`.** Rejeitada: o `emit`
  corre antes de o listener do webview existir e se perde em silêncio.

## Decision

### Produto (D1–D5, fechadas pelo usuário)

- **D1** — O comando estilo `code .` é o **subcomando `loopy open [dir]
[flags]`**. `loopy [dir]` fica inalterado (roda o loop).
- **D2** — Semver automático com **semantic-release** a partir dos
  conventional commits, disparado por push na `main`, sem Release PR.
  `feat` → minor, `fix`/`perf` → patch, `!`/`BREAKING CHANGE:` → major; só
  `docs`/`chore`/`test`/`ci` não geram release.
- **D3** — O **npm entra no mesmo release**: uma versão para pacote, GUI e tag.
- **D4** — O **owner do repositório fica em aberto** e pode trocar; tudo é
  escrito agnóstico ao owner (E11).
- **D5** — **Linux sai só com `.deb`; AppImage adiado.** O `linuxdeploy` roda
  `patchelf` em todo ELF de `usr/bin`, o que corrompe o sidecar do
  `bun build --compile` (segfault) e aborta o bundle. Registrado como dívida
  (D-0014).

### Desenho (E1–E11)

- **E1** — `loopy open` acha a GUI por uma **função pura** (`resolveApp`, em
  `src/open/resolve-app.ts`) sobre `(platform, env, selfDir, home, exists,
list)`, em ordem: `LOOPY_APP` → GUI irmã do próprio executável → locais
  padrão por SO. O binário instalado chama-se `loopy-menubar` (nome do crate).
  Nada achado → exit ≠ 0 listando onde procurou. _Refinado pela C-0021 (adendo
  abaixo): nunca resolve a própria CLI._
- **E2** — **Contrato de argv da GUI:** `[dir] [--task <id>] [--yes]
[--verbose] [--run]`. O `loopy open` passa o `dir` já absoluto e lança a GUI
  destacada, **sem shell**. Abrir pré-preenche as flags; o Run **só inicia com
  `--run`**. Parsing puro em Rust (`launch_args.rs`).
- **E3** — **Instância única** (`tauri-plugin-single-instance`): um segundo
  `loopy open` repassa o argv à instância viva, que foca a janela e troca de
  projeto pelo dirty guard existente; com um Run ativo, não o mata — avisa e
  adia a troca. _Refinado pela C-0021 (adendo abaixo)._
- **E4** — **Uma versão, uma fonte:** o `package.json` da raiz. O
  semantic-release grava a versão nele e em `apps/menubar/package.json`
  (`scripts/release/sync-version.mjs`) e commita de volta
  (`chore(release): X.Y.Z [skip ci]`).
- **E5** — **Ordem do release**, um workflow (`release.yml`) com jobs
  encadeados: `release` (tag + GitHub Release como **draft**) → `build` (matriz
  de 3 SOs anexa os instaladores) → `instructions` (gera e anexa o
  `instructions_install.txt`) → `publish` (npm via OIDC **e** promoção do draft
  a público). Falha em qualquer job deixa o draft e não publica no npm.
- **E6** — `.deb` em `ubuntu-22.04` (glibc mais antiga), macOS em `macos-14`
  (arm64), Windows em `windows-latest`.
- **E7** — Toolchain do CI via `jdx/mise-action` lendo o `mise.toml` da raiz;
  libs de sistema do Tauri via `apt`.
- **E8** — Nome do produto `Loopy`; o identificador `com.hgflima.loopy.menubar`
  **não muda** (mudar invalidaria config/estado salvos).
- **E9** — `instructions_install.txt` é **gerado de um template versionado**
  (`scripts/release/instructions_install.template.txt`) por um renderizador
  puro que injeta versão, repo, pacote npm e os assets reais — e falha se
  faltar a plataforma de algum asset.
- **E10** — O `publish.yml` é **substituído** pelo job `publish`; o
  `workflow_dispatch` de recuperação vive no `release.yml` (input `tag`
  retoma um release existente).
- **E11** — **Portável entre repositórios.** Nenhum workflow, script de
  release ou guia de instalação contém o owner/repo literal (guarda no
  `ci.yml`). O repo vem de `${{ github.repository }}` / `--repo`; o nome do
  pacote npm e a habilitação do publish vêm das Variables
  `NPM_PACKAGE_NAME`/`NPM_PUBLISH_ENABLED`; `repository`/`bugs`/`homepage` são
  reescritos por `scripts/release/set-repo.mjs`. Sem npm configurado, o release
  sai igual e só o publish é pulado com aviso.

### Do plano de implementação

- **`bundle.targets` em arquivos por plataforma** (`tauri.linux.conf.json` →
  `["deb"]`, `tauri.macos.conf.json` → `["app", "dmg"]`,
  `tauri.windows.conf.json` → `["nsis"]`), que o Tauri v2 mescla sobre o
  `tauri.conf.json` — sem lógica de matriz no workflow e sem tocar no `version`
  path-ref.
- **Argv de launch é _pull_, não _push_.** Um `emit` antes de o webview
  escutar se perde. Desde a C-0021, **todo** pedido (o argv inicial e o de cada
  segunda instância) entra numa fila no Rust, que o webview drena
  (`drain_launch_args`); o evento `launch-args-pending` só avisa para drenar.
- **Draft encontrado por id, não por tag.** `GET /releases/tags/{tag}` não
  enxerga drafts; o job `release` lista `/releases`, filtra por `tag_name` e
  exporta o `id`, que o `tauri-action` consome (`releaseId`).
- **Builds fazem checkout da tag**, não do `github.sha`: o commit de release é
  o que tem a versão nova.
- **npm opt-in por Variable** (`NPM_PUBLISH_ENABLED == 'true'`).
- **Lógica dos scripts de release em `.mjs` + `.d.mts`**: rodam com `node` puro
  no CI e são importáveis com tipos nos testes; cada um exporta a função pura e
  só executa o CLI quando é o entrypoint.

## Consequences

- **Positivas.** Um `feat:`/`fix:` mergeado na `main` vira, sem passo humano,
  tag + changelog + release com três instaladores, o `instructions_install.txt`
  e o npm na mesma versão. `loopy open .` leva da CLI à GUI no projeto. Trocar
  de repositório é um script e um checklist
  (`docs/how-to/trocar-repositorio.md`).
- **Conventional commits viram contrato.** O tipo do commit decide a versão; um
  `feat:` mal rotulado publica uma minor.
- **O workflow de release só é provado de verdade num push na `main`, que
  publica.** Mitigação: `actionlint` no CI, `semantic-release --dry-run` local,
  npm desligado por default; o primeiro release real é decisão humana.
- **Configuração externa obrigatória antes do primeiro release:** o Trusted
  Publisher do npm apontando para `release.yml`, as Variables, e a escrita na
  `main` pelo commit de release — com branch protection, exige bypass (questão
  em aberto).
- **Riscos aceitos.** Instaladores de macOS/Windows sem teste funcional
  (marcados como experimentais; o Windows não roda um Run — W1). Binários não
  assinados: o usuário contorna o aviso **por app**, nunca globalmente. Sem
  AppImage, o Linux cobre só distros com `dpkg`/`apt`. Uma pasta chamada `open`
  exige `loopy ./open` para rodar o loop nela.
- **Fora desta decisão:** assinatura/notarização, auto-update, Linux arm64,
  macOS x86_64, CLI standalone sem Node.

## Adendo — 2026-10-30, C-0021 (review do PR #8)

O review do PR #8 achou casos em que E1 e E3 não se sustentavam. As correções
(spec em `.harn/devy/changes/C-0021-correcoes-review-pr8/`):

- **E1 — `loopy open` nunca resolve a própria CLI.** No macOS (APFS) e no
  Windows (NTFS) o sistema de arquivos ignora caixa, e o candidato `Loopy`
  casava com a CLI `loopy`: sob `npm i -g`, a busca ao lado do executável
  olhava a pasta `bin` do Node e lançava um Run headless (com `--yes`, que
  aprovava o próprio Merge). Agora: macOS e Windows só procuram
  `loopy-menubar`; nenhum candidato com nome de CLI nem o próprio
  executável/script (`isSelf`, por realpath) é lançado, nem via `LOOPY_APP`;
  e a busca ao lado do executável só roda no **binário empacotado**
  (`__LOOPY_BUNDLED__`, injetado por `bun build --compile --define`).
- **E3 — o Run existe desde o clique.** O `BridgeState` ganhou
  `runStatus: "starting"` (do Iniciar ao `run_started`), e é Run ativo para o
  argv de launch; um exit em `starting` é start-fail e volta para `idle`. Como
  rede de segurança, `SidecarState::start` **recusa** com um sidecar vivo em
  vez de matá-lo.
- **E3 — `--run` passa pelo aviso de rascunho sujo** também no mesmo projeto:
  todo `--run` recarrega o projeto antes de iniciar (Salvar / Descartar /
  Cancelar), em vez de fazer auto-save por cima do `loopy.yml` em disco.
- **E3 — pedidos durante um Run se combinam** (como se aplicados em
  sequência; o banner diz qual dir foi substituído) e, quando o Run termina,
  **esperam o usuário** ("Abrir agora?"): o resultado do Run não some sozinho.
- **E3 — boot sem perda.** Fila de argv no Rust drenada pelo webview; nada é
  aplicado antes de decidir o dir inicial, e o dir salvo só carrega se nenhum
  pedido traz dir. O callback da segunda instância faz a parte de janela na
  main thread (`run_on_main_thread`).
- **Verificação independente (2026-10-31).** O smoke da GUI de release achou
  que o motor sob `--emit-events` **não saía** depois do Run: o leitor de
  comandos do stdin seguia aberto, e o `start` antigo mascarava isso matando o
  processo parado. Agora o `stop()` da UI fecha esse leitor (aprovações
  pendentes viram `false`) em toda saída do Run, inclusive numa falha de start.
  Também: o argv inicial semeia a fila antes do `setup` (ordem garantida com
  uma segunda instância rápida), Salvar recusado no aviso não descarta o
  rascunho, o pedido adiado não vaza entre Runs, e o popover vê o `starting`
  (`sidecar://started`).
