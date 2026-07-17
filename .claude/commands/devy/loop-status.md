---
disable-model-invocation: true
description: Reporta o status do loop corrente (tasks, worktrees, run pausado) e oferece ações — stop, resume, limpeza
---

Reporte o status do loop no diretório corrente. Todos os artefatos vivem no
**repo-alvo** (este diretório), nunca no repo do motor.

## Fontes da verdade (leia nesta ordem)

1. **Backlog** — o `todo.md` apontado por `inputs.todo` do `loopy.yml`:
   conte `- [x]` (done) vs `- [ ]` (pendentes) e liste os ids.
2. **Checkpoint** — `.loopy/state.json` (se existir): run pausado/em progresso,
   task corrente, step corrente. É o que o resume usa.
3. **Git** — `git worktree list` + branches de task vivas: worktree presente
   sem checkpoint = possível órfão de um crash.
4. **Processo** — há um loopy vivo? (`pgrep -f "@hgflima/loopy"` e, se em
   herdr, `herdr pane list` procurando o pane do loop).
5. **Telemetria** — se `.db/telemetry.db` existir, resuma por SQL read-only
   (`sqlite3 .db/telemetry.db`): tasks por status, custo somado
   (`SUM(cost_usd)`), tentativas por step. Ignore silenciosamente se o `.db`
   não existir (telemetria é opt-in).

Apresente um resumo curto: N done / N pendentes / N bloqueadas, run vivo ou
não, pausado em qual task/step, worktrees existentes, custo até aqui (se
houver telemetria).

## Ações (ofereça só as aplicáveis, uma pergunta por vez)

- **Parar após a task corrente**: criar o Stop signal —
  `touch .loopy.stop` (o motor encerra a Run graciosamente ao vê-lo).
  Lembre de removê-lo antes do próximo run.
- **Retomar run pausado**: o usuário re-roda o comando do loop
  (`/devy:run-loop`) — o checkpoint em `.loopy/state.json` retoma de onde
  parou. Se a pausa veio de um step de cleanup/merge quebrado, inspecione o
  worktree preservado (`keep_worktree: true`) antes de retomar.
- **Limpar órfãos**: worktree/branch sem checkpoint correspondente —
  `npx -y @hgflima/loopy@latest --clean [task-id]` (teardown de worktree +
  branch + checkpoint). Confirme com o usuário antes: é destrutivo para o
  trabalho não-merjado daquela task.

Não execute nenhuma ação sem o usuário escolher explicitamente.
