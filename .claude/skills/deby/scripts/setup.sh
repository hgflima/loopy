#!/usr/bin/env bash
# setup.sh — detecta SO + instala dependências da skill deby.
#
# Uso:
#   setup.sh check    # só inspeciona, não instala
#   setup.sh plan     # imprime os comandos que rodaria
#   setup.sh apply    # executa o plan (pede sudo quando precisa)
#
# Deps gerenciadas: psql (libpq), jq, tmux, uv, harlequin[postgres]
#
# Estratégia por SO:
#   macOS:       brew install ...; harlequin via uv tool
#   ubuntu/debian: sudo apt-get install postgresql-client jq tmux
#   fedora/rhel: sudo dnf install postgresql jq tmux
#   arch:        sudo pacman -S postgresql-libs jq tmux
#   uv:          curl -LsSf https://astral.sh/uv/install.sh | sh (universal)

set -euo pipefail

# --- detecção ---

detect_os() {
  case "$(uname -s)" in
    Darwin) echo macos ;;
    Linux)
      if [ -r /etc/os-release ]; then
        # shellcheck disable=SC1091
        . /etc/os-release
        case "${ID:-}" in
          ubuntu|debian) echo debian ;;
          fedora|rhel|centos|rocky|almalinux) echo fedora ;;
          arch|manjaro) echo arch ;;
          *) echo "linux-unknown:${ID:-}" ;;
        esac
      else
        echo linux-unknown
      fi
      ;;
    *) echo "unsupported:$(uname -s)" ;;
  esac
}

has() { command -v "$1" >/dev/null 2>&1; }

has_uv_tool() {
  has uv && uv tool list 2>/dev/null | grep -qi "^${1}"
}

has_pipx_tool() {
  has pipx && pipx list --short 2>/dev/null | grep -qi "^${1}"
}

has_harlequin() {
  has harlequin || has_uv_tool harlequin || has_pipx_tool harlequin
}

# --- check ---

print_status() {
  local os="$1"
  printf 'SO detectado: %s\n\n' "$os"
  printf '%-12s %s\n' "deps" "status"
  printf '%-12s %s\n' "----" "------"
  for cmd in psql jq tmux uv; do
    if has "$cmd"; then
      printf '%-12s ✓ (%s)\n' "$cmd" "$(command -v "$cmd")"
    else
      printf '%-12s ✗ ausente\n' "$cmd"
    fi
  done
  if has_harlequin; then
    printf '%-12s ✓\n' "harlequin"
  else
    printf '%-12s ✗ ausente\n' "harlequin"
  fi
}

# --- plan ---

# Imprime os comandos que seriam executados, um por linha (prefixados por #
# comentários explicativos). NÃO executa.
plan_for_os() {
  local os="$1"
  case "$os" in
    macos)
      has brew || cat <<'EOF'
# brew não está instalado. Instale antes:
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
EOF
      has psql || cat <<'EOF'
# psql (cliente Postgres): brew instala libpq (client-only, sem servidor)
brew install libpq
brew link --force libpq
EOF
      has jq    || echo 'brew install jq'
      has tmux  || echo 'brew install tmux'
      has uv    || echo 'curl -LsSf https://astral.sh/uv/install.sh | sh'
      ;;
    debian)
      local pkgs=()
      has psql || pkgs+=("postgresql-client")
      has jq   || pkgs+=("jq")
      has tmux || pkgs+=("tmux")
      if [ ${#pkgs[@]} -gt 0 ]; then
        echo "sudo apt-get update"
        echo "sudo apt-get install -y ${pkgs[*]}"
      fi
      has uv || echo 'curl -LsSf https://astral.sh/uv/install.sh | sh'
      ;;
    fedora)
      local pkgs=()
      has psql || pkgs+=("postgresql")
      has jq   || pkgs+=("jq")
      has tmux || pkgs+=("tmux")
      if [ ${#pkgs[@]} -gt 0 ]; then
        echo "sudo dnf install -y ${pkgs[*]}"
      fi
      has uv || echo 'curl -LsSf https://astral.sh/uv/install.sh | sh'
      ;;
    arch)
      local pkgs=()
      has psql || pkgs+=("postgresql-libs")
      has jq   || pkgs+=("jq")
      has tmux || pkgs+=("tmux")
      if [ ${#pkgs[@]} -gt 0 ]; then
        echo "sudo pacman -S --noconfirm ${pkgs[*]}"
      fi
      has uv || echo 'curl -LsSf https://astral.sh/uv/install.sh | sh'
      ;;
    *)
      cat >&2 <<EOF
deby setup: SO não suportado automaticamente ($os).

Instale manualmente:
  - psql (cliente Postgres do seu pacote postgresql)
  - jq, tmux (gerenciador de pacotes do seu sistema)
  - uv: curl -LsSf https://astral.sh/uv/install.sh | sh
  - harlequin: uv tool install 'harlequin[postgres]'
EOF
      return 2
      ;;
  esac

  # harlequin é universal — assume uv presente após o passo anterior
  has_harlequin || echo "uv tool install 'harlequin[postgres]'"
}

# --- apply ---

apply_for_os() {
  local os="$1"
  local plan
  plan="$(plan_for_os "$os")"
  if [ -z "$plan" ]; then
    echo "deby setup: nada a instalar — todas as deps já estão presentes."
    return 0
  fi
  echo "Plano:"
  # shellcheck disable=SC2001
  echo "$plan" | sed 's/^/  /'
  echo ""
  printf "Executar? [y/N] "
  read -r ans
  case "$ans" in
    y|Y|yes|YES) ;;
    *) echo "cancelado"; return 1 ;;
  esac
  # Executa cada linha não-comentário/não-vazia
  echo "$plan" | while IFS= read -r line; do
    [ -z "$line" ] && continue
    case "$line" in \#*) continue ;; esac
    echo "→ $line"
    eval "$line"
  done
}

# --- entry ---

cmd="${1:-check}"
os="$(detect_os)"

case "$cmd" in
  check)
    print_status "$os"
    ;;
  plan)
    print_status "$os"
    echo ""
    echo "Plano para instalar o que falta:"
    plan_for_os "$os" | sed 's/^/  /'
    ;;
  apply)
    print_status "$os"
    echo ""
    apply_for_os "$os"
    ;;
  *)
    echo "uso: $0 {check|plan|apply}" >&2
    exit 2
    ;;
esac
