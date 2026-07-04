# loopy — motor de loop agêntico config-driven via ACP

## Purpose & Scope
CLI TypeScript/Node que roda um **loop agêntico de dois níveis** sobre um diretório local, dirigindo um **agente de código via ACP** até concluir um backlog de tasks. O diferencial e invariante central: `loopy` é um **motor genérico que interpreta o `loopy.yml`** — não tem pipeline hardcoded. Para cada task pendente, executa o `pipeline` declarado (tipicamente: worktree isolado → agente implementa até os checks passarem → simplifica → audita read-only → commita → merge com aprovação humana → limpa), mostrando tudo numa TUI Ink.

**NÃO** é: uma lib de agente, um wrapper de um pipeline fixo, nem um harness que decide *o que* fazer — decide só *a mecânica* de fazer o que o yml manda.

## Entry Points & Contracts
- `loopy [dir]` → `src/index.ts` (`run()` exportado + testável). Lê `loopy.yml` + inputs (`spec.md`/`plan.md`/`todo.md`), seleciona tasks pendentes do backlog, roda o loop externo.
- Flags-chave: `--dry-run` (resolve+imprime o pipeline, zero escrita), `--task <id>` (roda uma task isolada, avisa sobre pendentes anteriores), `--clean [id]` (teardown worktree+branch+checkpoint), `--yes` (auto-aprova gates), `--no-tui`, `--verbose`.
- Contrato congelado de tipos: `src/types.ts` (`Step`/`StepContext`/`StepResult`/`LoopyConfig` + ports). É declaration-only; sua corretude é provada por `tsc --noEmit`.

## Usage Patterns
Dev do próprio loopy: `npm run dev -- [args]` (tsx). Qualidade: `npm run typecheck`, `npm run lint`, `npm test` (vitest). Build: `npm run build` (tsup → `dist/`). O exemplo canônico do config vive em `examples/loopy.yml` (carregado pelos testes de aceite e de `config/load`); `tests/fixtures/project/loopy.yml` é o fixture usado pelos testes de CLI.

Stack: `@agentclientprotocol/sdk`, `commander`, `execa`, `ink`+`react`, `yaml`, `zod`. Node ≥20, ESM (`"type": "module"`).

## Anti-patterns
- **Nunca hardcodar comportamento de loop no motor** (AD-1): steps, ordem, prompts, comandos, modo/autonomia, retries, escalação e gates são 100% do `loopy.yml`. Trocar o que o loop faz = editar o yml.
- Não editar o `parent_branch` diretamente: cada task vive num worktree isolado.
- Não deixar merge passar com checks falhando ou `AUDIT: FAIL` (verdict é fail-closed).
- Não passar dado interpolado para um shell (`shell` roda argv sem shell — ver `src/steps/`).

## Dependencies & Edges
Intent nodes filhos (siga para o detalhe):
- `src/config/CLAUDE.md` — validação zod do `loopy.yml`.
- `src/loop/CLAUDE.md` — orquestrador (loop externo) + dry-run + escopo.
- `src/steps/CLAUDE.md` — os 4 primitivos e o registry (AD-2).
- `src/acp/CLAUDE.md` — ponte ACP: processo, sessões, permission/fs/terminal (AD-3).
- `src/tui/CLAUDE.md` — renderer Ink + fallback de linha.
- Módulos de apoio (sem node próprio): `src/interp/` (interpolação `${...}`), `src/checks/` (runner de checks), `src/git/` (worktree/merge), `src/backlog/` (parse do todo.md), `src/resume/` (checkpoint `.loopy/state.json`), `src/logging/`.

Docs: `SPEC.md` (spec completa), `README.md`, ADRs em `docs/adrs/`. **`CONTEXT.md` é o glossário da linguagem ubíqua** — a fonte canônica dos termos do domínio (resumidos abaixo); consulte-o antes de nomear conceitos.

## Linguagem ubíqua (glossário — resumo de `CONTEXT.md`)
O motor **interpreta** estas palavras, então cada uma tem um único significado. Use o termo canônico; os clusters abaixo são os que mais se confundem — não os intercambie.

- **Motor** (interpreta o yml, fixo) × **Configuração** (o que o loop faz, no `loopy.yml`) × **Run** (uma execução inteira; 1 Agente ACP por Run).
- **Loop externo** (itera Tasks do Backlog; contador = **Iteração**, teto `max_iterations`) × **Loop interno** (o Verify de um Step de Agente; contador = **Tentativa**, teto `max_attempts`). Nunca troque Iteração ↔ Tentativa.
- **Pipeline** = lista ordenada de **Steps** aplicada a cada Task. Quatro tipos: Step de **Agente** / **Shell** / **Checks** / **Aprovação**. Diga "Step de Agente" (turno de conversa), não "o agente".
- Cluster de verificação: **Check** (um comando) → **Lista de checks** (nomeada, ex. `ci`) → **Verify** (loop de retry sobre checks, mecânica) × **Expect** (condição textual, ex. `AUDIT: PASS`) × **Verdict** (o conteúdo julgado que o Agente emite) × **Report** (`checks.report`, saída agregada). **Audit** = Step de Agente em Modo plan (read-only) que só emite Verdict.
- **Plan** (documento `plan.md`, o "como") × **Modo plan** (autonomia ACP read-only). Nunca escreva "plan" sozinho para o modo.
- **Agente** (o subprocesso; 1 por Run) × **Sessão** (conversa ACP presa a um Worktree, cwd imutável, 1 por Task). **Modo** = autonomia da Sessão (`acceptEdits`/`plan`/…).
- **Worktree** (`.worktrees/<id>/`, onde o Agente edita) × **Parent branch** (destino do Merge, limpa entre Tasks, contém o **Harness** `.claude` commitado).
- **on_fail** = a Ação em falha unificada de um Step (uma chave só; nomes antigos `on_expect_fail`/`on_conflict`/`verify.on_fail` foram unificados). **`escalate`** é o sinal; **Escalonamento** (`pause`/`skip_task`/`abort_loop`) é a política.
- **Gate** sempre qualificado: Gate de Aprovação (humano, no Merge) × Gate de veredito (Expect). **Stop signal** (`.loopy.stop`) encerra a Run após a Task corrente.
- **Artefato** = saída de runtime no projeto-alvo (Worktrees, logs, Stop signal), sempre gitignored. **Interpolação** (`${…}`) resolve vars conhecidas por Task/Tentativa; var desconhecida aborta fail-fast.

## Patterns & Pitfalls
Decisões arquiteturais que atravessam todo o código (definidas nos docstrings; citadas por nome nos filhos):
- **AD-1 — config-driven**: motor interpreta, não decide. Nenhum comportamento de loop no código.
- **AD-2 — inversão de dependência**: registry `type → interpreter`; `type` sem intérprete é pulado (no-op), não falha.
- **AD-3 — um processo ACP por run, N sessões**: uma sessão por task/worktree; cwd imutável por sessão.
- **AD-4 — `StepContext` + interpolação por task/attempt**: `buildScopeVars` é a fonte única do escopo (dry-run e run vivo resolvem strings idênticas).
- **AD-5 — erros como valores nas fronteiras de step**: intérpretes retornam `ok:false`; exceções só para faltas genuínas.
- **AD-6 — funções puras onde dá**: verdict, planner do dry-run e a view da TUI são puros e testáveis isolados.

**Artefatos de um run vivem no repo-ALVO, não neste repo**: worktrees (`.worktrees/`), branches, `todo.md`, `.loopy/state.json` e logs são criados no diretório-alvo passado para `loopy`. Ao investigar "sumiu/não existe", olhe lá.
