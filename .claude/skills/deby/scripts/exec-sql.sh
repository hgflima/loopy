#!/usr/bin/env bash
# exec-sql.sh — executa SQL contra um profile e renderiza resultado.
#
# Uso:
#   exec-sql.sh <profile> [--no-limit] [--out-csv PATH] -- "<SQL>"
#   echo "<SQL>" | exec-sql.sh <profile> [--no-limit] [--out-csv PATH]
#
# Comportamento:
#   - Aplica `LIMIT 50` se for SELECT puro sem LIMIT (a menos que --no-limit)
#   - Executa via psql --csv com PGPASSWORD do profile
#   - Salva CSV completo em --out-csv (default: .harn/deby/last-result.csv)
#   - Imprime no stdout: markdown table (até 50 linhas) + "(N linhas total)"
#   - Acrescenta uma linha em .harn/deby/history.log (NDJSON)
#
# Pré-requisitos: psql no PATH, jq, profile registrado em .harn/deby/profiles.json

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=profiles.sh
source "$SCRIPT_DIR/profiles.sh"

DEBY_HISTORY="$DEBY_DIR/history.log"
DEBY_LAST_CSV="$DEBY_DIR/last-result.csv"

profile_name=""
no_limit=0
out_csv="$DEBY_LAST_CSV"
sql=""

while [ $# -gt 0 ]; do
  case "$1" in
    --no-limit) no_limit=1; shift ;;
    --out-csv)  out_csv="$2"; shift 2 ;;
    --) shift; sql="$*"; break ;;
    *)  if [ -z "$profile_name" ]; then profile_name="$1"; shift; else sql="$*"; break; fi ;;
  esac
done

if [ -z "$profile_name" ]; then
  echo "deby: profile name é obrigatório" >&2
  exit 2
fi

if [ -z "$sql" ]; then
  sql="$(cat)"
fi

if ! command -v psql >/dev/null 2>&1; then
  cat >&2 <<'EOF'
deby: psql não está instalado.
Instale com:  brew install libpq && brew link --force libpq
EOF
  exit 3
fi

prof="$(profiles_get "$profile_name")"
if [ -z "$prof" ]; then
  echo "deby: profile '$profile_name' não encontrado" >&2
  exit 4
fi

host="$(jq -r '.host' <<<"$prof")"
port="$(jq -r '.port' <<<"$prof")"
db="$(jq -r '.database' <<<"$prof")"
user="$(jq -r '.user' <<<"$prof")"
pass="$(jq -r '.password' <<<"$prof")"
ssl="$(jq -r '.sslmode' <<<"$prof")"

# Auto-LIMIT: só se for SELECT puro (uma statement) e não tem LIMIT explícito.
trimmed="$(printf '%s' "$sql" | tr '\n' ' ' | sed -E 's/--[^\n]*//g; s/[[:space:]]+/ /g; s/^ //; s/ $//')"
lower="$(printf '%s' "$trimmed" | tr '[:upper:]' '[:lower:]')"
final_sql="$sql"
if [ "$no_limit" = "0" ] \
   && [[ "$lower" =~ ^(with|select) ]] \
   && [[ ! "$lower" =~ [[:space:]]limit[[:space:]]+[0-9]+ ]] \
   && [[ "$trimmed" != *";"* || "${trimmed%;}" != *";"* ]]; then
  # Remove ; final se houver, então append LIMIT 50
  trimmed_no_semi="${trimmed%;}"
  final_sql="$trimmed_no_semi LIMIT 50"
fi

mkdir -p "$(dirname "$out_csv")" "$DEBY_DIR"

# Executa: CSV completo via -A -F','; cabeçalho no topo
PGPASSWORD="$pass" psql \
  --host="$host" --port="$port" --dbname="$db" --username="$user" \
  --set=sslmode="$ssl" \
  --no-psqlrc --pset=footer=off \
  --csv \
  --command="$final_sql" \
  > "$out_csv" 2>/tmp/deby-psql-err
rc=$?

if [ $rc -ne 0 ]; then
  echo "deby: psql falhou (exit $rc):" >&2
  cat /tmp/deby-psql-err >&2 || true
  exit $rc
fi

# Conta linhas (subtrai 1 do header se houver)
total_lines=$(wc -l < "$out_csv" | tr -d ' ')
if [ "$total_lines" -gt 0 ]; then
  row_count=$((total_lines - 1))
else
  row_count=0
fi

# Renderiza markdown (até 50 linhas + header)
if [ "$row_count" -gt 0 ]; then
  python3 - "$out_csv" <<'PY'
import csv, sys
path = sys.argv[1]
with open(path, newline='') as f:
    rdr = csv.reader(f)
    rows = list(rdr)
if not rows:
    sys.exit(0)
header, *data = rows
def esc(c):
    return str(c).replace('|', '\\|').replace('\n', ' ')
print('| ' + ' | '.join(esc(c) for c in header) + ' |')
print('|' + '|'.join('---' for _ in header) + '|')
for r in data[:50]:
    print('| ' + ' | '.join(esc(c) for c in r) + ' |')
PY
fi

echo ""
echo "($row_count linhas — CSV completo em $out_csv)"

# History
ts="$(date -u +%FT%TZ)"
jq -nc \
  --arg ts "$ts" --arg p "$profile_name" --arg sql "$final_sql" \
  --argjson rows "$row_count" \
  '{ts:$ts, profile:$p, sql:$sql, rows:$rows}' \
  >> "$DEBY_HISTORY"
