---
number: 0009
title: "Concorrência derivada do DAG: concurrency auto e max_concurrency"
status: accepted
date: 2026-07-14
status_date: 2026-07-14
supersedes: []
superseded_by: null
---

# ADR-0009 — Concorrência derivada do DAG: `concurrency: auto` e `max_concurrency`

## Context

O ADR-0004 introduziu `concurrency` como inteiro fixo — o operador escolhe a
dedo quantas Tasks rodam em paralelo. O problema: **o operador não tem como
saber o número certo sem desenhar o DAG na cabeça**. Errar para baixo serializa
trabalho paralelizável; errar para cima desperdiça o teto (o pool nunca excede
o *ready set*). `topoLayers()` já existia puro em `scheduler/graph.ts` — mas
só servia ao dry-run.

Forças em tensão:

1. **AD-1 (config-driven):** o motor não decide quantas Tasks rodar — mas pode
   **calcular** o valor que o grafo sugere, se o operador pedir explicitamente
   (`auto`).
2. **Sem teto é perigoso:** um `todo.md` sem `Deps:` (o caso comum) produziria
   uma única camada com **todas** as Tasks, disparando N worktrees, N sessões
   ACP e N× o rate-limit de uma vez.
3. **Retrocompat absoluta:** `concurrency: 8` (escolha explícita do operador)
   não pode ser silenciosamente capada por um teto novo.
4. **Contrato público:** `LoopyConfig.concurrency` é `number` nos tipos e nos 5
   barrels exportados; adicionar `"auto"` quebra `tsc` em todos os consumidores
   — que é exatamente o efeito desejado (o `tsc` aponta cada site a adaptar).

Alternativas consideradas:

- **Auto-tuning dinâmico durante o Run.** Rejeitado: não mudaria nada — o pool
  nunca excede o *ready set*, reavaliado a cada `Promise.race`
  (`orchestrator.ts`). O valor é resolvido **uma vez**, no início.
- **Flag `--max-concurrency` na CLI.** Rejeitada: assimetria consciente — o teto
  é política do projeto (mora no yml, versionado), não algo que se ajusta por
  invocação. Adicionar depois é aditivo.
- **Resolver `auto` no parse (schema).** Rejeitado: o parse não conhece o DAG
  (as tasks vêm do `todo.md`, carregado depois).

## Decision

### 1. `concurrency: number | "auto"`

O schema aceita inteiro positivo ou a literal `"auto"`. Default permanece `1`
(sequencial). `--concurrency auto` sobrescreve o yml. `--task <id>` força `1`.

### 2. Fórmula: camada topológica mais larga, com teto

```
auto = min(maxLayerWidth(graph), max_concurrency)
```

`maxLayerWidth(graph)` = `max(...topoLayers(graph).map(l => l.length))` — a
**Largura do grafo** (`src/scheduler/graph.ts`). É o máximo de Tasks que o DAG
**permite** em paralelo.

**Nota técnica:** é o *limite inferior* do paralelismo real. O pico exato seria
o maior antichain (o maior conjunto de nós mutuamente incomparáveis), que
exigiria matching bipartido (Dilworth). Na prática coincidem: o DAG típico de
um backlog não tem os padrões de entrelaçamento que separariam os dois. A
camada mais larga é O(V+E) e já estava implementada (`topoLayers`).

### 3. Teto: `max_concurrency` (default 4)

Nova chave `max_concurrency` no schema (inteiro ≥ 1, default **4**). **Só
morde o `auto`:** `concurrency: 8` + `max_concurrency: 4` roda com **8** — o
operador escolheu 8 e o motor obedece. O teto protege o número que o operador
**não** escolheu. Efeito: **retrocompat absoluta** (D17) — nenhum `loopy.yml`
existente muda de comportamento.

### 4. Resolução pura: `resolveConcurrency()`

Função pura em `src/scheduler/graph.ts` (não no orquestrador). Precedência:
`flag > declared`. Se o valor efetivo é `"auto"`, calcula
`max(1, min(maxLayerWidth, maxConcurrency))`. Retorna
`ConcurrencyResolution { value, auto, width, widestLayer, cap }` — a
justificativa viaja junto com o valor.

### 5. Dry-run com justificativa

O `--dry-run` imprime o resolvido **com justificativa**:
`concorrência efetiva: 3 (auto — camada mais larga: T-001, T-002, T-003; teto: 4)`.
`renderDag()` já tem os dados em mãos.

### 6. Sexto subpath export: `@hgflima/loopy/scheduler`

A GUI precisa da **mesma** `resolveConcurrency` para resolver o `auto` no
browser (o `DepsFlow` usa para cortar a frente de onda). `scheduler/` é puro
(sem `node:fs`) → browser-safe por construção. Publicado em `package.json`
exports e `tsup.config.ts`.

## Consequences

- **Positivo:** `concurrency: auto` elimina a calibração manual; o DAG decide o
  pool; o teto evita explosão de processos; dry-run mostra a justificativa; a
  GUI resolve o `auto` com a mesma função do motor (subpath export); retrocompat
  absoluta para ymls existentes.
- **Negativo / custo:** `LoopyConfig.concurrency: number | "auto"` quebra o
  contrato de tipo público do subpath `@hgflima/loopy/config` — o `tsc` aponta
  cada consumidor (efeito desejado). O `ConfigPane` e o `DepsFlow` precisaram
  ser adaptados.
- **Risco aceito:** a Largura do grafo é um limite inferior; o paralelismo real
  pode ser maior (o maior antichain). Na prática coincidem para backlogs
  típicos, e o teto é o guard de segurança.
- **Neutro:** `concurrency: 1` continua sequencial; `concurrency: 3`
  byte-idêntico; nenhuma dependência nova.
