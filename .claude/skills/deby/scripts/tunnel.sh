#!/usr/bin/env bash
# tunnel.sh — abre SST tunnel para um stage e cria/atualiza profile deby
# apontando para o Postgres (Aurora) daquele stage.
#
# Uso:
#   tunnel.sh install              # instala /opt/sst/tunnel (sudo, one-time)
#   tunnel.sh open <stage>         # garante bin + abre tunnel + cria profile tunnel-<stage>
#   tunnel.sh close <stage>        # fecha tunnel (delega para scripts/deploy.sh)
#   tunnel.sh status [stage]       # status (managed + externos)
#
# Pré-requisitos automatizados:
#   - /opt/sst/tunnel (instalado via `sst tunnel install`, requer sudo)
#   - jq, sst, pnpm (já cobertos pelo `setup.sh`/workspace backend)
#
# Convenção de profile:
#   nome:      tunnel-<stage>          (ex: tunnel-dev, tunnel-hml)
#   sslmode:   require                  (Aurora exige TLS)
#   credenciais: lidas via `sst shell --stage <stage>` (SST_RESOURCE_OnboardingDb)
#
# Estados de tunnel são geridos por scripts/deploy.sh (PID file em /tmp).

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
BACKEND_DIR="$REPO_ROOT/apps/backend"
DEPLOY_SH="$REPO_ROOT/scripts/deploy.sh"

# shellcheck source=profiles.sh
source "$SCRIPT_DIR/profiles.sh"

# --- detecção -------------------------------------------------------------

has() { command -v "$1" >/dev/null 2>&1; }

sst_tunnel_bin_present() { [[ -x /opt/sst/tunnel ]]; }

detect_os() {
  case "$(uname -s)" in
    Darwin) echo macos ;;
    Linux)  echo linux ;;
    *)      echo "unsupported:$(uname -s)" ;;
  esac
}

ensure_backend_workspace() {
  if [[ ! -d "$BACKEND_DIR" ]]; then
    echo "deby:tunnel: apps/backend não encontrado em $BACKEND_DIR" >&2
    return 1
  fi
  if [[ ! -d "$BACKEND_DIR/node_modules" ]]; then
    echo "deby:tunnel: dependências do backend ausentes. Rode: pnpm install" >&2
    return 1
  fi
}

ensure_deploy_sh() {
  if [[ ! -x "$DEPLOY_SH" ]]; then
    echo "deby:tunnel: scripts/deploy.sh não encontrado/executável em $DEPLOY_SH" >&2
    return 1
  fi
}

# --- install --------------------------------------------------------------

cmd_install() {
  local os
  os="$(detect_os)"
  case "$os" in
    macos|linux) ;;
    *) echo "deby:tunnel: SO não suportado ($os). Suportamos macOS e Linux." >&2; exit 2 ;;
  esac

  ensure_backend_workspace || exit 1

  if sst_tunnel_bin_present; then
    echo "deby:tunnel: /opt/sst/tunnel já instalado — nada a fazer."
    return 0
  fi

  if ! has jq; then
    echo "deby:tunnel: jq ausente. Rode primeiro: bash .claude/skills/deby/scripts/setup.sh apply" >&2
    exit 3
  fi

  echo "deby:tunnel: instalando /opt/sst/tunnel via 'sst tunnel install' (vai pedir sudo)."
  (cd "$BACKEND_DIR" && pnpm --filter @liber/backend exec sst tunnel install)

  if ! sst_tunnel_bin_present; then
    echo "deby:tunnel: instalação não criou /opt/sst/tunnel — verifique o output acima." >&2
    exit 4
  fi
  echo "deby:tunnel: /opt/sst/tunnel instalado."
}

# --- fetch credenciais via sst shell -------------------------------------

