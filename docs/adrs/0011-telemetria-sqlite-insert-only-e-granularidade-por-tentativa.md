---
number: 0011
title: "Telemetria em SQLite: persistência insert-only e granularidade por-Tentativa (estende a ADR-0003)"
status: accepted
date: 2026-07-15
status_date: 2026-07-15
supersedes: []
superseded_by: null
---

# ADR-0011 — Telemetria em SQLite: persistência insert-only e granularidade por-Tentativa (estende a ADR-0003)

## Context

A ADR-0003 deu ao motor visibilidade de tempo, tokens e custo — mas persistiu-a
num `.loopy/metrics.json` **por-Change**. Três limites do formato só ficaram
visíveis com o uso:

1. **Não se compara Change com Change.** O arquivo recomeça do zero a cada
   Change (é keyed por path do `todo.md`). "Melhorei em relação à última change?"
   é, na persistência atual, impossível de responder.
2. **A granularidade funde as Tentativas.** A Amostra da ADR-0003 mede uma
   **Visita** inteira (`drainUsage()` após o `verify` loop) — o custo de o Agente
   **errar e re-tentar** desaparece dentro de um número só. Não há como responder
   "quanto custa o loop errar".
3. **O custo agregado subconta (D-0008).** Quando o ADR-0006 tornou as Sessões
   keyed por `(Agente, Worktree)`, o custo virou **por-Task** (soma de Sessões),
   mas `summarizeRun`/`summarizeChange` continuaram *last-non-null* — o total de um
   Run de N Tasks ficou próximo de 1/N do real. Um JSON de folds não tem como
   corrigir isso sem reescrever a álgebra inteira.

E três perguntas que o operador faz e o `loopy` não responde: *quanto custou esta
change e onde (por task, por tentativa)?*, *o pipeline está melhorando run a run?*,
*onde o review do Agente deixou passar defeito?* (a Task que mergeou, passou no
Verdict, e é `fail` para o humano).

Forças em tensão:

1. **AD-1 (config-driven).** A coleta continua sendo decisão do `loopy.yml`, não
   do motor. O gate **opt-in por `metrics:`** da ADR-0003 tem de sobreviver: sem o
   bloco, nenhum `.db`, e o `RunLoopResult` byte-idêntico (paridade on/off).
2. **Dois runtimes.** O motor roda como pacote Node no npm **e** como sidecar
   `bun build --compile` da GUI (ADR-0007). O driver de persistência precisa
   existir nos dois — sem dependência nativa que quebre o `--compile`.
3. **Best-effort ACP (herdado da ADR-0003).** `usage`/`cost` podem faltar; a
   coleta **nunca** pode falhar um Step.
4. **Escritor único, leitor sem SQL cru.** A GUI (webview) não pode receber SQL;
   e sob paralelismo (ADR-0004) as Tasks escrevem do mesmo processo.

Alternativas consideradas:

- **Evoluir o `metrics.json`** (mais um nível, timestamps absolutos). Rejeitada:
  não é queryável, não compara Changes, e a álgebra de fold do D-0008 seguiria
  frágil. O problema é o *meio* (um JSON de folds), não o schema.
- **`better-sqlite3`.** Rejeitada por spike: compila com `bun --compile` mas
  crasha em runtime (`$bunfs` sem `package.json`); e nenhuma opção WASM suporta
  WAL.
- **Coleta always-on.** Rejeitada: fere o AD-1 (o motor não decide "quero medir").
- **Revogar a ADR-0003.** Rejeitada: o *contrato* dela (opt-in, aditivo,
  best-effort, `drainUsage`/`readCost` na Sessão) continua certo. O que muda é
  **onde a coleta vive** e **com que granularidade** — isso *estende*, não revoga.

## Decision

Um **SQLite** (`<root>/.db/telemetry.db`, WAL) **substitui** a persistência da
ADR-0003. A ADR-0003 fica **estendida** (não revogada): o gate opt-in, o contrato
aditivo e o best-effort seguem valendo; muda o meio e a granularidade.

### 1. `.db` insert-only para fatos, mutável para anotações humanas

- **Fatos** (`step`, `task`) são **insert-only** — nunca `UPDATE`. A linha de
  `step` é inserida na **finalização** de cada Tentativa, com
  `started_at`/`ended_at` já conhecidos; nenhum estado `running`, nenhum reaper.
- **`change` é dimensão mutável** (a única com `UPDATE`): `INSERT OR IGNORE` no
  início do Run (`status`/`ended_at` NULL = em andamento), fecha `merged` ao zerar
  o backlog, `abandoned`/`failed` por CLI. Resolve a violação de FK que a linha
  `task` teria contra uma Change que ainda não existe.
- **Anotações humanas** (`task_verdict`, `bug`) são mutáveis por CLI.

