# Plano de implementação: C-0042 — Exportar dados de Insights para CSV

## Overview

Adicionar exportação CSV à aba **Insights** do app de menubar (`apps/menubar/`,
Tauri v2 + React): um comando Rust `export_insights_csv` que consulta uma das três
views da telemetria (`v_task_costs`, `v_step_tokens`, `v_verdicts`) e devolve CSV
RFC 4180 como string, mais um botão "Exportar CSV" por tabela que abre o diálogo
nativo de salvar (`tauri-plugin-dialog`) e grava o arquivo. A change é 100% no app
(o motor `src/` na raiz não é tocado) e termina com testes Rust + React verdes e
uma seção nova em `docs/how-to/insights.md`.

O trabalho foi quebrado em **6 tasks** (S/M), com duas frentes paralelas — backend
Rust e frontend React — que convergem numa task de integração. O backlog
executável está em `todo.md` (mesma pasta), no formato que o parser do loopy
consome (`Deps:` isoladas → arestas do DAG).

## Decisões de arquitetura

- **Fluxo do export em três passos**: o webview chama `invoke("export_insights_csv", { view })`
  → recebe a string CSV → abre `save()` do `@tauri-apps/plugin-dialog` com nome
  sugerido `insights-<view>-<data>.csv` → grava via um segundo comando Rust
  enxuto (`write_export_file(path, contents)`). *Racional*: evita adicionar
  `tauri-plugin-fs` e ampliar a superfície de capabilities; o único plugin novo é
  o `dialog`, exatamente o que a spec pede.
- **Whitelist de views no Rust**: o comando casa o argumento `view` contra um enum
  fechado das 3 views e monta o SQL a partir dele — o nome recebido do webview
  **nunca** é interpolado em SQL. View fora da whitelist → erro estruturado.
- **Escape CSV num módulo puro** (`csv.rs`): função de escape RFC 4180 isolada e
  sem dependência de rusqlite, para os testes unitários exigidos (vírgula, aspas,
  newline no campo) rodarem sem banco. Linhas terminadas em CRLF (RFC 4180 §2).
- **`ExportCsvButton` é apresentacional**: recebe `disabled`/`onClick`/`tooltip`
  por props e não importa nada do Tauri. Isso desacopla a frente React da frente
  Rust (dá pra construir e testar em paralelo); o fluxo real de clique é ligado só
  na task de integração. Zero cor hardcoded — tudo via `tokens.css`.
- **Arquivos compartilhados têm dono único**: `capabilities/default.json` é editado
  **apenas** em T-001 e o barrel `src/ui/index.ts` **apenas** em T-004 — nenhuma
  outra task da change toca neles (mitiga o risco de edição concorrente apontado
  na spec).
- **Frente Rust serializada por `Deps:`**: T-001, T-002 e T-003 editam o mesmo
  `lib.rs` (registro do plugin, `mod csv;`, `invoke_handler`). Tasks paralelas no
  mesmo arquivo geram conflito real de merge no loop, então a cadeia é
  explicitamente T-001 → T-002 → T-003. O paralelismo vem das frentes
  independentes (React, docs), não de dentro da frente Rust.
- **Versão do `tauri-plugin-dialog` não é pinada aqui**: a spec exige confirmar a
  versão na documentação oficial; isso é critério de aceite de T-001, não uma
  decisão deste plano.

## DAG e paralelização

```
T-001 (setup plugin + capability)      T-004 (ExportCsvButton)   T-006 (docs)
    │
T-002 (csv.rs + testes de escape)
    │
T-003 (comando export_insights_csv)
    │
    └──────────────┬──────────────────────────┘
                 T-005 (integração na aba Insights)
```

- **Camadas topológicas**: L1 = {T-001, T-004, T-006} · L2 = {T-002} ·
  L3 = {T-003} · L4 = {T-005}.
- **Largura do grafo = 3** → `concurrency: auto` resolve para 3 (teto default 4
  não morde). Rode com `concurrency: auto` ou `3`.
- **Seguro em paralelo**: T-001 ∥ T-004 ∥ T-006 (arquivos disjuntos).
- **Obrigatoriamente sequencial**: a cadeia Rust (mesmo `lib.rs`) e T-005 (precisa
  do comando real e do componente).
- **Contrato compartilhado**: a assinatura `export_insights_csv(view) → string`
  está fixada pela spec, então as frentes podem partir dela sem coordenação extra
  (T-005 usa o comando real; os testes React mockam o `invoke`).

## Task list

### Fase 1 — Fundação (paralela: T-001 ∥ T-004 ∥ T-006)

- [ ] T-001: Setup do `tauri-plugin-dialog` + permissão na capability
- [ ] T-004: Componente `ExportCsvButton` (estado desabilitado + tooltip)
- [ ] T-006: Docs — seção "Exportar CSV" em `docs/how-to/insights.md`

### Fase 2 — Backend Rust (sequencial)

- [ ] T-002: Módulo `csv.rs` de escape RFC 4180 + testes unitários
- [ ] T-003: Comandos `export_insights_csv` e `write_export_file`

### Checkpoint: fundação + backend

