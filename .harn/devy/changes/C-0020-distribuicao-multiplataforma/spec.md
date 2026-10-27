# Spec: C-0020 — Distribuição multiplataforma: release automático, instaladores e `loopy open`

> Escrita em 2026-10-23 (`/devy:spec`). Parte do trabalho de portabilidade feito
> na mesma sessão (ainda **não commitado** na `main`): GUI rodando no Linux,
> `mise.toml`, `build-sidecar.mjs` cross-platform, `install-linux-desktop.mjs`,
> guard do positioner, fix do import do dagre e o mapa vivo
> `docs/how-to/plataformas.md`. Esse trabalho é a **linha de base** desta change
> e entra nela (T-001), não é re-desenhado aqui.
>
> Decisões **fechadas pelo usuário** nesta spec (não re-litigar): D1–D4 abaixo.

---

## Objective

Hoje o `loopy` só chega a alguém de dois jeitos: `npm i -g @hgflima/loopy` (a
CLI, publicada à mão — bump de versão, tag, GitHub Release, e aí o
`publish.yml` publica no npm) ou clonando o repo e rodando `tauri build` num Mac
(a GUI). Não existe instalador, não existe build para Linux/Windows, e cada
release depende de alguém lembrar a sequência certa.

Esta change torna a distribuição **automática e multiplataforma**:

1. **Release automático na `main`.** Todo push na `main` analisa os
   conventional commits desde a última tag, calcula a próxima versão (semver),
   gera tag + changelog + GitHub Release, builda os instaladores das três
   plataformas e publica o pacote npm — **sem passo humano**.
2. **Instaladores da GUI** anexados a cada GitHub Release:
   Linux x86_64 (**AppImage** + `.deb`), macOS arm64 (`.dmg`) e Windows x64
   (NSIS `.exe`).
3. **`instructions_install.txt`** em cada release: um prompt autocontido para um
   **modelo agêntico** ler e executar a instalação completa (pré-requisitos,
   app, CLI, verificação) — com a versão e as URLs **daquele** release.
4. **App de bandeja instalável**: abre pelo menu de apps do SO e vive no tray
   (menubar no macOS, área de notificação no Linux/Windows).
5. **`loopy open <dir> [flags]`**, no espírito do `code .`: abre a GUI já no
   projeto da pasta passada, repassando flags de launch.

**Usuário:** quem quer usar o loopy num projeto (dev da Liber, o próprio dono
do repo) — e o **agente** que muitas vezes vai instalá-lo por ele.

**Sucesso, em uma frase:** mergear um `feat:` na `main` resulta, sem ninguém
tocar em nada, num GitHub Release com versão nova, três instaladores, o
`instructions_install.txt` e o pacote npm na mesma versão — e quem instalou
roda `loopy open .` e cai na GUI com o projeto aberto.

### O que NÃO é

- **Não** valida o app em macOS/Windows nesta change. Os builds dessas
  plataformas precisam **compilar e gerar o artefato**; funcionar de ponta a
  ponta lá é trabalho futuro (o mapa `docs/how-to/plataformas.md`, itens
  W1–W17, continua sendo o roteiro do Windows).
- **Não** assina nem notariza binários (sem Apple Developer ID, sem
  certificado Authenticode). O SO vai avisar "desenvolvedor não identificado";
  o `instructions_install.txt` ensina a contornar.
- **Não** tem auto-update dentro do app (o `tauri-plugin-updater` fica de fora).
- **Não** muda o que `loopy [dir]` faz: ele continua **rodando o loop** (D1).
- **Não** distribui a CLI como binário standalone: a CLI vem do npm (precisa de
  Node de qualquer jeito — os adapters ACP são `npx`).
- **Não** cobre Linux arm64 nem macOS x86_64.

---

## Decisões fechadas

