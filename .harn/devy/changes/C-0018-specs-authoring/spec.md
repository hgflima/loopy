# Spec: C-0018 — aba **Specs**, autoria de spec/plan/todo dentro da GUI

> Deriva do protótipo em `apps/menubar/src/authoring-prototype/` (variante **E**,
> iterada 4× com o usuário) — ver `handoff.md` de lá. O protótipo é **descartado**
> ao fim desta change; o que fica é o que esta spec descreve.
>
> **Refinada em 2026-07-25** (`/devy:refine`). As decisões D10–D26 são dessa
> sessão; as D1–D9 foram revisadas e três delas mudaram (marcadas na tabela).
> Quatro conflitos entre a spec e o código foram encontrados e resolvidos —
> estão na seção *Conflitos resolvidos*.

---

## Objective

Hoje o único jeito de produzir os inputs de um Run (`spec.md` / `plan.md` /
`todo.md`) é abrir um terminal e rodar `/devy:spec`, `/devy:refine`, `/devy:plan`
à mão. A GUI só sabe **observar e dirigir** um Run que já tem backlog — a etapa
anterior, que é onde o trabalho de verdade é decidido, vive fora dela.

Esta change fecha esse buraco: um **5.º segmento no `ViewSwitcher`, chamado
`Specs`**, que lista as Changes do projeto e conduz uma **Entrevista** — uma
conversa dirigida por um Agente ACP, uma pergunta por vez, com opção recomendada
e o porquê explícito — que termina com os três `.md` gravados na pasta da Change.

**Usuário:** o dono do repo, na sua própria máquina, decidindo o que construir
antes de mandar o loop construir. Não é multi-usuário, não é remoto.

**Sucesso**, em uma frase: começar e terminar uma Change inteira sem sair da GUI,
e o board (Kanban/Deps) carregar o backlog recém-criado sem passo manual.

### O que NÃO é

- **Não** é um editor de `loopy.yml` (isso é a aba `Config`, C-0014). A única
  exceção é o patch de três paths em `inputs.*` no fim da Entrevista (D11), que
  não abre campo nenhum para edição.
- **Não** é um chat de propósito geral com o Agente. É um fluxo com começo, fases
  e fim.
- **Não** inventa roteiro: as perguntas são do `/devy:*`, não do motor (AD-1).
- **Não** roda o loop. Terminar a Entrevista produz arquivos, não um Run.

---

## Decisões fechadas

Tomadas com o usuário. **Não re-litigar** — se alguma se mostrar errada durante a
implementação, atualize esta spec antes de mudar o código.

### Da spec original (D1–D9)

| # | Decisão | Consequência |
|---|---|---|
| **D1** | **Delegar aos `/devy:*` do harness.** O motor manda `/devy:spec …`, `/devy:refine`, `/devy:plan …` como prompt, envelopado. | Zero roteiro no motor (AD-1 intacto). **Só funciona onde o harness devy está instalado** — trade-off aceito, e é o que sustenta a D16. |
| **D2** | **Pergunta estruturada = bloco no texto do turno.** O envelope instrui o Agente a encerrar o turno com um bloco delimitado; o motor parseia o `TurnTextBuffer`. | Nenhuma mudança no protocolo ACP. Decidido pelo código: o motor abre sessão via `ctx.buildSession(cwd).start()` do SDK e **não controla `mcpServers`** — uma tool MCP exigiria descer ao `session/new` cru + servidor próprio + validação em 3 adapters. **É a decisão central do ADR-0012** (D26). |
| **D3** | **Fallback obrigatório:** turno que não emite bloco vira **pergunta aberta** (texto do Agente + campo livre). | O `/devy:refine` perguntando em prosa continua funcionando, só sem os cards. Combinado com a D17, deixa de ser um beco sem saída. |
| **D4** | **Escopo v1 = o protótipo inteiro.** Triagem → demanda → trilha `feature` completa → salvar; trilhas `bug`/`débito` vão até o hand-off estático e param. | A "volta do debug" (investigação → `todo.md` direto) fica para o v2. |
| **D5** | **Aba `Specs` com lista de Changes + `+ Nova spec`.** O fluxo ocupa a aba; fechar volta para a lista. | O nome é **`Specs`** — nunca "Autoria". Exige comando Rust novo para ler `.harn/devy/changes/*`. |
| **D6** | **`PICK_FOLDER` sai do fluxo.** O `dir` do header é a fonte única do projeto. | Mata os dois seletores concorrentes que o próprio protótipo já apontou. As iterações 3 e 4 do usuário continuam pagas — pelo header. |
| **D7** | **A pasta da Change é o checkpoint.** Cada fase devy grava seus arquivos; interromper deixa a Change parcial em disco e a lista mostra o que falta, com `Continuar`. | Zero estado novo inventado. **Sustentada pela D12**: sem o gate humano entre fases, a pasta não distinguiria "refine não rodou" de "refine rodou" — o `/devy:refine` não grava arquivo nenhum. |
| **D8** | ~~Agente escolhido na aba, persistido global~~ → **alterada pela D16 e pela D18.** O seletor existe e persiste em `launch-config.json`, mas lista **só presets `claude`**, e ganha `model` + `effort`. | Funciona em projeto sem `loopy.yml` — o que exigiu a D20. |
| **D9** | **Anexo vira arquivo em `<dir>/.loopy/attachments/`** e entra no prompt como `ContentBlock` `resource_link`. A numeração `C-XXXX` continua sendo do `/devy:spec`. | `.loopy/` **já é gitignored**. A numeração pelo Agente é o que obriga a D10. Ciclo de vida definido na D19. |

