# Perfis de conexão — `profiles.md`

Carregue este arquivo quando precisar **criar, editar, listar ou trocar** um perfil de conexão.

## Localização

`.harn/deby/profiles.json` — gitignored. Pode conter senha em plaintext.

## Schema

```json
{
  "current": "<name>" | null,
  "profiles": {
    "<name>": {
      "name": "<name>",
      "host": "localhost",
      "port": 5432,
      "database": "onboarding",
      "user": "postgres",
      "password": "...",
      "sslmode": "disable" | "require" | "prefer" | "verify-ca" | "verify-full",
      "notes": "string livre — ex.: 'RDS dev, túnel via pnpm deploy:tunnel dev'"
    }
  }
}
```

## Wrapper: `scripts/profiles.sh`

| Subcomando | Faz |
|---|---|
| `list` | uma linha por profile: `<name>\t<host>\t<port>\t<db>\t<user>` |
| `names` | só os nomes |
| `current` | nome do profile current (ou vazio) |
| `get <name>` | objeto JSON completo do profile |
| `exists <name>` | exit 0 se existe |
| `set <n> <host> <port> <db> <user> <pass> <ssl> [notes]` | upsert |
| `remove <name>` | remove |
| `use <name>` | define current |
| `dsn <name>` | imprime `postgresql://user:pass@host:port/db?sslmode=...` (já URL-encoded) |

## Fluxo `/deby:connection:create <descrição em pt-BR>`

1. **Parse heurístico da descrição** — extraia o que conseguir, mas não chute campos críticos.

   Exemplos:
   - `"banco docker local"` → `host=localhost, port=5432, ssl=disable, name=local-docker`
   - `"rds dev via tunnel"` → `host=localhost, port=5433` (padrão do projeto), `ssl=require, name=rds-dev` (mas confirme porta)
   - `"banco de producao"` → confirme tudo, **sem chute**

2. **Pergunte item por item** o que ficou ambíguo, na ordem: `name`, `host`, `port`, `database`, `user`, `password`, `sslmode`, `notes`. Use `AskUserQuestion` com **uma pergunta por vez** (o usuário tem TDAH).

3. **Mostre o JSON final** antes de salvar e peça `y/N`:

   ```
   Vou salvar este profile:
   {
     "name": "local-docker",
     "host": "localhost",
     "port": 5432,
     "database": "onboarding",
     "user": "postgres",
     "password": "••••••",
     "sslmode": "disable",
     "notes": ""
   }
   Confirma? (y/N)
   ```

4. **Salva** via `bash .claude/skills/deby/scripts/profiles.sh set "$name" "$host" "$port" "$db" "$user" "$pass" "$ssl" "$notes"`.

5. **Testa imediatamente** rodando `connection:test`. Se falhar, diga o que tentar (túnel? credencial?).

## Fluxo `/deby:connections`

```bash
bash .claude/skills/deby/scripts/profiles.sh list
bash .claude/skills/deby/scripts/profiles.sh current
```

Formate como markdown:

```
| nome | host | porta | db | user | current |
|---|---|---|---|---|---|
| local-docker | localhost | 5432 | onboarding | postgres | ✓ |
| rds-dev | localhost | 5433 | onboarding | postgres |  |
```

## Fluxo `/deby:connection:use <name>`

```bash
bash .claude/skills/deby/scripts/profiles.sh use <name>
```

Confirme: "ok, current = `<name>`". Faça um `SELECT 1` silencioso pra verificar conectividade — se falhar, avise mas não desfaça o `use`.

## Fluxo `/deby:connection:test <name>`

```bash
echo 'SELECT 1' | bash .claude/skills/deby/scripts/exec-sql.sh <name>
```

Reporte sucesso ou erro. Em caso de erro com `Connection refused` para profile remoto, sugira o comando de túnel (deste projeto: `pnpm deploy:tunnel <stage>`).

## Fluxo `/deby:connection:remove <name>`

1. Pergunte confirmação `y/N` — não é destrutivo no banco, só remove o profile local.
2. Se confirmado: `bash .claude/skills/deby/scripts/profiles.sh remove <name>`.
3. Se o profile removido era o `current`, avise qual virou current (ou se ficou null).
