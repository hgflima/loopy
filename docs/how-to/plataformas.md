# Rodar o loopy (e a GUI) no Linux e no Windows

O `loopy` nasceu no macOS. O **motor** (a CLI) sempre rodou no Linux (o CI de
publish é `ubuntu-latest`), mas a **GUI** (`apps/menubar/`, Tauri v2) só era
buildável no macOS. Este guia é, ao mesmo tempo:

1. o **passo a passo** para rodar tudo no Linux (suportado);
2. o **mapa de portabilidade**: cada ponto do código que depende de plataforma,
   o que já foi resolvido e o que falta para o **Windows**, com o arquivo e a
   correção proposta.

> Mantenha este arquivo vivo: ao portar um item, mude o status na tabela e
> registre o porquê da solução.

## Status por plataforma

| Componente                          | macOS | Linux                              | Windows                     |
| ----------------------------------- | ----- | ---------------------------------- | --------------------------- |
| Motor / CLI (`loopy`, TUI Ink)      | ✅    | ✅                                 | ⚠️ não testado (ver W1–W6)  |
| Testes TS (`npm test`, typecheck)   | ✅    | ✅                                 | ⚠️ não testado              |
| Sidecar compilado (`build:sidecar`) | ✅    | ✅                                 | ⚠️ script pronto, sem teste |
| GUI Tauri (`tauri dev`/`build`)     | ✅    | ✅ (exige libs de sistema, abaixo) | ❌ pendente (W7–W14)        |
| Popover do tray                     | ✅    | ➖ substituído por menu nativo     | ⚠️ (W12)                    |

## Linux — como rodar

### 1. Toolchains (via mise)

O repo tem um `mise.toml` (node 22, bun, rust stable). Na raiz:

```bash
mise install          # instala node, bun e rust (rustup) declarados no mise.toml
npm install
```

### 2. Bibliotecas de sistema do Tauri (fora do mise)

Não existem no mise; vêm do gerenciador de pacotes da distro. Ubuntu/Debian:

```bash
sudo apt install pkg-config libwebkit2gtk-4.1-dev libayatana-appindicator3-dev \
  librsvg2-dev libxdo-dev libssl-dev
```

Outras distros: veja os pré-requisitos do Tauri v2 para Linux
(`webkit2gtk-4.1`, `libayatana-appindicator`, `librsvg`, `openssl`).

### 3. Rodar

```bash
npm run dev -w apps/menubar     # build:sidecar + tauri dev
# só a UI, sem Rust (dados mock):
npm run dev:web -w apps/menubar
# empacotar (.deb/.AppImage/.rpm conforme bundle.targets):
npm run menubar
# (uma vez) ícone na lista de apps/dock do GNOME + atalho no launcher:
npm run install:linux-desktop -w apps/menubar
```

> Também precisa de um **agente instalado/logado** (o preset `claude` roda
> `npx -y @agentclientprotocol/claude-agent-acp`, que usa o login do Claude
> Code) e de um projeto-alvo com **branch parent existente**, **árvore limpa**
> e um backlog com tasks pendentes cujo id case com `task_id_pattern` — sem
> isso a GUI abre com o board vazio e o Run termina sem fazer nada.

### Diferenças de comportamento no Linux

- **A janela principal abre ao iniciar.** No macOS o app nasce só na menubar;
  no Linux o ícone do tray pode nem aparecer (GNOME sem a extensão
  AppIndicator) e não há Dock, então a janela `main` é exibida no `setup`
  (`main.rs`, `#[cfg(target_os = "linux")]`).
- **Tray = menu nativo, sem popover.** O libappindicator **não entrega eventos
  de clique** ao app, então o toggle do popover nunca dispararia. Fora do macOS
  o tray ganha um menu nativo (Abrir / Parar · Sobre / Sair) que espelha o
  popover (`build_tray_menu`/`handle_tray_menu` em `main.rs`).
- **Ícone colorido no tray.** O `tray-template.png` (preto, para o macOS
  tingir) some num painel escuro; fora do macOS usamos `icons/32x32.png`.
- **Fechar a janela esconde, não sai** (igual ao macOS). Para sair: menu do
  tray → Sair. Sem tray visível, feche pelo terminal (Ctrl+C no `tauri dev`).
- **Atalhos exibidos como `Ctrl+`** em vez de `⌘` (`src/ui/platform.ts`).
- **Ícone na lista de apps (GNOME/Wayland)** vem de um `.desktop` cujo
  `StartupWMClass` casa com o app_id da janela — no dev, `loopy-menubar` (nome
  do binário). `install:linux-desktop` grava
  `~/.local/share/applications/loopy-menubar.desktop`; o `.deb`/`.AppImage`
  trazem o próprio.
- **PATH**: `login_shell_path()` (`$SHELL -ilc 'echo $PATH'`) também roda no
  Linux; necessário quando o app é aberto por um `.desktop` (sem o PATH do
  shell, `npx`/mise não seriam achados).

## Mapa de portabilidade