| #   | Decisão                                                                                                                                              |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1  | O comando estilo `code .` é o **subcomando `loopy open [dir] [flags]`**. `loopy [dir]` fica inalterado (roda o loop) — zero quebra para CLI, CI e sidecar. |
| D2  | Semver automático com **semantic-release**, a partir dos conventional commits, disparado por push na `main`. Sem Release PR.                          |
| D3  | O **npm entra no mesmo release**: uma versão só para pacote npm, GUI e tag (o single-source de versão já existe).                                     |
| D4  | O **owner do repositório ainda não está decidido** (`hgflima/loopy` × fork na org da Liber) **e pode trocar depois** — a troca é um caso de uso de primeira classe, não um imprevisto. Tudo é escrito **agnóstico ao owner** (E11); ver Open Questions. |

## Decisões de desenho (desta spec — revisáveis no refine)

| #   | Decisão                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| E1  | **Como `loopy open` acha a GUI**, em ordem: (1) env `LOOPY_APP` (path explícito); (2) GUI **irmã do próprio executável** (quando quem roda é o sidecar embutido no app); (3) locais padrão de instalação por SO — macOS `/Applications/Loopy.app` e `~/Applications/Loopy.app`; Linux `loopy-menubar`/`loopy` do `.deb` no `PATH`, e `~/Applications/Loopy*.AppImage`, `~/.local/bin/Loopy*.AppImage`; Windows `%LOCALAPPDATA%\Programs\Loopy\Loopy.exe` e `%ProgramFiles%\Loopy\Loopy.exe`. Nada achado → erro **com a dica de instalação** (exit ≠ 0). A resolução é uma **função pura** sobre `(platform, env, exists)` — AD-6. |
| E2  | **Contrato de argv da GUI:** `Loopy [dir] [--task <id>] [--yes] [--verbose] [--run]`. `dir` relativo é resolvido contra o cwd **de quem chamou** (o `loopy open` passa o path já absoluto). Abre a janela `main` nesse projeto e **pré-preenche as flags de launch**; o Run **só inicia com `--run`** (abrir nunca dispara agente por acidente). Parsing é função pura no Rust, testada.                                                                                                       |
| E3  | **Instância única** (`tauri-plugin-single-instance`): com o app já aberto, um segundo `loopy open` **não sobe outra GUI** — o argv é repassado à instância viva, que foca a janela e troca para o projeto. Trocar de projeto respeita o dirty guard existente (Salvar/Descartar/Cancelar). Com um Run ativo em outro projeto, **não mata o Run**: abre o projeto e avisa.                                                                                                   |
| E4  | **Uma versão, uma fonte:** o `package.json` da raiz. semantic-release grava a versão nele **e** em `apps/menubar/package.json` (o teste `version-single-source` passa a ficar verde) e commita de volta (`chore(release): x.y.z [skip ci]`). O `tauri.conf.json` já lê da raiz.                                                                                                                                                                                                         |
| E5  | **Ordem do release** (um workflow, jobs encadeados): `release` (semantic-release cria tag + GitHub Release **como draft**) → `build` (matriz de 3 SOs, anexa instaladores ao draft) → `instructions` (gera e anexa o `instructions_install.txt`) → `publish` (npm via OIDC/Trusted Publishing **e** promove o draft a público). Release só fica público com **todos** os artefatos; falha em qualquer job deixa o draft para inspeção e **não publica no npm**. |
| E6  | **AppImage builda em `ubuntu-22.04`** (glibc mais antiga = roda em mais distros). macOS em `macos-14` (arm64 nativo). Windows em `windows-latest`.                                                                                                                                                                                                                                                                                                                                      |
| E7  | **Toolchain do CI via mise** (`jdx/mise-action`, lendo o `mise.toml` da raiz) — node, bun e rust iguais aos de dev. As libs de sistema do Tauri no Linux vêm do `apt` no job.                                                                                                                                                                                                                                                                                                             |
| E8  | O **nome do produto** instalado é `Loopy` (já é o `productName`). O identificador `com.hgflima.loopy.menubar` **não muda** nesta change (mudar invalida config/estado salvos dos usuários).                                                                                                                                                                                                                                                                                              |
| E9  | `instructions_install.txt` é **gerado a partir de um template versionado** (`scripts/release/instructions_install.template.txt`) por um script puro que injeta versão, repo e nomes/URLs reais dos assets. Nada de texto escrito à mão por release.                                                                                                                                                                                                                                     |
| E10 | O `publish.yml` atual (trigger `release: published`) é **substituído** pelo job `publish` do workflow novo — senão o npm publicaria duas vezes. O `workflow_dispatch` de recuperação é preservado no workflow novo.                                                                                                                                                                                                                                                                   |
| E11 | **Portável entre repositórios (o repo pode mudar).** Nenhum workflow, script, template ou doc de instalação contém `hgflima/loopy` literal. O repo vem **sempre** de `${{ github.repository }}` no CI e de `--repo` nos scripts. O que não dá para derivar do contexto — **nome do pacote npm** e a habilitação do publish — vem de **GitHub Actions Variables** (`NPM_PACKAGE_NAME`, `NPM_PUBLISH_ENABLED`), com default = o `name` do `package.json`. Os campos `repository`/`bugs`/`homepage` do `package.json` são reescritos por **um** script (`scripts/release/set-repo.mjs <owner/repo>`). Trocar de repo = rodar esse script + seguir `docs/how-to/trocar-repositorio.md` (Trusted Publisher do npm, Variables, permissões de Actions). Num repo novo **sem** npm configurado, o release **ainda sai** (tag + instaladores + instruções) e o job `publish` do npm é **pulado com aviso**, nunca falha o release. |

