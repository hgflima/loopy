# Handoff — protótipo de autoria de spec/plan na GUI

> Escrito em 2026-07-25. Trabalho **não commitado**, na branch `main`, no repo
> `~/dev/personal/acp-agentic-loop`.

<original_task>
O usuário invocou `/prototype` sem argumentos e, quando questionado, definiu a pergunta a
responder:

> **"Como criar specs / plans de forma 'smoothy' para o usuário? Um wizard? Um chat?"**

Decisões de escopo tomadas com o usuário via `AskUserQuestion` (uma pergunta por vez, conforme
preferência registrada em memória):

1. **Branch do skill**: UI (`~/.claude/skills/prototype/UI.md`), não LOGIC — a pergunta é sobre
   "o que isso deveria parecer".
2. **Onde vive**: dentro da **GUI menubar** (`apps/menubar/`), não no terminal (skill `/devy:*`)
   nem num produto separado. Sub-shape A do skill: montado dentro do shell real do app.

O escopo é **descobrir o design**, não implementá-lo em produção. O deliverable é um conjunto de
variantes descartáveis, comparáveis lado a lado, num único route com `?variant=`.

Iterações pedidas pelo usuário DEPOIS da entrega inicial (todas concluídas):

- **It. 1**: "A espinha dorsal é da opção D, mas com o seguinte fluxo: (1) pergunta 'O que vamos
  desenvolver hoje?' com opções Nova Feature / Bug / Débito Técnico / {outros}; (2) depois pedir
  para explicar mais sobre a demanda; (3) se Nova feature → `/devy:spec {info}` → interação uma
  pergunta por vez, AskUserQuestion-like, **sinalizar a opção recomendada (descrevendo o porquê)**
  → `/devy:refine` → interação → `/devy:plan spec.md` → interação → salvar os arquivos na pasta já
  convencional; (4) se bug ou débito técnico → `/devy:debug {informacoes}`."
- **It. 2**: "(1) Em toda caixa que o usuário pode digitar deve ser permitido ele colar arquivo,
  imagem e etc; (2) no fluxo da feature, na tela final não precisa mostrar os arquivos criados,
  apenas um spinner de salvando e salva."
- **It. 3**: "Antes de tudo o usuário precisa escolher a pasta do projeto que ele vai criar spec,
  plan e todo."
- **It. 4**: "'ou cole o caminho' não ficou legal." (feedback visual sobre o campo de path)
  </original_task>

<work_completed>

## Artefatos criados

Tudo em `apps/menubar/src/authoring-prototype/` (pasta nova, **untracked**), 3.406 linhas:

| Arquivo                   | Linhas | Papel                                                                         |
| ------------------------- | ------ | ----------------------------------------------------------------------------- |
| `PrototypeRoute.tsx`      | 122    | Shell + switcher; monta as variantes dentro do `app-shell`/`app-header` reais |
| `PrototypeSwitcher.tsx`   | 78     | Barra flutuante bottom-center; setas ←/→ e teclado; gated em DEV              |
| `VariantA_Wizard.tsx`     | 173    | Variante A — wizard de etapas                                                 |
| `VariantB_Chat.tsx`       | 165    | Variante B — chat + artefato ao vivo                                          |
| `VariantC_Copilot.tsx`    | 144    | Variante C — documento primeiro, agente na margem                             |
| `VariantD_OneAtATime.tsx` | 133    | Variante D — uma pergunta por vez                                             |
| `VariantE_DevyFlow.tsx`   | 412    | **Variante E — a viva**: espinha do D + roteiro devy real                     |
| `Attachable.tsx`          | 151    | Wrapper de anexos (paste / drag-drop / botão 📎) usado pela E                 |
| `fixtures.ts`             | 245    | Dados canned das variantes A–D                                                |
| `devy-script.ts`          | 487    | Roteiro canned da variante E (nós, fases, recentes, arquivos salvos)          |
| `prototype.css`           | 1.296  | Estilos, usando **só** tokens de `src/ui/tokens.css`                          |

## Único arquivo de produção tocado

`apps/menubar/src/main.tsx` (**modified**, +44/-5). Duas edições:

