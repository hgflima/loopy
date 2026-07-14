# loopy

O **loopy** é um motor de _agentic loop_ dirigido por configuração: ele lê um `loopy.yml` e conduz um agente de código (via ACP) sobre um backlog de tasks, aplicando a cada task um pipeline de steps em worktrees git isolados. Este glossário fixa a linguagem ubíqua do domínio — o motor interpreta essas palavras, então elas precisam ter um único significado.

## O motor e o loop

**Motor** (_engine_):
A parte fixa que interpreta o `loopy.yml`. Não contém comportamento de loop embutido — ordem, prompts, comandos e modos vêm todos da configuração (invariante AD-1).
_Avoid_: mecânica, plumbing, runtime

**Configuração**:
O comportamento do loop, definido inteiramente pelo usuário no `loopy.yml`. É o único lugar onde "o que o loop faz" existe.
_Avoid_: yml (quando referindo-se ao comportamento, não ao arquivo)

**Run**:
Uma execução completa do motor, do início ao esvaziamento do backlog (ou parada). Uma Run tem **um Processo de Agente por Agente referenciado** pelo Pipeline (ADR-0006).
_Avoid_: execução, sessão, invocação. (Reserve "Run" para a execução inteira; o campo `run:` de um Step é config, não este conceito.)

**Loop externo**:
O laço que itera as Tasks do Backlog em ordem, aplicando o Pipeline a cada uma. Seu contador é a Iteração.
_Avoid_: loop principal, outer loop

**Loop interno**:
O laço de Verify dentro de um Step de Agente: re-prompta em falha até passar ou esgotar tentativas. Seu contador é a Tentativa.
_Avoid_: retry loop, inner loop

## Backlog e entradas

**Backlog**:
A lista ordenada de Tasks pendentes que o Loop externo consome. Materializado no `todo.md` como checkboxes.
_Avoid_: fila, lista de tarefas, TODO list

**Task**:
Uma unidade de trabalho do Backlog (id `T-NNN`, título, corpo), processada isoladamente em seu próprio Worktree. Só é marcada concluída quando o Pipeline inteiro dela tem sucesso.
_Avoid_: item, ticket, tarefa, issue

**Spec**:
O documento de especificação (`SPEC.md`) — o "o quê" que a implementação deve satisfazer.

**Plan**:
O documento de plano (`plan.md`) — o "como" derivado da Spec. Distinto do **Modo plan** do Agente (ver _Modo_); nunca use "plan" sozinho para o modo.
_Avoid_: usar "plan" para o modo ACP read-only

**Todo**:
O arquivo (`todo.md`) que materializa o Backlog em checkboxes. Marcar `- [x]` é a única fonte de verdade de "Task concluída".

## Pipeline e steps

**Pipeline**:
A lista ordenada de Steps aplicada a cada Task. É "o loop em si", inteiramente definido na Configuração. A ordem declarada é o fluxo **default**; **Desvios** (`on_fail`/`on_success` com `{ goto }`) sobrepõem-na, navegando o Pipeline como grafo dirigido via Program counter.

**Step**:
Uma unidade do Pipeline, de um dos quatro tipos primitivos: Step de Agente, Step de Shell, Step de Checks e Step de Aprovação.
_Avoid_: passo, fase, stage

**Step de Agente** (`agent`):
Um Step que envia um turno ao Agente ACP. Pode ter Verify (loop interno) e/ou Expect (gate de veredito).
_Avoid_: "o agente" (isso é o processo — ver _Agente_)

**Step de Shell** (`shell`):
Um Step que roda comandos externos, em ordem.

**Step de Checks** (`checks`):
Um Step que roda uma Lista de checks nomeada de forma avulsa.

**Step de Aprovação** (`approval`):
Um Step que é um Gate humano: pausa por confirmação e então executa sua ação.

## Verificação

Cluster de conceitos próximos mas distintos — cada palavra tem um papel único; não os intercambie.

**Check**:
Um único comando do projeto-alvo que verifica o trabalho (ex.: typecheck, lint, test).
_Avoid_: teste, validação (para o comando individual)

**Lista de checks**:
Uma lista nomeada e reutilizável de Checks, declarada no bloco `checks:` (ex.: `ci`).
_Avoid_: suite

