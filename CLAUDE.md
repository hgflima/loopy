# loopy — motor de loop agêntico config-driven via ACP

## Purpose & Scope
CLI TypeScript/Node que roda um **loop agêntico de dois níveis** sobre um diretório local, dirigindo **agentes de código via ACP** até concluir um backlog de tasks. O diferencial e invariante central: `loopy` é um **motor genérico que interpreta o `loopy.yml`** — não tem pipeline hardcoded. Para cada task pendente, executa o `pipeline` declarado (tipicamente: worktree isolado → agente implementa até os checks passarem → simplifica → audita read-only → commita → merge com aprovação humana → limpa), mostrando tudo numa TUI Ink — ou, sob `--emit-events`, numa **GUI nativa** (`apps/menubar/`) que roda o motor como sidecar.

**NÃO** é: uma lib de agente, um wrapper de um pipeline fixo, nem um harness que decide *o que* fazer — decide só *a mecânica* de fazer o que o yml manda.

## Entry Points & Contracts
- `loopy [dir]` → `src/index.ts` (`run()` exportado + testável). Lê `loopy.yml` + inputs (`spec.md`/`plan.md`/`todo.md`), monta o DAG das tasks pendentes, roda o loop externo.
- Flags (todas em `src/index.ts`; referência completa em `docs/reference/cli.md`): `--dry-run` (resolve+imprime o pipeline e o DAG, zero escrita), `-t, --task <id>` (roda uma task isolada — **força `concurrency=1`**), `--clean [id]`, `-y, --yes`, `--concurrency <n>` e `--max-iterations <n>` (**sobrepõem o yml**), `-c, --config <path>`, `--emit-events` (stdout vira canal NDJSON, texto vai pro stderr — ADR-0007), `--no-tui`, `--verbose`.
- Contrato congelado de tipos: `src/types.ts` (`Step`/`StepContext`/`StepResult`/`LoopyConfig` + ports). É declaration-only; sua corretude é provada por `tsc --noEmit`.
- **Segundo contrato público**: **5 subpath exports** (buildados com `dts` — ver `tsup.config.ts`), que são a API que a GUI consome: `@hgflima/loopy/tui/{store,view,transport}` (estado, apresentação pura, frames NDJSON) + **`@hgflima/loopy/config`** e **`@hgflima/loopy/backlog`** (parse/serialize do `loopy.yml` e do `todo.md`, usados pelo editor visual). Mudar a shape de um `StoreEvent`, de um frame ou desses barrels quebra `apps/menubar/` em tempo de build.
- **Invariante browser-safe**: os barrels `config` e `backlog` rodam no browser. `node:fs` vive **só** em `src/config/load.ts` e `src/backlog/todo.ts`; `parse.ts`/`schema.ts`/`serialize.ts` de ambos são puros. Importar `node:fs` fora desses dois arquivos quebra o build Vite do app.

## Usage Patterns
Dev do próprio loopy: `npm run dev -- [args]` (tsx). Qualidade: `npm run typecheck` (cobre a raiz **e** o menubar), `npm run lint`, `npm test` (vitest). Build: `npm run build` (tsup → `dist/`). GUI: `npm run menubar`. O exemplo canônico do config vive em `examples/loopy.yml`; `tests/fixtures/project/loopy.yml` é o fixture dos testes de CLI.

⚠️ **`npm test` na raiz NÃO roda os testes do `apps/menubar`** (o `include` da raiz é `tests/**`). Para o app: `npm test -w apps/menubar`.

**Monorepo**: `workspaces: ["apps/*"]` — a raiz **não** é workspace (o app resolve o motor por alias para `../../src`, não pelo pacote publicado; ver `apps/menubar/CLAUDE.md`).

Stack: `@agentclientprotocol/sdk`, `commander`, `execa`, `ink`+`react`, `@dagrejs/dagre` (layout do grafo), `yaml`, `zod`. Node ≥20, ESM (`"type": "module"`).

## Anti-patterns
- **Nunca hardcodar comportamento de loop no motor** (AD-1): steps, ordem, prompts, comandos, modo/autonomia, retries, escalação e gates são 100% do `loopy.yml`. Trocar o que o loop faz = editar o yml.
- Não editar o `parent_branch` diretamente: cada task vive num worktree isolado.
- Não deixar merge passar com checks falhando ou `AUDIT: FAIL` (verdict é fail-closed).
- Não passar dado interpolado para um shell (`shell` roda argv sem shell — ver `src/steps/`).

