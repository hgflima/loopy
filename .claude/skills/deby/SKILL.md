---
name: deby
description: Administração imperativa de bancos Postgres (locais ou via túnel) — gerenciar conexões, descobrir schema, escrever e executar SQL em linguagem natural, abrir TUI interativa (harlequin). Use sempre que o usuário invocar `/deby:*`, ou quando ele pedir para conectar, listar tabelas, descrever tabela, executar query, ou abrir TUI de Postgres. Use ainda quando ele descrever a intenção em pt-BR (ex.: "mostra as últimas 10 registrations", "quantos usuários por status hoje") esperando que você traduza para SQL e execute.
---

# deby — Postgres DB admin

Objetivo: o usuário descreve em português o que quer do banco; você descobre o schema, escreve o SQL, **pede confirmação**, executa via `psql --csv`, devolve markdown + insight curto, e mantém um CSV completo da última execução.

A skill é **genérica** (não conhece o schema do projeto). Cada execução começa por discovery, não por suposição.

## Comandos (v1)

| Slash | Roteia para |
|---|---|
| `/deby:setup` | `scripts/setup.sh` — detecta SO e instala deps (psql, jq, tmux, uv, harlequin) |
| `/deby:connection:create <desc>` | `references/profiles.md` — fluxo interativo de criação |
| `/deby:connection:use <name>` | `profiles.sh use <name>` |
| `/deby:connection:test <name>` | `exec-sql.sh <name> -- 'SELECT 1'` |
| `/deby:connection:remove <name>` | `profiles.sh remove <name>` (com confirmação y/N) |
| `/deby:connections` | `profiles.sh list` formatado em tabela |
| `/deby:tables [pattern]` | `references/discovery.md` |
| `/deby:describe <table>` | `references/discovery.md` |
| `/deby:query <desc\|SQL>` | `references/query-flow.md` (entrypoint principal) |
| `/deby:harlequin:install` | `references/harlequin.md` (atalho que delega ao :setup) |
| `/deby:harlequin:open [name]` | `tmux-harlequin.sh <name>` |
| `/deby:tunnel:install` | `scripts/tunnel.sh install` — instala `/opt/sst/tunnel` (sudo, one-time) |
| `/deby:tunnel:open <stage>` | `scripts/tunnel.sh open <stage>` — abre tunnel + cria profile `tunnel-<stage>` |
| `/deby:tunnel:close <stage>` | `scripts/tunnel.sh close <stage>` |
| `/deby:tunnel:status [stage]` | `scripts/tunnel.sh status [stage]` (default `dev`) |

## Regras invioláveis

1. **Sempre confirmar antes de executar** SQL contra o banco. Mesmo `SELECT 1` recebe `y/N`. O custo é baixíssimo e evita acidentes.
2. **Queries perigosas exigem type-to-confirm**: o usuário digita `<database>.<tabela_principal>` exato para autorizar. Aplica a:
   - DDL: `DROP`, `ALTER`, `TRUNCATE`, `CREATE`, `GRANT`, `REVOKE`, `REINDEX`, `VACUUM FULL`
   - DML sem `WHERE` (ou com `WHERE 1=1`/`WHERE true`): `DELETE`, `UPDATE`
3. **Classificação automática** via `scripts/danger-check.sh` — não decida no olho.
4. **Discovery antes de query** quando o usuário descreve em pt-BR e você não conhece o schema da tabela alvo. Use `/deby:describe` ou consulte `information_schema` antes de chutar nomes de coluna.
5. **Mostre o SQL ao usuário antes de executar.** Em bloco ```sql. Ele tem que reconhecer o que vai rodar.
6. **Senha nunca aparece no output.** Ao mostrar profiles, mascare com `••••••`.
7. **Túnel:** preferir `/deby:tunnel:open <stage>` (abre tunnel + cria profile auto). Para abrir manual sem deby, `pnpm deploy:tunnel <stage>` continua válido.

## Estrutura de arquivos

```
.harn/deby/                       (gitignored)
  profiles.json                   { current, profiles: { name → {...} } }
  history.log                     NDJSON de cada query executada
  last-result.csv                 output completo da última query bem-sucedida
```

## Workflows (carregue o reference correspondente)

- **Criar conexão** → `references/profiles.md`
- **Executar query em pt-BR ou SQL** → `references/query-flow.md`
- **Listar/descrever tabelas** → `references/discovery.md`
- **Instalar / abrir harlequin** → `references/harlequin.md`
- **Taxonomia de perigo + type-to-confirm** → `references/safety.md`

## Forma de resposta após executar query

Depois de `exec-sql.sh` retornar com sucesso:

1. Cole a tabela markdown que veio do script (até 50 linhas).
2. Cite a linha final `(N linhas — CSV completo em …)`.
3. Adicione **um parágrafo curto de insight** baseado no que voltou: padrões óbvios (todos os status são o mesmo? há valores `NULL` inesperados? distribuição enviesada? coluna de tempo com gaps?). Sem inventar o que não está nos dados — se não houver insight relevante, diga "sem padrão óbvio no resultado".

Exemplo:

```
| id | status | created_at |
|---|---|---|
| ... |

(7 linhas — CSV completo em .harn/deby/last-result.csv)

Observação: 5 das 7 registrations estão em `pending_review` e foram criadas
nas últimas 6h — pode indicar um backlog recente do reviewer humano.
```

## Quando NÃO usar esta skill

- Quando o usuário pede para escrever migration files (use o ORM/Drizzle do projeto).
- Quando o pedido é code review ou design de schema (use `code-review-and-quality` ou `api-and-interface-design`).
- Quando ele só quer um SQL escrito (não executado) — você pode escrever o SQL inline na conversa, sem invocar a skill, a menos que ele explicitamente peça `/deby:*`.
