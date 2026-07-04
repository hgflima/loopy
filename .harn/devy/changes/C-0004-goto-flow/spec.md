# Spec: Desvio de fluxo entre steps (`on_fail`/`on_success` → `goto STEP`)

> Feature spec derivada do `SPEC.md`-mãe do projeto e do glossário `CONTEXT.md`.
> **Estende** o `docs/adrs/0001-unificar-acao-em-falha-em-on-fail.md` (accepted):
> o ADR-0001 unificou "a ação em falha" numa única chave `on_fail` cujo único valor
> era `escalate`, e **previu explicitamente** que diferenciar/ampliar essa ação
> exigiria um novo ADR. Este é esse ADR (ADR-0002, a criar). Invariante mantido
> (AD-1): o motor é intérprete genérico; o fluxo é **config**, não comportamento
> hardcodado.

## Objective

Permitir **controle de fluxo não-linear** no `loopy.yml`. Hoje o Pipeline é uma
lista estritamente sequencial: cada Step avança para o próximo (`índice + 1`), e a
única forma de desvio é "após uma falha, pular os subsequentes não-`always` até o
teardown". Não há como **voltar** a um Step anterior nem **saltar** para um Step
adiante.

Esta feature adiciona duas ações de desvio, ambas com alvo = `id` de um Step
existente:

- **`on_fail: { goto: <step-id> }`** — em falha do Step, salta para `<step-id>` em
  vez de escalar. Amplia o `on_fail` de hoje (`escalate`) para
  `escalate | { goto }`.
- **`on_success: { goto: <step-id> }`** — em sucesso do Step, salta para
  `<step-id>` em vez de seguir ao próximo. Chave **nova**.

**Omitir ambas = comportamento atual** (sequencial): sucesso → próximo Step; falha
→ `escalate`.

O caso de uso central é o **fix-loop** (ciclo intencional): `review` falha →
`on_fail: { goto: implement }` reenvia ao Step de implementação, que corrige e
segue de novo pela verificação — sem abortar a Task. Ciclos são **permitidos** e
limitados por um teto de runtime (ver Design).

**Usuário-alvo:** quem escreve `loopy.yml`. É mudança de **linguagem/config +
runtime** (o laço de steps deixa de ser `for...of` linear e passa a ter um
program counter com saltos).

**Critérios de aceite (do pedido), reenquadrados como Success Criteria:**
`on_fail`/`on_success` aceitam alvo = id de Step existente; validação de alvo
válido + detecção de ciclos não intencionais (via teto de visitas); `on_fail`
coerente com o ADR-0001 (agora `escalate` **ou** `goto`); testes de fluxo
(sucesso segue, falha desvia, omissão = sequencial, ciclo limitado).

## Enquadramento (o que o pedido esconde)

1. **O laço linear é uma suposição espalhada.** `runTaskPipeline` usa
   `for (const step of config.pipeline)` (orchestrator.ts:644) e o modelo de
   "primeira falha desliga o resto" (`firstFailure`, orchestrator.ts:708). Saltos
   quebram essa suposição: o laço precisa virar um **program counter** sobre um
   mapa `id → índice`, e o conceito de "terminal" (fim OK vs escalação) precisa
   ficar explícito. Blast radius real está no runtime, não só no schema.

2. **"Detectar ciclos" ≠ "proibir ciclos".** O fix-loop *é* um ciclo e é o motivo
   da feature. Proibir ciclos estáticos mataria o caso de uso. A defesa contra
   loop infinito é **runtime**: teto de execuções por Step por Task
   (`max_step_visits`), fail-closed → `escalate` ao estourar. Validação estática
   cobre só o que é sempre-erro: alvo inexistente e `id` duplicado.

3. **`id` deixa de ser decorativo.** Hoje `id` identifica Step para
   resume/log/atribuição de falha, mas **não há checagem de unicidade**. Como
   agora `id` é **alvo de salto**, unicidade e existência do alvo viram
   invariantes de validação.