**Verify**:
O loop interno de um Step de Agente: roda uma Lista de checks após o prompt e, em falha, re-prompta com o Report até passar ou esgotar as Tentativas. É mecânica de retry sobre Checks — não é julgamento textual.
_Avoid_: verificação (ambíguo), validação

**Report** (`checks.report`):
A saída agregada e truncada de uma Lista de checks (exit codes + stdout/stderr), devolvida ao Agente na re-prompta.
_Avoid_: log, output

**Expect**:
O gate de veredito de um Step de Agente: a string que deve aparecer na saída do Agente (ex.: `AUDIT: PASS`) para o Pipeline continuar. Comparação textual — distinta de Verify.
_Avoid_: assert, gate (sozinho)

**Verdict** (veredito):
O resultado julgado que o Agente emite e o motor extrai por parse tolerante (ex.: `AUDIT: PASS` / `AUDIT: FAIL: <motivo>`). É o conteúdo; Expect é a condição sobre ele.
_Avoid_: resultado, julgamento, decisão

**Audit**:
Um Step de Agente em Modo plan (read-only) que apenas julga o diff contra Spec e Plan e emite o Verdict — nunca edita.
_Avoid_: revisão, review

## Git e isolamento

**Worktree**:
O diretório git isolado de uma Task (`.worktrees/<id>/`) onde o Agente edita. O parent nunca é editado diretamente.
_Avoid_: checkout, diretório de branch, sandbox

**Parent branch**:
A branch destino do Merge. Deve estar limpa entre Tasks e conter o Harness commitado.
_Avoid_: main, base, tronco

**Merge**:
A integração do Worktree de uma Task na Parent branch, atrás de um Gate de Aprovação (salvo `--yes`).

## ACP e contexto do agente

**ACP** (Agent Client Protocol):
O protocolo pelo qual o motor dirige os Agentes de código.

**Agente** (precisão — ADR-0006):
Um agente de código **nomeado** que o motor pode dirigir via ACP (ex.: `claude`, `codex`). É o *perfil/tipo* declarado no Registry de Agentes, não o subprocesso em si (esse é o **Processo de Agente**). Um Run pode usar **N Agentes**.
_Avoid_: modelo, LLM, assistente; e não use "agente" para o Step nem para o subprocesso (use Processo de Agente)

**Processo de Agente** (ADR-0006):
O subprocesso adapter stdio de **um** Agente nomeado (ex.: `codex-acp`, `claude-agent-acp`). **Um por Agente referenciado** pelo Pipeline, spawned **eager** no início do Run (conjunto referenciado é estático; Agentes não referenciados nunca sobem; falha de spawn = Run falha rápido). Hospeda N Sessões (AD-3 evoluído).
_Avoid_: agente (é o perfil, não o subprocesso), processo (sem qualificar)

**Registry de Agentes** (`agents:`, ADR-0006):
O mapa top-level `agents:` (nome → definição) resolvido/normalizado no `load`. Definição de Agente = `{ command, env?, model?, effort? }`. Fonte única do que o motor spawna e dos defaults de modelo/effort. `acp.command` legado sintetiza o Agente `default`. `agents:` e `acp.command` são mutuamente exclusivos.
_Avoid_: config de agente (colide com Configuração do loop)

**Agente default**:
O Agente usado por um Step `agent` que **omite** `agent:`. Vem de `acp.default_agent` (se declarado) ou do único Agente do Registry (quando há exatamente 1). Com >1 Agente sem `default_agent`, `agent:` é obrigatório em todo Step de agente.
_Avoid_: agente implícito, fallback

**Sessão** (precisão — ADR-0006):
Uma conversa ACP vinculada a um **`(Agente, Worktree)`**; seu diretório de trabalho é imutável (AD-3). Uma Task pode ter **mais de uma** Sessão se Steps distintos usam Agentes distintos — cada uma no seu Processo de Agente, todas com o mesmo cwd (o Worktree da Task). Sessões lazy por-`(Agente, Worktree)`.
_Avoid_: conexão, contexto

**Model** (ADR-0006):
O modelo do Agente para um Step (`model:`), aplicado via `session/set_config_option` (categoria `model`) / `session/set_model` (legado). String open-ended, repassada crua (AD-1). **Best-effort**: capability ausente → no-op + log.
_Avoid_: LLM, provedor