# Imprime o JSON cru de SST_RESOURCE_OnboardingDb para o stage dado.
fetch_db_resource_json() {
  local stage="$1"
  # sst shell injeta SST_RESOURCE_OnboardingDb no env; basta echoar.
  # Redirect stderr para esconder ruído do sst (mensagens "Sourcing..." etc).
  # shellcheck disable=SC2016
  (cd "$BACKEND_DIR" \
    && pnpm --silent --filter @liber/backend exec \
       sst shell --stage "$stage" -- bash -c 'printf "%s" "$SST_RESOURCE_OnboardingDb"' 2>/dev/null)
}

# --- open -----------------------------------------------------------------

cmd_open() {
  local stage="${1:-}"
  if [[ -z "$stage" ]]; then
    echo "uso: tunnel.sh open <stage>" >&2
    exit 2
  fi

  ensure_backend_workspace || exit 1
  ensure_deploy_sh || exit 1

  if ! has jq; then
    echo "deby:tunnel: jq ausente. Rode: bash .claude/skills/deby/scripts/setup.sh apply" >&2
    exit 3
  fi

  if ! sst_tunnel_bin_present; then
    echo "deby:tunnel: binário ausente — instalando antes de abrir."
    cmd_install
  fi

  echo "deby:tunnel: abrindo tunnel para stage=$stage (delegando a scripts/deploy.sh)…"
  (cd "$REPO_ROOT" && bash "$DEPLOY_SH" tunnel "$stage")

  echo "deby:tunnel: lendo credenciais do Aurora via sst shell…"
  local json
  json="$(fetch_db_resource_json "$stage" || true)"
  if [[ -z "$json" ]] || ! echo "$json" | jq -e . >/dev/null 2>&1; then
    cat >&2 <<EOF
deby:tunnel: falha ao ler SST_RESOURCE_OnboardingDb (stage=$stage).
  - O tunnel está aberto, mas o profile NÃO foi criado.
  - Tente manualmente:
      cd apps/backend && pnpm exec sst shell --stage $stage -- bash -c 'echo \$SST_RESOURCE_OnboardingDb'
EOF
    exit 5
  fi

  local host port db user pass profile_name
  host="$(echo "$json" | jq -r '.host')"
  port="$(echo "$json" | jq -r '.port')"
  db="$(echo "$json"   | jq -r '.database')"
  user="$(echo "$json" | jq -r '.username')"
  pass="$(echo "$json" | jq -r '.password')"
  profile_name="tunnel-$stage"

  if [[ -z "$host" || "$host" == "null" ]]; then
    echo "deby:tunnel: SST_RESOURCE_OnboardingDb não tem .host — payload: $json" >&2
    exit 6
  fi

  profiles_set "$profile_name" "$host" "$port" "$db" "$user" "$pass" "require" \
    "auto via /deby:tunnel:open $stage"
  profiles_use "$profile_name"

  cat <<EOF
deby:tunnel: profile '$profile_name' criado/atualizado e setado como current.
  host=$host:$port  db=$db  user=$user  sslmode=require

Próximos:
  /deby:connection:test $profile_name
  /deby:tables
  /deby:tunnel:close $stage   # quando terminar
EOF
}

# --- close / status (delegam a deploy.sh) --------------------------------

cmd_close() {
  local stage="${1:-}"
  if [[ -z "$stage" ]]; then
    echo "uso: tunnel.sh close <stage>" >&2
    exit 2
  fi
  ensure_deploy_sh || exit 1
  (cd "$REPO_ROOT" && bash "$DEPLOY_SH" tunnel:close "$stage")
}

cmd_status() {
  ensure_deploy_sh || exit 1
  local stage="${1:-dev}"
  (cd "$REPO_ROOT" && bash "$DEPLOY_SH" tunnel:status "$stage")
}

# --- dispatcher ----------------------------------------------------------

cmd="${1:-}"
shift || true
case "$cmd" in
  install) cmd_install "$@" ;;
  open)    cmd_open "$@" ;;
  close)   cmd_close "$@" ;;
  status)  cmd_status "$@" ;;
  *) echo "uso: $0 {install|open|close|status} [stage]" >&2; exit 2 ;;
esac