4. **Resume (C-0002) assume execução-única por Step.** O checkpoint grava um
   `completedSteps` (set de ids) e pula ids já concluídos. Com loops, um Step roda
   N vezes — um set de ids não representa "estou na 2ª volta do loop". O modelo de
   checkpoint precisa migrar para **posição do program counter + contadores de
   visita** (ver OQ-4).

5. **Coerência com o ADR-0001.** O 0001 travou "uma chave `on_fail` por step" e o
   único valor `escalate`, avisando que ampliar exigiria supersede/novo ADR. Esta
   feature **estende** (não revoga) essa decisão: mantém a chave única, amplia o
   valor. Precisa de **ADR-0002** para não deixar a linguagem ubíqua órfã.

## Tech Stack

Sem novas dependências. TypeScript estrito, zod (`.strict()`), Node ≥ 20, vitest,
eslint + prettier. Mensagens de erro/log em pt-BR. Puros onde der (AD-6): a
resolução de alvos, a validação de grafo e o planner do dry-run são funções puras.

## Commands

```
Typecheck:  npm run typecheck
Lint:       npm run lint
Test:       npm test
Test alvo:  npx vitest run tests/loop/orchestrator.test.ts tests/config/schema.test.ts
Dry-run:    npx tsx src/index.ts <dir> --dry-run     # confere as arestas de goto na saída
```

## Design

### Contrato de config

Superfície nova no `loopy.yml`:

```yaml
pipeline:
  - id: implement
    type: agent
    verify: { run: ci, max_attempts: 3 }
    # on_fail omitido → escalate (comportamento atual)

  - id: review
    type: agent
    expect: "REVIEW: PASS"
    on_fail: { goto: implement }     # ciclo intencional (fix-loop): volta e reimplementa
    # on_success omitido → próximo step (sequencial)

  - id: commit
    type: shell
    run: [ ... ]

stop_conditions:
  max_iterations: 25
  max_step_visits: 10                # NOVO: teto de execuções por step, por task (default 10)
  stop_signal_file: ".loopy.stop"
```

**Tipos** (`src/types.ts`):

```ts
export type GotoAction = { readonly goto: string };      // alvo = id de step existente
export type OnFailAction = "escalate" | GotoAction;      // AMPLIADO (era só "escalate")
export type OnSuccessAction = GotoAction;                // NOVO — só goto faz sentido
```

- `on_fail?: OnFailAction` — permanece **por primitiva** (agent/shell/checks/
  approval), como o ADR-0001 deixou. Amplia de `z.literal("escalate")` para
  `z.union([z.literal("escalate"), gotoSchema])`.
- `on_success?: OnSuccessAction` — entra no **`StepBase`/`stepBaseShape`**
  (schema.ts:98-102), pois desvio em sucesso é universal a todo tipo de Step e
  nunca é órfão (sucesso é sempre bem-definido).

### Semântica de execução (program counter)

O laço de steps (`runTaskPipeline`, orchestrator.ts:644) deixa de ser `for...of`
e passa a um **program counter (PC)** sobre `stepIndex: Map<id, índice>`:

1. **Ao entrar em `PC`** (antes de executar): incrementa `visits[id]`; **se
   `visits[id] > max_step_visits`** → terminal **escalate** com motivo "step
   `<id>` excedeu max_step_visits (N)" (fail-closed; respeita
   `policies.escalation`) — **sem executar o Step**. A checagem na entrada
   garante que o teto vale também no alvo de um goto (o alvo é conferido antes de
   rodar uma 11ª vez). Semântica: um Step executa **no máximo `max_step_visits`
   vezes**; a `(N+1)`-ésima entrada escala.
2. Executa o Step em `PC`.
3. **Sucesso** (`StepResult.ok`): se `on_success.goto` presente → `PC =
   stepIndex[goto]`; senão `PC += 1`.
4. **Falha** (`!ok`): se `on_fail` é `{ goto }` → `PC = stepIndex[goto]`; se
   `escalate` (ou omitido, ou caminho órfão do agente) → terminal **escalate**.