### Da `/devy:refine` de 2026-07-25 (D10–D26)

| # | Decisão | Consequência |
|---|---|---|
| **D10** | **O Agente cria a pasta da Change e a reporta:** `<loopy-change dir="…"/>`, antes de gravar qualquer arquivo. Fallback: snapshot de `.harn/devy/changes/` antes × depois da fase. | Fiel à D9. Custo: o envelope da fase `spec` **não** injeta `<CHANGE_DIR>` (não existe ainda) — só o das fases `refine`/`plan`; e `phase_started` da fase `spec` sai com `changeDir` ausente, resolvido depois pelo frame `change_resolved`. |
| **D11** | **"Abrir o board" patcha `inputs.{spec,plan,todo}` no draft** (`configDraft.patch`), não em disco. A save bar global acende `dirty`. | Faz o SC7 valer sem virar editor de yml e sem escrever nada sem consentimento. Disco só quando o humano clicar Salvar — o mesmo gesto que a C-0014 já ensinou. |
| **D12** | **Gate humano entre fases.** Ao `<loopy-done/>` a Entrevista para, mostra o que foi gravado e oferece o próximo passo (`Refinar` / `Ir direto ao plano` / `Fechar`). | Você lê a spec antes de refinar e pode pular a fase mais cara. Resolve a retomada de graça: o estado da Change é "qual o próximo passo", e quem responde é o humano. |
| **D13** | **Uma Sessão (janela de contexto) por Fase → um processo `loopy interview` por Fase.** A fase termina, o processo sai com 0; o próximo passo spawna outro. | **Gate e retomada viram o mesmo código**: fechar o app no meio é indistinguível de não clicar o botão. Um caminho para testar. Cada fase relê os `.md` — que é o preço que a D7 já tinha aceitado. |
| **D14** | **Linha de atividade + transcript colapsável** enquanto o Agente trabalha. A linha vem do `session/update`; o transcript reusa o `MarkdownStream` do app, fechado por padrão. | Prova vida em turnos de minutos sem virar chat. Custo: o frame `agent_activity`. |
| **D15** | **Envelope completo no 1.º turno da fase; lembrete de uma linha nos demais.** | Combate o drift do turno 10 sem encher o contexto de cópias. Determinístico e testável com string exata. |
| **D16** | **Só Claude no v1.** O seletor lista apenas presets `claude` (e `command` custom, que o operador assume). | Nenhuma promessa falsa: os `/devy:*` são do Claude Code (D1). O `if` de adapter fica **só na GUI** — o motor segue sem `if (agent === 'claude')`, como manda `src/acp/catalog.ts`. Comandos de fase configuráveis são v2. |
| **D17** | **Botão "Chega, grave o que temos", sempre visível** na barra de progresso da fase. Manda um turno final pedindo o encerramento; a fase termina no `<loopy-done/>` normal. | Um mecanismo cobre os dois casos: o Agente que nunca emite `done` (D3 em loop) e a 15.ª pergunta legítima (a antiga OQ3). Sem contador, sem config — o humano é o teto, como no gate. |
| **D18** | **Model e effort na aba, por Sondagem**, ao lado do agente; persistidos em `launch-config.json`. | Zero componente novo: `useAgentCapabilities`, `SelectField`, `ensureOption` e a degradação para texto livre já existem (C-0016). Deixa subir o effort no `refine` e baixar no `plan`. |
| **D19** | **Anexos nunca são apagados**, e o nome leva timestamp: `.loopy/attachments/20260725-143012-erro.png`. | Nunca quebra uma referência que o `spec.md` tenha escrito; gitignored, então não suja o repo; o prefixo evita colisão de dois `print.png`. Guardá-los na pasta da Change é **incompatível com a D10** (os anexos existem antes de o dir ser conhecido). |
| **D20** | **A barra de abas passa a ser sempre visível**; o `EmptyState` deixa de substituir o `ViewSwitcher`. Sem yml: Kanban/Deps/Insights mostram o próprio vazio, `Config` hospeda o "criar a partir do template", `Specs` funciona normal. | Corrige a ordem do trabalho: spec vem **antes** do yml. Custo real de escopo: mexe no `App.tsx` e obriga as outras quatro views a degradar com graça. |
| **D21** | **Descartar uma Change parcial move a pasta para `<dir>/.loopy/trash/<id>-<slug>-<epoch>/`** — `rename`, não delete. | Reversível com um `mv`, gitignored, e com precedente direto: `write_loopy_yml` já faz isso com `.loopy/backups/`. O boundary muda de "nenhum comando Rust escreve" para **"nenhum comando Rust destrói"**. |
| **D22** | **Com um Run em andamento, a aba avisa e deixa decidir** — não bloqueia. | A Entrevista suja o parent e pode parar o Run (ver *Conflitos resolvidos* nº 4). Não mexer em `require_clean_parent` mantém a semântica dele intacta: ele existe para pegar edição humana no parent, e a Entrevista **é** edição humana no parent. |
| **D23** | **O subcomando chama-se `loopy interview`.** | **Entrevista** já é o termo canônico, e o comando produz uma Entrevista — não "uma spec" (são três arquivos). Zero colisão com `inputs.spec` e com o `loopy change` que **já existe** (`src/index.ts:1188`, anotação de telemetria). A aba nomeia o artefato; o comando, a mecânica. |
| **D24** | **"Outro tipo de demanda…" cai na trilha `feature`.** | A trilha `feature` produz arquivos; a de bug termina num hand-off que não grava nada — mandar o desconhecido para o caminho estéril é o pior default. Com o gate da D12, se na spec ficar claro que era bug, fecha-se ali. |
| **D25** | **O texto que o Agente escreve antes do bloco vive no transcript**, não no card; turno com dois blocos `ask` usa o primeiro e emite `warning`; **cancelar não apaga nada** (o que foi gravado fica, e a Change reaparece como parcial). | Derivadas mecânicas das decisões acima — registradas para não serem re-decididas na implementação. |
| **D26** | **ADR-0012 — "Autoria de Change via Entrevista delegada"**, com referência cruzada no ADR-0007. | O que importa registrar é o **porquê não uma tool MCP** (D2), com o custo real. Sem isso alguém reabre a discussão em seis meses sem o dado. |