---

## Tech Stack

| Peça                        | Escolha                                                                                    | Por quê                                                                                        |
| --------------------------- | ------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------- |
| Semver/changelog/tag        | `semantic-release` + `@semantic-release/{commit-analyzer,release-notes-generator,changelog,github,git,exec}` | D2. Conventional commits já são a convenção do repo.                                          |
| Build/bundle da GUI         | `tauri-apps/tauri-action` (v0) no GitHub Actions, Tauri v2 (já em uso)                    | Builda e **anexa ao release existente** (`releaseId`) por plataforma.                          |
| Bundles                     | `bundle.targets`: `appimage`, `deb` (Linux) · `app`, `dmg` (macOS) · `nsis` (Windows)      | Formatos pedidos; NSIS dispensa WiX e instala por usuário sem admin.                           |
| Instância única             | `tauri-plugin-single-instance` v2                                                          | E3 — o padrão oficial do Tauri para "abrir no app já aberto".                                   |
| Toolchain CI                | `jdx/mise-action` + `mise.toml` (node 22, bun, rust stable)                                | E7 — mesma toolchain do dev; preferência do usuário por mise.                                  |
| Sidecar                     | `bun build --compile` via `apps/menubar/scripts/build-sidecar.mjs` (já cross-platform)    | Linha de base desta sessão.                                                                    |
| npm                         | Trusted Publishing (OIDC), `npm publish` com provenance — mecanismo atual preservado       | D3, E10.                                                                                       |
| Lint de workflow            | `actionlint` (job de CI)                                                                   | Workflows são código; erro de YAML só apareceria no push da `main`.                            |

Novas dependências exigem aprovação (Boundaries) — as acima **são** a proposta
para aprovação junto com esta spec.

---

## Commands