5. **PC além do último Step** → terminal **sucesso**.

**`always` (teardown) preservado:** ao atingir qualquer terminal (sucesso ou
escalate), os Steps `always` ainda-não-executados rodam em ordem declarada, como
hoje (respeitando `keep_worktree`, orchestrator.ts:642,665). Um goto **não** pode
ter `always: true` como alvo *implícito* de fluxo normal — `always` é teardown;
apontar um goto para um Step `always` é permitido pelo schema mas desencorajado na
doc.

**Teardown é sempre linear (OQ-11):** um Step `always` **pode** declarar
`on_success`/`on_fail: {goto}` (o schema não distingue), mas na fase de teardown
esses desvios são **ignorados** — os `always` rodam best-effort, em ordem, sem PC
nem salto. Isso preserva o modelo de terminal: nada reabre o fluxo depois do
terminal. Para não virar armadilha silenciosa, a validação emite **warning
informativo** ("`on_success`/`on_fail` em step `always` é ignorado no teardown").

`PipelineOutcome` (orchestrator.ts:594) ganha, quando terminal por escalação, o
motivo do estouro de visitas (para a mensagem de escalonamento em runLoop
orchestrator.ts:886-908 reaproveitar).

### Feedback do fix-loop (threading do report no goto) — OQ-8/OQ-9

O caso central (`review → implement`) **só converge se o alvo do goto souber o que
corrigir**. Sem isso, `implement` re-roda cego e "converge quando os checks
passam" não se sustenta. A mecânica **reusa o canal existente do
`${checks.report}`** (nenhuma var nova — OQ-8):

- **No salto por `on_fail: { goto }`**, o motor semeia o carry:
  `checksReport = result.report?.text ?? result.output`. Para um `review` com
  `expect`, `report` é ausente → usa `output` (o texto do turno do revisor, que
  carrega as notas; `applyVerdictGate` já retorna `output: text`,
  agent.ts:143). Para um gate `checks`/`shell` que falha, usa `report.text`.
- Esse threading estendido (**output-como-report**) **só ocorre no salto por
  goto**. No fluxo sequencial normal segue valendo apenas `result.report`
  (orchestrator.ts:700) — regressão zero: um Step comum **não** vaza seu `output`
  para o `${checks.report}` do próximo.
- O **Step de agente re-entrado por goto** semeia seu `checksReport` inicial a
  partir do valor threadado no `ctx` (hoje `agent.ts:180` fixa `""`, descartando
  o carry — **precisa mudar**). A re-entrada é uma **execução fresca**
  (`attempt = 1`, usa `prompt`, **não** `retry_prompt`) — OQ-9. O autor do yml
  escreve o `prompt` do `implement` referenciando `${checks.report}`: **vazio no
  1º run normal** (regressão zero), **preenchido na volta do fix-loop**.
  `retry_prompt` permanece **exclusivo do loop interno de `verify`** — o contador
  de **Tentativa** não se mistura com o salto do loop externo (glossário
  preservado).
- Nota de implementação: `agent.ts:228,231` loga `on_fail: ${onFail}`; com
  `onFail` agora possivelmente `{ goto }`, formatar o objeto (não `[object
  Object]`).

### Validação (schema + grafo)

Três invariantes novos, no `pipelineSchema.superRefine` (schema.ts:165-185, onde já
mora a regra OQ-7 do agente):

1. **`id` único** no pipeline. Duplicado → erro pt-BR citando os `id`s repetidos.
   (Necessário porque `id` virou alvo de salto — hoje inexistente.)
2. **Alvo de goto existe.** Todo `on_fail.goto`/`on_success.goto` referencia um
   `id` presente no pipeline. Alvo inexistente → erro pt-BR citando o Step de
   origem, a chave e o alvo faltante.