---

## Conflitos resolvidos

Quatro coisas que a spec original afirmava e o código contradiz. Todas foram
verificadas no fonte durante a refine.

1. **`<CHANGE_DIR>` não pode ser injetado na fase `spec`.** A D9 dá a numeração
   ao `/devy:spec`, então o motor não conhece o dir antes do primeiro turno.
   → Resolvido pela **D10** (o Agente reporta).

2. **`SC8` era impossível.** O board lê o backlog em `inputs.todo`
   (`apps/menubar/src/config/useConfigDraft.ts:154-174`), e `inputs.{spec,plan,todo}`
   são campos obrigatórios do schema apontando para a Change **anterior**.
   → Resolvido pela **D11**.

3. **A aba não existiria em projeto sem `loopy.yml`.** `App.tsx:258` faz
   `showEmptyState = isIdle && configDraft.hasConfig === false` e o `App.tsx:409`
   troca o **`ViewSwitcher` inteiro** pelo `EmptyState` — a barra de abas some.
   → Resolvido pela **D20**.

4. **`SC12` prometia o oposto do que acontece.** `isParentClean` é
   `git status --porcelain` vazio (`src/git/worktree.ts:156-162`), que inclui
   **untracked não-ignorados**, e `.harn/` não está no `.gitignore`. Gravar uma
   Change nova durante um Run com `require_clean_parent: true` derruba o Run com
   `stoppedBy: "dirty_parent"` no próximo mark-done (`orchestrator.ts:1414-1425`).
   → Resolvido pela **D22**, e o SC12 foi reescrito para o que é verdade.

---

## Tech Stack

Nada novo. Tudo já está no repo:

- **Motor**: TypeScript ESM, Node ≥ 22.13, `@agentclientprotocol/sdk@0.29.0`,
  `commander`, `zod`.
- **GUI**: Tauri v2 (Rust) + React 18 + Vite; `vitest`/`jsdom`.
- **Ponte**: NDJSON duplex por stdin/stdout (ADR-0007), `src/tui/transport.ts`.

**Nenhuma dependência nova.** Se a implementação achar que precisa de uma, é
sinal de que o desenho está errado — pare e reveja. (A D21 foi desenhada como
`rename` justamente para não precisar da crate `trash`.)

---

## Arquitetura

### Fluxo, ponta a ponta