1. Bloco `PROTOTYPE gate` antes do `ReactDOM.createRoot`:
   ```tsx
   const IS_PROTOTYPE =
     (import.meta as { env?: { DEV?: boolean } }).env?.DEV === true &&
     new URLSearchParams(window.location.search).get("proto") === "authoring";
   const PrototypeRoute = IS_PROTOTYPE
     ? React.lazy(() => import("./authoring-prototype/PrototypeRoute").then(...))
     : null;
   ```
2. No render: `PrototypeRoute ? <Suspense><PrototypeRoute/></Suspense> : IS_ABOUT ? <About/> : <Root/>`.

**Reversível removendo esse bloco + a pasta.** É lazy e DEV-only, então um merge acidental não
embute nem expõe o protótipo.

## As cinco variantes

- **A — Wizard de etapas**: trilha numerada (Ideia · Problema · Escopo · Plano · Revisão), vários
  campos por etapa, footer Voltar/Avançar. Documentos escondidos até a revisão final.
- **B — Chat + artefato ao vivo**: split. Conversa à esquerda; `spec.md`/`plan.md`/`todo.md` à
  direita preenchendo em tempo real com flash (`--accent-subtle`, 900 ms) no bloco recém-escrito;
  contador `n/7 respondidas`; dots por arquivo preenchido.
- **C — Documento primeiro, agente na margem**: textarea markdown ocupa a tela; margem direita de
  260 px lista lacunas ("Falta critério de aceite verificável") com "Escrever isso pra mim" que
  injeta o bloco; rodapé deriva plan → tasks.
- **D — Uma pergunta por vez**: tela quase vazia, pergunta 26 px, input sublinhado, sugestões
  clicáveis, `Pular`; rodapé com pips clicáveis por pergunta; no fim, os 3 arquivos de uma vez.
- **E — Roteiro devy (a que o usuário escolheu e iterou 4×)**: detalhada abaixo.

## Variante E — estado final detalhado

**Sequência de nós** (`sequence` montado em `VariantE_DevyFlow.tsx:58`):

```
PICK_FOLDER → (se answers.project) TRIAGE → DESCRIBE[track] →
  feature: FEATURE_SCRIPT (3 spec + 1 note + 2 refine + 2 plan + save)
  bug|debt: DEBUG_SCRIPT (repro + evidence + handoff)
```

**Tipos de nó** (`Node` em `devy-script.ts:69`): `folder` | `choice` | `text` | `note` |
`handoff` | `save`.

**Telas, em ordem:**

