# Harlequin — `harlequin.md`

Harlequin é a TUI Postgres (https://harlequin.sh) que usamos para sessões interativas, quando o usuário quer "se virar sozinho" no banco.

## `/deby:harlequin:install`

Prefira delegar para `/deby:setup`, que cuida de **todas** as deps de uma vez (psql, jq, tmux, uv, harlequin) multi-OS:

```bash
bash .claude/skills/deby/scripts/setup.sh apply
```

Se o usuário quer **só** harlequin (assume que uv já está):

```bash
uv tool install 'harlequin[postgres]'
# fallback se uv não existir:
pipx install 'harlequin[postgres]'
```

Pós-install, valide:

```bash
harlequin --version
```

Nota: `harlequin[postgres]` instala o adapter postgres junto — não tente instalar `harlequin-postgres` separado.

### Troubleshooting

- **`No module named '_psycopg'`** após install — recompile com `uv tool install --force 'harlequin[postgres]'`.
- **`harlequin: command not found`** mesmo após install — adicione ao PATH: `export PATH="$HOME/.local/bin:$PATH"` (pipx) ou `uv tool dir` (uv).

## `/deby:harlequin:open [name]`

Abre/anexa uma sessão `tmux` chamada `deby-<profile>` com harlequin conectado.

```bash
bash .claude/skills/deby/scripts/tmux-harlequin.sh <name>
```

Se `name` não vier, usa o `current` do profiles.json.

### O que o script faz

1. Verifica `tmux` e `harlequin` instalados (falha clara se faltar).
2. Resolve DSN do profile via `profiles_dsn`.
3. Cria `tmux new-session -s deby-<profile> "harlequin -a postgres '<dsn>'"` se a sessão não existir.
4. Se existe, anexa (`tmux attach -t deby-<profile>`).

### Considerações

- A sessão **persiste** depois que o usuário sai (`Ctrl-b d`). Anexar de novo: `/deby:harlequin:open <same-profile>` ou `tmux a -t deby-<profile>`.
- Múltiplos profiles = múltiplas sessões (`deby-local-docker`, `deby-rds-dev`...).
- Para matar uma sessão: `tmux kill-session -t deby-<profile>`. (Não cobrimos no v1, mas vale lembrar.)

### Quando o usuário só quer "ver" o banco

Esse é o caminho. Não tente reproduzir a TUI no chat — abra o tmux e deixe ele operar. Sua próxima utilidade volta quando ele pedir algo que valha um `exec-sql.sh` (export, query complexa que deveria virar arquivo, etc.).