### Já resolvido (macOS + Linux, e preparado para Windows)

| #   | Onde                                        | Problema                                                                                                                                                                                                                                                            | Solução                                                                                                         |
| --- | ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| L1  | `apps/menubar/package.json` `build:sidecar` | Triple `aarch64-apple-darwin` hardcoded + `codesign` obrigatório.                                                                                                                                                                                                   | `scripts/build-sidecar.mjs`: triple do host via `rustc -vV`, sufixo `.exe` no Windows, `codesign` só no darwin. |
| L2  | toolchain                                   | `bun` e `rust` não declarados em lugar nenhum.                                                                                                                                                                                                                      | `mise.toml` na raiz.                                                                                            |
| L3  | `src-tauri/src/main.rs` tray                | Linux não recebe clique no tray → app inacessível.                                                                                                                                                                                                                  | Menu nativo fora do macOS + janela `main` visível no start (Linux).                                             |
| L4  | `src-tauri/src/main.rs` ícone               | Ícone template preto invisível fora do macOS.                                                                                                                                                                                                                       | `icons/32x32.png` fora do macOS.                                                                                |
| L5  | `src/main.tsx` classe `popover-window`      | Popover transparente sem vibrancy = superfície invisível fora do macOS.                                                                                                                                                                                             | Classe só aplicada quando `isMacOS()`.                                                                          |
| L6  | `src/specs/Attachable.tsx`                  | Dica "⌘V" fora do Mac.                                                                                                                                                                                                                                              | `modKeyLabel()` de `src/ui/platform.ts`.                                                                        |
| L7  | `src-tauri/src/main.rs` `resize_popover`    | **Crash na inicialização**: o `tauri-plugin-positioner` faz `current_monitor().unwrap()`; no GTK/Wayland uma janela nunca exibida não tem monitor → panic num callback que não pode fazer unwind → abort. O popover chama `resize_popover` ao montar, ainda oculto. | `anchor_popover` só chama o positioner com `current_monitor()` = `Some`.                                        |
| L8  | GNOME / Wayland                             | Janela sem ícone na lista de apps abertos.                                                                                                                                                                                                                          | `apps/menubar/scripts/install-linux-desktop.mjs` (`.desktop` com `StartupWMClass=loopy-menubar`).               |

### Pendente para o Windows

Ordem sugerida: W1–W2 (sem eles nada roda), depois W7–W10 (a GUI builda e
spawna), depois o resto.

#### Motor (TypeScript)

