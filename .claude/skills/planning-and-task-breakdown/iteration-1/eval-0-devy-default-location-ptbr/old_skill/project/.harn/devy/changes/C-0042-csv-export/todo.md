# Backlog — C-0042 Exportar dados de Insights para CSV

Backlog executável pelo loopy. Detalhe completo de cada task (critérios,
verificação, riscos) em `plan.md` nesta pasta. DAG: T-001 → T-002 → T-003 →
T-005; T-004 e T-006 são paralelas (largura 3 → `concurrency: auto` = 3).

- [ ] T-001: Setup do tauri-plugin-dialog + permissão na capability
    Confirmar a versão atual do tauri-plugin-dialog na documentação oficial do
    Tauri v2 ANTES de pinar (restrição da spec). Pinar no Cargo.toml do
    apps/menubar/src-tauri, registrar tauri_plugin_dialog::init() no builder,
    adicionar @tauri-apps/plugin-dialog ao package.json do app e conceder a
    permissão do diálogo de salvar em capabilities/default.json.
    Única task da change que edita capabilities/default.json (arquivo
    compartilhado com outras frentes — não tocar em nenhuma outra task).
    Aceite: app compila e sobe em dev sem erro de capability; cargo clippy e
    npm run typecheck verdes.
    Deps: nenhuma

- [ ] T-002: Módulo csv.rs de escape CSV RFC 4180 + testes unitários
    Criar apps/menubar/src-tauri/src/csv.rs: escape de campo (aspas duplicadas,
    campo envolto em aspas quando contém vírgula, aspas ou newline) e montagem
    header + linhas com CRLF. Módulo puro, sem rusqlite. Declarar `mod csv;` no
    lib.rs. Testes unitários #[cfg(test)] cobrindo os 3 casos de escape da spec
    (vírgula, aspas, newline no campo) + caso sem escape.
    Aceite: cargo test e cargo clippy verdes.
    Deps: T-001

- [ ] T-003: Comandos export_insights_csv e write_export_file
    Comando export_insights_csv(view): valida o nome contra a whitelist fechada
    (v_task_costs, v_step_tokens, v_verdicts — erro estruturado fora dela; o
    nome NUNCA é interpolado em SQL), consulta o SQLite pela camada rusqlite
    existente (SELECT-only) e retorna o CSV como string usando o módulo csv.rs;
    view vazia retorna só o header. Comando write_export_file(path, contents):
    grava o conteúdo no path escolhido pelo diálogo. Registrar ambos no
    invoke_handler.
    Aceite: cargo test e cargo clippy verdes; invoke das 3 views contra um .db
    real devolve CSV válido com campos escapados.
    Deps: T-002

- [ ] T-004: Componente ExportCsvButton com estado desabilitado e tooltip
    Componente React apresentacional em apps/menubar/src/ui/: props disabled e
    onClick; quando desabilitado, tooltip "Sem dados para exportar". Zero cor
    hardcoded — só variáveis de tokens.css. Não importa nada do Tauri (o fluxo
    real entra em T-005). Exportar no barrel src/ui/index.ts — única task da
    change que edita o barrel (arquivo compartilhado com outras frentes).
    Teste React do estado desabilitado + tooltip.
    Aceite: npm test -w apps/menubar e npm run typecheck verdes.
    Deps: nenhuma

- [ ] T-005: Integrar o fluxo de export na aba Insights
    Renderizar um ExportCsvButton por tabela exibida na aba Insights,
    desabilitado quando a view não tem linhas. No clique: invoke
    export_insights_csv da view → save() do @tauri-apps/plugin-dialog com nome
    sugerido insights-<view>-<data>.csv (data YYYY-MM-DD) → gravar via
    write_export_file. Cancelar o diálogo é no-op silencioso. Teste React do
    fluxo de clique com invoke e save mockados.
    Aceite: npm test -w apps/menubar e npm run typecheck verdes; smoke manual
    exporta as 3 views e abre no Numbers/Excel sem corromper campos com
    vírgula/aspas/newline.
    Deps: T-003, T-004

- [ ] T-006: Docs — seção "Exportar CSV" em docs/how-to/insights.md
    Documentar o comportamento definido na spec: um botão por tabela, diálogo
    nativo de salvar, nome sugerido insights-<view>-<data>.csv, botão
    desabilitado com tooltip quando não há dados. Seguir o estilo das seções
    existentes do arquivo. Conteúdo derivado da spec, por isso paralela às
    frentes de código.
    Aceite: lint/format do repo passam no arquivo tocado.
    Deps: nenhuma
