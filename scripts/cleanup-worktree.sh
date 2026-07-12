#!/usr/bin/env bash
# Teardown idempotente do worktree + branch de uma Task do loopy.
#
# Uso: cleanup-worktree.sh <root> <worktree-path> <branch>
#
# Por que existe: o step `cleanup` do loopy.yml grava o checkpoint (pc=cleanup)
# ANTES de o step concluir. Se o Processo morre depois de `git worktree remove`
# ter tido sucesso (ex.: o app-pai reiniciar no merge de Rust — ver docstring do
# gotcha de dogfooding), o resume re-executa `worktree remove` sobre algo que já
# não existe -> `fatal: '...' is not a working tree` (exit 128) -> como o step
# reporta falha, escala -> pause, pulando todos os dependentes. Este wrapper
# torna o teardown IDEMPOTENTE: tolera worktree/branch JA removidos (no-op), mas
# ainda propaga erros genuinos (permissao, repo corrompido, branch atual, ...).
#
# Invocado como um unico argv pelo shell step (argv sem shell); toda a logica de
# tolerancia vive aqui, nao na linha do yml.
set -uo pipefail

root=${1:?root ausente}
path=${2:?worktree-path ausente}
branch=${3:?branch ausente}

# 1) Remover o worktree. Tolerar SOMENTE "is not a working tree" — o caso exato
#    de idempotencia (worktree ja desregistrado num run anterior). Qualquer outra
#    falha e propagada.
if err=$(git -C "$root" worktree remove --force "$path" 2>&1); then
  :
elif printf '%s' "$err" | grep -q "is not a working tree"; then
  echo "cleanup: worktree '$path' ja removido — no-op" >&2
else
  printf '%s\n' "$err" >&2
  exit 1
fi

# Podar metadados orfaos de worktree (no-op se nada a podar).
git -C "$root" worktree prune

# 2) Deletar o branch da Task. Tolerar SOMENTE "not found" (ja deletado); um erro
#    tipo "Cannot delete branch ... currently on" e genuino e deve escalar.
if err=$(git -C "$root" branch -D "$branch" 2>&1); then
  :
elif printf '%s' "$err" | grep -q "not found"; then
  echo "cleanup: branch '$branch' ja deletado — no-op" >&2
else
  printf '%s\n' "$err" >&2
  exit 1
fi
