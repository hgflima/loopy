# Spec: C-0042 — Exportar dados de Insights para CSV

## Contexto

O app de menubar (`apps/menubar/`, Tauri v2 + React) tem uma aba **Insights** que lê a
telemetria de um SQLite (`.db/telemetry.db`) via camada Rust (`rusqlite`, SELECT-only).
Usuários pedem para exportar os dados agregados (custo por task, tokens por step,
vereditos) para CSV, para análise externa em planilha.

## Requisitos

1. **Comando Rust `export_insights_csv`**: recebe o nome de uma view (`v_task_costs`,
   `v_step_tokens` ou `v_verdicts`), consulta o SQLite e retorna o conteúdo CSV como
   string (header + linhas, RFC 4180: campos com vírgula/aspas devem ser escapados).
2. **Botão "Exportar CSV" na aba Insights**: um botão por tabela exibida. Ao clicar,
   abre o diálogo nativo de salvar arquivo (plugin `tauri-plugin-dialog`) com nome
   sugerido `insights-<view>-<data>.csv` e grava o conteúdo retornado pelo comando.
3. **Capability**: o diálogo de salvar exige permissão no `capabilities/default.json`.
4. **Estado vazio**: se a view não tem linhas, o botão fica desabilitado com tooltip
   "Sem dados para exportar".
5. **Testes**: unitários Rust para o escape CSV (vírgula, aspas, newline no campo);
   testes React para o estado desabilitado e para o fluxo de clique (mock do invoke).
6. **Docs**: adicionar seção "Exportar CSV" em `docs/how-to/insights.md`.

## Restrições

- Zero cor hardcoded no webview (tudo via `tokens.css`).
- O motor (`src/` na raiz) não é tocado — change 100% no app.
- O plugin `tauri-plugin-dialog` ainda não está no projeto: versão a confirmar na
  documentação oficial antes de pinar no `Cargo.toml`.
- `capabilities/default.json` e o barrel `src/ui/index.ts` são arquivos compartilhados
  com outras frentes — cuidado com edições concorrentes.

## Success criteria

- Exportar cada uma das 3 views produz um CSV válido que abre no Numbers/Excel.
- Campos com vírgula, aspas ou newline não corrompem o arquivo.
- Botão desabilitado quando não há dados.
- `npm run typecheck`, `npm test -w apps/menubar` e `cargo clippy`/`cargo test` verdes.