3. **Guard do agente generalizado (herda OQ-7 do ADR-0001):** `on_fail` em Step
   `agent` — seja `escalate` **ou** `{ goto }` — exige `verify` **ou** `expect`
   (senão é órfão: sem modo de falha de agente para governar). `on_success` **não**
   recebe guard (sucesso é sempre definido).

**Ciclos:** *não* são rejeitados na validação (fix-loop é válido). Emitir
**warning** informativo, **não-bloqueante**, ao detectar ciclo no grafo de goto
(OQ-3) — cortesia contra laço acidental; o teto de runtime é a defesa real.

### Dry-run (`orchestrator.ts::resolveStep`, planner puro AD-6)

Cada Step imprime suas arestas de desvio quando presentes:
`on_success -> <id>` e `on_fail -> escalate | goto <id>`, no slot do campo
correspondente. A saída continua sendo a lista de Steps em ordem declarada (não um
render de grafo), com as arestas anotadas por Step — diff mínimo e legível.

### Config-driven (AD-1)

O motor ganha a **mecânica** de salto, mas **qual** salto, **quando** e o teto são
100% do `loopy.yml`. Nenhuma política de fluxo hardcodada.

## Project Structure

```
src/types.ts              → MOD: GotoAction; OnFailAction = "escalate" | GotoAction;
                            OnSuccessAction; StepBase.on_success?; PipelineOutcome
                            (motivo de estouro de visitas).
src/config/schema.ts      → MOD: gotoSchema; onFailSchema vira union; on_success no
                            stepBaseShape; superRefine ganha (a) unicidade de id,
                            (b) existência de alvo de goto, (c) guard do agente
                            generalizado p/ on_fail=goto.
src/config/load.ts        → (revisar) pré-varredura atual não muda; conferir que
                            mensagens novas fluem por formatValidationError.
src/loop/orchestrator.ts  → MOD: runTaskPipeline vira program counter sobre
                            Map<id,índice>; visits[id] + max_step_visits; terminal
                            explícito; no salto por on_fail:goto semeia o carry
                            (result.report?.text ?? result.output — OQ-8);
                            resolveStep imprime arestas no dry-run.
src/loop/*                → MOD: stop_conditions ganha max_step_visits (leitura).
src/steps/agent.ts        → MOD: semeia checksReport inicial do ctx (não "") p/ o
                            alvo do goto ver o feedback (OQ-9); formatar on_fail
                            objeto no log (não [object Object]).
src/resume/*              → MOD: checkpoint grava PC + visitas + carry do report
                            (não completedSteps como set) — ver OQ-4/OQ-10.
examples/loopy.yml        → MOD: adiciona max_step_visits; exemplo de fix-loop
                            (review on_fail goto implement) documentado.
docs/adrs/0002-*.md       → NOVO: ADR-0002 estende ADR-0001 (on_fail ganha goto;
                            on_success; teto de visitas). Via skill adr_management.
CONTEXT.md                → MOD: verbetes novos — Desvio/goto, on_success,
                            max_step_visits; nuance no verbete Pipeline (ordem é o
                            default, goto sobrepõe); on_fail agora escalate|goto.
CLAUDE.md (+ filhos)      → MOD: glossário resumido (Pipeline, on_fail) reflete o goto.
SPEC.md-mãe / README      → MOD: se descreverem fluxo estritamente sequencial.

tests/loop/orchestrator.test.ts → MOD+NOVO: fluxo (sucesso segue; on_success desvia;
                            on_fail goto desvia; omissão=sequencial; ciclo limitado
                            por max_step_visits → escalate).
tests/loop/run-loop.test.ts     → MOD: interação goto↔escalonamento.
tests/config/schema.test.ts     → NOVO: id duplicado rejeitado; goto p/ alvo
                            inexistente rejeitado; agent on_fail=goto sem verify/
                            expect rejeitado; casos válidos aceitos.
tests/resume/*.test.ts          → MOD: resume no meio de um loop (OQ-4).
tests/cli/dry-run.test.ts       → MOD: arestas de goto na saída.
tests/fixtures/project/loopy.yml → MOD: max_step_visits (mínimo válido).
```

