# Backlog: C-0042 — Exportar dados de Insights para CSV

> Consumed by tooling (`- [ ]` pending / `- [x]` done; id `T-\d+`; indented body).
> Narrativa, grafo de dependências, checkpoints e riscos: ver `plan.md` (mesmo diretório).

## Fase 1 — Fundação (T-001 → T-002 ∥ T-003)

- [ ] T-001: Instalar e configurar o tauri-plugin-dialog
    Confirmar a versão atual do plugin na documentação oficial do Tauri v2 antes de pinar (restrição da spec); adicionar a crate no Cargo.toml e o pacote JS `@tauri-apps/plugin-dialog`, registrar o plugin no builder e conceder a permissão do diálogo de salvar em `capabilities/default.json`. Edição mínima no capabilities — arquivo compartilhado com outras frentes; nenhuma outra task da change o toca.
    Acceptance: app compila com o plugin registrado; `capabilities/default.json` contém a permissão de save do dialog; versão pinada corresponde à documentação oficial.
    Verification: `cargo clippy --manifest-path apps/menubar/src-tauri/Cargo.toml` && `npm run typecheck`
    Deps: none
    Files: apps/menubar/src-tauri/Cargo.toml, apps/menubar/src-tauri/src/lib.rs, apps/menubar/src-tauri/capabilities/default.json, apps/menubar/package.json
    Size: S
    Risk: M

- [ ] T-002: Criar módulo Rust de geração CSV (RFC 4180) com testes
    Função pura que monta o CSV (header + linhas) a partir de colunas e valores, escapando campos com vírgula, aspas e newline conforme RFC 4180. Testes unitários cobrindo os três casos de escape mais o campo simples sem escape. Depende de T-001 apenas para serializar a edição de `lib.rs` (declaração `mod csv;`).
    Acceptance: campo com vírgula sai entre aspas; aspas internas duplicadas; newline preservado dentro de aspas; campo simples sai sem aspas; testes unitários dos quatro casos passam.
    Verification: `cargo test --manifest-path apps/menubar/src-tauri/Cargo.toml csv`
    Deps: T-001
    Files: apps/menubar/src-tauri/src/csv.rs, apps/menubar/src-tauri/src/lib.rs
    Size: S
    Risk: S

- [ ] T-003: Criar componente ExportCsvButton com estado vazio
    Componente de apresentação puro: botão "Exportar CSV" com props `disabled`/`onExport`; quando desabilitado, exibe tooltip "Sem dados para exportar". Estilo exclusivamente via `tokens.css` (zero cor hardcoded); exportar no barrel `src/ui/index.ts` — única task da change que edita o barrel (arquivo compartilhado com outras frentes). Testes React do estado desabilitado e do tooltip.
    Acceptance: botão desabilitado não dispara `onExport` e mostra o tooltip; habilitado dispara; nenhum valor de cor hardcoded no componente; testes de estado passam.
    Verification: `npm test -w apps/menubar -- ExportCsvButton` && `npm run typecheck`
    Deps: none
    Files: apps/menubar/src/ui/ExportCsvButton.tsx, apps/menubar/src/ui/ExportCsvButton.test.tsx, apps/menubar/src/ui/index.ts
    Size: S
    Risk: M

## Fase 2 — Comandos Rust (T-004)

- [ ] T-004: Implementar comandos export_insights_csv e gravação do arquivo
    Comando `export_insights_csv(view)` valida a view contra a whitelist (`v_task_costs`, `v_step_tokens`, `v_verdicts`), consulta o SQLite pela camada rusqlite existente (SELECT-only) e retorna o CSV como string usando o módulo de T-002; comando auxiliar `write_csv_file(path, contents)` grava a string no path escolhido pelo diálogo (decisão registrada no `plan.md` — sem `tauri-plugin-fs`). Registrar ambos no `invoke_handler`; testes Rust com banco em memória.
    Acceptance: cada uma das 3 views retorna CSV com header; view fora da whitelist retorna erro; view sem linhas retorna só o header; arquivo gravado é byte-idêntico à string retornada.
    Verification: `cargo test --manifest-path apps/menubar/src-tauri/Cargo.toml` && `cargo clippy --manifest-path apps/menubar/src-tauri/Cargo.toml`
    Deps: T-002
    Files: apps/menubar/src-tauri/src/insights_export.rs, apps/menubar/src-tauri/src/lib.rs
    Size: M
    Risk: M

## Fase 3 — Integração UI (T-005)

- [ ] T-005: Integrar exportação na aba Insights
    Renderizar um `ExportCsvButton` por tabela exibida na aba Insights, com `disabled` derivado de `rows.length === 0` dos dados já carregados. Ao clicar: `invoke("export_insights_csv")` → `save()` do dialog com nome sugerido `insights-<view>-<data>.csv` → gravação via `write_csv_file`; cancelar o diálogo não grava nada. Testes React do fluxo de clique com `invoke` e diálogo mockados (paths dos arquivos da aba são os prováveis — confirmar no repo antes de editar).
    Acceptance: cada tabela tem seu botão; fluxo completo grava o CSV retornado com o nome sugerido correto; cancelamento do diálogo não grava; botão desabilitado quando a tabela está vazia; testes do fluxo passam.
    Verification: `npm test -w apps/menubar` && `npm run typecheck`
    Deps: T-003, T-004
    Files: apps/menubar/src/views/Insights.tsx, apps/menubar/src/views/Insights.test.tsx
    Size: M
    Risk: M

## Fase 4 — Documentação (T-006)

- [ ] T-006: Documentar "Exportar CSV" no how-to de Insights
    Adicionar seção "Exportar CSV" em `docs/how-to/insights.md` descrevendo o fluxo: um botão por tabela, diálogo nativo de salvar, nome sugerido `insights-<view>-<data>.csv` e o estado desabilitado quando não há dados. Seguir o formato how-to (Diataxis) do arquivo existente.
    Acceptance: seção cobre botão por tabela, diálogo/nome sugerido e estado vazio; consistente com o comportamento implementado em T-005.
    Verification: `npx prettier --check docs/how-to/insights.md`
    Deps: T-005
    Files: docs/how-to/insights.md
    Size: XS
    Risk: S