**Effort** (ADR-0006):
O reasoning effort do Agente para um Step (`effort:`), aplicado via config option (categoria `thought_level`/reasoning). String open-ended, repassada crua. **Best-effort e por-Agente** — Agente sem a capability (ex.: Claude) ⇒ no-op + log. Distinto de **Modo** (autonomia: `acceptEdits`/`plan`) e de **Model**.
_Avoid_: nível de raciocínio (use "effort" direto), intensidade

**Contexto fresco** (`clear_context`):
O princípio de zerar o histórico da conversa antes de um prompt, apoiado na ideia de que a memória vive no disco (Worktree, diff, Spec) — não na conversa.
_Avoid_: reset, limpar histórico

**Modo**:
A autonomia do Agente numa Sessão (`acceptEdits`, `plan`, `default`, …). **Modo plan** é read-only. Nunca abrevie para "plan" sozinho (colide com o documento Plan).
_Avoid_: permissão (é conceito distinto), nível

## Controle do loop

**Tentativa** (_attempt_):
O contador do Loop interno (uma re-prompta do Verify), limitado por `max_attempts`.
_Avoid_: try, retry, iteração. (A TUI mostra "try k/max", mas o termo canônico é Tentativa.)

**Stop condition**:
Uma condição que encerra o Loop externo ou escala uma Task: Backlog vazio, teto de Iterações, `max_step_visits` excedido (ver _Visita_), falha persistente, ou o Stop signal.
_Avoid_: critério de parada, término

**Stop signal** (`.loopy.stop`):
Um arquivo criado pelo operador que encerra a Run graciosamente após a Task corrente.
_Avoid_: kill, interrupção

**Gate**:
Um ponto de controle que bloqueia a continuação até uma condição ser satisfeita. Os Gates do domínio são: o Gate de Aprovação (humano, no Merge) e o Gate de veredito (Expect). Sempre qualifique qual.
_Avoid_: usar "gate" sem qualificar

**Aprovação** (_approval_):
Um Gate humano: o operador confirma antes de o motor prosseguir (ex.: o Merge). Contornável com `--yes`.
_Avoid_: confirmação, ok

**Ação em falha** (`on_fail`):
A ação declarada num Step para quando ele falha, qualquer que seja o modo de falha do seu tipo (Shell: exit ≠ 0; Agente: Verify esgotado ou Expect não satisfeito; Aprovação: conflito de Merge). Uma única chave por Step. Valor: `escalate` (default, dispara Escalonamento) **ou** `{ goto: <step-id> }` (Desvio — salta para o alvo em vez de escalar). Em Step `agent`, `on_fail` (seja `escalate` ou `{ goto }`) exige `verify` ou `expect` (senão a falha é inobservável — guard do ADR-0001 generalizado pelo ADR-0002).
_Avoid_: `on_expect_fail`, `on_conflict`, `verify.on_fail` (nomes antigos do mesmo conceito, unificados em `on_fail`)

**Ação em sucesso** (`on_success`):
A ação declarada num Step para quando ele tem sucesso. Valor: `{ goto: <step-id> }` — salta para o alvo em vez de seguir ao próximo Step. Omitir = sequencial (próximo Step). Mora em `StepBase` (universal a todo tipo de Step; sucesso é sempre bem-definido). Chave nova, adicionada pelo ADR-0002.
_Avoid_: next, redirect

**Desvio** (_goto_):
Um salto do fluxo do Pipeline para um Step identificado por `id`, disparado por `on_fail: { goto }` ou `on_success: { goto }`. Permite fluxo não-linear — ciclos intencionais (fix-loop) e saltos para frente. Validação estática rejeita alvo inexistente ou `id` duplicado; ciclos são limitados por `max_step_visits` (ver _Visita_).
_Avoid_: jump, branch, redirect

**Visita**:
Cada vez que o Program counter entra num Step, conta uma Visita. O total de Visitas por Step por Task é limitado por `max_step_visits` (fail-closed: exceder → escalate sem executar). É o guard de runtime contra loops infinitos.
_Avoid_: execução (ambíguo com Run), iteração (é o contador do Loop externo)

