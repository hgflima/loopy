# Pipeline canônico resiliente + gotchas de dogfooding

O template abaixo encoda todas as lições aprendidas rodando o loopy em
projetos reais. Cada desvio do óbvio tem um motivo — a tabela de gotchas no
fim explica cada um. Adapte os papéis aos agentes que passaram no preflight;
**não copie cegamente**: leia o `plan.md` e o `package.json` do alvo e ajuste
checks, prompts e steps à entrega.

## Distribuição de papéis

| Papel | Preferência | Racional |
| --- | --- | --- |
| Implementar | claude → codex → opencode | Melhor em seguir spec/plan longos. |
| Simplificar | codex (`effort: low`) → pular o step | Passada barata de limpeza; opcional. |
| Revisar | um agente **diferente** do implementador, se houver | Lente independente pega o que o autor não vê. Com um agente só, ele mesmo revisa (ainda vale: contexto limpo + prompt read-only). |

## Template comentado

```yaml
version: "1"
name: <slug-da-change>

workspace:
  root: "."
  parent_branch: "main"
  worktrees_dir: ".worktrees"

agents:
  # Só agentes que PASSARAM no probe. effort/mode/model = dialeto do probe.
  claude:
    preset: claude
  codex:
    preset: codex
    effort: low
  opencode:
    preset: opencode

acp:
  default_agent: claude
  request_timeout_seconds: 1800
  permissions:
    default_mode: acceptEdits
    on_request: allow

inputs:
  spec: "<dir-da-change>/spec.md"
  plan: "<dir-da-change>/plan.md"
  todo: "<dir-da-change>/todo.md"
  backlog:
    pending_marker: "- [ ]"
    done_marker: "- [x]"
    task_id_pattern: "T-\\d+"     # derivado do todo.md REAL
    body: indented
    mark_done_on_success: true
    deps_pattern: "Deps:"

checks:
  ci:
    # Só scripts que EXISTEM no package.json do alvo. Argv sem shell.
    - { name: typecheck, run: "npm run typecheck" }
    - { name: lint, run: "npm run lint" }
    - { name: test, run: "npm test" }

pipeline:
  - id: create-worktree
    type: shell
    run:
      - git worktree add -b "${task.branch}" "${worktree.path}" "${workspace.parent_branch}"

  - id: install-deps
    type: shell
    parallel_safe: true            # não mexe no parent → fora do mutex
    run:
      - npm ci --prefix "${worktree.path}"   # exige lockfile commitado (G6)

  - id: implement
    type: agent
    clear_context: true
    mode: acceptEdits
    prompt: |
      /devy:build Implemente a task ${task.id} — ${task.title} — conforme ${inputs.spec} e ${inputs.plan}.
      ${task.body}
      ${checks.report}
      **CRITICAL**: NÃO rode git add/commit. Deixe todas as mudanças no working tree; o pipeline faz o commit.
    retry_prompt: |
      A tentativa anterior está no worktree, mas os checks falharam. Leia o código e corrija.
      ${checks.report}
    verify: { run: ci, max_attempts: 3 }

  - id: simplify                   # inclua só se houver um 2º agente barato
    type: agent
    agent: codex
    effort: low
    clear_context: true
    mode: agent                    # dialeto do codex (não acceptEdits!)
    prompt: |
      /devy:code-simplify Simplifique o que está no worktree sem alterar comportamento.
      **CRITICAL**: NÃO rode git add/commit.
      Diff atual:
      ${worktree.diff}
    verify: { run: ci, max_attempts: 3 }

  - id: review
    type: agent
    clear_context: true
    # SEM `mode: plan` (G1) — read-only é imposto pelo prompt.
    # Com codex como revisor, `mode: read-only` é seguro e preferível.
    prompt: |
      /devy:review Reveja a implementação da task ${task.id} contra ${inputs.spec} e ${inputs.plan}.
      **CRITICAL:** NUNCA EDITE NADA — revisão é read-only.
      Diff sob revisão:
      ${worktree.diff}
      Responda na ÚLTIMA linha exatamente "REVIEW: PASS" ou "REVIEW: FAIL: <motivo>".
    expect: "REVIEW: PASS"
    on_fail: { goto: implement }   # fix-loop; teto = max_step_visits

  - id: commit
    type: shell
    run:
      - git -C "${worktree.path}" add -A -- .
      - 'git -C "${worktree.path}" commit --allow-empty -m "feat(${task.id}): ${task.title}"'

  - id: merge
    type: approval
    prompt: "Aprovar merge da task ${task.id} (${task.title}) em ${workspace.parent_branch}?"
    run:
      - 'git -C "${workspace.root}" merge --no-ff "${task.branch}" -m "merge(${task.id}): ${task.title}"'
    on_fail: escalate

  - id: cleanup
    type: shell
    always: true                   # roda mesmo com o pipeline falho
    run:
      - sh scripts/loopy-cleanup.sh "${workspace.root}" "${worktree.path}" "${task.branch}"

stop_conditions:
  max_iterations: 25
  max_step_visits: 10
  stop_signal_file: ".loopy.stop"

concurrency: auto
max_concurrency: 3

policies:
  escalation:
    action: pause
    keep_worktree: true
    notify: stderr
  git:
    require_clean_parent: true
    on_merge_conflict: escalate

logging:
  dir: ".loopy/logs"
  per_task: true
  capture_acp_traffic: true

metrics: {}
```