```bash
# Dev (inalterado + linha de base desta sessão)
mise install && npm install
npm run dev -w apps/menubar                 # GUI em dev (build:sidecar + tauri dev)
npm run install:linux-desktop -w apps/menubar   # Linux: ícone/atalho do app de dev

# Novo: abrir a GUI num projeto (estilo `code .`)
loopy open .                                # abre a GUI nesta pasta
loopy open ~/proj --task T-003 --yes        # abre e pré-preenche flags de launch
loopy open ~/proj --run                     # abre e já inicia o Run
LOOPY_APP=/caminho/Loopy.AppImage loopy open .   # força o executável da GUI

# Qualidade (inalterado; CI roda tudo)
npm run typecheck && npm run lint && npm test && npm test -w apps/menubar
mise exec -- cargo test --manifest-path apps/menubar/src-tauri/Cargo.toml

# Release — local, sem efeitos (simula o cálculo de versão)
npx semantic-release --dry-run --no-ci
node scripts/release/render-instructions.mjs --version 0.7.0 --repo owner/loopy --assets assets.json > instructions_install.txt

# Bundles locais (por SO, no próprio SO)
npm run menubar                             # = build:sidecar + tauri build (targets do SO corrente)
```

---

## Project Structure

```
.github/workflows/
  ci.yml                      → NOVO: PR + push — typecheck, lint, testes TS (raiz + menubar),
                                 cargo test (Linux) e actionlint
  release.yml                 → NOVO: push na main — release → build (matriz) → instructions → publish
  publish.yml                 → REMOVIDO (absorvido pelo job publish do release.yml — E10)
.releaserc.json               → NOVO: config do semantic-release (branches, plugins, assets do commit)
CHANGELOG.md                  → NOVO: mantido pelo semantic-release
mise.toml                     → (linha de base) toolchain de dev e CI

scripts/release/
  instructions_install.template.txt  → NOVO: o prompt para o agente instalador (E9)
  render-instructions.mjs            → NOVO: template + versão + repo + pacote npm + assets → instructions_install.txt (puro)
  sync-version.mjs                   → NOVO: grava a versão na raiz e em apps/menubar (E4)
  set-repo.mjs                       → NOVO: aponta repository/bugs/homepage para <owner/repo> (E11)

src/
  index.ts                    → `open` registrado como subcomando (commander)
  open/
    resolve-app.ts            → NOVO: resolução pura do executável da GUI (E1)
    launch.ts                 → NOVO: spawn destacado da GUI com o argv (I/O)
    index.ts                  → NOVO: barrel

apps/menubar/
  scripts/build-sidecar.mjs   → (linha de base) + suporta TAURI_ENV_TARGET_TRIPLE do CI
  scripts/install-linux-desktop.mjs → (linha de base)
  src-tauri/
    build.rs                  → placeholder com `.exe` no Windows (W7 — necessário para compilar)
    tauri.conf.json           → bundle.targets por plataforma; plugin single-instance
    Cargo.toml                → + tauri-plugin-single-instance
    src/main.rs               → argv inicial + single-instance → evento ao webview
    src/launch_args.rs        → NOVO: parsing puro do argv da GUI (E2)
    src/sidecar.rs            → candidatos com EXE_SUFFIX (W8 — necessário para rodar o .exe)
  src/
    state/launch-args.ts      → NOVO: aplica o argv recebido (troca de dir + flags) respeitando o dirty guard

docs/
  how-to/instalar.md          → NOVO: instalar a partir de um release (humano), por SO
  how-to/trocar-repositorio.md → NOVO: checklist para mover pipeline/releases para outro repo (E11)
  how-to/plataformas.md       → (linha de base) + status dos bundles e do CI
  reference/cli.md            → + `loopy open`
  adrs/0013-distribuicao-e-release-automatico.md → NOVO: D1–D4 + E1–E10
tests/
  open/resolve-app.test.ts    → NOVO
  release/render-instructions.test.ts → NOVO
  cli/open.test.ts            → NOVO (registro do subcomando, argv repassado)
```

---

## Code Style

Segue o estilo do motor: funções puras nas bordas de decisão (AD-6), I/O isolado,
erros como valores nas fronteiras (AD-5), comentários dizendo o **porquê**.