**Escalonamento** (_escalation_):
A política aplicada quando a Ação em falha de um Step é `escalate` (ou quando `max_step_visits` é excedido): `pause`, `skip_task` ou `abort_loop`, tipicamente preservando o Worktree. `escalate` é o sinal que o Step levanta; Escalonamento é o que a política faz com ele.
_Avoid_: falha, erro (para a política)

**Program counter** (PC):
O índice corrente no Pipeline durante a execução de uma Task. O motor mantém um `Map<id, índice>` e avança o PC conforme o resultado de cada Step: sucesso sem `on_success` → `PC += 1`; Desvio → `PC = stepIndex[goto]`; `PC` além do último Step → terminal sucesso; falha com `escalate` → terminal escalate. Substituiu o `for...of` linear (ADR-0002).
_Avoid_: cursor, ponteiro

**Concorrência** (_concurrency_):
O teto efetivamente respeitado pelo Scheduler para o paralelismo entre Tasks. Default `1` (sequencial); sem teto superior. `--concurrency N` sobrescreve. Com `concurrency: 1` + sem `Deps:` + `on_merge_conflict: escalate`, o comportamento é **byte-idêntico** ao `for...of` sequencial (regressão zero). (ADR-0004.)
_Avoid_: threads, workers

**Iteração** — precisão dupla sob paralelismo (ADR-0004):
- A **var `${iteration}`** = índice estável da Task na ordem de arquivo do Backlog (o que o dry-run já resolve). Determinística e **idêntica entre dry-run e run vivo** ⇒ preserva AD-4. Não é mais o contador de runtime.
- O **teto `max_iterations`** = contador de runtime separado, "Tasks **iniciadas** nesta Run". `skipped` não conta.
(Tentativa/Visita intra-Task intocados.)

## DAG de tasks e scheduling (ADR-0004)

Termos do paralelismo entre Tasks — distinto do fluxo intra-Pipeline (Desvio/`goto`/PC, que é entre Steps de **uma** Task). Introduzidos pelo ADR-0004.

**Aresta de dependência** (*dependency edge*):
"T-B depende de T-A", materializada na linha `Deps:` do `todo.md` e em `task.deps`. Semântica: **T-B só fica Ready quando T-A está Done (merjada no parent)**. Direção no grafo: `[from = dep, to = dependente]`. Pattern **configurável** via `inputs.backlog.deps_pattern` (default `Deps:` case-insensitive).
_Avoid_: link, relação, edge (sem qualificar)

**Grafo de tasks** (*task graph* / DAG):
Grafo dirigido **acíclico**; **nodes** = Tasks do Backlog **completo** (`done` + pendentes), **edges** = Arestas de dependência. Ciclo ou Dep órfã (id ausente do Backlog inteiro) ⇒ erro fail-fast (Run não inicia). Distinto do **flow graph de `goto`** (que é intra-Pipeline, entre Steps).
_Avoid_: pipeline graph, flow graph (esses são de Steps)

**Scheduler**:
Componente puro (AD-6) que, dado o Grafo e o mapa de status, computa o **conjunto pronto** (*ready set*) e escolhe as próximas a iniciar sob Concorrência. Desempate por ordem do Backlog (determinismo). O Scheduler **não** executa Steps (isso é do PC).
_Avoid_: orquestrador (é o módulo do Loop externo), planner (é o do `--dry-run`)

**Ready / Pronta**:
Task cujas Deps estão **todas** `done`. Desempate entre Prontas = ordem do Backlog.
_Avoid_: disponível, livre

**Blocked / Bloqueada**:
Task com ≥1 Dep não-`done` **e ainda alcançável** (nenhuma Dep falhou). Vira Ready quando a última Dep chega a `done`.
_Avoid_: travada, pendente (colide com o status de checkbox)

**Skipped / Pulada**:
Task cujo fecho de Deps contém uma que **não chegou a `done`**. Nunca ficará Ready; marcada e **não executada**. Derivada do Grafo + status, **não persistida** (recomputada no resume). Resultado do skip transitivo.
_Avoid_: ignorada, descartada

**Seção crítica do parent** (*parent critical section*):
Região serializada por um mutex único da Run que embrulha a **execução de comandos de todo Step não-Agente** (rodam contra o root) mais os ports `commitPaths`/`isParentClean`. **Não** mora no `GitPort` — vive na **camada de execução de Steps** (threaded via os seams do command-runner). O **wait de aprovação** do Merge acontece **fora** do mutex; a aquisição é só para a **execução de comandos**, com `require_clean_parent` reavaliado logo antes. O auto-rebase (quando `on_merge_conflict: rebase`) roda **dentro** dela. Step `parallel_safe: true` fica **fora**.
_Avoid_: lock, semáforo, região crítica (sem qualificar)