### 2. Granularidade por-Tentativa

Cada retry do `verify` é a sua **própria linha** de `step`, com
tokens/custo/duração próprios (`visit_no` = entrada do PC, `attempt_no` = tentativa
dentro da Visita). Responde "quanto custa o loop errar". Exige instrumentar o loop
interno de `src/steps/agent.ts` — código novo, não "ler o que já se emitia".

### 3. Custo por-Step derivável — e o **D-0008 pago**

`step.cost_usd` = **delta de snapshots cumulativos** por Sessão: `readCost()` no
início da Tentativa menos o snapshot anterior da **mesma** Sessão (`costCarry`
mantém o cumulativo monotônico através de `clear_context`). Com o custo por-linha,
o custo por Task/Change vira **`SUM(cost_usd)`** — a agregação correta pós-ADR-0006.
Isso **fecha o D-0008**: o *last-non-null* que subcontava some, porque não há mais
fold — há uma soma em SQL.

### 4. Driver por runtime, zero dependências novas

`node:sqlite` (Node ≥ 22.13) e `bun:sqlite` atrás de um **adapter guardado por
runtime** (`src/telemetry/db.ts`, a única linha que conhece o runtime). Bump
`engines.node` `>=20` → **`>=22.13`** (Node 20 é EOL; `node:sqlite` não existe
nele). WAL é setado **1× no bootstrap** (persistente no header); **uma conexão-
escritora** por processo serializa as Tasks paralelas sem tocar `SQLITE_BUSY`.
`tsup` externaliza `bun:sqlite`; o `import("node:sqlite")` morto é tolerado pelo
`--compile`.

### 5. Opt-in por `metrics:` sobrevive; `metrics.report` deprecado

O gate da ADR-0003 fica **à letra**: `metrics:` presente → abre o `.db`; ausente →
nada (nenhum `.db`, `RunLoopResult` idêntico). `metrics.report.index` (o Relatório
de change) continua parseando — o schema não quebra —, mas o motor o **ignora** e
emite **warning de deprecação**.

### 6. A aba Insights é a única leitura; relatórios aposentados

O **Relatório de execução** (stderr) e o **Relatório de change** (`index.md`) são
**aposentados** — `src/metrics/` inteiro é desmontado. A leitura passa a ser a **4ª
aba "Insights"** da GUI menubar (4º segmento do `ViewSwitcher`), que lê o `.db` por
comando Rust `rusqlite` **SELECT-only nas views** e compara a Change contra a
média±desvio das merged e contra outra Change escolhida (Δ%, absoluto↔normalizado
por churn). Consequência aceita (D19): **headless/CI ficam sem métricas** — a tela
é a única leitura, não há `loopy report`.

### 7. Escritor único = motor/CLI; a GUI escreve por subprocesso

Os fatos são escritos pelo motor durante o Run. As anotações vêm de subcomandos
CLI one-shot — `loopy verdict set/clear`, `loopy bug add`, `loopy change
--abandoned/--failed`. A GUI **escreve** invocando esses comandos como subprocesso
(o padrão `probe-agent` já existente), nunca SQL cru no webview.

## Consequences

- **Positivo:** comparação cross-Change (média±desvio, Δ%) que o `metrics.json`
  nunca deu; custo **correto** por Task/Change (`SUM`, **D-0008 pago**);
  granularidade por-Tentativa ("quanto custa errar"); telemetria queryável com
  timestamps absolutos, status e config; anotação humana (veredito, bugs) e o
  **defeito escapado** (Task `merged` + `human_verdict='fail'`) de primeira classe.
- **Negativo / custo:** `engines.node` sobe para `>=22.13` (Node 20 EOL — quebra
  quem estava em 20); superfície nova (`src/telemetry/` + `rusqlite` no `src-tauri`)
  no lugar de `src/metrics/`; headless/CI perdem métricas por design (D19).
- **Risco aceito:** uma Change rodada **sem** `metrics:` vira buraco no baseline; o
  histórico começa na C-0017 (sem backfill — Changes anteriores degradam para "sem
  telemetria" na aba); o `kill -9` do orquestrador é a única terminação que não
  insere (e aí a Change inteira já se perdeu).
- **Relação com outros ADRs:** **estende a ADR-0003** (não a supersede — o opt-in,
  o contrato aditivo e o best-effort sobrevivem); **fecha o D-0008** (o custo
  subcontava desde que a ADR-0006 tornou o custo por-Sessão); consome a leitura
  Rust/`rusqlite` sobre o Transport da ADR-0007. Um ADR futuro que queira
  reprecificar histórico (`price`/`v_step_repriced` já existem no schema, sem seed)
  ou tornar `bug` N:N (`bug_task`) parte deste solo já preparado.
