# Implementation Plan: C-0042 — Exportar dados de Insights para CSV

> Deriva de `spec.md` (mesmo diretório). As decisões de design vivem na spec —
> este plano decide a mecânica e a ordem, não o design.

## Overview

Adicionar exportação CSV à aba Insights do app de menubar (`apps/menubar/`, Tauri v2 + React), 100% dentro do app — o motor (`src/` na raiz) não é tocado. O trabalho se divide em duas trilhas paralelas que convergem na integração: uma trilha Rust (escape CSV RFC 4180 → comandos `export_insights_csv` + gravação) e uma trilha frontend (componente `ExportCsvButton` puro com estado vazio). A instalação do `tauri-plugin-dialog` abre a trilha Rust porque é o passo com incerteza externa (versão a confirmar) e porque toca os arquivos compartilhados mais sensíveis (`capabilities/default.json`, `lib.rs`).

## Architecture Decisions

- **Gravação do arquivo via comando Rust dedicado, não via `tauri-plugin-fs`.** A spec exige o `tauri-plugin-dialog` só para o diálogo; para gravar a string retornada por `export_insights_csv`, um comando pequeno `write_csv_file(path, contents)` evita um segundo plugin e uma capability de filesystem ampla. Alternativa (`tauri-plugin-fs` + `fs:allow-write-text-file` com escopo) fica registrada caso o time prefira alinhar com outras frentes — trocar afeta só T-004 e T-005.
- **Whitelist de views no comando Rust.** `export_insights_csv` aceita apenas `v_task_costs`, `v_step_tokens`, `v_verdicts`; qualquer outro valor é erro. Mantém a camada Rust SELECT-only e fecha injeção de nome de view.
- **Estado vazio derivado dos dados já carregados.** A aba Insights já exibe as tabelas; `disabled` do botão deriva de `rows.length === 0` dos dados renderizados — sem query extra.
- **Zero cor hardcoded** (herdado da spec, não reabrir): todo estilo do botão/tooltip via `tokens.css`.
- **Motor intocado** (herdado da spec, não reabrir): nenhum arquivo fora de `apps/menubar/` e `docs/` é editado.

## Dependency graph

```
T-001 ─► T-002 ─► T-004 ─┐
                         ├─► T-005 ─► T-006
T-003 ───────────────────┘
```

Ready set inicial (sem deps): **T-001, T-003** — largura do grafo = 2, então `concurrency: auto` resolve 2.

Arestas que existem **só para serializar arquivo compartilhado** (não são dependência lógica):

- `T-001 → T-002`: ambas editam `apps/menubar/src-tauri/src/lib.rs` (registro do plugin × declaração `mod csv;`). Logicamente o módulo CSV independe do plugin.
- As demais arestas são lógicas: T-004 usa o módulo do T-002 (e também edita `lib.rs`); T-005 consome os comandos do T-004 e o componente do T-003.

`capabilities/default.json` é editado **apenas** por T-001, e o barrel `src/ui/index.ts` **apenas** por T-003 — os dois arquivos que a spec marca como compartilhados com outras frentes ficam cada um confinado a uma única task.

## Vertical slicing (why this order)

- **Fase 1** ataca primeiro o que pode afundar o plano: T-001 carrega a única incerteza externa (versão do plugin a confirmar na doc oficial) e as edições nos arquivos compartilhados; em paralelo, T-003 entrega o componente visual completo (com o estado vazio da spec) testável com mock. T-002 fecha a fase com o escape RFC 4180 provado por teste unitário antes de qualquer comando depender dele.
- **Fase 2** (T-004) entrega o contrato Rust↔frontend completo: as 3 views exportam string CSV válida, verificável por `cargo test` sem UI.
- **Fase 3** (T-005) liga as pontas — a essa altura toda peça já foi verificada isolada, então a integração só orquestra: invoke → diálogo → gravação.
- **Fase 4** (T-006) documenta o comportamento final (escrever docs antes do fluxo existir geraria retrabalho).

Cada fase deixa o app compilando e os testes verdes; nada é merjado com o fluxo pela metade porque o botão só entra na aba em T-005.

## Phases & checkpoints

### Fase 1 — Fundação (T-001 → T-002 ∥ T-003)

Plugin instalado com versão confirmada + capability concedida; escape CSV provado por teste; componente de botão pronto e testado isolado.

**Checkpoint: Fundação**
- [ ] `cargo clippy` e `cargo test` verdes no `src-tauri` (escape cobre vírgula, aspas e newline)
- [ ] `npm run typecheck` e testes do `ExportCsvButton` verdes
- [ ] Versão do `tauri-plugin-dialog` pinada conforme doc oficial; permissão de save presente em `capabilities/default.json`

### Fase 2 — Comandos Rust (T-004)

`export_insights_csv` + gravação registrados e testados contra banco em memória.

**Checkpoint: Contrato Rust**
- [ ] As 3 views exportam CSV com header; view desconhecida erra; view vazia retorna só o header
- [ ] `cargo test` e `cargo clippy` verdes

### Fase 3 — Integração UI (T-005)

Botão por tabela na aba Insights com o fluxo completo diálogo → gravação.

**Checkpoint: End-to-end (critério da spec)**
- [ ] Exportar cada uma das 3 views manualmente e abrir o arquivo no Numbers/Excel — campos com vírgula/aspas/newline não corrompem
- [ ] Botão desabilitado com tooltip quando a view não tem linhas
- [ ] `npm run typecheck`, `npm test -w apps/menubar` verdes
- [ ] Revisão humana antes de seguir

### Fase 4 — Documentação (T-006)

**Checkpoint: Completo**
- [ ] Seção "Exportar CSV" em `docs/how-to/insights.md`
- [ ] Todos os success criteria da spec atendidos

## Risks and mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| Versão do `tauri-plugin-dialog` desconhecida (não está no projeto) | Med | T-001 confirma na documentação oficial **antes** de pinar no `Cargo.toml`; é a primeira task do grafo (fail fast) |
| Edição concorrente de `capabilities/default.json` e `src/ui/index.ts` por outras frentes | Med | Cada arquivo compartilhado confinado a uma única task (T-001 e T-004), com edição mínima; merge cedo na Fase 1 |
| Escape RFC 4180 incorreto corrompe o CSV silenciosamente | High | Função pura + testes unitários (T-002) fecham antes de qualquer comando consumir; casos vírgula/aspas/newline explícitos |
| Diálogo nativo não testável em ambiente headless | Low | Testes React mockam `invoke` e o `save()` do plugin (spec já prevê mock); verificação real fica no checkpoint manual da Fase 3 |
| Caminhos exatos dos arquivos da aba Insights podem divergir | Low | `Files:` de T-005 são os prováveis; a task confirma no repo antes de editar, sem mudar o escopo |

## Open questions

- Nenhuma que bloqueie o início — a spec resolveu os ramos. Única decisão vetável: o mecanismo de gravação (comando Rust dedicado × `tauri-plugin-fs`), registrada em Architecture Decisions; trocar afeta apenas T-004 e T-005.