## Dependencies & Edges
Intent nodes filhos (siga para o detalhe):
- `src/config/CLAUDE.md` — validação zod do `loopy.yml` (e o que ela **não** pega).
- `src/loop/CLAUDE.md` — orquestrador (loop externo), mutex do parent, scheduler/DAG, dry-run e escopo.
- `src/steps/CLAUDE.md` — os 4 primitivos e o registry (AD-2).
- `src/acp/CLAUDE.md` — ponte ACP: pool de processos, sessões, permission/fs/terminal (AD-3).
- `src/tui/CLAUDE.md` — renderer Ink, fallback de linha **e a camada pública store/view/transport**.
- `src/metrics/CLAUDE.md` — instrumentação opt-in (tempo/tokens/custo), rollup e relatórios (ADR-0003).
- `apps/menubar/CLAUDE.md` — a **GUI nativa** (Tauri v2 + React): roda o motor como sidecar NDJSON (ADR-0007).
- Módulos de apoio (sem node próprio): `src/scheduler/` (DAG puro: `buildGraph`/`readySet`/`skipDescendants`/`topoLayers` — documentado no node do loop), `src/interp/` (interpolação `${...}`), `src/checks/` (runner de checks — **e a política de truncagem que decide o que entra no prompt**), `src/git/` (worktree/merge/rebase), `src/backlog/` (parse do `todo.md`: **fonte das arestas do DAG e do nome da branch**), `src/resume/` (checkpoint `.loopy/state.json`), `src/logging/` (inclui o log de Tráfego ACP).

Docs: `README.md`, docs em Diataxis — `docs/tutorials/`, `docs/how-to/`, `docs/reference/` (`cli.md`, `configuration.md`, `backlog.md`, `interpolation.md`) — e ADRs em `docs/adrs/` (0001 `on_fail` unificado · 0002 goto/`on_success`/`max_step_visits` · 0003 métricas · 0004 concorrência N/DAG · 0005 dashboard Ink + emit seam · 0006 multi-agente ACP · 0007 Transport NDJSON duplex). **`CONTEXT.md` é o glossário da linguagem ubíqua** — a fonte canônica dos termos do domínio (resumidos abaixo); consulte-o antes de nomear conceitos.

## Linguagem ubíqua (glossário — resumo de `CONTEXT.md`)
O motor **interpreta** estas palavras, então cada uma tem um único significado. Use o termo canônico; os clusters abaixo são os que mais se confundem — não os intercambie.