1. **`folder` — "Em qual projeto?"** (fase `projeto`, chip `loopy`). Três cartões de recentes
   (`RECENT_PROJECTS`), cada um com path monoespaçado + contexto lido do repo ("17 changes ·
   última C-0017 · branch main limpa"); o terceiro tem tag `NOVO`. Quarto cartão **tracejado**
   "Escolher outra pasta… / Abre o seletor do sistema" → chama `showDirectoryPicker()` do browser
   (no app real seria o dialog do Tauri; ausência ou cancelamento é no-op). Abaixo, link discreto
   "Colar um caminho…" (padrão `.pe-escape`) que revela `<input class="pa-input">` + botão
   "Usar ⏎".
2. **`choice` — "O que vamos desenvolver hoje?"** (fase `triagem`). Nova feature (RECOMENDADA) /
   Bug / Débito técnico + "Outro tipo de demanda…". `trackOf()` mapeia label → track; **"Outro"
   cai na trilha de debug** (investigar antes de planejar).
3. **`text` — descrição da demanda** (fase `descricao`), com texto diferente por track
   (`DESCRIBE.feature` / `.bug` / `.debt`). Envolvido em `<Attachable>`.
4. **Trilha feature**: 3 `choice` sob `/devy:spec` (objetivo · critério de aceite · boundaries) →
   1 `note` sob `/devy:refine` ("Não perguntei de onde vêm os dados — o código respondeu", com a
   fonte lida e botões "Está errado, quero decidir" / "Seguir") → 2 `choice` de refine (onde mora ·
   projeto sem `metrics:`) → 2 `choice` sob `/devy:plan` (fatiamento vertical · paralelismo) →
   `save`.
5. **`save`**: **sem preview de arquivo**. Spinner + "Salvando…" + path; após 1.500 ms vira
   `✓ Salvo` + path + linha `spec.md · plan.md · todo.md` + botão "Abrir o board". O `<h2>` do
   prompt é **suprimido** neste nó (`node.kind !== "save" && <h2>`). `← Voltar` desabilitado a
   partir do nó save.
6. **Trilha bug/débito**: `choice` de reprodução → `text` de evidência (com `Attachable`) →
   `handoff`: bloco `<pre>` com `/devy:debug <descrição>` montado + `<dl>` de contexto (Tipo /
   Reprodução / Evidência) + "Investigar agora". **Nenhum arquivo é criado nessa trilha.**

**Cartão de opção** (`.pe-option`): label + detalhe de uma linha + badge `RECOMENDADA` +
bloco `**Porquê:** …` separado por hairline. Exatamente uma opção recomendada por pergunta.

**Progresso**: chip do comando devy no topo (`loopy` / `/devy:spec` / `/devy:refine` /
`/devy:plan` / `/devy:debug`) + "N de M em <Fase>"; rodapé com trilha de fases
(`TRACK_PHASES`), que só se revela por completo depois da triagem (antes mostra
`Projeto · Triagem · Demanda · …`). `is-done` só quando o **último** nó da fase ficou para trás
(`lastIndexOf`, não `findIndex` — corrigido durante o trabalho).

**Anexos** (`Attachable.tsx`): envolve textarea/input. Três entradas — `onPaste` lendo
`e.clipboardData.files`, `onDragOver`/`onDrop` com overlay "Solte para anexar", e botão 📎 com
`<input type="file" multiple>` (`e.target.value = ""` no fim para permitir re-selecionar o mesmo
arquivo). Anexos viram chips: miniatura via `URL.createObjectURL` para imagens (revogado ao
remover), glifo `▤` para o resto, nome + tamanho humanizado + `×`. Estado por `node.id` em
`attached` (`Record<string, readonly Attachment[]>`).

**Header do shell na E**: o dir-picker vira **espelho** (`readOnly`, placeholder "nenhuma pasta
escolhida") e recebe a pasta escolhida via prop `onProjectChange` → `setDir` no `PrototypeRoute`.
Deliberado: evitar dois seletores concorrentes da mesma coisa.

## Verificação executada

- **Browser real** (`chrome-devtools-axi`, viewport 1280×820): percorri as duas trilhas da E ponta
  a ponta; conferi A, B (inclusive avançando 5 turnos), C e D; simulei **paste** de PNG + `.log`
  via `ClipboardEvent` com `DataTransfer` e **drop** via `DragEvent` — ambos produziram os chips
  corretos (`1|trace-do-run.txt`).
- `npm run typecheck` (raiz — cobre motor **e** menubar): limpo.
- `npm test -w apps/menubar`: **844 testes, 49 arquivos, todos passando**.
- `chrome-devtools-axi console --type error`: sem erros.
- `npx prettier --write` só nos arquivos do protótipo + `main.tsx` (memória: o repo está
  fora de sincronia com o prettier; nunca rodar format global).

## Leituras de código feitas para embasar o design

- `.claude/commands/devy/{spec,refine,plan,debug}.md` — **fonte da fidelidade da variante E**:
  - `spec`: pergunta objetivo/usuários, features+aceite, stack/constraints, boundaries; salva em
    `.harn/devy/changes/{C-XXXX}-{slug}`.
  - `refine`: "Interview me relentlessly… **For each question, provide your recommended answer**.
    Ask the questions one at a time. **If a question can be answered by exploring the codebase,
    explore the codebase instead**." → origem direta do nó `note` e do badge RECOMENDADA.
  - `plan`: plan mode read-only, grafo de deps, fatiar **vertical**, checkpoints.
  - `debug`: repassa `$ARGUMENTS` para a skill `debug-like-expert`.
- `apps/menubar/CLAUDE.md`, `apps/menubar/src/CLAUDE.md`, `src/ui/tokens.css`, `src/App.tsx`,
  `src/panes/ViewSwitcher.tsx`, `src/config/EmptyState.tsx`, `src/ui/index.ts`.
  </work_completed>

<work_remaining>

## Bloqueante: o usuário ainda não escolheu

Nenhuma variante foi declarada vencedora. O passo 6 do skill (`SKILL.md`) — dobrar o vencedor no
código real e mover o resto para um branch descartável — **não foi executado**. O feedback do
usuário até aqui converge fortemente para **E**, mas ele nunca disse "é essa, implementa".

## Lacunas de design conhecidas (levantadas e ainda abertas)

1. **A volta do `/devy:debug`.** A trilha de bug/débito termina no hand-off. Há só uma frase
   dizendo que "se a investigação virar trabalho, ela volta para a trilha da feature" — mas essa
   volta **não foi desenhada**. Pergunta em aberto: um débito investigado vira `todo.md` direto,
   sem passar pela spec inteira?
2. **Cobertura do `/devy:spec`.** O comando real pergunta **4 blocos** (objetivo+usuários,
   features+aceite, stack/constraints, boundaries); a E representa **3**. Se cada bloco vira uma
   tela, a trilha de feature passa de ~10 perguntas — vale medir se cansa.
3. **Anexos não foram propagados para A–D.** Deliberado (são variantes de comparação, descartáveis).
   Se o usuário quiser testar colar dentro do chat da B, é envolver o campo em `<Attachable>`.
4. **O `loopy.yml` está fora de escopo.** A E para nos três `.md`; a criação/edição do yml continua
   sendo o editor visual da C-0014.

## Se a E for escolhida — passos para produção

1. Substituir os canned de `devy-script.ts` por interação ACP real com o agente (o roteiro
   declarativo é a estrutura; as perguntas passam a vir do agente).
2. `PICK_FOLDER`: trocar `showDirectoryPicker()` pelo dialog do Tauri (`@tauri-apps/plugin-dialog`,
   já usado em `App.tsx:pickDir`). Os "recentes" precisam de persistência — hoje o app só guarda
   **um** dir em `launch-config.json`; vira uma lista.
3. Contexto dos recentes ("17 changes · última C-0017 · branch main limpa") exige comandos Rust
   novos: contar `.harn/devy/changes/*` e ler o estado do git. Hoje o Rust tem só
   `read_project_files` / `read_backlog` / `write_loopy_yml`.
4. Escrita dos três `.md`: comando Rust novo (o `write_loopy_yml` grava só o yml, com backup em
   `.loopy/backups/`). Decidir se os `.md` também levam backup.
5. Anexos precisam de destino real (hoje só `URL.createObjectURL` em memória) — provavelmente
   caminho de arquivo passado ao agente via ACP.
6. Onde a tela mora: hoje o app não tem rota; o empty-state é decidido por
   `configDraft.hasConfig === false` em `App.tsx`. A tela de autoria precisa de um gatilho —
   provavelmente "projeto sem backlog" — sem colidir com o `EmptyState` existente de "sem
   loopy.yml".
7. Reescrever sob restrições de produção: testes (o app tem 844), tipos estritos, i18n do texto
   pt-BR hardcoded, acessibilidade dos cartões (hoje são `<button>` com spans — ok, mas sem
   navegação por setas dentro do grupo).

## Limpeza obrigatória ao terminar

- Reverter o bloco `PROTOTYPE gate` de `apps/menubar/src/main.tsx` (é o **único** arquivo de
  produção sujo).
- Mover `apps/menubar/src/authoring-prototype/` para um branch descartável (é o _primary source_
  segundo o skill), deixando na `main` só a decisão dobrada no código real.
  </work_remaining>

<attempted_approaches>

## Design

- **4 variantes em vez das 3 default do skill** (cap é 5): incluí a D "uma pergunta por vez"
  justamente porque a preferência do usuário (TDAH, uma pergunta por vez) sugeria que ela venceria
  — e venceu, virando a espinha da E.
- **Variante E como arquivo novo, não reescrita da D**: a D ficou intacta para comparar a espinha
  contra a versão com o roteiro real.
- **Faixa lateral colorida no cartão de lacuna (variante C)**: o hook `impeccable` sinalizou
  `side-tab` ("o tell mais reconhecível de UI gerada por IA"). Trocado por um **dot semântico** com
  `::before`, que é a gramática de status do resto do app. Finding legítimo, corrigido.
- **Campo "…ou cole o caminho" ao lado do botão** (primeira versão do passo 0): rejeitado pelo
  usuário. Diagnóstico: input com só border-bottom (`pd-input`) grudado num botão ghost, sem
  alinhamento, quebrando o ritmo dos cartões e dando peso visual demais ao caso mais raro.
  Substituído por (a) quarto cartão tracejado para o browse e (b) link `.pe-escape` que revela um
  campo `pa-input` — o mesmo padrão de escape que todas as outras perguntas da E já usam.

## Bugs de layout encontrados e corrigidos

1. **Switcher flutuante cobria o footer das variantes** → `.proto-stage { padding-bottom: 46px }`
   reserva a faixa.
2. **`.pe-head` colapsava** sob conteúdo alto (flex-shrink default 1) e o chip do comando
   sobrepunha o conteúdo → `flex: none` em `.pe-head` e `.pe-foot`.
3. **`justify-content: center` cortava o topo** de conteúdo mais alto que a caixa (a tela de
   revisão ficava inalcançável) → `justify-content: safe center`.
4. **Botão "Usar ⏎" quebrava em duas linhas** → `white-space: nowrap` em `.pa-btn`.
5. **Trilha de fases marcava `is-done` cedo demais** (usava `findIndex` = primeiro nó da fase) →
   `lastIndexOf`.
6. **Título "Tudo respondido. Revise antes de gravar."** virou mentira quando o preview saiu →
   `<h2>` suprimido no nó `save` e o prompt do fixture trocado para "Gravando a change." (não
   renderizado).

## Ferramental — o que não funcionou

- `chrome-devtools-axi screenshot --out <path>`: a flag correta é posicional (`screenshot <path>`).
- `chrome-devtools-axi eval "const x = …"`: o eval trata a entrada como **expressão** →
  `Unexpected token 'const'`. Envolver em IIFE: `(() => { … })()`.
- **Cliques via `eval` + `.click()`** não avançaram o React de forma confiável nas primeiras
  tentativas; o que funcionou foi `snapshot | grep 'button "…"' | click @uid`.
- **Medir o DOM logo após disparar um evento** retorna o estado pré-render (o `querySelectorAll`
  logo depois do drop devolveu `0`); medir num segundo `eval` devolveu `1|trace-do-run.txt`.
- **`import.meta.env`** não tipa neste tsconfig (sem `vite/client`) → cast
  `(import.meta as { env?: { DEV?: boolean } }).env?.DEV === true` nos dois pontos de uso. Não
  mexi no tsconfig porque é arquivo de produção.
- **Screenshot inicial saiu 1200×2029** (viewport gigante, header parecendo duplicado) →
  `chrome-devtools-axi resize 1280 820` antes de capturar.
- Criei por engano `apps/henrique-placeholder` numa chamada acidental de Write; removido no ato.
  </attempted_approaches>

<critical_context>

## Restrições do skill `/prototype` (`~/.claude/skills/prototype/`)

- Código **descartável desde o dia um** e marcado como tal → todo arquivo abre com
  `PROTOTYPE — throwaway`.
- **Um comando para rodar**: `npm run dev:web -w apps/menubar` (Vite puro, sem Rust; `isTauri()`
  false).
- **Sem persistência**: estado em memória; nada escreve em disco.
- **Sem polimento**: sem testes, sem tratamento de erro além do necessário para rodar.
- Variantes devem ser **estruturalmente diferentes**, não variações de cor.
- Sub-shape A (hospedar numa página existente) é preferido — daí montar dentro do `app-shell` real.

## Convenções do repo que o protótipo respeita

- **Nenhuma cor literal**: tudo de `src/ui/tokens.css` (OKLCH). O acento magenta significa
  exatamente três coisas: interativo, vivo, gate humano.
- Prefixos CSS por variante: `pa-` (compartilhado/A), `pb-` (B), `pc-` (C), `pd-` (D), `pe-` (E),
  `pf-` (anexos), `proto-` (shell/switcher).
- **`npm test` na raiz NÃO roda os testes do menubar** — é `npm test -w apps/menubar`.
- `npm run typecheck` da raiz **cobre** o app.
- **Prettier do repo está fora de sincronia** (~368 arquivos pré-existentes reprovam): formatar
  **só** os arquivos editados.
- Duas cópias de React (raiz 19 para Ink, app 18); não mexer na config de dedupe.

## Fatos do domínio que a variante E encena (e que precisam continuar verdadeiros)

- Os três `.md` vão em `.harn/devy/changes/C-XXXX-<slug>/` — **não** em `tasks/` (o
  `/devy:plan` diz `tasks/plan.md`, mas a convenção real deste repo é a pasta da change).
- `Deps:` no `todo.md` vira aresta do DAG. O `/devy:plan` da E recomenda **serializar** T-004 e
  T-005 porque tasks concorrentes no mesmo arquivo conflitam no merge e `on_merge_conflict: rebase`
  não resolve.
- Telemetria é **insert-only** e o leitor Rust é **SELECT-only** (ADR-0011) — usado como
  justificativa do boundary "nunca escrever no `.db`".
- Arquivo ausente = `None`, **não erro** — é assim que o app decide empty-state. Usado como
  justificativa do "projeto sem `metrics:` mostra empty-state".

## Gotchas do ambiente

- O Vite dev server foi iniciado em background nesta sessão (`npm run dev:web -w apps/menubar`,
  porta 5173) e **pode ainda estar rodando**. URLs: `http://localhost:5173/?proto=authoring&variant=<A..E>`.
- Vários comandos `Bash` **resetaram o cwd** para a raiz do repo após rodar em background —
  usar caminhos absolutos ao anexar conteúdo a arquivos (`cat >> /abs/path`).
- O hook `impeccable` roda a cada Write/Edit e suprime dicas após 6 edições no mesmo arquivo
  (`/impeccable audit` revisita).

## Suposições que precisam de validação do usuário

- A tela de autoria substitui o vazio de hoje quando **o diretório não tem backlog** (o
  `EmptyState` atual é para "sem `loopy.yml`" — são condições diferentes).
- "Outro tipo de demanda" cai na trilha de **debug**, não na de feature.
- A confirmação do save mostra **path + nomes** dos arquivos. O usuário pediu "apenas um spinner de
  salvando e salva"; mantive path e nomes porque sem eles não se sabe onde a change foi parar.
  **Se ele quiser literalmente nada, é remover 2 linhas.**
  </critical_context>

<current_state>

## Status

- **Protótipo: completo e funcional.** Cinco variantes rodando, todas verificadas no browser real.
- **Decisão de design: pendente.** Nenhuma variante foi oficialmente escolhida; a E incorpora
  quatro rodadas de feedback do usuário e é a candidata de fato.
- **Nada foi dobrado no código de produção.** Nada foi commitado.

## Git

Branch `main`, HEAD em `2b6bd6d`. Working tree:

```
 M apps/menubar/src/main.tsx          (+44/-5 — o gate DEV-only)
?? apps/menubar/src/authoring-prototype/   (11 arquivos + este handoff)
```

## Como retomar

```bash
npm run dev:web -w apps/menubar
# http://localhost:5173/?proto=authoring&variant=E   ← a viva
# ?variant=A|B|C|D                                   ← comparação
# setas ←/→ ou a barra flutuante trocam de variante
```

## Perguntas abertas para o usuário

1. **A E é a escolhida?** Se sim, dobro no código real e mando o conjunto para um branch
   descartável.
2. A volta do `/devy:debug` para a trilha de trabalho — desenhar agora ou deixar fora do v1?
3. As 4 perguntas do `/devy:spec` viram 4 telas (trilha de ~10 perguntas) ou continuam
   condensadas em 3?
4. Levar os anexos para as variantes A–D (só se ele quiser testá-las com anexo)?
   </current_state>
