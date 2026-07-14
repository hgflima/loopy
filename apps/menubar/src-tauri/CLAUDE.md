# src-tauri — o shell nativo (Rust): tray, popover NSPanel e o sidecar

## Purpose & Scope
A casca macOS do app: ciclo de vida do processo (accessory app, sem Dock), tray icon, as 3 janelas, o painel do popover (NSPanel swizzled), o **supervisor do sidecar** (o subprocesso `loopy`) e a **ponte de filesystem** com o projeto-alvo (`project_fs.rs`). É aqui que moram as armadilhas mais caras do app (resolução do binário, PATH, geometria do popover). **Não interpreta o domínio do loop**: nunca parseia NDJSON de evento, nunca sabe o que é Task/Step — só line-frama stdout e repassa ao webview. (Conhece *nomes* do domínio — `loopy.yml`, `todo.md`, `.loopy/backups/` — mas não o significado deles.)

## Entry Points & Contracts
- `main.rs:main()` — plugins (`positioner`, `dialog`, `notification`, `opener`, + `tauri_nspanel` em macOS); no `setup`: `ActivationPolicy::Accessory` (sem ícone no Dock), instala o popover panel, monta o tray (`icons/tray-template.png`, `icon_as_template(true)`). Clique esquerdo (Up) no tray → toggle do popover.
- **3 janelas**, todas `visible: false` no `tauri.conf.json`: `main` (1024×768), `popover` (320×180, transparent, alwaysOnTop, sem decorações), `about`. Fechar `main`/`about` = `prevent_close()` + `hide()` (o app **nunca** morre por fechar janela); volta a `Accessory` via `should_revert_to_accessory`.
- **17 comandos** `#[tauri::command]` (registrados no final de `main.rs`). Os que carregam contrato: `start_sidecar(dir, flags)`, `send_command(payload)` (escreve **uma linha NDJSON no stdin** do sidecar), `stop_sidecar()`, `resize_popover(height)`, `update_tray_title(title)`, `load/save_launch_config`, **`read_project_files(dir)`**, **`read_backlog(dir, path)`** e **`write_loopy_yml(dir, contents)`** (C-0014), `log_error(...)`, `quit_app`.
- **`project_fs.rs`** — a ponte de FS com o projeto-alvo. Contrato serde snake_case: **arquivo ausente vira `None`, erro de I/O vira `Err`** — o frontend depende dessa distinção para escolher entre empty-state e mensagem de erro. `read_project_files` devolve `{ loopy_yml }` e **nada mais**: o backlog **não** mora num `todo.md` fixo, e sim onde o `inputs.todo` do yml manda; quem sabe ler o schema é o frontend, então é ele que pede o arquivo depois, via **`read_backlog(dir, path)`**. Esse `path` vem de um yml editável à mão, logo é **confinado ao dir do projeto** por `resolve_within` (rejeita absoluto e qualquer `..` — sem isso o webview viraria leitor de arquivo arbitrário). `write_loopy_yml` **faz backup antes de sobrescrever** (`<dir>/.loopy/backups/loopy.<epoch>.yml`, retenção 10). São comandos dedicados **em vez de `tauri-plugin-fs`** justamente para não abrir permissão de FS ao webview — mesmo raciocínio do `hide_popover`.
- **Eventos para o webview** (`sidecar.rs`): `sidecar://line` (uma linha de stdout, já framed), `sidecar://stderr`, `sidecar://exit(code)`. Este é o único canal Rust→React de dados do Run.
- **Um Run por vez**: `SidecarState` é um `Mutex<Option<...>>`; `start` mata o anterior. > TODO(intent): invariante de produto ou limitação atual?
- Permissões (`capabilities/default.json`) são **mínimas** — só `core:default`, `dialog:default`, `notification:default` e `opener:allow-open-url` restrito a 3 URLs. Não há `core:window:allow-hide`: é por isso que `hide_popover` existe como comando em vez de o JS chamar a API de janela direto.

