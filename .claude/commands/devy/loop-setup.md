---
disable-model-invocation: true
description: Configura o loopy.yml da change corrente e prepara o repo para o run rodar redondo
---

Invoque a skill `loopy` (Skill tool) — ela conduz o setup interativo do
`loopy.yml`: descobre a change, valida os agentes disponíveis, propõe um
pipeline resiliente e só salva com a aprovação do usuário.

Depois que a skill salvar o `loopy.yml`, complete o setup do repo:

1. **`.gitignore`**: garanta as entradas de artefatos de runtime —
   `.worktrees/`, `.loopy/`, `.loopy.stop`, `.db/`. Adicione só o que falta.
2. **Checklist de "rodar redondo"**: percorra a seção 4 de
   `references/preflight.md` da skill (lockfile presente, harness `.claude/`
   commitado se os prompts usam `/devy:*`, lint ignorando `.claude/` e
   `.worktrees/`).
3. **Validação final**: rode `npx -y @hgflima/loopy@latest . --dry-run` e
   reporte tasks encontradas, camadas do DAG e concorrência efetiva.
4. **Sugira o commit**: liste os arquivos que precisam estar commitados para o
   run (o motor exige parent limpo): `loopy.yml`, `scripts/loopy-cleanup.sh`,
   `.gitignore`, os inputs da change, lockfile, harness. Proponha a mensagem
   de commit, mas **deixe o usuário decidir** — não commite sem pedido.

Encerre indicando o próximo passo: `/devy:run-loop` para executar.