```
Aba Specs (lista)  ← sempre acessível, com ou sem loopy.yml (D20)
  │  Rust read_changes(dir) → [{ id, slug, hasSpec, hasPlan, hasTodo, taskCount }]
  │  seletor agente + model + effort, sondados (D16/D18)
  │  ⚠ aviso se há Run ativo (D22)
  └─ [+ Nova spec] ────────────────┐
                                   ▼
                       ┌─ Entrevista (ocupa a aba) ─────────────────┐
                       │                                            │
  LOCAL, sem agente ►  │  1. TRIAGE   "O que vamos desenvolver      │
                       │               hoje?"                       │
                       │     Nova feature (RECOMENDADA) · Bug ·     │
                       │     Débito técnico · Outro… (→feature, D24)│
                       │                                            │
  LOCAL, sem agente ►  │  2. DESCRIBE  texto livre + anexos         │
                       │                                            │
                       └──────────┬──────────────┬──────────────────┘
                                  │              │
              track ∈ {feature,   │              │track ∈ {bug, debt}
                       outro}     ▼              ▼
       ┌─ Fase spec ── processo #1 ─┐   ┌─ hand-off, LOCAL ──────┐
       │  /devy:spec <demanda>      │   │ repro (choice)         │
       │  <loopy-change dir=…/>     │   │ evidence (text+anexo)  │
       │  ↕ N perguntas             │   │   ▼                    │
       │  <loopy-done/>  → exit 0   │   │ bloco `/devy:debug …`  │
       └──────────┬─────────────────┘   │ + contexto + [copiar]  │
                  ▼                     │ NADA é escrito         │
       ╔═ GATE HUMANO (D12) ═══════╗    └────────────────────────┘
       ║ ✓ spec.md · [Abrir]       ║
       ║ [Refinar] [Ir ao plano]   ║
       ╚══════════╤════════════════╝
                  ▼
       ┌─ Fase refine ─ processo #2 ┐
       │  /devy:refine  ↕ N         │
       └──────────┬─────────────────┘
                  ▼   ╔═ GATE ═╗
       ┌─ Fase plan ── processo #3 ─┐
       │  /devy:plan spec.md  ↕ N   │
       └──────────┬─────────────────┘
                  ▼
       ┌─ ✓ Salvo ──────────────────┐
       │ .harn/devy/changes/        │
       │   C-XXXX-slug/             │
       │ [Abrir o board] → patch    │
       │   inputs.* no draft (D11)  │
       └────────────────────────────┘
```

**A triagem, a descrição, o gate e o hand-off são locais** — nenhum processo é
spawnado até uma Fase começar. As trilhas `bug`/`débito` **nunca** spawnam nada.

### O envelope (D1 + D2 + D15)

O motor não escreve o roteiro, mas **impõe o formato da resposta**. É a única
"instrução do motor" que existe, e ela fala sobre forma, nunca sobre conteúdo.

**Turno 1 da fase — envelope completo:**

```
Você conduz uma entrevista dentro de uma GUI: o humano vê UMA pergunta por vez,
como cartões clicáveis. Não há terminal.

Quando precisar de uma decisão, ENCERRE O TURNO emitindo exatamente um bloco:

<loopy-ask>
{"id":"objetivo",
 "prompt":"Qual o objetivo desta feature?",
 "options":[{"label":"…","detail":"…","recommended":true,"why":"…"}],
 "otherLabel":"Nenhuma dessas — escrever a minha…"}
</loopy-ask>

Regras: uma pergunta por turno; exatamente uma opção com "recommended": true,
e o "why" diz por que ela.

Se a resposta estiver no código, LEIA O CÓDIGO em vez de perguntar — e me conte
no MESMO bloco, acrescentando "finding" (o que você descobriu) e "source"
(arquivo:linha), com opções para eu seguir ou decidir à mão.

Ao criar a pasta da Change, informe-a ANTES de gravar qualquer arquivo:
<loopy-change dir=".harn/devy/changes/C-XXXX-slug"/>

Quando esta fase estiver completa, grave e encerre com <loopy-done/>.
```

Nas fases `refine`/`plan` o parágrafo do `<loopy-change>` é substituído por
`Grave os arquivos em: <CHANGE_DIR>` — porque o `/devy:plan` diz `tasks/plan.md`
e a **convenção real deste repo é a pasta da Change**. O envelope corrige sem
editar o comando do harness.

**Turnos seguintes — lembrete de uma linha:**

```
Lembre: uma pergunta por turno, no bloco <loopy-ask>; <loopy-done/> ao terminar.
```

**Wrap-up (D17)**, quando o humano clica "Chega":

```
Pare de perguntar. Grave os arquivos desta fase com o que você já tem e encerre
com <loopy-done/>.
```

**Parsing** (`src/interview/parse-ask.ts`, puro, AD-6):

| Texto do turno contém | Resultado |
|---|---|
| `<loopy-ask>{json válido}</loopy-ask>` | `{ kind: "ask", question }` |
| `<loopy-change dir="…"/>` | `{ kind: "change", dir }` — **pode coexistir** com `ask`/`done` no mesmo turno |
| `<loopy-done/>` | `{ kind: "done" }` |
| nada disso, texto não-vazio | `{ kind: "open", text }` ← **fallback D3** |
| JSON malformado dentro do bloco | `{ kind: "open", text }` + `warning` |
| dois ou mais blocos `ask` | o **primeiro** + `warning` (D25) |

Nunca lança (AD-5). Mesmo caminho do `parseVerdict`, que já lê o turno assim.

### Novo subcomando: `loopy interview` (D23)

```
loopy interview <dir> --emit-events [--change <id>] [--phase <spec|refine|plan>]
                      [--demand <texto>] [--agent <preset>]
                      [--model <m>] [--effort <e>]
```

- **Sempre** `--emit-events`: o processo existe para falar com a GUI. Sem a flag,
  imprime uma mensagem dizendo isso e sai com código 2. (Um modo terminal
  interativo é um produto diferente — fora de escopo.)