| #   | Onde                                                                                                          | Problema no Windows                                                                                                                                                             | Correção proposta                                                                                                                                                                       |
| --- | ------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| W1  | `src/acp/agent.ts` (`spawn(file, …)`) e `src/acp/client.ts` (terminal `spawn`)                                | `node:child_process.spawn` **sem shell** não resolve `npx` → `npx.cmd` (ENOENT). Todo preset do Catálogo é `npx -y …`. Desde o Node 18.20.2 spawnar `.cmd` exige `shell: true`. | Trocar por `execa` (já é dependência e usa `cross-spawn`, que resolve `.cmd` com escaping seguro) **ou** `cross-spawn` direto. Não usar `shell: true` cru (AD de segurança do `shell`). |
| W2  | `src/acp/agent.ts` `child.kill()`, `src/acp/client.ts` `kill("SIGKILL")`, `src/steps/shell.ts` (cancelSignal) | No Windows `kill()` = `TerminateProcess` só do processo direto. `npx` → `node` adapter fica **órfão** (o processo-neto segura a sessão ACP e arquivos do worktree).             | Matar a árvore: `taskkill /PID <pid> /T /F` no win32 (ou `tree-kill`). Centralizar num helper `killTree(child)`.                                                                        |
| W3  | `src/backlog/parse.ts`, `src/checks/runner.ts`, `src/git/worktree.ts` (`split("\n")`)                         | Com `core.autocrlf=true`, `todo.md`/`plan.md` chegam com `\r\n`; linhas ficam com `\r` no fim (títulos de task, ids, nome de branch).                                           | Normalizar `\r\n` → `\n` na leitura (`todo.ts`, `load.ts`) ou `split(/\r?\n/)`. Testes com fixture CRLF.                                                                                |
| W4  | yml dos projetos-alvo (ex.: `sh scripts/loopy-cleanup.sh`) e `scripts/*.sh` deste repo                        | Steps `shell` que chamam `sh`/`bash` exigem Git Bash ou WSL no PATH.                                                                                                            | Documentar pré-requisito (Git for Windows). Opcional: portar `scripts/*.sh` para `.mjs`. O motor em si não chama `sh` (argv direto — AD de segurança).                                  |
| W5  | `src/index.ts`, `src/loop/orchestrator.ts`, `src/interview/*` (paths montados com `/`)                        | Mistura de `/` e `\` nos paths exibidos/gravados (`.worktrees/<id>`, `.loopy/…`). Git aceita ambos, mas comparações por string (prefixo, `startsWith`) podem falhar.            | Auditar comparações de path; usar `node:path` nas fronteiras de I/O e normalizar para `/` no que é exibido/persistido.                                                                  |
| W6  | git worktree                                                                                                  | `MAX_PATH` (260) com `.worktrees/<C-0017/T-004>/node_modules/...`; remoção de worktree falha com arquivo aberto (antivírus/indexador).                                          | Documentar `git config --global core.longpaths true` + LongPathsEnabled; retry no `worktree remove`.                                                                                    |

#### GUI (Rust / Tauri)

| #   | Onde                                                                                                                            | Problema no Windows                                                                                                                                                                  | Correção proposta                                                                                                                                                                 |
| --- | ------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| W7  | `src-tauri/build.rs`                                                                                                            | Placeholder criado como `bin/loopy-<triple>`; no Windows o `tauri_build` espera `bin/loopy-<triple>.exe` e falha.                                                                    | Acrescentar `.exe` quando `CARGO_CFG_TARGET_OS == "windows"`.                                                                                                                     |
| W8  | `src-tauri/src/sidecar.rs` `resolve_sidecar_path`                                                                               | Candidatos sem `.exe` (`loopy`, `loopy-<triple>`) → "No runnable sidecar binary".                                                                                                    | Usar `std::env::consts::EXE_SUFFIX` em cada candidato.                                                                                                                            |
| W9  | `sidecar.rs` e `interview_process.rs` `stop()`                                                                                  | Só existe o ramo `#[cfg(unix)] kill -TERM`; no Windows o motor **não é parado** (só o stdin cai). Mesmo problema de árvore do W2.                                                    | Guardar o `Child` (ou o pid) e, no win32, `taskkill /PID <pid> /T /F`. No unix, avaliar trocar o `kill` em subprocesso por `libc::kill` (TODO(intent) existente).                 |
| W10 | todo `Command::new` em `sidecar.rs`, `interview_process.rs`, `project_fs.rs` (`probe_agent`), `telemetry.rs` (`run_annotation`) | Cada spawn de um app GUI (`windows_subsystem = "windows"`) abre uma **janela de console** piscando.                                                                                  | `CommandExt::creation_flags(CREATE_NO_WINDOW /* 0x08000000 */)` sob `#[cfg(windows)]`, num helper compartilhado.                                                                  |
| W11 | `sidecar.rs` `login_shell_path`                                                                                                 | `$SHELL` não existe → tenta `/bin/zsh`, falha, cai no PATH herdado (inofensivo, mas spawn inútil a cada start).                                                                      | Gatear com `#[cfg(unix)]`; no Windows o PATH herdado do Explorer já é o do usuário.                                                                                               |
| W12 | `main.rs` `resize_popover`/`toggle_popover_window` + `tauri.conf.json` popover                                                  | No Windows o clique no tray funciona e mostra o popover, mas (a) a barra fica embaixo: `TrayBottomLeft`/`TrayCenter` posicionam por cima/fora; (b) `transparent: true` sem vibrancy. | Posicionar acima do tray quando a barra está embaixo (`TrayBottomCenter` vs. cálculo manual); L5 já deixa a superfície opaca. Alternativa: usar só o menu nativo (como no Linux). |
| W13 | `src-tauri/icons` / bundle                                                                                                      | `icon.ico` existe; bundle `targets: "all"` gera MSI/NSIS — exige WiX/NSIS e WebView2 (Win10 antigo não tem).                                                                         | Fixar `targets` por plataforma e configurar `webviewInstallMode`.                                                                                                                 |
| W14 | `src/specs/Interview.tsx` `changeIdFromDir` (`split("/")`)                                                                      | `changeDir` vindo do motor no Windows pode ter `\`.                                                                                                                                  | `split(/[/\\]/)`.                                                                                                                                                                 |

#### Toolchain / processo

| #   | Onde                        | Problema                                                                                          | Correção proposta                                                                       |
| --- | --------------------------- | ------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| W15 | `package.json` `check:rust` | `bash scripts/loopy-check-rust.sh`.                                                               | Portar para `.mjs` ou exigir Git Bash.                                                  |
| W16 | CI                          | Só existe `publish.yml` (ubuntu). Nenhum job prova macOS/Windows nem o build da GUI.              | Matriz `ubuntu/macos/windows` rodando `typecheck`, `test`, `cargo test` do `src-tauri`. |
| W17 | `bun build --compile`       | Funciona no Windows, mas o `bun:sqlite` do binário e o `import.meta.main` devem ser validados lá. | Rodar `loopy --version` e um Run com `metrics:` no Windows.                             |

## Verificação

- Linux: `npm run typecheck`, `npm test`, `npm test -w apps/menubar`,
  `mise exec -- cargo test --manifest-path apps/menubar/src-tauri/Cargo.toml`,
  `npm run dev -w apps/menubar`.
- Sidecar compilado contra um projeto real, sem escrita:
  `apps/menubar/src-tauri/bin/loopy-<triple> --dry-run --no-tui <dir>`.