## Wrapper de cleanup idempotente (G5)

Grave em `scripts/loopy-cleanup.sh` do alvo (e commite). Argv sem shell não
tem `|| true`, e `worktree remove` re-executado num resume explode com
"not a working tree" → pause permanente:

```sh
#!/bin/sh
# loopy-cleanup.sh <root> <worktree-path> <branch> — idempotente por design.
root="$1"; wt="$2"; branch="$3"
if [ -d "$wt" ]; then
  git -C "$root" worktree remove --force "$wt" || true
fi
git -C "$root" worktree prune
if git -C "$root" show-ref --verify --quiet "refs/heads/$branch"; then
  git -C "$root" branch -D "$branch" || true
fi
exit 0
```

## Tabela de gotchas (por que o template é assim)

| # | Gotcha | Consequência se ignorado | Mitigação no template |
| --- | --- | --- | --- |
| G1 | Step com `expect:` + `mode: plan` (claude) perde o Verdict | O veredito sai no artefato de plan, que o motor **não bufferiza** → expect avalia "ausente" → falha falsa | Review sem `mode: plan`; read-only via prompt. Codex revisor pode usar `mode: read-only` (é permissão, não plan). |
| G2 | Agentes auto-commitam apesar do pipeline ter step de commit | `git commit` do step sai 1 (árvore limpa) → falha falsa | Proibição explícita no prompt **+** `--allow-empty` no commit (cinto e suspensório). |
| G3 | Pathspec de exclusão (`:!dir`) sobre dir gitignorado | Warning "ignored paths" + exit 1 no step de commit | `git add -A -- .` puro; exclusões vêm do `.gitignore`. |
| G4 | `checks`/`shell` rodam argv **sem shell** | `&&`, pipes, `test -f` viram argumentos literais → erro opaco | Um comando por entrada; composição vai em script npm/sh do alvo. |
| G5 | Cleanup não-idempotente envenena o resume | Crash no/pós cleanup → resume re-roda `worktree remove` → exit 128 → pause permanente + dependentes pulados | Wrapper `loopy-cleanup.sh` idempotente. |
| G6 | `npm ci` sem lockfile | install-deps falha em todo worktree | Preflight exige lockfile commitado (ou troca para `npm install`). |
| G7 | Tasks paralelas no mesmo arquivo sem `Deps:` | Conflito real de merge; `rebase` re-colide idêntico → pause | Análise de colisão na Fase 3; `Deps:` serializa. |
| G8 | Linha `Deps:` com texto após os ids | Última dep engolida (D-0001) → DAG achata → paralelismo indevido | Validar/normalizar linhas `Deps:` isoladas. |
| G9 | Lint de repo-inteiro tocando `.claude/`/`.worktrees/` | Tasks concorrentes "corrigem" o harness → conflito de merge | Preflight: lint ignora ambos os dirs. |
| G10 | `todo.md` como documento (`###`) em vez de checklist | 0 tasks parseadas | Fase 3 valida markers + `task_id_pattern` derivado do arquivo real. |
| G11 | `mode`/`effort` chutados sem sondagem | Dialeto é por-agente e por-versão; valor inválido falha em runtime | Preflight roda `probe-agent`; yml só usa valores anunciados. |

## Variações

- **Um agente só**: remova `simplify`; o mesmo agente implementa e revisa
  (mantenha `clear_context: true` no review — contexto limpo é o que resta de
  independência).
- **Entrega sem testes ainda** (greenfield): comece com checks mínimos
  (typecheck) e deixe o step de implement criar os testes; não invente
  `npm test` que não existe.
- **Backlog sem `Deps:`**: o DAG é plano e `auto` = `max_concurrency`. Se a
  análise de colisão apontar risco, proponha `Deps:` ou `concurrency: 1`.
- **Merge com conflito esperado** (tasks tocando arquivos vizinhos):
  `on_merge_conflict: rebase` resolve replay simples; conflito real ainda
  escala — é o comportamento desejado.
