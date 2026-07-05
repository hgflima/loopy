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
Uma execução completa do motor, do início ao esvaziamento do backlog (ou parada). Uma Run tem exatamente um processo de Agente ACP.
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
O protocolo pelo qual o motor dirige o Agente de código.

**Agente**:
O subprocesso de código que o motor dirige via ACP. Há um Agente por Run. Distinto do Step de Agente (que é um turno de conversa com este processo).
_Avoid_: modelo, LLM, assistente; e não use "agente" para o Step

**Sessão**:
Uma conversa ACP vinculada ao Worktree de uma Task; seu diretório de trabalho é imutável. Uma Sessão por Task.
_Avoid_: conexão, contexto

**Contexto fresco** (`clear_context`):
O princípio de zerar o histórico da conversa antes de um prompt, apoiado na ideia de que a memória vive no disco (Worktree, diff, Spec) — não na conversa.
_Avoid_: reset, limpar histórico

**Modo**:
A autonomia do Agente numa Sessão (`acceptEdits`, `plan`, `default`, …). **Modo plan** é read-only. Nunca abrevie para "plan" sozinho (colide com o documento Plan).
_Avoid_: permissão (é conceito distinto), nível

## Controle do loop

**Iteração**:
O contador do Loop externo (uma por Task processada), limitado por `max_iterations`.
_Avoid_: ciclo, rodada; não confunda com Tentativa

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
O grau de paralelismo entre Tasks. `1` (sequencial) no v1; o modelo de dados já é _parallel-ready_.

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