- [ ] `cargo clippy` e `cargo test` verdes no `src-tauri`
- [ ] `npm run typecheck` e `npm test -w apps/menubar` verdes
- [ ] `invoke("export_insights_csv", { view: "v_task_costs" })` devolve CSV com
      header ao apontar para um `.db` real

### Fase 3 — Integração

- [ ] T-005: Ligar o fluxo na aba Insights (clique → dialog → gravação)

### Checkpoint: completo

- [ ] Exportar cada uma das 3 views produz CSV que abre no Numbers/Excel
- [ ] Campos com vírgula, aspas ou newline não corrompem o arquivo
- [ ] Botão desabilitado (com tooltip) quando a view não tem linhas
- [ ] `npm run typecheck`, `npm test -w apps/menubar`, `cargo clippy` e
      `cargo test` verdes
- [ ] Revisão humana antes do merge final

---

## Detalhe das tasks

## Task T-001: Setup do `tauri-plugin-dialog` + permissão na capability

**Descrição:** Adicionar o plugin de diálogo ao app: confirmar a versão atual na
documentação oficial do Tauri v2 (restrição explícita da spec), pinar no
`Cargo.toml`, registrar `tauri_plugin_dialog::init()` no builder, adicionar o
pacote JS `@tauri-apps/plugin-dialog` ao `package.json` do app e conceder a
permissão de `save` em `capabilities/default.json`. É a única task da change que
toca a capability (arquivo compartilhado).

**Acceptance criteria:**
- [ ] Versão do plugin confirmada na doc oficial e pinada em `Cargo.toml` +
      `package.json` (versões compatíveis entre si)
- [ ] Plugin registrado no builder e permissão de save-dialog presente em
      `capabilities/default.json`
- [ ] App compila e sobe em dev sem erro de capability

**Verificação:**
- [ ] `cargo clippy` verde no `src-tauri`
- [ ] `npm run typecheck` e build do app passam
- [ ] Manual: `save()` do plugin abre o diálogo nativo num smoke rápido em dev

**Dependencies:** Nenhuma

**Files likely touched:**
- `apps/menubar/src-tauri/Cargo.toml`
- `apps/menubar/src-tauri/src/lib.rs`
- `apps/menubar/src-tauri/capabilities/default.json`
- `apps/menubar/package.json`

**Estimated scope:** S (4 arquivos, mudanças pequenas)

## Task T-002: Módulo `csv.rs` de escape RFC 4180 + testes unitários

**Descrição:** Criar um módulo Rust puro com a serialização CSV: escape de campo
(envolver em aspas e duplicar aspas internas quando o campo contém vírgula, aspas
ou newline) e montagem de `header + linhas` com CRLF. Sem dependência de rusqlite.
Cobre o requisito 5 da spec no lado Rust.

**Acceptance criteria:**
- [ ] Função de escape cobre os 3 casos da spec: vírgula, aspas e newline dentro
      do campo (mais o caso trivial sem escape)
- [ ] Montagem de documento produz header + N linhas terminadas em CRLF
- [ ] Testes unitários `#[cfg(test)]` cobrindo cada caso de escape

**Verificação:**
- [ ] `cargo test` verde (novos testes incluídos)
- [ ] `cargo clippy` verde

**Dependencies:** T-001 (mesmo `lib.rs`: o `mod csv;` entra depois do registro do
plugin para evitar merge concorrente no arquivo)

**Files likely touched:**
- `apps/menubar/src-tauri/src/csv.rs` (novo, testes inline)
- `apps/menubar/src-tauri/src/lib.rs` (uma linha: `mod csv;`)

**Estimated scope:** S (2 arquivos)

## Task T-003: Comandos `export_insights_csv` e `write_export_file`

**Descrição:** Implementar o comando `export_insights_csv(view)` que valida o nome
da view contra a whitelist fechada (`v_task_costs`, `v_step_tokens`,
`v_verdicts`), consulta o SQLite via a camada rusqlite existente (SELECT-only),
serializa com o módulo `csv.rs` e retorna a string; e o comando auxiliar
`write_export_file(path, contents)` que grava o arquivo escolhido no diálogo.
Registrar ambos no `invoke_handler`.

**Acceptance criteria:**
- [ ] View fora da whitelist retorna erro estruturado (nunca interpolada em SQL)
- [ ] Cada uma das 3 views retorna CSV com header (view vazia → só o header)
- [ ] `write_export_file` grava exatamente o conteúdo recebido no path recebido

**Verificação:**
- [ ] `cargo test` e `cargo clippy` verdes
- [ ] Manual: `invoke` das 3 views contra um `.db` real devolve CSV válido; um
      campo com vírgula/aspas vem escapado

**Dependencies:** T-002

**Files likely touched:**
- `apps/menubar/src-tauri/src/lib.rs` (ou módulo de comandos existente)
- `apps/menubar/src-tauri/src/csv.rs` (se precisar expor helper)

**Estimated scope:** M (2-3 arquivos)

## Task T-004: Componente `ExportCsvButton` (estado desabilitado + tooltip)

