# Confirmação e taxonomia de perigo — `safety.md`

Carregue quando estiver prestes a **executar SQL** ou remover algo (profile, sessão tmux).

## Princípio

O custo de confirmar uma query é baixíssimo. O custo de um `DELETE FROM users` acidental é altíssimo. A regra: **sempre confirme antes de executar**. O nível da confirmação muda conforme o risco.

## Classificação automática

Use `scripts/danger-check.sh` — não decida no olho:

```bash
echo "<SQL>" | bash .claude/skills/deby/scripts/danger-check.sh
# imprime: safe | mutation | destructive
```

### `safe`
- `SELECT`, `EXPLAIN`, `SHOW`, `WITH ... SELECT`
- **Confirmação**: `y/N` simples ("vou rodar o SQL acima — confirma?")

### `mutation`
- `INSERT INTO ...`
- `DELETE FROM ... WHERE <cond>` (com WHERE não-trivial)
- `UPDATE ... WHERE <cond>` (com WHERE não-trivial)
- `COPY ... FROM`
- **Confirmação**: `y/N`, mas reforce no prompt o que vai mudar: "vai afetar N linhas estimadas" (rode um `SELECT count(*) WHERE <mesma cond>` antes se for barato).

### `destructive`
- DDL: `DROP`, `ALTER`, `TRUNCATE`, `CREATE`, `GRANT`, `REVOKE`, `REINDEX`, `VACUUM FULL`
- DML sem WHERE (ou `WHERE 1=1`, `WHERE true`): `DELETE`, `UPDATE`
- **Confirmação**: **type-to-confirm**.

## Fluxo type-to-confirm (para `destructive`)

1. Identifique a tabela principal afetada (primeira após `FROM` / `UPDATE` / `DROP TABLE`).
2. Combine com o database do profile current → `<database>.<tabela>` (sem schema, usando só `database.table`).
3. Mostre uma mensagem como:

   ```
   ⚠️  Query CLASSIFICADA COMO DESTRUTIVA:

   ```sql
   DELETE FROM registrations
   ```

   Banco: onboarding
   Tabela: registrations
   Profile: rds-dev

   Para confirmar, digite EXATAMENTE:  onboarding.registrations
   Qualquer outra coisa cancela.
   ```

4. **Use `AskUserQuestion` com a opção "Digite exato" + cancelar.** Se a opção for "Other" e o texto não bater EXATAMENTE com `<database>.<tabela>` (case-sensitive, sem espaços extras), **cancele**.

5. Se confirmado, execute. Se cancelado, diga "cancelado" e pare.

## Casos especiais

- **Múltiplos statements** (`SELECT ...; DELETE ...`): classifique pelo statement mais perigoso. Considere recomendar separar.
- **Subqueries com DELETE/UPDATE aninhado**: o classificador atual é conservador — pode marcar como destrutivo um caso que não é. Se o usuário insistir, ele tem que digitar a confirmação mesmo assim. Não relaxe a regra.
- **Falsos positivos**: se ficar repetidamente preso em type-to-confirm para uma query que claramente é segura, sugira ao usuário escrever um SELECT equivalente em vez de baixar a guarda.

## Confirmação em ações fora de SQL

| Ação | Nível |
|---|---|
| `/deby:connection:remove` | `y/N` (não toca o banco) |
| `/deby:harlequin:install` | `y/N` antes de instalar via `uv tool install` |
| Abrir/anexar tmux | sem confirmação (não muda estado persistente) |

## Como mostrar o SQL pro usuário

Sempre em bloco markdown `sql`:

````
```sql
SELECT id, status, created_at
FROM registrations
ORDER BY created_at DESC
LIMIT 10;
```
````

Nunca inline em prosa. Ele tem que ler antes de aprovar.
