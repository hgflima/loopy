---
number: 0001
title: Unificar ação em falha dos steps em uma única chave on_fail
status: accepted
date: 2026-07-04
status_date: 2026-07-04
supersedes: []
superseded_by: null
---

# ADR-0001 — Unificar ação em falha dos steps em uma única chave on_fail

## Context

O `loopy.yml` expõe hoje três chaves distintas para o mesmo conceito — "o que
fazer quando este step falha":

- `on_fail` — em steps `shell` e dentro do bloco `verify` de steps `agent`
  (gatilho: comando com exit ≠ 0, ou checks esgotam `max_attempts`);
- `on_expect_fail` — em steps `agent` (gatilho: a string de `expect` não
  aparece na saída do agente);
- `on_conflict` — em steps `approval` (gatilho: conflito de merge).

As três aceitam um único valor: `escalate`. São, portanto, o mesmo conceito
("ação em falha") vestido com três nomes conforme o gatilho. Isso sobrecarrega
a linguagem ubíqua (ver `CONTEXT.md`), obriga quem lê o yml a memorizar qual
chave vale em cada tipo de step, e cria três pontos de manutenção para uma
regra só. Um step `agent` chega a ter duas chaves de falha (`verify.on_fail` e
`on_expect_fail`) para modos de falha que hoje levam à mesma ação.

Alternativas consideradas:

1. **Manter as três chaves** e apenas documentar a equivalência. Rejeitada:
   preserva a carga cognitiva e o risco de divergência futura de nomenclatura.
2. **Unificar em `on_fail`** por step. Escolhida.

## Decision

Adotar uma única chave **`on_fail`** por step, com a semântica "a ação quando
este step falha", onde *falhar* é definido pelo tipo do step:

| Step       | Modo de falha                                             |
|------------|----------------------------------------------------------|
| `shell`    | comando com exit ≠ 0                                      |
| `agent`    | `verify` esgota `max_attempts` **ou** `expect` não bate  |
| `approval` | conflito de merge                                        |

Consequências diretas no schema/config:

- `verify:` deixa de ter `on_fail` aninhado — passa a ser `{ run, max_attempts }`;
  a ação em falha do loop interno é a `on_fail` do próprio step `agent`.
- `on_expect_fail` e `on_conflict` são **removidos**.

## Consequences

- **Positivo:** uma única palavra na linguagem ubíqua para "ação em falha";
  menos superfície de config para aprender e manter; regra única por step.
- **Negativo / custo:** é um *breaking change* no `loopy.yml` — configs
  existentes que usem `on_expect_fail`, `on_conflict` ou `verify.on_fail`
  precisam migrar para `on_fail`. Exige mudança em `schema.ts`, `types.ts`,
  no `loopy.yml` de exemplo e na doc.
- **Risco aceito:** um step `agent` com dois modos de falha (`verify` e
  `expect`) passa a ter uma só ação para ambos. Sem perda de expressividade
  hoje, pois o único valor possível é `escalate`; se no futuro for preciso
  diferenciar a ação por modo de falha, este ADR precisará ser revisto
  (superseded).