### Resolução da GUI — pura, testável sem filesystem (`src/open/resolve-app.ts`)

```ts
/** Where a candidate came from — surfaced in the "not found" error. */
export type AppSource = "env" | "sibling" | "default";

export interface ResolveAppInput {
  readonly platform: NodeJS.Platform;
  readonly env: Readonly<Record<string, string | undefined>>;
  /** Directory of the running `loopy` executable (the bundled sidecar case). */
  readonly selfDir: string;
  readonly home: string;
  readonly exists: (path: string) => boolean;
}

export type ResolveAppResult =
  | { readonly ok: true; readonly path: string; readonly source: AppSource }
  | { readonly ok: false; readonly searched: readonly string[] };

/**
 * Find the Loopy GUI executable (E1). Order matters: an explicit LOOPY_APP
 * always wins; the sibling check makes `loopy open` work from inside an
 * installed bundle with no PATH setup; defaults cover a normal install.
 */
export function resolveApp(input: ResolveAppInput): ResolveAppResult {
  const candidates = [
    ...envCandidate(input),
    ...siblingCandidates(input),
    ...defaultCandidates(input),
  ];
  const hit = candidates.find((c) => input.exists(c.path));
  return hit
    ? { ok: true, path: hit.path, source: hit.source }
    : { ok: false, searched: candidates.map((c) => c.path) };
}
```

### Argv da GUI — puro no Rust (`src-tauri/src/launch_args.rs`)

```rust
/// What the GUI was asked to open (E2). Parsed from argv on first launch and
/// from the forwarded argv of a second instance (E3) — one parser, two callers.
#[derive(Debug, Default, PartialEq, serde::Serialize, Clone)]
pub struct LaunchArgs {
    pub dir: Option<String>,
    pub task: Option<String>,
    pub yes: bool,
    pub verbose: bool,
    pub run: bool,
}

/// `cwd` resolves a relative `dir` against the *caller's* cwd, not the app's.
pub fn parse_launch_args(argv: &[String], cwd: &Path) -> Result<LaunchArgs, String> { … }
```

### Convenções

- Commits seguem **conventional commits** — agora isso **é** o semver
  (`feat` → minor, `fix`/`perf` → patch, `BREAKING CHANGE:`/`!` → major). Commits
  só de `docs`/`chore`/`test`/`ci` **não** geram release.
- Workflows: jobs com `permissions` mínimas e explícitas por job; ações
  **pinadas por versão maior** (`@v4`) como no `publish.yml` atual; nenhum
  segredo em log.
- Strings voltadas ao usuário em português (como o resto da CLI); identificadores
  em inglês.

---

## Testing Strategy

| Nível                  | O quê                                                                                                                       | Onde / como                                                         |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| Unit (TS, vitest)      | `resolveApp`: ordem env → sibling → default por SO; `LOOPY_APP` inexistente cai para o próximo; nada achado lista o que buscou | `tests/open/resolve-app.test.ts`                                    |
| Unit (TS)              | `renderInstructions`: injeta versão, repo, pacote npm e **um asset por plataforma**; falha se faltar asset de alguma plataforma (release incompleto não gera instrução mentirosa); renderizado com `--repo outra-org/loopy` **não contém** `hgflima` | `tests/release/render-instructions.test.ts`                         |
| Guarda de portabilidade | `grep` no CI: nenhum `hgflima/loopy` literal em `.github/`, `scripts/release/`, `docs/how-to/instalar.md` (E11)          | step no `ci.yml`                                                    |
| CLI (TS)               | `loopy open` registrado; `dir` vira absoluto; flags repassadas na ordem; `loopy [dir]` (sem `open`) continua rodando o loop | `tests/cli/open.test.ts` (com `launch` injetado/mocado — sem spawn real) |
| Unit (Rust)            | `parse_launch_args`: dir relativo × absoluto, flags, flag desconhecida = erro, argv vazio = default                          | `#[cfg(test)]` em `launch_args.rs`                                  |
| Unit (Rust)            | resolução do sidecar com `EXE_SUFFIX` (estende os testes existentes de `is_executable_file`)                               | `sidecar.rs`                                                        |
| Unit (TS, GUI)         | aplicar argv: troca de dir passa pelo dirty guard; `--run` só inicia após o load do yml                                    | `apps/menubar/src/state/launch-args.test.ts`                        |
| Workflow               | `actionlint` limpo; `semantic-release --dry-run` local calcula a versão esperada                                            | job no `ci.yml`; manual                                             |
| Smoke (manual, Linux)  | AppImage do release abre, aparece no menu de apps/tray; `loopy open .` abre o projeto; segundo `loopy open` foca a instância | checklist no `plan.md`                                              |
| macOS / Windows        | **Só "o artefato foi gerado e anexado"** — sem validação funcional nesta change (escopo do usuário)                        | status do job de build                                              |