## Code Style

Puros nas fronteiras (AD-6): `stepIndex`/resolução de alvo/validação de grafo/planner
do dry-run são funções puras testáveis sem I/O. Erros como valores nas fronteiras de
Step (AD-5); exceções só para faltas genuínas. `.strict()`/`readonly` em todo schema
e tipo. Discriminated union por `type` preservada. Mensagens pt-BR.

## Testing Strategy

vitest, testes espelhando `src/`. Foco em **testes de fluxo** (critério de aceite):

- **Sequencial (omissão):** sem `on_fail`/`on_success` → ordem declarada, falha →
  escalate (regressão zero do comportamento atual).
- **Desvio em sucesso:** `on_success: { goto: X }` → PC salta para X.
- **Desvio em falha:** `on_fail: { goto: X }` → PC salta para X em vez de escalar.
- **Fix-loop limitado:** ciclo `review→implement→review` roda até `max_step_visits`
  e então **escala** com motivo de estouro (prova o guard de runtime).
- **Feedback do fix-loop (OQ-8/9):** no salto `review on_fail goto implement`, o
  `implement` re-entrado vê o `output` do `review` em `${checks.report}` (assert
  no prompt resolvido); um step comum no fluxo normal **não** vaza `output` para
  `${checks.report}` do próximo (regressão zero do threading).
- **Validação:** id duplicado; goto para alvo inexistente; `agent` com `on_fail`
  (escalate ou goto) sem `verify`/`expect` → todos rejeitados com mensagem pt-BR.
- **Resume:** pausar dentro de um loop e retomar da posição/visitas corretas (OQ-4).
- **Dry-run:** arestas `on_success -> X` / `on_fail -> goto X | escalate` impressas.
- Gate: `npm run typecheck && npm run lint && npm test` verdes.

## Boundaries

- **Always:** `on_fail`/`on_success` opcionais; omissão = sequencial (regressão zero);
  validar unicidade de id + existência de alvo; teto de visitas fail-closed →
  escalate; `always`/teardown preservados; migrar `examples/loopy.yml` **e** o
  fixture; criar **ADR-0002** e atualizar `CONTEXT.md`; rodar typecheck+lint+test
  antes de commit.
- **Ask first:** proibir ciclos estáticos (contradiz o design — só se o usuário
  mudar de ideia); mudar o modelo de checkpoint do resume (OQ-4); adicionar
  dependência; mexer em outros blocos do schema; default de `max_step_visits`
  diferente de 10.
- **Never:** hardcodar política de fluxo no motor (AD-1); deixar loop rodar sem teto
  de runtime; deixar goto para alvo inexistente passar a validação; commitar com
  algum dos três checks vermelho; revogar o ADR-0001 (esta feature **estende**).

## Success Criteria

1. `on_fail` aceita `escalate` **ou** `{ goto: <id> }`; `on_success` aceita
   `{ goto: <id> }`. Omitir ambos = fluxo sequencial (falha→escalate).
2. Validação rejeita: `id` duplicado; `goto` para alvo inexistente; `agent` com
   `on_fail` (escalate|goto) sem `verify`/`expect` — todos com mensagem pt-BR
   acionável (Step + chave + alvo).
3. Runtime executa saltos via program counter; `max_step_visits` (default 10)
   limita execuções por Step por Task; estouro → `escalate` (respeita
   `policies.escalation`).
4. Fix-loop (`review on_fail goto implement`) roda e converge quando os checks
   passam; diverge para escalate quando estoura o teto — provado por teste. O
   alvo do goto **vê o feedback** do step que falhou via `${checks.report}`
   (output-como-report só no salto; regressão zero no fluxo normal — OQ-8/9), e o
   carry sobrevive a um resume no meio do loop (OQ-10).