## Usage Patterns
- O Rust **sempre injeta** `--no-tui --emit-events` no argv do sidecar; as flags do usuário (`--yes`, `--task`, `--verbose`) vêm do React. O contrato de linha é o Transport NDJSON do motor (ADR-0007) — ver `../../../src/tui/`.
- Testes: unitários inline (`#[cfg(test)]`) em `main.rs`, `sidecar.rs`, `panel.rs`, `config.rs`, `project_fs.rs`. Rodam com `cargo test` — **nenhum script npm os invoca**, e o ESLint/`tsc` ignoram este diretório inteiro.

## Anti-patterns
- **Nunca trocar `is_executable_file` por `Path::exists()`** na resolução do sidecar. O `build.rs` cria um **placeholder de 0 byte** em `bin/loopy-<triple>` (senão `tauri_build` falha em `cargo check`/`tauri dev`), e spawná-lo dá **EACCES**. A checagem exige arquivo regular, não-vazio, com bit de execução. Há 5 testes travando isso.
- **Não usar as variantes `Tray*` do `tauri-plugin-positioner`** para posicionar o popover. O tray-icon reporta `y` na borda **superior** do ícone (0 na menubar) e o painel, em `NSMainMenuWindowLevel + 1`, escapa da constraint da barra → renderiza **por cima** da menubar. A geometria correta é `tray_y + tray_height + gap*scale` (`popover_origin`).
- Não redimensionar o popover pelo `set_size` de janela (path async do tao) — **não gruda** no painel swizzled. Use `panel.set_content_size` síncrono na main thread (`resize_popover_panel`).
- Não assumir que o `.app` herda o PATH do usuário: aberto pelo Finder/tray, o PATH é o do launchd (`/usr/bin:/bin:/usr/sbin:/sbin`) e o sidecar não acha `node`/`npx`/nvm. `login_shell_path()` roda `$SHELL -ilc 'echo $PATH'` — o **`-i` é obrigatório** (nvm vive no `.zshrc`).

## Dependencies & Edges
- Pai: `../CLAUDE.md` (build, sidecar, versão). Consumidor dos eventos: `../src/CLAUDE.md` (React).
- Contrato de frames: `docs/adrs/0007-transport-ndjson-duplex-native-ui.md`; implementação no motor em `src/tui/transport.ts`.

## Patterns & Pitfalls
- **Resolução do binário do sidecar tenta 4 layouts** porque `tauri build` **strippa** o prefixo `bin/` e o sufixo `-<triple>` (no bundle vira `Contents/MacOS/loopy`), enquanto `tauri dev` mantém o triple. Mexer no `externalBin` sem mexer aqui quebra em release e passa em dev.
- **Vibrancy do popover só funciona com o combo completo**: `transparent: true` + `macOSPrivateApi: true` + feature `macos-private-api` no Cargo + `NSVisualEffectState::Active` (senão o painel — que nunca ativa o app — renderiza permanentemente cinza) + a classe `popover-window` no `<html>`, que o React aplica.
- O popover é um `NSPanel` **não-ativante** (style mask `1<<7`), `CanJoinAllSpaces | Stationary | FullScreenAuxiliary`, e fecha em resign-key. Ele não é uma janela comum: APIs de janela do Tauri frequentemente não valem para ele.
- **O `allow(unexpected_cfgs)` do `panel.rs` mora no `Cargo.toml`, não no arquivo** (`[lints.rust]` + `check-cfg`). Não é desleixo: um `#![allow]` inline **não silencia cfg emitido por macro externa** — o lint resolve contra a check-cfg list da crate de destino. Quem "limpar" o `Cargo.toml` traz o warning de volta e não vai conseguir consertá-lo no `panel.rs`.
- `format_approval_decision` (Rust) duplica `formatApprovalPayload` (TS) e está `#[allow(dead_code)]`. > TODO(intent): deletar o lado Rust ou é a fronteira futura?
- `stop_sidecar` mata via `kill -TERM` em subprocesso, não por API nativa. > TODO(intent): razão histórica ou pendência?
