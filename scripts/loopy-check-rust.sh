#!/usr/bin/env bash
# Check condicional de Rust para o loopy: roda `cargo test` do `src-tauri` APENAS
# quando a Task corrente tocou `apps/menubar/src-tauri/`.
#
# Uso: npm run check:rust   (entra na lista `ci` do loopy.yml como `{ name: rust }`)
#
# Por que existe: `target/` e gitignorado, entao cada Worktree comeca sem cache de
# compilacao. Colocar `cargo test` direto na lista `ci` faria TODA task de
# TypeScript pagar um build Rust from-scratch (as centenas de crates do Tauri) a
# cada Tentativa de cada Step de Agente. Este wrapper cobra esse custo so de quem
# realmente mexeu em Rust — na C-0019, uma unica task (T-004, o LineFramer).
#
# Checa DUAS fontes, porque o momento do check muda ao longo do Pipeline:
#   1. working tree (`git status`) — o caso do `verify`: o agente deixa as
#      mudancas sem commitar, por decisao do Pipeline;
#   2. commits da branch contra o parent — o caso pos-`commit`/`finalize-merge`.
#
# Roda com cwd no Worktree da Task (os checks do motor herdam esse cwd), por isso
# todos os caminhos sao relativos e o `git` opera no repo do proprio Worktree.
set -uo pipefail

manifest="apps/menubar/src-tauri/Cargo.toml"
needle="apps/menubar/src-tauri/"
parent="${LOOPY_PARENT_BRANCH:-main}"

touched() {
  # 1) Mudancas ainda nao commitadas (inclui untracked).
  if [ -n "$(git status --porcelain -- "$needle" 2>/dev/null)" ]; then
    return 0
  fi
  # 2) Commits desta branch em relacao ao parent. Sem merge-base (parent
  #    inexistente), assume-se "nao tocado" — o caso 1 ja cobre o verify.
  local base
  base=$(git merge-base HEAD "$parent" 2>/dev/null) || return 1
  if [ -n "$(git diff --name-only "$base" HEAD -- "$needle" 2>/dev/null)" ]; then
    return 0
  fi
  return 1
}

if touched; then
  echo "check:rust: '$needle' tocado — rodando cargo test"
  exec cargo test --manifest-path "$manifest"
fi

echo "check:rust: nada tocado em '$needle' — skip"
exit 0