**`parallel_safe`**:
Campo aditivo de Step (default `false`) — opt-out declarativo da Seção crítica: o Step **não** toca o `.git` compartilhado e pode rodar em paralelo. O motor emite **Warning estático não-fatal** se um Step `parallel_safe` tiver argv que aparente mutar o parent (`git merge`/`commit`/`worktree`/`branch`/`push`, ou `-C ${workspace.root}`).
_Avoid_: thread-safe (conceito distinto)

**`on_merge_conflict`**:
Policy de git (`policies.git.on_merge_conflict`): `escalate` (default) | `rebase`. `rebase` = o motor faz `git rebase <parent>` + re-tenta o merge uma vez dentro do mutex antes de cair no `on_fail`. Config decide; mecânica é do motor (AD-1).
_Avoid_: conflict resolution (sem qualificar o mecanismo)

**Cancelamento** (*cancellation*):
`session.cancel()` (ACP `session/cancel`, por `sessionId`, sibling-safe, cooperativo). Na parada dura (`abort_loop`), `child.kill()` do processo do Agente é o **fallback de timeout** (a Run inteira encerra). Distinto do **Stop signal** (`.loopy.stop`, que encerra **após** a Task corrente). `child.kill()` **nunca** para abortar uma Task isolada.
_Avoid_: kill, interrupção (para o mecanismo cooperativo)

## Runtime

**Harness** (`.claude`):
A configuração do Agente que precisa estar commitada na Parent branch para alcançar cada Worktree.
_Avoid_: config do agente (ambíguo com a Configuração do loop)

**Artefato**:
Uma saída de runtime gerada no projeto-alvo — Worktrees, logs (`.loopy/logs/<id>.log`), o Stop signal. Todos ignorados pelo git.
_Avoid_: output, arquivo gerado

**Dry-run**:
O modo que resolve e imprime o Pipeline interpolado sem nenhuma escrita, commit ou merge.
_Avoid_: simulação, preview

**Interpolação** (`${…}`):
A substituição de variáveis conhecidas (`task.*`, `worktree.*`, `iteration`, `attempt`, `checks.report`, `inputs.*`, `workspace.*`, `change.*`) nos textos da Configuração, resolvida uma vez por Task/Tentativa. Variável desconhecida aborta (fail-fast).
_Avoid_: template, variável de ambiente

## Métricas (ADR-0003)

Instrumentação opt-in de tempo, tokens e custo por Step, acumulados em quatro níveis. Ativada pela presença do bloco `metrics` no `loopy.yml`; ausência = feature desligada (regressão zero). Não confundir estes termos com os do cluster de verificação (Report de checks, Verify, Tentativa).

**Amostra** (_Sample_):
A medição de **uma Visita** efetivamente executada a um Step: `{ durationMs, usage?, cost? }`. Unidade mínima de coleta. Steps não executados (visit-exceeded, sem intérprete) não geram Amostra. Um Step visitado N vezes numa Task gera N Amostras — todas somadas no rollup.
_Avoid_: medição (genérico), ponto de dados

**Uso** (_Usage_):
Tokens de **um turno ACP** (`input/output/cachedRead/cachedWrite/thought/total`), emitido **por-turno** pelo agente. Best-effort: pode ser `null` (⇒ `n/d`). Somado ao longo dos turnos de uma Visita → Uso por-Step. Só Steps de **Agente** têm Uso; Shell/Checks/Aprovação → `n/a`.
_Avoid_: consumo, tokens (sozinho — ambíguo com input/output/cached)

**Custo** (_Cost_):
Valor monetário **cumulativo da Sessão** (`amount` + `currency`), obtido via `usage_update` do ACP. Best-effort: pode ser `null` (⇒ `n/d`). Reportado a nível de **Task/Run/Change** (nunca por-Step — cumulativo impede rateio confiável). O rollup por Task toma o último snapshot não-nulo.
_Avoid_: preço, gasto; não confundir com Uso (tokens ≠ custo)

