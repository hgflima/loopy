# Discovery de schema — `discovery.md`

Carregue para `/deby:tables` e `/deby:describe`. Essas queries são sempre `safe` — não exigem type-to-confirm, mas o fluxo de `y/N` da skill ainda se aplica (a menos que o usuário desligue explicitamente).

## `/deby:tables [pattern]`

Lista tabelas do schema atual (`public` por padrão).

### SQL base

```sql
SELECT
  table_schema,
  table_name,
  pg_size_pretty(pg_total_relation_size(format('%I.%I', table_schema, table_name)::regclass)) AS size
FROM information_schema.tables
WHERE table_schema NOT IN ('pg_catalog', 'information_schema')
ORDER BY table_schema, table_name;
```

### Com filtro

Se o usuário passar `pattern` (ex.: `/deby:tables register`):

```sql
... WHERE table_schema NOT IN ('pg_catalog', 'information_schema')
  AND table_name ILIKE '%register%'
ORDER BY ...
```

### Execução

```bash
bash .claude/skills/deby/scripts/exec-sql.sh "$profile" -- "$SQL"
```

Pode pular o `y/N` neste comando específico — descoberta de metadado é inócua. Mas se preferir consistência, mantenha.

## `/deby:describe <table>`

Mostra colunas, tipos, nullability, default, PK, FKs e índices.

### SQL — colunas

```sql
SELECT
  column_name,
  data_type,
  is_nullable,
  column_default,
  character_maximum_length AS max_len
FROM information_schema.columns
WHERE table_schema = COALESCE(NULLIF(split_part('<table>', '.', 1), ''), 'public')
  AND table_name = split_part('<table>', '.', 2)
ORDER BY ordinal_position;
```

Se o usuário passou só `registrations`, vire `public.registrations`. Se passou `auth.users`, respeite.

> **`public` é default, não premissa.** Tabelas relevantes — em especial de auditoria/log/evento/histórico — podem viver em outros schemas (ex.: `audit`). Se uma coluna esperada não aparecer (ex.: `from_state`/`to_state`), varra todos os schemas com `/deby:tables` (cujo SQL já exclui só `pg_catalog`/`information_schema`) antes de concluir que a tabela está errada.

### SQL — índices

```sql
SELECT indexname, indexdef
FROM pg_indexes
WHERE schemaname = '<schema>' AND tablename = '<table>';
```

### SQL — foreign keys

```sql
SELECT
  tc.constraint_name,
  kcu.column_name,
  ccu.table_schema AS foreign_schema,
  ccu.table_name AS foreign_table,
  ccu.column_name AS foreign_column
FROM information_schema.table_constraints AS tc
JOIN information_schema.key_column_usage AS kcu
  ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
JOIN information_schema.constraint_column_usage AS ccu
  ON ccu.constraint_name = tc.constraint_name AND ccu.table_schema = tc.table_schema
WHERE tc.constraint_type = 'FOREIGN KEY'
  AND tc.table_schema = '<schema>' AND tc.table_name = '<table>';
```

### Apresentação

Combine os três blocos em uma resposta única:

```
### Colunas — public.registrations

| coluna | tipo | null | default |
|---|---|---|---|
| id | uuid | NO | gen_random_uuid() |
| ... |

### Índices
- `registrations_pkey` — `CREATE UNIQUE INDEX ... ON public.registrations (id)`
- ...

### Foreign keys
- `registrations.user_id` → `public.users.id`
```

Não execute os 3 SQLs em paralelo de mãos vazias — peça `y/N` uma vez ("vou rodar 3 queries de metadado contra `<table>`, ok?") e dispare em sequência.
