# D-0014 — Bundle AppImage aborta: o `patchelf` do linuxdeploy corrompe o sidecar do `bun --compile`

> **Status:** aberto · **Severidade:** média · **Área:** `apps/menubar/src-tauri/tauri.linux.conf.json` · `apps/menubar/src-tauri/src/sidecar.rs` · `apps/menubar/scripts/build-sidecar.mjs`
> **Descoberto em:** 2026-10-27 · **Origem:** C-0020, T-004 (decisão D5 da spec: Linux só `.deb`, AppImage adiado)

## Sintoma

Com `appimage` em `bundle.targets` no Linux, `npm run menubar` aborta no passo do
AppImage: o sidecar `loopy` empacotado passa a dar **segfault** e o bundle falha. O
`.deb` do mesmo build sai íntegro. Por isso a C-0020 fixou
`tauri.linux.conf.json` em `["deb"]` e o release Linux sai sem AppImage.

## Causa raiz

O Tauri gera o AppImage via `linuxdeploy`, que roda `patchelf` em **todo ELF de
`usr/bin`** do AppDir para reescrever `RPATH`/interpretador. O sidecar
(`externalBin` → `usr/bin/loopy`) é um executável do `bun build --compile`
(`apps/menubar/scripts/build-sidecar.mjs`): o runtime do Bun com o bundle JS
**anexado ao fim do ELF**. Reescrever o ELF com `patchelf` desloca/invalida esse
payload, e o binário resultante segfaulta. Mesmo problema relatado em
`khoj-ai/pipali#14`.

## Impacto

- Linux só tem instalador para distros com `dpkg`/`apt` (Debian/Ubuntu e
  derivadas); Fedora, Arch etc. ficam sem pacote pronto.
- Fail-closed: o build **falha**, não gera um AppImage quebrado em silêncio.
- `resolveApp` (`src/open/resolve-app.ts`) e a doc da CLI ainda procuram
  `~/Applications/Loopy*.AppImage` e `~/.local/bin/Loopy*.AppImage` — inofensivo
  (só candidatos a mais), e já pronto para quando o AppImage voltar.

## Reprodução

1. Em `apps/menubar/src-tauri/tauri.linux.conf.json`, troque `["deb"]` por
   `["deb", "appimage"]`.
2. `npm run menubar` num Linux com as libs do Tauri (`docs/how-to/plataformas.md` §2).
3. O passo do linuxdeploy falha; o `usr/bin/loopy` do AppDir segfaulta ao rodar
   `--version`.

## Correção proposta

Duas saídas, nenhuma testada:

1. **Tirar o sidecar de `usr/bin`** só no AppImage: empacotá-lo como arquivo
   comum via `bundle.linux.appimage.files` (fora do alcance do `patchelf`) e
   acrescentar esse caminho aos candidatos de `resolve_sidecar_path`
   (`sidecar.rs`, `sidecar_candidates`).
2. **Wrapper não-ELF em `usr/bin`**: um script que `exec`a o binário real guardado
   fora de `usr/bin`, de modo que o `patchelf` não tenha ELF do Bun para reescrever.

Ao resolver: voltar `appimage` ao `tauri.linux.conf.json`, ao template
`scripts/release/instructions_install.template.txt` (e ao `render-instructions.mjs`),
e a `docs/how-to/instalar.md`.

## Workaround atual

Usar o `.deb`. Em distro sem `dpkg`, rodar a GUI a partir do código
(`npm run dev -w apps/menubar`, ver `docs/how-to/plataformas.md`).
