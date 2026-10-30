# Spec: C-0021 — Correções do review do PR #8 (`loopy open` e argv de launch da GUI)

> Escrita em 2026-10-30, a partir do review **CHANGES_REQUESTED** do PR
> [hgflima/loopy#8](https://github.com/hgflima/loopy/pull/8) (C-0020). Todos os
> pontos do review foram **conferidos no código** da branch
> `feat/c-0020-distribuicao-multiplataforma` (commit `1d053c0`) antes de entrar
> aqui. Esta change é implementada **na mesma branch** e entra no mesmo PR: ela
> é pré-requisito do merge da C-0020, não uma entrega separada.
>
> Decisões da C-0020 (D1–D5, E1–E11) continuam valendo. Esta spec **refina** o
> E1 (como `loopy open` acha a GUI) e o E3 (instância única com Run ativo) e
> não reabre mais nada.

---

## Objective

O review apontou três bloqueadores e três problemas menores. Todos quebram uma
garantia que a C-0020 prometeu:

| #  | Garantia da C-0020                               | Como ela quebra hoje                                                                                                     |
| -- | ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------ |
| B1 | `loopy open` abre a **GUI** (E1)                  | No macOS, com a CLI instalada por `npm i -g`, ele acha a **própria CLI** e roda um Run headless, que com `--yes` aprova o Merge sozinho. |
| B2 | Um `loopy open` **nunca mata um Run** (E3)        | Durante os segundos entre o clique em Iniciar e o `run_started`, um `--run` mata o sidecar que ainda está subindo.        |
| B3 | Nada sobrescreve o yml sem passar pelo aviso      | `--run` no mesmo projeto, com o editor sujo, salva o rascunho por cima do `loopy.yml` em disco sem perguntar.             |
| M1 | O usuário vê o resultado do Run                   | Um pedido adiado é aplicado assim que o Run termina e tira a tela de resultado (escalonamento/falha) antes que alguém a veja. |
| M2 | Nenhum pedido de `loopy open` some               | Um segundo `loopy open` durante o Run descarta o primeiro sem avisar.                                                     |
| M3 | Idem, na inicialização do app                    | Um `loopy open` que chega antes do `listen` registrar se perde; um que chega antes do `load_launch_config` é sobreposto pelo dir salvo. |
| M4 | O app não cai no macOS (hipótese do review)      | O callback da instância única roda fora da main thread e chama AppKit (`panel.order_out`).                                |

**Sucesso, em uma frase:** nenhum `loopy open`, em nenhuma ordem e em nenhum
momento, lança a CLI no lugar da GUI, mata um Run, grava o yml sem perguntar,
esconde o resultado de um Run ou se perde — e cada um desses casos tem um teste
que falharia no código atual.

### O que NÃO é

- **Não** muda o contrato de argv da GUI (E2), o argv do sidecar nem o que
  `loopy [dir]` faz (D1).
- **Não** mexe no pipeline de release, nos instaladores, no CI nem nos docs de
  instalação da C-0020 (o review não apontou nada lá).
- **Não** valida funcionalmente o app no macOS/Windows. O M4 é corrigido de forma
  defensiva, sem reprodução (não temos Mac no ciclo de desenvolvimento).
- **Não** resolve os achados que o próprio PR listou como fora de escopo
  (colisão do step `fim` com a coluna "Fim", `rustfmt` em código antigo, sidecar
  instalado como `/usr/bin/loopy` no `.deb`).

---

## Diagnóstico (conferido no código)

### B1 — `resolveApp` casa a CLI no macOS

`src/open/launch.ts` passa `selfDir: dirname(process.execPath)`. Com a CLI do npm,
`process.execPath` é o **Node**, então `selfDir` é a pasta `bin` do Node
(nvm/Homebrew), onde também mora o link `loopy` da CLI. `siblingCandidates`
(`src/open/resolve-app.ts`) testa `loopy-menubar` e depois `Loopy`; no APFS, que
não diferencia caixa, `Loopy` casa com `loopy`. Como os irmãos vêm antes dos
locais padrão, isso ganha até do `/Applications/Loopy.app`.

O mesmo nome `Loopy` aparece em `macBinaries` (defaults e `LOOPY_APP`), onde
`Contents/MacOS/Loopy` casa com o sidecar `Contents/MacOS/loopy`. Hoje só não
acontece porque `loopy-menubar` vem antes. No Windows (NTFS, também sem
distinção de caixa), `Loopy.exe` casa com o sidecar `loopy.exe` pelo mesmo motivo.

### B2 — "Run ativo" começa tarde demais

`App.tsx` define `isRunning = ui.runStatus === "running"`. O `runStatus` só vira
`running` com o frame `run_started`, emitido depois do spawn eager dos Agentes.
Entre o `onStartRun` e esse frame, `planLaunchArgs` recebe `isRunning: false`,
devolve `startAfterLoad`, e o `handleLaunch` chama `start_sidecar`. O
`SidecarState::start` (`src-tauri/src/sidecar.rs`) faz `self.stop()` antes do
spawn e mata o Run que estava subindo. O efeito do `pendingStart` tem o mesmo
furo.

### B3 — `--run` no mesmo dir pula o dirty guard

Sem troca de dir, `planLaunchArgs` não emite `switchDir`, e o `startAfterLoad`
nasce com `loaded: true`. O `handleLaunch` então faz auto-save do rascunho sujo
por cima do `loopy.yml`. Com o Run em `finished` e o mesmo dir acontece igual,
depois do `onDismissRun`.

### M1/M2 — pedido adiado

O efeito "The Run ended" aplica o `deferredLaunch` assim que `isRunning` cai.
Nesse momento o status já é `finished`, então `applyLaunchArgs` chama
`onDismissRun` e a tela de resultado some. `setDeferredLaunch` guarda só o último
pedido.

### M3 — corrida no boot

O webview registra o `listen("launch-args")` num `useEffect`. Antes disso, o
`emit_to` do Rust (`on_second_instance`) cai no vazio. Se o evento chega depois
do listener mas antes de `load_launch_config` resolver, o `.then` do dir salvo
faz `setDir(cfg.dir)` + `load` por cima do pedido novo.

### M4 — thread do callback (hipótese)

`on_second_instance` → `surface_main_window` → `hide_tray_popover` →
`hide_popover_panel` (`panel.rs`) chama `panel.order_out` direto.
`resize_popover_panel` já usa `run_on_main_thread` de propósito. Não sabemos se o
`tauri-nspanel` despacha sozinho; corrigir custa uma linha.

---

## Decisões de desenho (desta spec — revisáveis no refine)

| #  | Decisão |
| -- | ------- |
| F1 | **A GUI nunca casa com a CLI.** Em plataformas sem distinção de caixa (`darwin`, `win32`), `resolveApp` só procura o nome `loopy-menubar` (`loopy-menubar.exe`), em **todas** as fontes (`LOOPY_APP` com `.app`, irmãos e defaults). O nome `Loopy` continua só no Linux. Além disso, `resolveApp` recebe um `isSelf(path)` injetado e **descarta qualquer candidato que seja o próprio executável ou o script da CLI** (realpath igual a `process.execPath` ou a `process.argv[1]`). As duas regras são redundantes de propósito: a primeira é pura e testável sem filesystem; a segunda pega o caso que ninguém previu. |
| F2 | **Irmãos só no binário empacotado.** A busca "ao lado do executável" existe para o sidecar dentro do bundle. Ela só roda quando o processo **é** o binário do `loopy` (`bun --compile`), detectado por `basename(process.execPath)` não ser `node`/`node.exe`/`bun`/`bun.exe`. Rodando sob Node (npm), `selfDir` fica vazio e a busca é pulada. O `searched` da mensagem de erro deixa de listar a pasta do Node. |
| F3 | **O Run está ativo desde o clique.** `BridgeState.ui.runStatus` ganha o estado **`starting`**: `handleStartRun` entra em `starting`; `run_started` leva a `running`; exit em `starting` é **start-fail** (como `idle` hoje); falha de spawn também. `planLaunchArgs` e o efeito do `pendingStart` tratam `starting` e `running` como **Run ativo** (`isRunActive`). A pill mostra "Iniciando". |
| F4 | **Defesa no Rust.** `SidecarState::start` deixa de matar o sidecar vivo: com um processo no slot, devolve `Err("Run em andamento")`. Quem quer trocar de Run chama `stop_sidecar` antes, explicitamente. O slot já é limpo no exit (`sidecar.rs`, `*inner = None` quando o pid bate), então um Run novo depois de um finalizado continua funcionando. |
| F5 | **`--run` sempre recarrega o projeto pelo dirty guard.** Com `--run`, `planLaunchArgs` emite o carregamento do dir **mesmo quando o dir não muda** (`switchDir` vira `loadDir`, com o campo `reload: true` quando é o mesmo dir). Esse carregamento passa por `requestDir`, ou seja, pelo aviso Salvar/Descartar/Cancelar quando o rascunho está sujo. Salvar grava e inicia; Descartar relê do disco e inicia; Cancelar mantém tudo e descarta o `--run`. Sem rascunho sujo, o yml é relido do disco antes de iniciar, para o board mostrar o que vai rodar. O texto do aviso distingue "trocar de projeto" de "iniciar um Run". |
| F6 | **O resultado do Run não some sozinho.** Um pedido adiado **não** é aplicado automaticamente quando o Run termina. O banner muda para "O Run terminou. Abrir `<dir>` agora?" com **Abrir** (volta para idle e aplica o pedido) e **Descartar**. O board de resultado fica visível até o usuário escolher. Sem dir no pedido (só flags), o texto fala em "aplicar as flags". |
| F7 | **Pedidos adiados se acumulam.** Vários `loopy open` durante um Run são **combinados** por uma função pura `coalesceLaunchArgs(a, b)`, com o mesmo resultado de aplicá-los em sequência: o último `dir` não nulo vence, o último `task` não nulo vence, `yes`/`verbose` ficam ligados se algum pedido ligou, e `run` é sempre descartado (um Run por vez). Quando o dir muda, o banner diz qual pedido foi substituído. |
| F8 | **Fila de argv no Rust, drenada pelo webview.** O `LaunchArgsState` vira uma fila (`VecDeque<LaunchArgs>`). O argv inicial **e** o de cada segunda instância entram na fila. A segunda instância também emite `launch-args-pending`, que é só um aviso, sem payload. O webview drena a fila com `drain_launch_args` (substitui `take_launch_args`). |
| F9 | **Boot determinístico no webview.** Ordem: (1) registra o listener de `launch-args-pending`, que só drena depois do boot; (2) `load_launch_config` aplica as **flags** salvas; (3) drena a fila; (4) se algum pedido drenado tem dir, o dir salvo **não** é carregado; senão carrega o dir salvo; (5) aplica os pedidos drenados, combinados (F7), pelo `planLaunchArgs`; (6) marca o boot como concluído e drena de novo, para pegar o que chegou no meio. Nenhum argv é aplicado antes do passo 5. |
| F10 | **Callback da segunda instância na main thread.** O corpo de `on_second_instance` roda dentro de `app.run_on_main_thread`. O enfileiramento (F8) acontece antes, fora do closure, para o pedido não depender do despacho. |

---

## Tech Stack

Sem dependência nova. Tudo usa o que a C-0020 já trouxe: `tauri-plugin-single-instance`
v2, Tauri v2, React 18, vitest, `cargo test`.

---

## Commands

```bash
# Qualidade (o mesmo gate da C-0020)
npm run typecheck && npm run lint && npm test && npm test -w apps/menubar
mise exec -- cargo test --manifest-path apps/menubar/src-tauri/Cargo.toml

# Smoke manual (Linux, binário de release)
npm run menubar                                  # gera o .deb
loopy open ~/proj --run                          # e, logo em seguida, de novo:
loopy open ~/proj --run                          # o 2.º não pode matar o 1.º
LOOPY_APP=/caminho/que/nao/existe loopy open .   # erro lista só candidatos da GUI
```

---

## Project Structure

```
src/open/
  resolve-app.ts           → F1/F2: nomes por plataforma (sem `Loopy` em darwin/win32), `isSelf` injetado
  launch.ts                → F2: `selfDir` só quando o processo é o binário empacotado; `isSelf` real (realpath)
tests/open/
  resolve-app.test.ts      → + `exists` case-insensitive (regressão do B1), `isSelf`, sob-Node sem irmãos

apps/menubar/src/
  state/store-bridge.ts    → F3: `runStatus: "starting"`; exit em `starting` = start-fail
  state/launch-args.ts     → F3 `isRunActive`; F5 reload pelo guard; F7 `coalesceLaunchArgs`
  main.tsx                 → F3: `handleStartRun` entra em `starting`
  App.tsx                  → F3/F5/F6/F9: guarda de Run ativo, banner "Abrir agora", boot em etapas
  popover/Glance.tsx       → F3: trata `starting` (não pode cair no ramo idle)
  state/launch-args.test.ts, state/store-bridge.test.ts, App.test.tsx → regressões

apps/menubar/src-tauri/src/
  sidecar.rs               → F4: `start` recusa com processo vivo
  main.rs                  → F8 fila + `drain_launch_args` + evento `launch-args-pending`; F10 main thread

docs/adrs/0014-distribuicao-e-release-automatico.md → adendo: F1/F2 (E1) e F3–F9 (E3)
apps/menubar/CLAUDE.md, apps/menubar/src/CLAUDE.md   → argv de launch: fila/drain, `starting`, banner
docs/reference/cli.md                                → `loopy open`: ordem de busca atualizada
```

---

## Code Style

Igual à C-0020: decisão em função pura (AD-6), I/O fino em volta, erro como
valor nas fronteiras (AD-5), comentário explicando o **porquê**. Cada correção
leva junto o comentário que teria evitado o bug (ex.: por que `Loopy` não entra
na lista do macOS).

```ts
/** Run "active" for launch purposes: from the click on Iniciar, not from run_started (B2). */
export function isRunActive(status: RunStatus): boolean {
  return status === "starting" || status === "running";
}

/**
 * Merge launch argv held during a Run (F7). Same result as applying `a` then
 * `b` in sequence: later dir/task win, flags only turn on, `run` never survives.
 */
export function coalesceLaunchArgs(a: LaunchArgs, b: LaunchArgs): LaunchArgs;
```

---

## Testing Strategy

Cada item do review vira um teste que **falha no código atual** antes da correção
(TDD: vermelho primeiro, depois verde).

| Item | Teste | Onde |
| ---- | ----- | ---- |
| B1 | `exists` case-insensitive com `<nodeBin>/loopy` existente e `/Applications/Loopy.app` instalado → resolve o `.app` (`Contents/MacOS/loopy-menubar`), nunca `<nodeBin>/Loopy` | `tests/open/resolve-app.test.ts` |
| B1 | Mesma coisa no `win32` com `loopy.exe` ao lado do GUI | idem |
| B1 | `isSelf` devolvendo `true` para um candidato → ele é pulado | idem |
| F2 | Sob Node (`execPath` = `.../node`) a busca de irmãos não roda e não aparece em `searched` | `tests/open/resolve-app.test.ts` / `tests/cli/open.test.ts` |
| B2 | `planLaunchArgs` com status `starting` + `--run` → `warnRunActive`, sem `startAfterLoad` | `state/launch-args.test.ts` |
| B2 | `applyLine`/`applySidecarExit`: `starting` → `running` no `run_started`; exit em `starting` = start-fail | `state/store-bridge.test.ts` |
| B2 | App: clicar Iniciar e, antes do `run_started`, receber `--run` → `onStartRun` chamado **uma** vez | `App.test.tsx` |
| F4 | `SidecarState::start` com slot ocupado → `Err`, o processo vivo continua | `#[cfg(test)]` em `sidecar.rs` (com processo fake) |
| B3 | Mesmo dir + rascunho sujo + `--run` → aparece o aviso; Cancelar não grava e não inicia; Descartar relê e inicia; Salvar grava e inicia | `App.test.tsx` |
| B3 | Mesmo dir + `finished` + sujo + `--run` → mesmo aviso | `App.test.tsx` |
| M1 | Run termina com pedido adiado → o board de resultado continua; o banner mostra "Abrir agora"; só ao clicar o app volta para idle | `App.test.tsx` |
| M2 | `coalesceLaunchArgs`: tabela de casos (dir/task/flags/run) igual à aplicação sequencial | `state/launch-args.test.ts` |
| M3 | Fonte fake: argv enfileirado antes do mount e durante o `load_launch_config` → aplicado depois do boot, sem o dir salvo sobrepor | `App.test.tsx` |
| F8 | Fila: inicial + duas segundas instâncias → `drain` devolve as três em ordem e depois vazio | `#[cfg(test)]` em `main.rs` (função pura de fila) |
| M4 | Sem teste automatizado (precisa de AppKit). Coberto por revisão de código e pelo smoke do primeiro release no macOS | — |

**Smoke manual (Linux)** — refaz o checklist do PR #8 mais estes casos:

- [ ] Dois `loopy open <dir> --run` seguidos (< 1 s): um Run só, o primeiro não morre.
- [ ] Editor sujo + `loopy open <mesmo dir> --run`: aparece o aviso; os três botões fazem o que o F5 diz.
- [ ] `loopy open <A>` e `loopy open <B>` durante um Run: o banner indica que B substituiu A; quando o Run termina, o resultado continua na tela até clicar em Abrir.
- [ ] Fechar o app e disparar dois `loopy open` seguidos: o app abre no projeto do segundo.

---

## Boundaries

- **Always:**
  - Escrever o teste que reproduz o item do review **antes** da correção e confirmar que ele falha.
  - Manter o argv de launch (E2), o argv do sidecar e `loopy [dir]` inalterados.
  - Toda decisão nova em função pura (`resolveApp`, `planLaunchArgs`, `coalesceLaunchArgs`, `isRunActive`, a fila do Rust).
  - Commits `fix(...)`: são correções de comportamento da C-0020, que ainda não saiu em release.
  - Atualizar ADR-0014 e os `CLAUDE.md` do menubar no mesmo PR.
- **Ask first:**
  - Mudar o comportamento de "Iniciar" pelo próprio usuário (fora do `loopy open`) além do estado `starting`.
  - Qualquer dependência nova.
  - Mudar o texto/fluxo do dirty guard fora dos dois contextos (trocar projeto × iniciar Run).
- **Never:**
  - Matar um sidecar vivo como efeito colateral de um `loopy open`.
  - Gravar o `loopy.yml` sem passar pelo aviso quando o rascunho está sujo.
  - Lançar qualquer binário cujo nome, sem distinção de caixa, seja o da CLI (`loopy`/`loopy.exe`).
  - Adicionar o Claude como co-author nos commits.

---

## Success Criteria

1. No macOS com `npm i -g` e `Loopy.app` em `/Applications`, `loopy open . --yes` abre a GUI. O teste case-insensitive do B1 cobre o caso, e `resolveApp` não tem nenhum candidato chamado `Loopy`/`Loopy.exe` em `darwin`/`win32`.
2. Sob Node, a mensagem "GUI não encontrada" não lista a pasta `bin` do Node.
3. Um `--run` recebido entre o clique em Iniciar e o `run_started` não inicia outro Run nem mata o atual: vira aviso. Mesmo que o frontend erre, o Rust recusa (`start` com slot ocupado = erro).
4. `--run` com o rascunho sujo, no mesmo projeto ou em outro, com o Run em idle ou `finished`, sempre passa pelo aviso Salvar/Descartar/Cancelar.
5. O fim de um Run com pedido adiado deixa o resultado na tela até o usuário clicar em Abrir ou Descartar.
6. N pedidos durante um Run viram um, combinado como se aplicados em sequência, e o banner deixa claro o que foi substituído.
7. Nenhum argv se perde no boot: a fila no Rust guarda tudo até o webview drenar, e o dir salvo nunca sobrepõe um pedido de `loopy open`.
8. `on_second_instance` executa a parte de janela/painel na main thread.
9. Gate verde: typecheck, lint, as duas suítes TS, `cargo test`, `actionlint`. Smoke manual do Linux refeito.
10. O PR #8 recebe uma resposta ao review ligando cada item (B1–B3, M1–M4) ao commit que o corrige.

---

## Open Questions

1. **F6 — confirmação depois do Run.** A proposta é sempre perguntar ("Abrir agora?"). A alternativa é aplicar sozinho quando o Run termina **sem** escalonamento nem falha. Proposta: sempre perguntar, que é mais simples e previsível.
2. **F2 — detecção do binário empacotado** por `basename(process.execPath)`. Se o loopy um dia rodar sob outro runtime (Deno), a regra precisa de mais um nome. Alternativa: o `build-sidecar.mjs` injeta uma constante (`--define LOOPY_BUNDLED=true`). Proposta: a constante, se o `bun build --compile` aceitar `--define` sem custo; senão o basename.
3. **Nome do binário da GUI no NSIS.** O F1 assume que o executável instalado no Windows é `loopy-menubar.exe` (nome do crate). Se o bundler do Tauri renomear para `Loopy.exe`, ele colide com o sidecar `loopy.exe` na mesma pasta (NTFS não diferencia caixa). Conferir o conteúdo do `-setup.exe` gerado pelo CI antes de fechar a change. Se colidir, vira dívida separada (Windows é experimental).