**Agregado** (_Rollup_):
Soma de Amostras num nível de contenção: **por Step** (Amostras de um `id` numa Task) → **por Task** (Σ Steps) → **por Run** (Σ Tasks da execução) → **por Change** (Σ Runs). Cada nível é um fold puro sobre o anterior.
_Avoid_: resumo, acumulado (quando não qualificado)

**Relatório de execução** (_Run report_):
Saída emitida ao fim de **cada Run** (stderr): breakdown por Step, subtotal por Task, total da Run e linha "Change até agora" (acumulado cross-run). Distinto do Report de checks (que é a saída de uma Lista de checks devolvida ao Agente).
_Avoid_: relatório (sozinho — colide com Report de checks), log

**Relatório de change** (_Change report_):
Artefato Markdown persistido no `index.md` (configurável via `metrics.report.index`) ao **finalizar a Change** — ou seja, quando o `todo.md` fica com 0 pendentes após a Run. Uma seção por Change (`## <change.id>`) com totais + tabela rica por Task. Reescrita byte-preserving (atualiza só a própria seção). Disparado por re-parse do todo.md, **nunca** por `stoppedBy`.
_Avoid_: index (sozinho — o index.md é o arquivo, não o conceito)

**Change**:
Termo do **devy**, adotado no motor **apenas** como par de valores de config derivados: `change.dir = dirname(inputs.todo)`, `change.id = basename(change.dir)`. O motor não tem lógica de change além de (a) interpolar `${change.*}` e (b) escrever onde o yml mandar. Quando `dirname` é `.`/vazio (backlog na raiz), `change.id` cai para `config.name`. (Cf. AD-1.)
_Avoid_: usar "change" como conceito do motor — é puramente derivado do path

## Dashboard e TUI de execução (ADR-0005)

O dashboard ao vivo do Run e o seam aditivo que o alimenta. A apresentação é **pura** em `view.ts` (AD-6) e o motor apenas **observa**: emitir um evento jamais altera o loop (AD-1) — `RunLoopResult` é byte-idêntico com e sem os seams. Não confundir estes termos com o cluster de verificação (Check/Verify/Tentativa/Visita) nem com Iteração.

**Dashboard**:
O layout **fixo** da TUI de execução: três Painéis simultâneos (Grafo, Tasks, Stream), todos vivos, sem foco nem navegação por teclado (a única entrada é o Gate de Aprovação). Distinto do **fallback de linha** (append-only, usado em no-TTY/`--no-tui`).
_Avoid_: tela, UI (genérico); "painel" (é o conjunto, não uma região)

**Painel** (_pane_):
Uma região do Dashboard com um recorte do estado do Run. Exatamente três: **Painel de Grafo** (o Grafo de tasks), **Painel de Tasks** (uma linha por Task, glyph+cor por status, step/try/checks quando `running`) e **Painel de Stream** (o Stream das Tasks `running`, ~3 mais recentes + contador `+K`). Um **Painel de Logs** (tail do Tráfego ACP) chegou a ser especificado e foi **removido**: cada chunk de texto virava um `session/update`, duplicando o Stream. O Tráfego ACP segue capturado — só não tem Painel.
_Avoid_: janela, aba; "view" (colide com `view.ts`); Painel de Logs (não existe)

**Painel de Grafo**:
A renderização do **Grafo de tasks** (ADR-0004) com layout computado por **dagre** (camadas Sugiyama, `rankdir:LR`): Tasks na mesma camada = candidatas a rodar em paralelo; arestas de dependência via os waypoints do dagre; cada nó colorido por `TaskStatus`; a Task `running` pulsa. Materialização visual do que era só dado em `StoreState.edges`.
_Avoid_: DAG na tela, diagrama

**GraphGeometry**:
A saída **pura e renderer-agnóstica** de `layoutGraph`: posição de cada nó (em célula) + os segmentos das arestas (dos `points[]` do dagre), em coordenadas inteiras de célula. É o **artefato durável** que `view.ts` rasteriza para ASCII hoje e que a Native UI reaproveita para desenhar no framebuffer — **toda** a matemática de layout mora aqui.
_Avoid_: layout (sozinho), coordenadas