- `--change` + `--phase`: entrada em uma fase específica (D12/D13). Sem eles,
  começa uma Change nova pela fase `spec`.
- `--demand <texto>`: a demanda em texto livre do stage DESCRIBE, que semeia o
  turno 1 da fase `spec` (`/devy:spec <demanda>` — `phaseCommand` em `phases.ts`).
  **Só** a fase `spec` a lê; `refine`/`plan` a ignoram (releem os `.md`). É o
  único canal que carrega a demanda da GUI ao processo — sem ela, `/devy:spec`
  roda pelado e repergunta o que o DESCRIBE já coletou. Um argv, não shell: o
  Rust spawna argv direto, então espaços e quebras de linha sobrevivem.
- **Um processo por Fase** (D13): o processo termina quando a fase termina.
- Reusa: `createAgentProcessPool`, `LoopySession`, `TurnTextBuffer`,
  `createEventTransport`, o logger. **Um Processo de Agente, uma Sessão**,
  `cwd = <dir>` (não há worktree aqui — a Entrevista escreve na árvore de
  trabalho, não numa branch).
- **Modo**: `acceptEdits` (dialeto Claude). A Entrevista **precisa** escrever os
  `.md`; `plan` (read-only) não serve — ver a memória `loopy-verdict-vs-plan-mode`.
- **Model/effort**: aplicados como o Step de Agente já faz — `setModel` antes de
  `setEffort`, ambos best-effort com warning (ADR-0008).

### Frames novos no Transport (ADR-0007, estendido pelo ADR-0012)

**Nove frames**, todos aditivos. Nenhum frame existente muda de shape —
`apps/menubar/` continua compilando.

**`control` (motor → GUI) — seis:**

```ts
| { control: "phase_started"; phase: Phase; command: string; changeDir?: string }
| { control: "change_resolved"; changeDir: string }
| { control: "question_asked"; questionId: string; phase: Phase;
    prompt: string; options?: readonly AskOption[]; otherLabel?: string;
    finding?: string; source?: string }
| { control: "agent_activity"; phase: Phase; text: string }
| { control: "phase_finished"; phase: Phase; changeDir: string;
    files: readonly string[] }
| { control: "interview_failed"; reason: string }
```

**`command` (GUI → motor, stdin) — três:**

```ts
| { command: "question_answer"; questionId: string; text: string;
    attachments?: readonly string[] }   // paths em .loopy/attachments/
| { command: "phase_wrap_up" }          // "Chega, grave o que temos" (D17)
| { command: "interview_cancel" }
```

`changeDir` é opcional em `phase_started` **só** porque a fase `spec` de uma
Change nova ainda não o conhece (D10); `change_resolved` o entrega assim que o
Agente o reporta — ou assim que o fallback de snapshot o deduz.

O ciclo é o mesmo do Gate de Aprovação que já existe: control sai, a GUI casa
pelo `questionId`, o command volta por stdin, o motor destrava o próximo turno.

> **Nota — paga o D-0005 de tabela.** O frame `approval_requested` existente
> emite `taskId: ""`/`stepId: ""` hardcoded. Os frames novos **não** repetem esse
> erro: `questionId` e `phase` são sempre preenchidos.

### Processo separado do Run

`SidecarState::spawn` hoje **mata o sidecar anterior** ("one Run at a time",
`sidecar.rs:210`). A Entrevista **não pode** matar um Run em andamento.
Portanto: um segundo estado gerenciado (`InterviewState`) com seus próprios
eventos `interview://line|stderr|exit`. Run e Entrevista coexistem **como
processos** — o efeito da Entrevista sobre o Run é o do parent sujo (D22), não o
de um kill.

### Comandos Rust novos

```rust
pub struct ChangeSummary {
    pub id: String,          // "C-0018"
    pub slug: String,        // "specs-authoring"
    pub has_spec: bool,
    pub has_plan: bool,
    pub has_todo: bool,
    pub task_count: usize,   // linhas "- [ ]" / "- [x]" do todo.md
    pub done_count: usize,
}
```

- **`read_changes(dir)`** — lê `<dir>/.harn/devy/changes/*/`, **só diretórios**
  (há um `index.md` solto lá), ordena por id **decrescente**. Diretório ausente →
  `Ok(vec![])`, **não** erro (mesma disciplina de `read_project_files`: arquivo
  ausente = `None`, é assim que o app decide empty-state).
- **`discard_change(dir, id)`** (D21) — `rename` da pasta para
  `<dir>/.loopy/trash/<id>-<slug>-<epoch>/`, confinado por `resolve_within` (o
  mesmo guard que o `read_backlog` já usa contra `..` e path absoluto).

**Nenhum comando Rust destrói.** Os `.md` são escritos pelo Agente via
`fs/write_text_file`, que o motor já serve; os anexos, pelo motor; o descarte
move, não apaga.

---

## Commands

Nenhum comando novo de build. Os que valem para esta change:

```bash
# Motor
npm run dev -- interview /caminho/do/projeto --emit-events   # o subcomando novo
npm test                                                     # vitest, tests/**
npm run typecheck                                            # cobre motor E menubar
npm run lint

# GUI
npm run dev:web -w apps/menubar     # UI só, sem Rust (MOCK_FEED)
npm run dev -w apps/menubar         # build:sidecar + tauri dev
npm test -w apps/menubar            # 844 testes hoje, 49 arquivos
cd apps/menubar/src-tauri && cargo test

# Formatação — SOMENTE nos arquivos tocados
npx prettier --write <arquivo>      # NUNCA `npm run format` (repo fora de sync)
```

⚠️ `npm test` na raiz **não** roda os testes do menubar. São dois comandos.

⚠️ Dogfooding: rodar um Run deste repo com `tauri dev` ativo reinicia o app e
mata o motor-filho. Use o CLI ou `tauri dev --no-watch`.

---

## Project Structure

```
src/interview/                 ← NOVO — o subcomando `loopy interview` (D23)
  run.ts                       Orquestra UMA fase: turnos → frames → exit
  envelope.ts                  Monta envelope, lembrete e wrap-up (puro)
  parse-ask.ts                 Turno → ask | change | done | open (puro, AD-6)
  phases.ts                    Fase → comando devy (a única tabela do motor)
  attachments.ts               Grava .loopy/attachments/, monta ContentBlock[]
  CLAUDE.md                    Intent node

src/tui/transport.ts           ← ESTENDIDO — 6 control + 3 command frames novos
src/acp/session.ts             ← ESTENDIDO — prompt aceita ContentBlock[] (aditivo)
src/index.ts                   ← ESTENDIDO — registra `interview` no commander

apps/menubar/src/specs/        ← NOVO — a aba
  SpecsPane.tsx                Lista + seletor agente/model/effort + aviso de Run
  Interview.tsx                O fluxo (triagem → demanda → fase → gate)
  QuestionCard.tsx             Cartão (opções · RECOMENDADA · porquê · finding)
  PhaseGate.tsx                O gate entre fases (D12)
  ActivityLine.tsx             Linha viva + transcript colapsável (D14)
  Handoff.tsx                  Trilha bug/débito
  Attachable.tsx               Paste / drag-drop / botão 📎
  interview-state.ts           Redutor PURO do fluxo (AD-6)
  useInterviewProcess.ts       Ponte com o processo `interview://`
  specs.css

apps/menubar/src/App.tsx                  ← ESTENDIDO — barra sempre visível (D20)
apps/menubar/src/panes/ViewSwitcher.tsx   ← ESTENDIDO — 5.º segmento + empty por view
apps/menubar/src/config/EmptyState.tsx    ← ESTENDIDO — vira o vazio da aba Config
apps/menubar/src-tauri/src/changes.rs     ← NOVO — read_changes + discard_change
apps/menubar/src-tauri/src/interview_process.rs ← NOVO — InterviewState
apps/menubar/src-tauri/src/config.rs      ← ESTENDIDO — authoring_{agent,model,effort}

docs/adrs/0012-autoria-de-change-via-entrevista.md  ← NOVO (D26)
docs/adrs/0007-transport-ndjson-duplex-native-ui.md ← nota "estendido pelo 0012"
CONTEXT.md                                ← ESTENDIDO — ver abaixo

