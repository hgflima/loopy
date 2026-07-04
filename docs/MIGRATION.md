# Migração: unificar ação em falha em `on_fail`

> Referência: [ADR-0001 — Unificar ação em falha dos steps em uma única chave on_fail](adrs/0001-unificar-acao-em-falha-em-on-fail.md)

## Resumo

As três chaves que expressavam "a ação quando este step falha" foram colapsadas numa única chave `on_fail` por step. O único valor possível continua `escalate` — o comportamento de runtime não muda.

| Chave antiga | Tipo de step | Chave nova |
|---|---|---|
| `verify.on_fail` | `agent` | `on_fail` (no nível do step) |
| `on_expect_fail` | `agent` | `on_fail` (no nível do step) |
| `on_conflict` | `approval` | `on_fail` (no nível do step) |

`shell` e `checks` já usavam `on_fail` no nível do step — inalterados.

## Migrando o `loopy.yml`

### Step `agent` com `verify.on_fail`

O `on_fail` **sobe** do bloco `verify` para o nível do step; `verify` passa a ter apenas `run` e `max_attempts`.

```diff
  - id: implement
    type: agent
    prompt: |
      Implemente ${task.id}.
    verify:
      run: ci
      max_attempts: 3
-     on_fail: escalate
+   on_fail: escalate
```

### Step `agent` com `on_expect_fail`

Renomeie `on_expect_fail` para `on_fail`.

```diff
  - id: audit
    type: agent
    mode: plan
    prompt: |
      Audite ${task.id}. Responda "AUDIT: PASS" ou "AUDIT: FAIL: <motivo>".
    expect: "AUDIT: PASS"
-   on_expect_fail: escalate
+   on_fail: escalate
```

### Step `approval` com `on_conflict`

Renomeie `on_conflict` para `on_fail`.

```diff
  - id: merge
    type: approval
    prompt: "Aprovar merge?"
    run:
      - 'git merge --no-ff "${task.branch}"'
-   on_conflict: escalate
+   on_fail: escalate
```

## Notas

- `on_fail` é **opcional** em todos os steps; o default é `escalate`.
- `escalate` é o **único valor** aceito. Se no futuro houver outros valores, o ADR-0001 será revisto.
- Num step `agent`, `on_fail` exige que `verify` ou `expect` esteja presente — sem nenhum dos dois, a chave seria inerte e o schema a rejeita.
- Configs com chaves antigas falham na carga com um **erro guiado** que cita o step, a chave nova e este documento.