5. `always`/teardown continuam garantidos em qualquer terminal.
6. `--dry-run` imprime as arestas de desvio por Step.
7. `examples/loopy.yml` e `tests/fixtures/project/loopy.yml` migrados e válidos;
   **ADR-0002** criado; `CONTEXT.md`/`CLAUDE.md` refletem a linguagem nova.
8. Regressão zero para pipelines sem `goto`/`on_success`; suíte inteira verde.

## Open Questions

- **OQ-1 (resolvido):** sintaxe = **`{ goto: <step-id> }` estruturado**; `on_fail`
  segue aceitando o literal `escalate`. Confirmado pelo usuário.
- **OQ-2 (resolvido):** ciclos **permitidos** + **teto de visitas em runtime**
  (`max_step_visits`, por Step por Task, fail-closed → escalate); validação
  estática só checa alvo-existe + id-único. Confirmado pelo usuário.
- **OQ-3 (resolvido):** validação emite **warning informativo, não-bloqueante**
  ao detectar ciclo no grafo (cortesia — "confirme que é intencional"; o teto de
  runtime é a defesa real). Confirmado pelo usuário.
- **OQ-4 (resolvido):** o checkpoint do **resume** (C-0002) **migra** de
  `completedSteps` (set de ids) para **posição do PC + contadores de visita +
  carry do report**; um resume no meio de um fix-loop reexecuta o Step corrente na
  volta correta. Confirmado pelo usuário. Consequência: `src/resume/` e
  `tests/resume/` mudam de forma (não só de conteúdo) — o `state.json` ganha `pc`
  + `visits` + `checksReport` corrente (ver OQ-10). Recomendação de forma: `pc`
  como **`id` do step** (robusto e legível; `pipelineHash` já invalida o
  checkpoint se o pipeline muda), `visits` como `Record<id, número>`; persistir a
  cada transição de PC (sucesso ou salto).
- **OQ-5 (resolvido por proposta):** `max_step_visits` é **global** em
  `stop_conditions` (default 10); override por Step fica para uma change futura se
  surgir necessidade. Usuário pode vetar → adicionar override por Step.
- **OQ-6 (resolvido):** `on_success` mora em `StepBase` (universal, nunca órfão);
  `on_fail` permanece por primitiva (herda estrutura do ADR-0001).
- **OQ-7 (resolvido):** guard do agente do ADR-0001 **se generaliza**: `on_fail`
  em `agent` (escalate ou goto) exige `verify` ou `expect`. Confirmado por analogia
  ao ADR-0001.
- **OQ-8 (resolvido):** o feedback do fix-loop (o "o quê corrigir" que o step que
  falhou produz) chega ao alvo do goto **reusando `${checks.report}`** — nenhuma
  var nova. No salto por `on_fail: { goto }`, o motor semeia
  `checksReport = result.report?.text ?? result.output`. Threading
  output-como-report **só no salto**; fluxo normal inalterado (regressão zero).
  Confirmado pelo usuário.
- **OQ-9 (resolvido):** o Step de agente **re-entrado por goto** semeia o
  `checksReport` inicial do valor threadado no `ctx` (não `""`) e re-entra como
  **execução fresca** (`attempt = 1`, usa `prompt`, não `retry_prompt`). O autor
  do yml referencia `${checks.report}` no `prompt` do alvo (vazio no run normal,
  preenchido no fix-loop). `retry_prompt` fica exclusivo do loop interno.
  Confirmado pelo usuário.
- **OQ-10 (resolvido):** o **carry do feedback é estado durável** — o `state.json`
  persiste o `checksReport` corrente além de `pc + visits`, para que um resume no
  meio de um goto retome com a nota do review intacta (o `implement` re-roda
  vendo o feedback). Confirmado pelo usuário. Consequência em OQ-4.
- **OQ-11 (resolvido):** `on_success`/`on_fail` num Step `always` são **ignorados
  na fase de teardown** — teardown é sempre linear/best-effort, nunca reabre o
  fluxo após o terminal. A validação emite **warning informativo** (não bloqueia).
  Confirmado pelo usuário.