**Native UI**:
A **GUI** macOS de menubar (`apps/menubar/`, Tauri + React) que observa e dirige um Run — **entregue** (ADR-0007). Não é um renderer alternativo dentro do processo: roda **fora**, como app, com o motor de **Sidecar**, e reaproveita `view.ts` + `store` via subpath exports. É o motivo de a geometria e o estilo viverem puros em `view.ts` (AD-6).
_Avoid_: OpenTUI, "TUI nativa" (a Native UI é uma GUI, não uma TUI)

**Pulso** (_pulse_):
A animação da Task `running`: alternância temporizada da ênfase do glyph no Painel de Grafo/Tasks. Pura em `view.ts` (`pulseFrame(tick)`); o relógio (`setInterval`) vive só no `.tsx`. **Só o Dashboard pulsa** (o fallback de linha, não).
_Avoid_: piscar, spinner, animação (genérico)

**Stream** (precisão):
O texto **legível** do que executa agora: `agent_message_chunk` do Agente (via `onUpdate`) **ou** `stdout`/`stderr` do Step `shell` (via `ctx.emit`), acumulado em `TaskState.stream` (evento `stream_chunk`). É o "o quê" produzido — distinto do Tráfego ACP (o "por baixo do capô").
_Avoid_: output, log; não confundir com Tráfego ACP

**Tráfego ACP** (_ACP traffic_):
As mensagens JSON-RPC **send/recv** entre motor e Agente (`AcpTrafficEntry { direction, method?, payload }`). O "por baixo do capô" do protocolo. Evento de store **`acp_traffic`**; buffer **bounded** (~200 linhas); captura gated por `--verbose`/`capture_acp_traffic`. **Não tem Painel** no Dashboard: vai para o log de arquivo (e para a store, que a Native UI consome).
_Avoid_: mensagens, protocolo; não confundir com Stream

**Emit seam** (_porta de progresso_):
O ponto onde o motor **emite** `StoreEvent`s de progresso. Materializado em **`OrchestratorDeps.emit(event)`** (transições de que o orquestrador é dono: `edges_set`, `task_*`, `step_*`) e **`StepContext.emit?(event)`** (eventos intra-Step: `attempt_started`, `check_started`/`check_finished`, `stream_chunk` do shell). **Aditivo**, no-op por omissão, **puro efeito de observação** — não altera o loop (AD-1) e roda fora da Seção crítica do parent.
_Avoid_: hook, dispatch (é o consumidor na store), callback (genérico)

**onTraffic**:
O callback de observação no boundary ACP (`OpenAgentOptions.onTraffic`) que capta o Tráfego send/recv e o roteia para **dois** consumidores: o arquivo (`TaskLogger.acp`) e a store (`acp_traffic`). Carimba `taskId` via o mapa `sessionId → taskId`. Observador puro — não altera o comportamento ACP.
_Avoid_: confundir com `onUpdate` (é o seam do **texto** do Agente, que vira Stream)

## Transport e Native UI (ADR-0007)

Como a GUI (fora do processo) conversa com o motor. Distinto do **Emit seam** (que é interno ao processo): o Transport é a **serialização** desses eventos para outro processo.

**Sidecar**:
O processo do motor spawnado **pela** Native UI: `loopy --no-tui --emit-events <dir>`. A GUI é a pai; o motor é o filho. Um Run por vez.
_Avoid_: backend, servidor, daemon (não escuta porta; é stdio)

**Transport**:
O protocolo **NDJSON duplex** entre motor e Native UI: uma linha JSON por mensagem, motor→UI pelo **stdout**, UI→motor pelo **stdin**. Sob `--emit-events`, o stdout é exclusivo do Transport (todo texto de log vai para stderr). Implementado em `src/tui/transport.ts`, publicado como subpath export.
_Avoid_: IPC, canal, socket (não há socket); "API" (não é RPC nem HTTP)

**Frame**:
Uma linha do Transport, discriminada pelo campo `frame`. Três classes: **`event`** (wrapper de um `StoreEvent` — o mesmo do Emit seam), **`control`** (fatos do Run que não são StoreEvent: `run_started`, `run_finished`, `approval_requested`) e **`command`** (a única direção UI→motor: `approval_decision`). Parse é **fail-soft** (linha inválida vira valor de erro, nunca exceção — AD-5).
_Avoid_: mensagem, payload, evento (solto — `event` é **uma** das três classes)
