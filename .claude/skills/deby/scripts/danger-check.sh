#!/usr/bin/env bash
# danger-check.sh — classifica um SQL em safe | mutation | destructive
#
# Uso: echo "SELECT 1" | bash danger-check.sh
#      bash danger-check.sh "DELETE FROM users WHERE id=1"
#
# Regras (best effort, não substitui revisão humana):
#   destructive: DROP, ALTER, TRUNCATE, CREATE, GRANT, REVOKE
#                DELETE/UPDATE sem WHERE (também: WHERE 1=1, WHERE true)
#   mutation:    INSERT, DELETE/UPDATE com WHERE, COPY (write)
#   safe:        SELECT, EXPLAIN, SHOW, WITH (que termina em SELECT)
#
# Output: uma palavra em stdout. Exit code sempre 0.
# Erros de parsing extremos => "destructive" (fail closed).

set -euo pipefail

sql="${1:-}"
if [ -z "$sql" ]; then
  sql="$(cat)"
fi

# Normaliza: minúsculas, remove comentários -- ... e /* ... */, colapsa espaços
norm="$(printf '%s' "$sql" \
  | tr '\n' ' ' \
  | sed -E 's|/\*[^*]*\*+([^/*][^*]*\*+)*/||g' \
  | sed -E 's|--[^\n]*||g' \
  | tr '[:upper:]' '[:lower:]' \
  | tr -s ' ')"

is_destructive_kw() {
  [[ "$norm" =~ (^|[^a-z_])(drop|truncate|alter|create|grant|revoke|reindex|vacuum[[:space:]]+full)([^a-z_]|$) ]]
}

is_delete_or_update() {
  [[ "$norm" =~ (^|[^a-z_])(delete[[:space:]]+from|update[[:space:]]+) ]]
}

has_where_clause() {
  # WHERE seguido de algo que não seja vazio, 1=1, true, ou 'a'='a'
  if [[ "$norm" =~ [[:space:]]where[[:space:]]+([^;]+) ]]; then
    local where="${BASH_REMATCH[1]}"
    # remove espaços
    where="$(printf '%s' "$where" | tr -d ' ')"
    case "$where" in
      1=1*|true*|'a'='a'*) return 1 ;;
      *) return 0 ;;
    esac
  fi
  return 1
}

is_mutation() {
  [[ "$norm" =~ (^|[^a-z_])(insert[[:space:]]+into|copy[[:space:]]+[^[:space:]]+[[:space:]]+from) ]]
}

if is_destructive_kw; then
  echo destructive
  exit 0
fi

if is_delete_or_update; then
  if has_where_clause; then
    echo mutation
  else
    echo destructive
  fi
  exit 0
fi

if is_mutation; then
  echo mutation
  exit 0
fi

echo safe