**Descrição:** Criar o componente React apresentacional do botão "Exportar CSV":
recebe `disabled`, `onClick` e rótulos por props, exibe tooltip "Sem dados para
exportar" quando desabilitado, estilizado 100% via `tokens.css` (zero cor
hardcoded). Exportar no barrel `src/ui/index.ts` — única task da change que toca o
barrel (arquivo compartilhado). Não importa nada do Tauri: o fluxo real entra em
T-005.

**Acceptance criteria:**
- [ ] Botão renderiza habilitado/desabilitado conforme prop; desabilitado mostra o
      tooltip "Sem dados para exportar"
- [ ] Nenhuma cor hardcoded (só variáveis de `tokens.css`)
- [ ] Teste React cobre o estado desabilitado + tooltip (requisito 5 da spec)

**Verificação:**
- [ ] `npm test -w apps/menubar` verde (teste novo incluído)
- [ ] `npm run typecheck` verde

**Dependencies:** Nenhuma

**Files likely touched:**
- `apps/menubar/src/ui/ExportCsvButton.tsx` (novo)
- `apps/menubar/src/ui/index.ts` (barrel — export novo)
- `apps/menubar/src/ui/ExportCsvButton.test.tsx` (novo)

**Estimated scope:** M (3 arquivos)

## Task T-005: Ligar o fluxo na aba Insights (clique → dialog → gravação)

**Descrição:** Integrar tudo na aba Insights: renderizar um `ExportCsvButton` por
tabela exibida, desabilitado quando a view não tem linhas; no clique, chamar
`invoke("export_insights_csv", { view })`, abrir `save()` do
`@tauri-apps/plugin-dialog` com nome sugerido `insights-<view>-<data>.csv`
(data no formato `YYYY-MM-DD`) e gravar via `write_export_file`. Cancelar o
diálogo não grava nada nem mostra erro. Teste React do fluxo de clique com
`invoke` e `save` mockados (requisito 5 da spec).

**Acceptance criteria:**
- [ ] Um botão por tabela; desabilitado + tooltip quando a tabela está vazia
- [ ] Clique → CSV do comando → diálogo com nome sugerido correto → arquivo salvo
- [ ] Cancelamento do diálogo é no-op silencioso
- [ ] Teste do fluxo de clique com mocks de `invoke`/`save` passa

**Verificação:**
- [ ] `npm test -w apps/menubar` e `npm run typecheck` verdes
- [ ] Manual (smoke em dev): exportar as 3 views e abrir os arquivos no
      Numbers/Excel — campos com vírgula/aspas/newline intactos

**Dependencies:** T-003, T-004

**Files likely touched:**
- `apps/menubar/src/` — componente/container da aba Insights
- teste do fluxo (novo arquivo `.test.tsx`)

**Estimated scope:** M (2-4 arquivos)

## Task T-006: Docs — seção "Exportar CSV" em `docs/how-to/insights.md`

**Descrição:** Adicionar a seção "Exportar CSV" ao how-to de Insights, descrevendo
o comportamento definido na spec: um botão por tabela, diálogo nativo de salvar,
nome sugerido `insights-<view>-<data>.csv`, botão desabilitado quando não há
dados. Conteúdo derivado da spec (comportamento fechado), por isso pode rodar em
paralelo às frentes de código.

**Acceptance criteria:**
- [ ] Seção "Exportar CSV" cobre as 3 views, o nome sugerido do arquivo e o estado
      desabilitado
- [ ] Segue o estilo/estrutura das seções existentes do arquivo

**Verificação:**
- [ ] Checks de lint/format do repo passam para o arquivo tocado

**Dependencies:** Nenhuma

**Files likely touched:**
- `docs/how-to/insights.md`

**Estimated scope:** XS (1 arquivo)

---

## Riscos e mitigações

| Risco | Impacto | Mitigação |
|-------|---------|-----------|
| Versão/API do `tauri-plugin-dialog` diferente do esperado | Médio | T-001 confirma a versão na doc oficial antes de pinar (restrição da spec); T-001 roda cedo (fail fast) |
| Edição concorrente de `capabilities/default.json` e `src/ui/index.ts` por outras frentes | Alto | Dono único por arquivo dentro da change (T-001 e T-004); mergear essas tasks cedo; se outra change tocar os mesmos arquivos, resolver no rebase |
| Conflito de merge na frente Rust (3 tasks no mesmo `lib.rs`) | Alto | Serializada por `Deps:` (T-001 → T-002 → T-003) — nunca em paralelo |
| Injeção de SQL via nome da view vindo do webview | Alto | Whitelist fechada no Rust; nome nunca interpolado em SQL |
| CSV com acentos abrindo errado no Excel (UTF-8 sem BOM) | Baixo | Verificação manual do checkpoint final inclui abrir no Numbers/Excel; se o Excel corromper acentos, avaliar BOM em T-003 |
| View vazia quebrar o comando | Baixo | T-003 exige header-only para view vazia; na UI o botão já fica desabilitado (T-004/T-005) |

## Perguntas em aberto

- Nenhuma bloqueante. Único ponto a validar durante a execução: se o Excel exigir
  BOM UTF-8 para exibir acentos corretamente (decidir em T-003 com base no smoke
  manual do checkpoint final).