- **Motor** (interpreta o yml, fixo) × **Configuração** (o que o loop faz, no `loopy.yml`) × **Run** (uma execução inteira; 1 Processo de Agente por Agente referenciado — ADR-0006).
- **Loop externo** (itera Tasks do Backlog; pool de N Sessões dirigido pelo **Scheduler**, teto `concurrency`) × **Loop interno** (o Verify de um Step de Agente; contador = **Tentativa**, teto `max_attempts`). **Visita** = cada entrada num Step pelo PC (teto `max_step_visits`). **Iteração** desacoplou sob paralelismo (ADR-0004): `${iteration}` = índice estável no backlog (AD-4); `max_iterations` = contador separado ("Tasks iniciadas"). Nunca troque Iteração ↔ Tentativa ↔ Visita.
- **Pipeline** = lista ordenada de **Steps** aplicada a cada Task; a ordem declarada é o default, mas **Desvios** (`on_fail: { goto }` / `on_success: { goto }`) sobrepõem-na, saltando para um Step pelo `id` — o Pipeline vira um grafo dirigido navegado por um **Program counter** (PC). Quatro tipos: Step de **Agente** / **Shell** / **Checks** / **Aprovação**. Diga "Step de Agente" (turno de conversa), não "o agente".
- Cluster de verificação: **Check** (um comando) → **Lista de checks** (nomeada, ex. `ci`) → **Verify** (loop de retry sobre checks, mecânica) × **Expect** (condição textual, ex. `AUDIT: PASS`) × **Verdict** (o conteúdo julgado que o Agente emite) × **Report** (`checks.report`, saída agregada). **Audit** = Step de Agente em Modo plan (read-only) que só emite Verdict.
- **Plan** (documento `plan.md`, o "como") × **Modo plan** (autonomia ACP read-only). Nunca escreva "plan" sozinho para o modo.
- **Agente** (perfil nomeado no **Registry de Agentes** `agents:`) × **Processo de Agente** (subprocesso adapter stdio, 1 por Agente referenciado, eager) × **Sessão** (conversa ACP presa a um `(Agente, Worktree)`, cwd imutável; uma Task pode ter N Sessões se usa N Agentes). **Modo** = autonomia da Sessão (`acceptEdits`/`plan`/…). **Model** = modelo por Step (best-effort). **Effort** = reasoning effort por Step (best-effort, por-Agente — no-op + log se o adapter não suporta). (ADR-0006.)
- **Worktree** (`.worktrees/<id>/`, onde o Agente edita) × **Parent branch** (destino do Merge, limpa entre Tasks, contém o **Harness** `.claude` commitado).
- **on_fail** = a Ação em falha unificada de um Step (uma chave só): `escalate` (default — dispara **Escalonamento**: `pause`/`skip_task`/`abort_loop`) **ou** `{ goto: <step-id> }` (**Desvio** — salta para o alvo em vez de escalar). Em Step `agent`, `on_fail` exige `verify` ou `expect`. **on_success** = `{ goto: <step-id> }` opcional em qualquer Step; omitir = sequencial.
- **Desvio** (_goto_) = salto do fluxo para outro Step por `id`. Ciclos permitidos (fix-loop); limitados por **`max_step_visits`** (default 10, fail-closed → escalate). Cada entrada num Step conta uma **Visita**; exceder o teto escala sem executar.
- **Gate** sempre qualificado: Gate de Aprovação (humano, no Merge) × Gate de veredito (Expect). **Stop signal** (`.loopy.stop`) encerra a Run após a Task corrente.
- **Artefato** = saída de runtime no projeto-alvo (Worktrees, logs, Stop signal), sempre gitignored. **Interpolação** (`${…}`) resolve vars conhecidas por Task/Tentativa (`task.*`, `worktree.*`, `iteration`, `attempt`, `checks.report`, `inputs.*`, `workspace.*`, `change.*`); var desconhecida aborta fail-fast.
- **DAG de tasks** (ADR-0004): **Aresta de dependência** (`Deps:` no `todo.md` → `task.deps`) = "T-B só fica **Ready** quando T-A está **Done** (merjada)". **Grafo de tasks** = DAG acíclico (ciclo/Dep órfã → fail-fast). **Scheduler** = puro, computa o *ready set* — **não conhece Concorrência**: o teto é aplicado pelo orquestrador. Status: **Ready**/Running/**Done**/**Blocked**/**Skipped**/**Paused**/**Escalated** — mas cuidado: o status **de exibição** (evento `task_registered`) nasce `ready` quando a Task não tem deps, enquanto no mapa **do scheduler** *toda* Task começa `blocked` (é o `readySet` que promove). Distinto ainda do **`CheckpointStatus`** (`src/types.ts`), o status *estreito* que o resume persiste. **Seção crítica do parent** = mutex na camada de Steps (não no `GitPort`); wait de aprovação **fora**; `parallel_safe: true` = opt-out. **`on_merge_conflict`** = `escalate` (default) | `rebase`. **Cancelamento** = `session.cancel()` (sibling-safe); `child.kill()` só no timeout da parada dura.
- **Métricas** (opt-in, ADR-0003 — cluster distinto do de verificação): **Amostra** (medição de uma Visita) → **Agregado** por Step/Task/Run/Change. **Uso** = tokens por-turno (só Agente; somados) × **Custo** = valor cumulativo da Sessão, **nunca por-Step**; por Task é a **soma** das Sessões da Task (ADR-0006), por Run/Change é o último snapshot não-nulo. Ambos best-effort (`n/d`). **Relatório de execução** (stderr por Run) × **Relatório de change** (`index.md` ao zerar o backlog). **Change** = par derivado `{id,dir}` do path do `todo.md`, não conceito do motor.
- **Native UI / Transport** (ADR-0007): **Native UI** = a **GUI** macOS de menubar (`apps/menubar/`, Tauri + React) — entregue, e **fora do processo** do motor (não é um renderer alternativo do Ink). **Sidecar** = o processo `loopy --no-tui --emit-events <dir>` que a GUI spawna. **Transport** = o protocolo NDJSON duplex entre eles; **Frame** = uma linha, de três classes: `event` (wrapper de `StoreEvent`, motor→UI), `control` (`run_started`/`run_finished`/`approval_requested`) e `command` (`approval_decision`, UI→motor por stdin).

## Patterns & Pitfalls
Decisões arquiteturais que atravessam todo o código (definidas nos docstrings; citadas por nome nos filhos):
- **AD-1 — config-driven**: motor interpreta, não decide. Nenhum comportamento de loop no código.
- **AD-2 — inversão de dependência**: registry `type → interpreter`; `type` sem intérprete é pulado (no-op), não falha.
- **AD-3 — N Processos ACP por run (um por Agente referenciado), Sessões por `(Agente, Worktree)`** (ADR-0006 evoluiu: antes 1 processo/run; agora 1 por Agente referenciado, eager; cwd imutável por sessão).
- **AD-4 — `StepContext` + interpolação por task/attempt**: `buildScopeVars` é a fonte única do escopo (dry-run e run vivo resolvem strings idênticas).
- **AD-5 — erros como valores nas fronteiras de step**: intérpretes retornam `ok:false`; exceções só para faltas genuínas.
- **AD-6 — funções puras onde dá**: verdict, planner do dry-run e a view da TUI são puros e testáveis isolados.

**Artefatos de um run vivem no repo-ALVO, não neste repo**: worktrees (`.worktrees/`), branches, `todo.md`, `.loopy/state.json`, `.loopy/metrics.json`, o `index.md` do Relatório de change e logs são criados no diretório-alvo passado para `loopy`. Ao investigar "sumiu/não existe", olhe lá.
