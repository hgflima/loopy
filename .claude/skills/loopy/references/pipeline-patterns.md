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

  # --- Merge pessimista (G12/G13) -------------------------------------------
  # O merge NUNCA é tentado direto no root. Primeiro integra-se o parent DENTRO
  # do worktree — o único lugar que o agente enxerga — e só então o root recebe
  # um merge que já é trivial. Ver a explicação abaixo do template.

  - id: reconcile-parent
    type: shell
    parallel_safe: true            # não muta o parent → fora do mutex
    run:
      - 'git -C "${worktree.path}" merge --no-edit "${workspace.parent_branch}"'
    on_success: { goto: merge }    # integrou limpo → pula a resolução
    on_fail: { goto: resolve-merge }

  - id: resolve-merge
    type: agent
    clear_context: true
    mode: acceptEdits
    prompt: |
      O merge de ${workspace.parent_branch} no worktree parou com conflito.
      Resolva os markers SEMANTICAMENTE — entenda as duas intenções e produza o
      código que satisfaz ambas; não escolha um lado por preguiça.
      **CRITICAL**: NÃO rode git add, git commit nem git merge --continue. Deixe
      os arquivos resolvidos no working tree; o pipeline finaliza o merge.
      ${checks.report}
    verify: { run: ci, max_attempts: 3 }
    on_fail: escalate              # agent com on_fail exige verify ou expect

  - id: finalize-merge
    type: shell
    run:
      - 'git -C "${worktree.path}" add -A -- .'
      - 'git -C "${worktree.path}" commit --no-edit'   # merge commit: nunca vazio

  - id: merge
    type: approval
    prompt: "Aprovar merge da task ${task.id} (${task.title}) em ${workspace.parent_branch}?"
    run:
      - 'git -C "${workspace.root}" merge --no-ff "${task.branch}" -m "merge(${task.id}): ${task.title}"'
    on_fail: { goto: abort-root-merge }   # NUNCA escalate: escalaria SUJO (G13)
    on_success: { goto: cleanup }  # OBRIGATÓRIO: sem ele o PC cairia no abort (G14)

  - id: abort-root-merge           # só alcançável pelo goto do `merge`
    type: shell                    # SEM parallel_safe → roda na Seção crítica
    run:
      - 'git -C "${workspace.root}" merge --abort'
    on_success: { goto: reconcile-parent }  # ciclo intencional; teto = max_step_visits

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

## Por que o merge é pessimista (G12/G13)

O caminho ingênuo — `merge` no root com `on_fail: escalate`, ou pior,
`on_fail: { goto: <step de agente> }` — **não funciona**, por duas razões que só
aparecem rodando:

**1. O agente não enxerga o root.** Um Step de Agente roda sempre no worktree da
task: o cwd da Sessão ACP é **imutável** (AD-3), a sessão é keyed por
`${agent}::${worktree}`, e não existe campo `cwd` no schema do step (`.strict()`
rejeita). Um conflito deixado por `git merge` no parent fica no working tree do
**root** — invisível para ele. Por isso a integração acontece **dentro** do
worktree, antes: é o único lugar onde o agente pode resolver qualquer coisa.

**2. `escalate` num merge conflitado escala SUJO, e a falha cascateia.** O
`git merge` que conflitou deixa `MERGE_HEAD` e arquivos unmerged no root. A
próxima task-irmã que chega no seu step de merge bate em
`exit 128 — "Merging is not possible because you have unmerged files"` e também
pausa. Uma task quebrada derruba as vizinhas. Foi o que aconteceu no run da
C-0009: a T-018 conflitou em `App.tsx` e levou a T-014 junto.

Daí o `abort-root-merge`: ele restaura o root limpo (mata a cascata) e volta ao
`reconcile-parent`, que re-integra o parent **atual** — porque entre o reconcile
e o merge uma task-irmã pode ter merjado, e é exatamente essa janela que faz o
merge "trivial" conflitar de novo. Ele **não** é `parallel_safe`: precisa da
Seção crítica. O ciclo `abort-root-merge → reconcile-parent → merge` converge
porque os merges são serializados, e `max_step_visits` é o backstop.

Com `concurrency: 1` o `reconcile-parent` costuma ser um no-op barato e o
`abort-root-merge` quase nunca dispara — mas a skill propõe `concurrency: auto`,
então trate os cinco steps como o default, não como um extra.

### Recuperação manual de tasks pausadas nesse estado

Se um run antigo (ou um yml otimista) já pausou com o root sujo:

1. Resolver/completar o merge em progresso no root — ou `git merge --abort`.
2. Para cada task-irmã pausada: `git -C <worktree> merge main`, resolver,
   commitar, e então `git merge --no-ff <branch>` no root.
3. Marcar `- [x]` no `todo.md`.
4. `git worktree remove --force <wt>` + `git branch -D <branch>`.

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
| G12 | `on_fail: { goto: <agente> }` no step de merge do **root** | O cwd da Sessão é imutável no worktree (AD-3): o conflito fica no working tree do root, **invisível** ao agente → ele "resolve" o nada e o merge segue quebrado | Integrar o parent **dentro** do worktree antes (`reconcile-parent` → `resolve-merge` → `finalize-merge`); o merge no root só acontece já trivial. |
| G13 | `on_fail: escalate` num `git merge` conflitado | Escala **sujo**: `MERGE_HEAD` + arquivos unmerged ficam no root, e a próxima task-irmã bate em exit 128 e pausa também — uma task derruba as vizinhas (C-0009: T-018 levou a T-014) | `on_fail: { goto: abort-root-merge }`; o abort restaura o root e volta ao `reconcile-parent`, que re-integra o parent **atual**. |
| G14 | Step de recuperação declarado **depois** do step que o invoca, sem `on_success` no invocador | Omitir `on_success` = seguir a ordem declarada: o `merge` que deu **certo** cairia no `abort-root-merge` e rodaria `git merge --abort` sem merge em progresso → exit ≠ 0 → escalate no caminho feliz | `merge` leva `on_success: { goto: cleanup }`; todo step só-alcançável-por-goto exige que o anterior declare para onde vai no sucesso. |

## Variações

- **Um agente só**: remova `simplify`; o mesmo agente implementa e revisa
  (mantenha `clear_context: true` no review — contexto limpo é o que resta de
  independência).
- **Entrega sem testes ainda** (greenfield): comece com checks mínimos
  (typecheck) e deixe o step de implement criar os testes; não invente
  `npm test` que não existe.
- **Backlog sem `Deps:`**: o DAG é plano e `auto` = `max_concurrency`. Se a
  análise de colisão apontar risco, proponha `Deps:` ou `concurrency: 1`.
- **Merge**: os cinco steps do template já são o caminho resiliente; não os
  substitua por `on_merge_conflict: rebase`. A policy só faz **replay
  automático** e para no primeiro conflito de conteúdo — ela não resolve nada
  semanticamente, e duas tasks que mexeram na mesma região colidem idêntico no
  replay. Deixe-a em `escalate` (o default) e confie no `resolve-merge`.
- **Pipeline mínimo** (`concurrency: 1`, uma task por vez, sem irmãs): os cinco
  steps continuam corretos e baratos — `reconcile-parent` vira no-op quando o
  worktree já está atualizado. Removê-los é uma economia de ~15 linhas de yml
  em troca de perder a resolução semântica na primeira vez que o humano commitar
  no parent durante o run.