Cobertura: todo código novo **puro** tem teste; I/O fino (`launch.ts`, os hooks do
Tauri) é coberto pelo smoke manual.

---

## Boundaries

- **Always:**
  - Manter `loopy [dir]` byte-idêntico em comportamento (D1); o sidecar continua sendo invocado como hoje.
  - Rodar `typecheck`, `lint`, as duas suítes TS e o `cargo test` antes de cada commit.
  - Atualizar `docs/how-to/plataformas.md` quando um item do mapa mudar de status (ex.: W7/W8 resolvidos para compilar).
  - Tornar o release **atômico**: público só com todos os artefatos (E5).
  - Escrever o `instructions_install.txt` de forma que um agente consiga **verificar** cada passo (comandos de checagem com saída esperada).
  - Derivar repo/owner do contexto (`github.repository`, `--repo`) — nunca literal (E11).
- **Ask first:**
  - Adicionar qualquer dependência além das listadas no Tech Stack.
  - Qualquer coisa que exija **segredo/permissão no repositório** (Trusted Publisher do npm apontando para o workflow novo, permissão de Actions de escrever na `main` / bypass de branch protection para o commit de release).
  - Disparar o **primeiro release real** (o primeiro push na `main` com o workflow novo publica de verdade no npm).
  - Mudar `identifier`, `productName` ou o nome do pacote npm.
  - Habilitar assinatura de código ou auto-update.
- **Never:**
  - Commitar tokens/segredos ou colocá-los em artefato/log.
  - Publicar no npm se qualquer build de plataforma falhar.
  - Mudar o significado de `loopy [dir]` ou do argv do sidecar (`--no-tui --emit-events`).
  - Usar `shell: true` para lançar a GUI a partir do `loopy open` (mesma regra de segurança dos steps `shell`).
  - Escrever no `instructions_install.txt` instruções que desliguem proteções do SO de forma global (ex.: `spctl --master-disable`) — só o contorno **por app**.

---

## Success Criteria

