# menubar — a GUI nativa do loopy (Tauri v2 + React), a "Native UI"

## Purpose & Scope
App macOS de menubar (`@hgflima/loopy-menubar`, privado) que **observa e dirige um Run** do motor: dispara `loopy`, mostra Kanban/grafo/streams ao vivo e resolve o Gate de Aprovação. É a **Native UI** do ADR-0007 — e ela **não é um renderer alternativo dentro do processo**: roda **fora**, como app, com o motor de **sidecar** (`loopy --no-tui --emit-events <dir>`), falando **NDJSON duplex** por stdin/stdout.

NÃO é: parte do motor (não decide nada do loop — AD-1), nem dona do domínio (Task/Step/Status vêm do motor).

## Entry Points & Contracts
**Três** superfícies distintas contra o motor/projeto — confundi-las é o erro nº 1 aqui:

1. **Processo (runtime): sidecar NDJSON.** O Rust spawna o binário `loopy`, line-frama o stdout e emite `sidecar://line|stderr|exit` ao webview; o retorno é uma linha no stdin (hoje só `approval_decision`). Contrato de frames = ADR-0007 (`event` | `control` | `command`), implementado em `src/tui/transport.ts` no motor.
2. **Tipos e lógica pura (build-time): subpath imports `loopy/…`.** Hoje são cinco: `loopy/tui/{store,view,transport}` + **`loopy/config`** (schema zod, `parseConfigSource`, `serializeConfig`, `initialConfigTemplate`) + **`loopy/backlog`** (`parseBacklog`) — mais `loopy/types`. É o que permite editar e validar o `loopy.yml` **sem reimplementar nada**.
3. **Filesystem (C-0014): comandos Rust `read_project_files` / `read_backlog` / `write_loopy_yml`.** Não passa pelo sidecar nem é build-time (**arquivo ausente = `None`, não erro** — é assim que o app decide o empty-state); grava o yml **com backup** em `<dir>/.loopy/backups/loopy.<epoch>.yml` (retenção 10). São comandos dedicados de propósito, **não** `tauri-plugin-fs`: mantém o capability mínimo. **A leitura é em duas etapas, e a ordem é obrigatória**: o Rust só lê o `loopy.yml`; o path do backlog é declarado *pelo yml* (`inputs.todo` — quase nunca `<dir>/todo.md`), então só depois de parsear/validar o yml o frontend sabe o que pedir ao `read_backlog(dir, path)`. Ler `todo.md` fixo era o bug que deixava o board vazio em todo projeto real.

**`loopy/*` NÃO é o pacote publicado.** É um alias para `../../src/*` (o TypeScript do motor) em `vite.config.ts`, `vitest.config.ts` e `tsconfig.json` — os três são **wildcards** (`^loopy/(.*)`), então um subpath novo funciona sem tocá-los. O que precisa acompanhar é o **`exports` do `package.json` da raiz** — e ele **não acompanhou**: o app importa `loopy/types`, que **não está exportado** lá. Funciona aqui (o alias resolve o fonte), mas o pacote publicado não oferece esse subpath. O `package.json` do app lista `"@hgflima/loopy": "*"`, mas **nenhum arquivo importa esse specifier** — resolvê-lo pegaria o build publicado stale.

- Versão: `tauri.conf.json` aponta para o `package.json` **da raiz** (single source). Travado por `src/version-single-source.test.ts`.

## Usage Patterns
- Dev completo: `npm run dev -w apps/menubar` (= `build:sidecar && tauri dev`). UI só, sem Rust: `npm run dev:web -w apps/menubar` (usa o `MOCK_FEED`). **`npm run menubar` na raiz não é o caminho de dev**: ele aponta para o `build` daqui (`build:sidecar && tauri build`) e **empacota o `.app`**.
- Build: `build:sidecar` usa **bun** (`bun build --compile ../../src/index.ts`) + `codesign` ad-hoc, e o `.app` embute o binário via `externalBin`. Isso é o que exige o `import.meta.main` em `src/index.ts` no motor.
- Testes: `npm test -w apps/menubar` (vitest/jsdom). **`npm test` na raiz NÃO roda os testes deste app** — o `include` da raiz é `tests/**` relativo à raiz. `npm run typecheck` da raiz **cobre** o app (mas só `src/`, não `tests/`).

## Anti-patterns
- Não tratar a Native UI como "trocar o renderer do Ink". Ela é out-of-process; o acoplamento é o **Transport**, não o React.
- Não mudar a shape de `StoreEvent`/frames/schema no motor sem olhar aqui: `src/tui/{store,view,transport}` e os barrels `config`/`backlog` são **API pública** (subpath exports com `dts`) e este app é o consumidor real.
- Não duplicar no frontend o que o motor já exporta: **reducer, status de task, schema zod do yml, tipos de step, parser do backlog**. Duplicar é como app e motor divergem em silêncio.
- Não importar `node:fs` (nem nada de Node) nos módulos do motor que o app consome: `config` e `backlog` são **browser-safe por contrato**; o I/O vive isolado em `load.ts`/`todo.ts`.
- Não presumir cross-platform: `build:sidecar` tem o triple **`aarch64-apple-darwin` hardcoded** e depende de `bun` (não declarado em `engines`/devDependencies). > TODO(intent): Windows/Linux/x86_64 são fora de escopo do v1 ou dívida? (Há um caminho não-macOS no Rust que parece aspiracional.)

## Dependencies & Edges
- Filhos: `src-tauri/CLAUDE.md` (Rust: tray, NSPanel, sidecar) e `src/CLAUDE.md` (React: bridge de estado, Kanban, grafo, streams).
- Motor: `../../CLAUDE.md` (raiz) e `../../src/tui/CLAUDE.md` (a camada que este app consome).
- Decisão: `docs/adrs/0007-transport-ndjson-duplex-native-ui.md`. Produto/design do app: `PRODUCT.md`, `DESIGN.md` (este último é **target**, não o estado atual do código).

## Patterns & Pitfalls
- **Duas cópias de React**: a raiz usa React 19 (Ink), o app usa React 18. O `vitest.config.ts` **força** todo `react`/`react-dom` para o `node_modules` do app e faz `inline` de `@xyflow/react`, `zustand`, `use-sync-external-store`, `react-markdown` — sem isso os hooks quebram. O `vite.config.ts` resolve por `dedupe`. Mexer nisso sem entender o porquê traz de volta o "Invalid hook call".
- **Dogfooding**: rodar um Run *deste repo* com `tauri dev` ativo faz o watcher recompilar ao merjar Rust na working tree — o app reinicia e **mata o motor-filho**. Rode o Run pelo CLI, ou use `tauri dev --no-watch`.
- **Dois diretórios de teste** (`src/**/*.test.ts` e `tests/`) com nomes sobrepostos e conteúdo diferente; só `src/` é typechecked. > TODO(intent): qual é a convenção?