apps/menubar/src/authoring-prototype/     ← REMOVIDO
apps/menubar/src/main.tsx                 ← REVERTIDO (tirar o gate PROTOTYPE)
```

### Glossário (`CONTEXT.md`)

Termos novos a registrar, e um a promover:

- **Change** deixa de ser "par derivado `{id,dir}`, não conceito do motor" — o
  motor agora **cria** Changes.
- **Entrevista** — a conversa dirigida por um Agente que produz os inputs de uma
  Change. Tem **Trilha**, **Fases** e um **Envelope**.
- **Trilha** — `feature` (produz arquivos) × `bug`/`débito` (termina em hand-off).
- **Fase** — `spec` / `refine` / `plan`. Uma Sessão e um processo por Fase (D13).
- **Envelope** — a instrução de **forma** que o motor prepende ao prompt
  delegado. Nunca fala de conteúdo (AD-1).
- **Pergunta** — o bloco `<loopy-ask>`; degrada para **pergunta aberta** (D3).

---

## Code Style

Igual ao resto do repo. Três coisas que esta change vai tropeçar se ignorar:

**1. Lógica em função pura, componente é casca (AD-6).** O fluxo da Entrevista é
um redutor testável sem montar React — mesmo padrão de `applyLine`, `groupByStep`,
`configToStore`:

```ts
/** One step of the interview. Pure: no I/O, no React, no Date.now(). */
export function advance(
  state: InterviewState,
  event: InterviewEvent,
): InterviewState {
  switch (event.kind) {
    case "answered":
      // Structural sharing: an answer to an unknown question is a no-op, not a
      // throw — a late frame after cancel must not corrupt the flow.
      if (state.pending?.questionId !== event.questionId) return state;
      return { ...state, pending: null, answers: [...state.answers, event] };
    ...
  }
}
```

**2. Erro como valor na fronteira (AD-5).** `parse-ask` devolve `open` em vez de
lançar; `read_changes` devolve lista vazia em vez de `Err`.

**3. Nenhuma cor literal.** Tudo de `apps/menubar/src/ui/tokens.css`. O acento
magenta significa exatamente três coisas — interativo, vivo, gate humano — e o
badge `RECOMENDADA` é a terceira.

Comentários explicam **por que**, não o que. Texto de UI em **pt-BR**,
identificadores e docstrings em **inglês** (é a convenção vigente do repo).

---

## Testing Strategy

Cobertura por camada, com o teste sempre no nível mais barato que prova a coisa.

| Camada | Onde | O que provar |
|---|---|---|
| Parser do envelope | `tests/interview/parse-ask.test.ts` | os 6 casos da tabela; `change` coexistindo com `done` no mesmo turno; dois `ask` → primeiro + warning; **nunca lança** |
| Envelope | `tests/interview/envelope.test.ts` | turno 1 leva o texto completo; turno 2+ leva só o lembrete; fases `refine`/`plan` injetam `<CHANGE_DIR>` e a `spec` **não** (D10/D15) |
| Máquina de fases | `tests/interview/phases.test.ts` | cada fase mapeia para o comando devy certo; `bug`/`debt` nunca spawnam; `--phase` entra na fase pedida |
| Frames | `tests/tui/transport.test.ts` | round-trip dos 9 frames novos; frame desconhecido → `ok:false` (não lança) |
| Anexos | `tests/interview/attachments.test.ts` | path sob `.loopy/attachments/` com prefixo de timestamp; `ContentBlock` bem-formado; nome com `../` é rejeitado |
| Redutor da Entrevista | `apps/menubar/src/specs/interview-state.test.ts` | avanço, gate, wrap-up, cancelar; resposta a `questionId` desconhecido = **mesma referência** |
| Componentes | `apps/menubar/src/specs/*.test.tsx` | jsdom: card com opções + badge único; card com `finding` renderiza a fonte; escape hatch; anexo vira chip |
| Barra sempre visível | `apps/menubar/src/App.test.tsx` | sem `loopy.yml`, a barra de abas existe e `Specs` é alcançável (D20) |
| Rust | `apps/menubar/src-tauri/src/changes.rs` | `cargo test`: pasta ausente → vazio; `index.md` ignorado; parcial → flags certas; contagem de tasks; `discard_change` move e recusa `..` |

**Regressão obrigatória:** os 844 testes do app e a suíte da raiz continuam
verdes. Um teste que quebrar por mudança de shape de frame é um **bug desta
change**, não um teste a atualizar.

Não há teste E2E automatizado (o app não tem harness para isso). A verificação
ponta-a-ponta é manual e está nos Success Criteria.

---

## Boundaries

**Always**

- Manter o roteiro fora do motor: as perguntas vêm do `/devy:*` (D1/AD-1). A
  única tabela permitida em `src/interview/phases.ts` é `fase → comando`.
- Estender o Transport de forma **aditiva**. Frame existente que muda de shape
  quebra `apps/menubar/` em tempo de build.
- Rodar `npm run typecheck` (cobre os dois) e as **duas** suítes antes de fechar
  qualquer task.
- Formatar **só** os arquivos tocados.
- Tratar arquivo/pasta ausente como estado vazio, nunca como erro.

**Ask first**

- Qualquer dependência nova, em qualquer um dos três `package.json` ou no
  `Cargo.toml`.
- Mudar a assinatura de `AgentSession` em `src/types.ts` (contrato congelado).
  Aceitar `ContentBlock[]` no prompt **deve** ser aditivo — método novo ou
  overload, nunca troca de assinatura.
- Escrever qualquer coisa fora de `<dir>/.harn/devy/changes/<change>/`,
  `<dir>/.loopy/attachments/` e `<dir>/.loopy/trash/`.
- Mexer na config de dedupe de React ou nos aliases `loopy/*`.

**Never**

- Reimplementar no frontend o que o motor já exporta (parser, schema, reducer).
- Adicionar `rehype-raw` a qualquer renderização de markdown — o conteúdo vem de
  um Agente.
- Matar o sidecar do Run para spawnar a Entrevista.
- **Destruir arquivo do usuário** — descartar é `rename` para `.loopy/trash/`,
  nunca `remove_dir_all` (D21).
- Pôr `if (agent === "claude")` no motor. A restrição da D16 vive **só** na GUI.
- Mexer em `require_clean_parent` ou em `isParentClean` para acomodar a
  Entrevista (D22).
- Interpolar dado do usuário dentro de string de shell.
- Deixar o protótipo na `main` ao terminar.

---

## Success Criteria

Verificáveis. `[M]` = manual, `[A]` = automatizado.

- **SC1** `[A]` `parse-ask` cobre os 6 casos da tabela e nunca lança.
- **SC2** `[A]` Os 9 frames novos fazem round-trip por `parseTransportLine`.
- **SC3** `[A]` As duas suítes verdes (raiz + `apps/menubar`, ≥ 844) e
  `npm run typecheck` limpo.
- **SC4** `[A]` `cargo test` verde, incluindo `read_changes` com pasta ausente e
  `discard_change` recusando `..`.
- **SC5** `[M]` Num projeto com Changes, a aba `Specs` lista todas, ordenadas
  decrescente, com o estado dos três `.md` e a contagem de tasks.
- **SC6** `[M]` `+ Nova spec` → triagem → descrição → o Agente faz **≥ 1 pergunta
  em cartão** com exatamente uma opção `RECOMENDADA` e o porquê visível.
- **SC7** `[M]` Ao fim da trilha `feature`, `.harn/devy/changes/C-XXXX-<slug>/`
  existe com `spec.md`, `plan.md` e `todo.md`, e o `todo.md` **parseia**
  (`parseBacklog` devolve ≥ 1 task).
- **SC8** `[M]` `Abrir o board` mostra esse backlog no Kanban **e** deixa a save
  bar `dirty` com os três `inputs.*` repontados; salvar persiste o yml (D11).
- **SC9** `[M]` Fechar o app depois da fase `spec` e reabrir: a Change aparece na
  lista como parcial, e `Continuar` oferece `refine` e `plan` — entrando na fase
  escolhida, não em `spec` (D12/D13).
- **SC10** `[M]` Trilha `bug`: chega ao hand-off com o comando `/devy:debug`
  montado e copiável, e **nenhum arquivo é criado**.
- **SC11** `[M]` Colar um PNG e arrastar um `.log` num campo produz dois chips; os
  arquivos aparecem em `.loopy/attachments/` com prefixo de timestamp e o Agente
  consegue lê-los.
- **SC12** `[M]` Com um Run rodando, abrir a aba `Specs` **não mata o sidecar do
  Run** (processos independentes) e a aba **exibe o aviso** de que gravar uma
  Change nova pode parar o Run por `require_clean_parent` (D22).
- **SC13** `[M]` Agente que responde em prosa (sem o bloco) cai na pergunta aberta
  — o fluxo continua, degradado, sem travar (D3) — e o botão "Chega" encerra a
  fase gravando o que houver (D17).
- **SC14** `[M]` Numa pergunta cuja resposta está no código, o Agente devolve um
  card com `finding` + `source`, e "Está errado — decido" volta a perguntar (D10).
- **SC15** `[M]` Num diretório **sem `loopy.yml`**, a barra de abas existe e a aba
  `Specs` conduz uma Entrevista inteira (D20).
- **SC16** `[M]` `Descartar` numa Change parcial move a pasta para
  `.loopy/trash/` — a Change some da lista e os arquivos continuam no disco (D21).
- **SC17** `[A]` `git status` limpo de protótipo: `authoring-prototype/` não
  existe e `main.tsx` não tem o gate `PROTOTYPE`.

---

## Open Questions

Não bloqueiam o início. Registrar aqui a decisão quando resolvidas.

1. ~~**O envelope sobrevive ao Agente real?**~~ — **RESPONDIDA em 2026-07-25**,
   antes de escrever código, pela spike `spikes/acp-claude-interview-envelope.ts`
   (um turno real, `claude-agent-acp 0.59.0`, `mode: acceptEdits`): **sobrevive**.
   Um único bloco `<loopy-ask>`, JSON válido, exatamente uma opção
   `"recommended": true` com `"why"` preenchido — e `finding` + `source`
   **espontâneos já na fase `spec`** (o SC14 é alcançável desde o primeiro turno).
   A D3 segue sendo o degradado, não o padrão. Dois achados laterais que a
   implementação precisa honrar: **328 s até a primeira pergunta** (o agente
   spawna sub-exploradores antes de perguntar — a D14 não é enfeite) e **1.427
   chars de prosa fora do bloco, concatenados sem quebra de linha** (a linha viva
   da D14 tem de vir do `session/update` ao vivo, não de fatiar o texto final do
   turno). Achados completos em `spikes/README.md`.
   **Ainda não provado**: o `<loopy-change dir=…/>` — o turno 1 perguntou antes de
   criar pasta alguma, então o report do dir só aparece quando a fase for gravar.
   É o que o fallback de snapshot da D10 cobre, e o que o Checkpoint A do
   `plan.md` re-verifica com a fase completa.
2. **Quantas perguntas o `/devy:spec` de fato faz na GUI.** Com a delegação, quem
   decide é o Agente; o botão da D17 é a válvula. Vale medir na primeira
   Entrevista real se a trilha `feature` fica cansativa (a antiga OQ3).
3. **Acessibilidade dos cartões.** Hoje são `<button>` com spans — funciona, mas
   sem navegação por setas dentro do grupo. Levantado no handoff do protótipo,
   ainda não endereçado.
4. **A "volta do debug"** (investigação → `todo.md` direto, sem spec inteira)
   continua fora do v1 por D4.
