# Referência do backlog (`todo.md`)

O formato do backlog que o loop externo itera. Derivado de `src/backlog/todo.ts`
(`parseBacklog`, `markDone`).

Uma task é uma linha de checkbox na **coluna 0**, seguida de um bloco indentado
como corpo. O parsing é mecânica pura (AD-1): marcadores, pattern do id e modo do
corpo vêm de `inputs.backlog` no `loopy.yml` — nada é hardcoded como política.

## Estrutura de uma task

```
- [ ] T-001: Título da task
    Corpo livre da task, indentado.
    Deps: T-000
```

| Elemento | Regra |
|----------|-------|
| Marcador | Prefixo (coluna 0) `pending_marker` (pendente) ou `done_marker` (done). |
| Id | Primeiro token após o marcador, casando `task_id_pattern`. Sem id, a linha é ignorada (checkbox que não é task). |
| Título | O que segue o id, menos um separador inicial (`:`, `–`, `—`, `-`, espaços). |
| Corpo | Linhas em branco e indentadas abaixo do checkbox, até a próxima linha não-branca na coluna 0. |
| Deps | Primeira linha do corpo iniciada por `deps_pattern`. |

## Defaults do parser

Aplicados quando a chave correspondente de `inputs.backlog` é omitida.

| Opção | Default |
|-------|---------|
| `pending_marker` | `- [ ]` |
| `done_marker` | `- [x]` |
| `task_id_pattern` | `T-\d+` |
| `deps_pattern` | `Deps:` (case-insensitive) |
| branch | `${id}-${slug}` (ou só `${id}` se o slug for vazio) |

## Slug

O slug é derivado do título: normaliza para NFKD, remove diacríticos, passa para
minúsculas e colapsa cada sequência de caracteres não-alfanuméricos num único
traço (traços das pontas são removidos).

| Título | Slug |
|--------|------|
| `Adicionar suporte a DAG` | `adicionar-suporte-a-dag` |
| `Fix: cache TTL (v2)` | `fix-cache-ttl-v2` |

## Corpo

- Coletado a partir da linha seguinte ao checkbox, incluindo linhas em branco e
  indentadas, até a próxima linha **não-branca na coluna 0** (outra task, heading,
  citação).
- Linhas em branco das pontas são removidas; **linhas em branco internas são
  preservadas**.
- O bloco é *dedentado* pela menor indentação comum.

## Dependências (`Deps:`)

Definem as Arestas de dependência do DAG de tasks (ADR-0004).

| Linha `Deps:` | `task.deps` |
|---------------|-------------|
| `Deps: T-001, T-002` | `["T-001", "T-002"]` |
| `Deps: nenhuma` | `[]` (case-insensitive) |
| ausente | `[]` |

Regras:

- Só a **primeira** linha do corpo iniciada por `deps_pattern` conta.
- Os ids são separados por vírgula e *trimados*.
- Ids que **não** casam `task_id_pattern` são descartados em silêncio.
- Semântica: `T-B` só fica **Ready** quando toda dep sua está **Done** (merjada).

## Marcação de conclusão

`markDone` reescreve o `pending_marker` da task em `done_marker`, tocando **apenas
esse marcador** — o resto do arquivo permanece byte-a-byte idêntico (mantém
`require_clean_parent` satisfeito). É idempotente: uma task já done é no-op; um id
ausente do backlog é erro (`BacklogError`).

## Seleção com `--task`

`selectTask` escolhe uma única task pendente por id e retorna, além dela, as tasks
pendentes que a **precedem** na ordem do arquivo — a base do aviso não-bloqueante
sobre trabalho anterior em aberto. Id não-pendente → nenhuma task selecionada.

## Ver também

- [Configuração (`loopy.yml`)](configuration.md) — bloco `inputs.backlog`.
- [Interpolação (`${…}`)](interpolation.md) — as variáveis `task.*`.
- `CONTEXT.md` — DAG de tasks, Ready/Done/Blocked, Scheduler.
