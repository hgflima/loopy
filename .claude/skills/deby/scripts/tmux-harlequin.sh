#!/usr/bin/env bash
# tmux-harlequin.sh — abre/anexa sessão tmux `deby-<profile>` com harlequin conectado.
#
# Uso: tmux-harlequin.sh <profile>
#
# Comportamento:
#   - Verifica harlequin instalado (via uv tool ou pipx ou no PATH)
#   - Verifica tmux instalado
#   - Cria/anexa sessão `deby-<profile>` rodando: harlequin -a postgres <dsn>

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=profiles.sh
source "$SCRIPT_DIR/profiles.sh"

profile_name="${1:-$(profiles_current)}"
if [ -z "$profile_name" ]; then
  echo "deby: nenhum profile fornecido nem 'current' definido" >&2
  exit 2
fi

if ! command -v tmux >/dev/null 2>&1; then
  echo "deby: tmux não encontrado. Instale com: brew install tmux" >&2
  exit 3
fi

# Resolve binário harlequin (na ordem: PATH, uv tool, pipx)
harlequin_bin=""
if command -v harlequin >/dev/null 2>&1; then
  harlequin_bin="$(command -v harlequin)"
elif command -v uv >/dev/null 2>&1 && uv tool list 2>/dev/null | grep -q '^harlequin'; then
  harlequin_bin="$(uv tool dir 2>/dev/null | head -1)/harlequin/bin/harlequin"
elif command -v pipx >/dev/null 2>&1 && pipx list --short 2>/dev/null | grep -q '^harlequin'; then
  harlequin_bin="$HOME/.local/bin/harlequin"
fi

if [ -z "$harlequin_bin" ] || [ ! -x "$harlequin_bin" ]; then
  cat >&2 <<'EOF'
deby: harlequin não encontrado.
Instale com: uv tool install 'harlequin[postgres]'
        ou:  pipx install 'harlequin[postgres]'
EOF
  exit 4
fi

dsn="$(profiles_dsn "$profile_name")"
session="deby-$profile_name"

if tmux has-session -t "$session" 2>/dev/null; then
  exec tmux attach -t "$session"
else
  exec tmux new-session -s "$session" "$harlequin_bin -a postgres '$dsn'"
fi
