#!/usr/bin/env bash
# profiles.sh — CRUD para .harn/deby/profiles.json
# Uso (carregar como library):  source scripts/profiles.sh
# Ou subcomandos diretos:        bash scripts/profiles.sh <cmd> [args]
#
# Estrutura do JSON:
# {
#   "current": "<name>" | null,
#   "profiles": {
#     "<name>": { name, host, port, database, user, password, sslmode, notes }
#   }
# }

set -euo pipefail

DEBY_ROOT="${DEBY_ROOT:-$(git rev-parse --show-toplevel 2>/dev/null || pwd)}"
DEBY_DIR="$DEBY_ROOT/.harn/deby"
DEBY_FILE="$DEBY_DIR/profiles.json"

profiles_ensure_file() {
  mkdir -p "$DEBY_DIR"
  if [ ! -f "$DEBY_FILE" ]; then
    echo '{"current":null,"profiles":{}}' > "$DEBY_FILE"
  fi
}

profiles_list() {
  profiles_ensure_file
  jq -r '
    .profiles
    | to_entries
    | map([.value.name, .value.host, (.value.port|tostring), .value.database, .value.user] | join("\t"))
    | .[]
  ' "$DEBY_FILE"
}

profiles_names() {
  profiles_ensure_file
  jq -r '.profiles | keys[]' "$DEBY_FILE"
}

profiles_current() {
  profiles_ensure_file
  jq -r '.current // empty' "$DEBY_FILE"
}

profiles_get() {
  local name="$1"
  profiles_ensure_file
  jq --arg n "$name" '.profiles[$n] // empty' "$DEBY_FILE"
}

profiles_exists() {
  local name="$1"
  profiles_ensure_file
  jq -e --arg n "$name" '.profiles | has($n)' "$DEBY_FILE" >/dev/null
}

# profiles_set <name> <host> <port> <database> <user> <password> <sslmode> [notes]
profiles_set() {
  local name="$1" host="$2" port="$3" db="$4" user="$5" pass="$6" ssl="${7:-disable}" notes="${8:-}"
  profiles_ensure_file
  local tmp
  tmp="$(mktemp)"
  jq \
    --arg n "$name" --arg h "$host" --argjson p "$port" \
    --arg d "$db" --arg u "$user" --arg pw "$pass" \
    --arg s "$ssl" --arg nt "$notes" '
    .profiles[$n] = {
      name: $n, host: $h, port: $p, database: $d,
      user: $u, password: $pw, sslmode: $s, notes: $nt
    }
    | (.current = (.current // $n))
  ' "$DEBY_FILE" > "$tmp" && mv "$tmp" "$DEBY_FILE"
}

profiles_remove() {
  local name="$1"
  profiles_ensure_file
  local tmp
  tmp="$(mktemp)"
  jq --arg n "$name" '
    del(.profiles[$n])
    | if .current == $n then .current = (.profiles | keys | .[0] // null) else . end
  ' "$DEBY_FILE" > "$tmp" && mv "$tmp" "$DEBY_FILE"
}

profiles_use() {
  local name="$1"
  profiles_ensure_file
  if ! profiles_exists "$name"; then
    echo "deby: profile '$name' não existe" >&2
    return 1
  fi
  local tmp
  tmp="$(mktemp)"
  jq --arg n "$name" '.current = $n' "$DEBY_FILE" > "$tmp" && mv "$tmp" "$DEBY_FILE"
}

# profiles_dsn <name> -> imprime DSN postgresql:// (senha url-encoded)
profiles_dsn() {
  local name="$1"
  local p
  p="$(profiles_get "$name")"
  if [ -z "$p" ]; then
    echo "deby: profile '$name' não encontrado" >&2
    return 1
  fi
  jq -r '
    @uri "postgresql://\(.user):\(.password)@\(.host):\(.port)/\(.database)?sslmode=\(.sslmode)"
  ' <<<"$p"
}

# Despachador quando chamado como script
if [ "${BASH_SOURCE[0]}" = "${0}" ]; then
  cmd="${1:-list}"
  shift || true
  case "$cmd" in
    list)    profiles_list ;;
    names)   profiles_names ;;
    current) profiles_current ;;
    get)     profiles_get "$@" ;;
    exists)  profiles_exists "$@" ;;
    set)     profiles_set "$@" ;;
    remove)  profiles_remove "$@" ;;
    use)     profiles_use "$@" ;;
    dsn)     profiles_dsn "$@" ;;
    *) echo "uso: $0 {list|names|current|get|exists|set|remove|use|dsn} [args]" >&2; exit 2 ;;
  esac
fi