1. Push na `main` com pelo menos um `feat:`/`fix:` desde a última tag gera, sem intervenção: tag `vX.Y.Z` com a versão certa, entrada no `CHANGELOG.md`, commit `chore(release): X.Y.Z [skip ci]` com raiz **e** `apps/menubar` na mesma versão.
2. O GitHub Release `vX.Y.Z` fica público contendo **no mínimo**: `Loopy_X.Y.Z_amd64.AppImage`, `Loopy_X.Y.Z_amd64.deb`, `Loopy_X.Y.Z_aarch64.dmg`, `Loopy_X.Y.Z_x64-setup.exe` e `instructions_install.txt` (nomes exatos podem seguir a convenção do `tauri-action`; o template referencia os nomes **reais** do release).
3. `@hgflima/loopy@X.Y.Z` publicado no npm com provenance, na mesma versão.
4. Push na `main` só com `docs:`/`chore:` **não** gera release.
5. Falha no build de qualquer SO → release continua **draft** e o npm **não** é publicado.
6. Linux (validado nesta change): baixar o AppImage, `chmod +x`, abrir → app aparece com ícone no menu de apps e no tray; `loopy open ~/liber/onboarding-loopy` abre a GUI nesse projeto com o board populado; um segundo `loopy open <outro>` com o app aberto **foca** a instância e troca de projeto (sem segunda janela).
7. `loopy open .` sem GUI instalada sai com código ≠ 0 e a mensagem lista onde procurou e como instalar.
8. Entregar `instructions_install.txt` a um agente numa máquina Linux limpa (com Node) resulta em app + CLI instalados e `loopy --version` / `loopy open --help` respondendo a versão do release.
9. `ci.yml` verde em PR: typecheck, lint, testes TS (raiz + menubar), `cargo test`, `actionlint`.
10. macOS arm64 e Windows x64: os jobs de build **concluem e anexam** os artefatos (sem validação funcional).
11. **Troca de repositório:** num fork/repo novo, rodar `set-repo.mjs <owner/repo>` + seguir `trocar-repositorio.md` basta para o próximo push na `main` gerar um release **naquele** repo, com `instructions_install.txt` apontando para ele. Sem npm configurado lá, o release sai igual e só o publish do npm é pulado com aviso.

---

## Fora de escopo

- Assinatura/notarização (macOS) e Authenticode (Windows).
- Auto-update dentro do app.
- Fazer o app **funcionar** no Windows (itens W1–W6, W9–W17 do mapa), além do mínimo para compilar (W7/W8).
- Linux arm64, macOS x86_64/universal, Flatpak/Snap, Homebrew/winget/Scoop.
- CLI como binário standalone (sem Node).
- Mudar o identificador do app ou migrar estado salvo.

## Open Questions

1. **Owner do repositório (D4):** releases e Actions em `hgflima/loopy` ou num fork da org da Liber — e pode mudar depois. Com o E11, a decisão **não bloqueia** a implementação; ela só define a configuração externa: Trusted Publisher do npm (hoje registrado para `hgflima/loopy` + `publish.yml` — precisa ser re-registrado para o `release.yml`), e o **nome do pacote npm** num fork (`@hgflima/loopy` só pode ser publicado por quem tem acesso ao escopo `@hgflima`; um fork da Liber provavelmente publica outro nome, ex. `@libercapital/loopy`, via `NPM_PACKAGE_NAME`).
2. **Branch protection na `main`:** o commit `chore(release)` do semantic-release precisa escrever na `main`. Se houver proteção, precisa de um token/App com bypass — ou abrir mão do commit de volta (versão só na tag; o `package.json` do repo ficaria atrás). Decidir antes do primeiro release real.
3. **Primeira versão calculada:** a última tag é `v0.6.0`; os commits desde então são `fix:`/`docs:` → o primeiro release automático seria `0.6.1`. Os `feat:` desta change levam a `0.7.0`. Confirmar que não há expectativa de `1.0.0`.
4. **`loopy open` sem dir:** abrir no cwd (como `code` sem argumento abre a janela vazia, mas `code .` abre o cwd) — proposta: sem dir = só abre/foca o app, sem trocar de projeto. Confirmar.

### Riscos aceitos

- **Builds de macOS/Windows sem teste funcional** podem gerar instaladores que abrem mas não rodam um Run (Windows certamente não roda: W1 — `npx` sem shell). O release notes e o `instructions_install.txt` marcam essas plataformas como **experimentais**.
- **Usuário que tem `open/` como nome de pasta:** `loopy open` vira o subcomando; para rodar o loop nessa pasta, `loopy ./open`. Documentado no `cli.md`.
- **AppImage depende de FUSE** em algumas distros (Ubuntu 22.04+ precisa `libfuse2`); o `instructions_install.txt` checa e instala.
