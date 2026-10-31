# Implementation Plan: C-0021 — Correções do review do PR #8

> Escrito em 2026-10-30 (`/devy:plan`) a partir de `spec.md` (mesma pasta).
> As tasks vivem em `todo.md`; aqui só a forma do trabalho. F1–F10 da spec e as
> respostas às Open Questions (abaixo) **não são re-litigadas**.

## Overview

Sete correções sobre o código da C-0020, todas na branch
`feat/c-0020-distribuicao-multiplataforma`, antes do merge do PR #8. Elas formam
três trilhas que quase não se tocam:

1. **`loopy open` nunca lança a CLI** (B1) — só TypeScript do motor (`src/open/`)
   e o build do sidecar.
2. **O sidecar vivo nunca é morto** (B2, defesa no Rust) — `sidecar.rs`.
3. **O argv de launch na GUI** (B2, B3, M1, M2, M3, M4) — o planner puro
   `state/launch-args.ts`, o `App.tsx`, o bridge, e a fila de argv no `main.rs`.

A trilha 3 concentra quase tudo no `App.tsx` e no `launch-args.ts`, então ela é
**serial** por construção (arestas de merge). As trilhas 1 e 2 e o lado Rust da
fila correm em paralelo com ela.

## Respostas às Open Questions da spec (fechadas pelo usuário em 2026-10-30)

- **OQ1 (F6):** depois do Run, **sempre perguntar** ("Abrir agora?"), sem aplicar sozinho.
- **OQ2 (F2):** o binário empacotado é detectado por **constante injetada no build**
  (`bun build --compile --define __LOOPY_BUNDLED__=true`). Testado na sessão do
  plano: o binário compilado vê `true`; sob `bun`/`tsx`/Node a constante é
  indefinida e `typeof __LOOPY_BUNDLED__ !== "undefined"` dá `false`.
- **OQ3 (nome no NSIS):** vira passo da T-001 — confirmar na doc/fonte do Tauri v2
  que, sem `mainBinaryName`, o executável instalado é `loopy-menubar(.exe)`. Se não
  for, a T-001 para e registra a dívida (Windows é experimental).

## Architecture Decisions

- **Regra "nunca a CLI" em duas camadas** (F1): uma pura (nomes por plataforma +
  `isCliName` sem distinção de caixa em `darwin`/`win32`) e uma de I/O (`isSelf`
  por `realpath` contra `process.execPath` e `process.argv[1]`). A pura é o que os
  testes travam; a de I/O pega o caso que ninguém previu.
- **`starting` mora no `BridgeState`, não num `useState` do `App`.** É estado do
  Run (o `Glance` do popover e o `applySidecarExit` também precisam dele), e o
  bridge já é a fonte única do `runStatus`. `isRunActive(status)` fica no
  `launch-args.ts`, ao lado do planner que o usa.
- **`SidecarState::start` recusa em vez de matar** (F4). O slot já é limpo no exit
  (`sidecar.rs`, pid confere), então "Iniciar depois de um Run finalizado"
  continua funcionando. É a rede de segurança caso o frontend erre de novo.
- **`--run` reutiliza o `requestDir`** (F5): o "mesmo dir" vira um recarregamento
  pelo mesmo caminho de uma troca de dir, só com o texto do aviso diferente. Assim
  não nasce um segundo dirty guard.
- **Fila de argv no Rust como função pura** (F8): uma `LaunchQueue` com
  `push`/`drain` testável em `launch_args.rs`; o `main.rs` só a embrulha num
  `State<Mutex<…>>`. O evento `launch-args-pending` não leva payload: perder o
  evento não perde o pedido, porque o próximo `drain` o encontra.
- **Boot em etapas no webview** (F9): o `App` só aplica argv depois de decidir o
  dir inicial; antes disso, o listener só marca "tem pendência".

## Dependency Graph

```
T-001 resolveApp/isBundled (motor) ─────────────────────────────────────┐
T-002 sidecar.rs recusa start ──────────────────────────────────────────┤
T-003 runStatus "starting" + isRunActive ── T-004 --run pelo guard ──   │
        ── T-005 adiados (coalesce + "Abrir agora") ──┐                  │
T-006 fila de argv no Rust + main thread ─────────────┴─ T-007 boot ────┴─ T-008 docs
```

Arestas só de merge (mesmo arquivo): `T-004→T-003`, `T-005→T-004`
(`App.tsx`, `launch-args.ts`, testes), `T-007→T-005` (`App.tsx`).
`T-007→T-006` é lógica (o boot usa `drain_launch_args`). `T-008→*` documenta o
código final.

Largura máxima: 4 (T-001, T-002, T-003, T-006 na primeira camada).

## Phases

### Fase 1 — Bloqueadores do review — T-001, T-002, T-003, T-004
B1, B2 (frontend + Rust) e B3. Ao fim dela o review não tem mais bloqueador.
**Checkpoint:** gate completo verde; os testes de regressão de B1/B2/B3 existiam
vermelhos antes da correção (anotado na mensagem do commit ou no corpo do PR).

### Fase 2 — Menores — T-005, T-006, T-007
M1/M2 (adiados), M3 (boot) e M4 (main thread).
**Checkpoint:** gate verde + smoke manual no Linux (lista abaixo).

### Fase 3 — Documentação — T-008
ADR-0014, intent nodes e `cli.md` refletindo o código final.
**Checkpoint:** revisão humana; resposta ao review no PR #8 ligando cada item
(B1–B3, M1–M4) ao commit que o corrige.

### Smoke manual (Linux, binário de release) — depois da Fase 2

- [ ] Dois `loopy open <dir> --run` seguidos (< 1 s): um Run só; o primeiro não morre.
- [ ] Editor sujo + `loopy open <mesmo dir> --run`: aparece o aviso; Salvar, Descartar e Cancelar fazem o que o F5 diz.
- [ ] `loopy open <A>` e `loopy open <B>` durante um Run: o banner diz que B substituiu A; no fim do Run o resultado fica na tela até clicar em Abrir.
- [ ] App fechado + dois `loopy open` seguidos: o app abre no projeto do segundo.
- [ ] O checklist do PR #8 (seis itens) continua passando.

## Risks and Mitigations

| Risco | Impacto | Mitigação |
| ----- | ------- | --------- |
| Nome do executável no NSIS não é `loopy-menubar.exe` | Médio: `loopy open` não acharia a GUI no Windows | Verificação na T-001 (OQ3); Windows é experimental |
| `starting` esquecido em algum `switch` sobre `runStatus` | Alto e silencioso: UI presa ou exit classificado errado | `Record<RunStatus, …>` força exaustividade no `RUN_PILL`; T-003 faz `grep runStatus` no app inteiro |
| `start` recusando quebra o reinício de um Run | Alto | Teste Rust: exit limpa o slot e um novo `start` passa |
| M4 sem reprodução (sem Mac) | Baixo | Correção defensiva de uma linha; validação no primeiro release do macOS |
| Boot em etapas cria corrida nova | Médio | Fonte fake controlável no `App.test.tsx` cobre argv antes/durante/depois do `load_launch_config` |

## Open Questions

Nenhuma bloqueante. A OQ3 é resolvida dentro da T-001.
