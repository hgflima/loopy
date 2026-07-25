# Plano: C-0018 — aba **Specs** (autoria de spec/plan/todo dentro da GUI)

> Narrativa, grafo de dependências, checkpoints e riscos. As **tasks** vivem em
> `todo.md` (mesma pasta); as **26 decisões de produto**, em `spec.md`.

---

## Overview

Hoje os inputs de um Run (`spec.md`/`plan.md`/`todo.md`) só nascem num terminal,
rodando `/devy:spec`, `/devy:refine`, `/devy:plan` à mão. A GUI sabe **observar e
dirigir** um Run que já tem backlog; a etapa anterior — onde o trabalho de verdade
é decidido — vive fora dela.

Esta change fecha o buraco com um **5.º segmento no `ViewSwitcher`, `Specs`**, que
lista as Changes do projeto e conduz uma **Entrevista**: uma conversa dirigida por
um Agente ACP, uma pergunta por vez, com opção recomendada e o porquê explícito,
que termina com os três `.md` gravados na pasta da Change. **Sucesso**: começar e
terminar uma Change inteira sem sair da GUI, e o board carregar o backlog
recém-criado sem passo manual.

O plano decide **a mecânica e a ordem** de fazer o que a spec manda. As decisões
D1–D26 estão fechadas — nenhuma task as re-litiga.

---

## Architecture Decisions

Decisões **deste plano** (as de produto estão na `spec.md`):

1. **`promptBlocks` vive em `LoopySession`, não em `AgentSession`.** A spec marca
   "aceitar `ContentBlock[]` no prompt" como *ask first* porque `src/types.ts` é
   contrato congelado. Mas o `run.ts` da Entrevista recebe um **`LoopySession`**
   do `pool.session()` — não passa por `StepContext`. Declarar o método em
   `src/acp/session.ts` (que já `extends AgentSession`) **não toca `types.ts` e
   não quebra um único fake de teste**; widenizar `prompt(text: string)` para
   `string | ContentBlock[]` quebraria a tipagem contextual dos fakes em
   `tests/steps/support.ts`, `tests/loop/support.ts` e `tests/fixtures/fake-agent.ts`
   sem ganho nenhum. O SDK já aceita blocos (`acp.d.ts:307`).

2. **`Phase` e `AskOption` são declarados em `src/tui/transport.ts`.** Fazem parte
   do contrato de fio (aparecem dentro dos frames), o barrel já é subpath export
   com `dts` e a GUI o consome. Declará-los em `src/interview/` obrigaria o
   transport a importar de um módulo não-exportado.

3. **T-001 também mexe em `apps/menubar/src/state/store-bridge.ts`.** Não é escopo
   extra: `applyControl(ui, control): UIState` faz `switch` sem `default`
   (`store-bridge.ts:81-101`), então **qualquer** variante nova de `ControlFrame`
   vira TS2366 e derruba `npm run typecheck`. Os seis controls da Entrevista não
   pertencem ao `BridgeState` do Run — o bridge os **ignora**. (`notify.ts` já tem
   `default: return null`; não precisa mudar.)

4. **`.harn/devy/changes/` é uma constante, declarada duas vezes e só duas.** Uma
   no motor (`src/interview/phases.ts`, ao lado da tabela fase→comando) e uma no
   Rust (`changes.rs`). É o preço explícito da D1 ("só funciona onde o harness devy
   está instalado") — não é comportamento de loop, é o endereço do harness.

5. **Nenhuma aresta força o Checkpoint A.** A OQ1 ("o envelope sobrevive ao Agente
   real?") é o maior risco da change, mas a spec diz que não bloqueia o início — e
   a D3 (fallback para pergunta aberta) faz a GUI valer nos dois mundos. O
   checkpoint é **humano e bloqueante para a Fase 4**, não uma aresta do DAG.

6. **Cada componente da Entrevista num arquivo, todos numa task.** A spec define
   **um** `specs.css`; separar os componentes em tasks paralelas os faria colidir
   nesse arquivo no merge.

---

## Dependency Graph

```
      MOTOR                      RUST                    GUI (React)
 ┌──────────────┐          ┌──────────────┐
 │ T-001        │          │ T-007        │
 │ frames       │          │ changes.rs   │
 └──┬────┬───┬──┘          └──────┬───────┘
    │    │   │                    │
    │    │   └────────────────┐   │
    ▼    ▼                    ▼   ▼
 T-002  T-003              T-009  T-008
 parse  envelope+          interview- interview_
 -ask   phases             state.ts   process.rs
    │    │                    │  │      │
    │    │  ┌── T-004 ────┐   │  └──┬───┘
    │    │  │ anexos +    │   │     ▼
    │    │  │ promptBlocks│   │   T-010  useInterviewProcess
    ▼    ▼  ▼             │   │     │
   ┌────────────┐         │   ▼     │
   │  T-005     │         │  T-011  │  componentes
   │  run.ts    │         │   │     │
   └─────┬──────┘         │   └──┬──┘
         ▼                │      ▼
      T-006               │    T-012  Interview.tsx
      subcomando          │      ▼
         │                │    T-013  SpecsPane (+ config.rs)
         ▼                │      ▼
      T-016  ADR-0012     │    T-014  D20 — barra sempre visível
                          │      │
                          │  ┌───┴────┬────────┐
                          │  ▼        ▼        ▼
                          │ T-015   T-017    T-018
                          │ D11     docs     limpeza
```

Três arestas existem **para serializar merge**, não por lógica — e por isso não
podem ser removidas (`loopy-parallel-tasks-same-file`):

- **T-008 → T-007**: os dois registram comando em `src-tauri/src/main.rs`.
- **T-015 → T-014**: os dois editam `apps/menubar/src/App.tsx`.
- **T-017 / T-018 → T-014**: dependem do código final (glossário e SC17).

Largura máxima da camada topológica: **4** (T-002, T-003, T-008, T-009). Com
`concurrency: auto` e o `max_concurrency: 6` deste repo, a concorrência efetiva é
`min(4, 6) = 4` — confirmado por `npm run dev -- --dry-run`, que também prova que o
grafo é acíclico e não tem Dep órfã.

---

## Phases

### Fase 1 — Fundação: contrato de fio e os puros — T-001, T-004, T-002, T-003

Frames aditivos, os módulos puros de `src/interview/` e os anexos. Nada spawna
processo; tudo é testável sem ACP.

**Checkpoint:** `npm run typecheck` (motor **e** menubar) limpo; `npm test` verde;
`npm test -w apps/menubar` ≥ 844 verde. **SC1** e **SC2** atendidos.

### Fase 2 — O subcomando `loopy interview` — T-005, T-006

Uma Fase ponta a ponta: um Processo, uma Sessão em `cwd = <dir>`, envelope no turno
1, lembrete nos demais, frames no stdout, comandos pelo stdin, `<loopy-done/>` →
exit 0.

**Checkpoint A (manual) — metade já respondida antes de escrever código.**

A parte cara da OQ1 foi resolvida em **2026-07-25** pela spike
`spikes/acp-claude-interview-envelope.ts` (um turno real, `claude-agent-acp 0.59.0`,
`mode: acceptEdits`): **o envelope sobreviveu** — um bloco `<loopy-ask>`, JSON
válido, exatamente uma opção `recommended`, `why` preenchido, e `finding`+`source`
espontâneos já na fase `spec`. A D3 continua sendo o degradado, não o padrão.
Achados completos em `spikes/README.md`.

O que **sobra** para este checkpoint, e por isso ele continua existindo:

```bash
npm run dev -- interview . --emit-events
# responder pelo stdin: {"type":"question_answer","questionId":"…","text":"…"}
```

(a) o `<loopy-change dir=…/>` é reportado **antes** de gravar — **não provado**: o
turno 1 perguntou antes de criar qualquer pasta, então o report do dir só aparece
quando a fase for de fato gravar. É para isso que a D10 carrega o fallback de
snapshot. (b) `<loopy-done/>` encerra e o processo sai 0. (c) o envelope aguenta o
**turno 10**, não só o primeiro (é a aposta específica da D15).

Duas consequências de produto que a spike trouxe e que a implementação não pode
ignorar:

- **328 s (5,5 min) até a primeira pergunta** — o agente spawnou sub-exploradores
  antes de perguntar. A **D14 não é enfeite**: sem prova de vida o humano encara
  uma tela parada por cinco minutos e conclui que travou.
- **1.427 chars de prosa fora do bloco, concatenados sem quebra de linha.** A linha
  viva da D14 tem de vir do `session/update` **ao vivo**; fatiar o texto final do
  turno produz um blocão colado, não uma linha de atividade.

### Fase 3 — A ponte Rust — T-007, T-008

`read_changes`/`discard_change` e o `InterviewState` — um segundo processo
gerenciado, que **não** mata o sidecar do Run.

**Checkpoint:** `cd apps/menubar/src-tauri && cargo test` verde. **SC4** atendido.

### Fase 4 — A GUI — T-009, T-011, T-010, T-012, T-013, T-014, T-015

Redutor puro → ponte de processo → componentes → fluxo → aba → barra sempre visível
→ "Abrir o board".

**Checkpoint:** as duas suítes verdes; **SC5–SC16** verificados à mão num projeto de
teste **e** num diretório sem `loopy.yml`.

### Fase 5 — Registro e limpeza — T-016, T-017, T-018

ADR-0012, glossário/intent nodes, e o protótipo fora da `main`.

**Checkpoint:** **SC17** — `authoring-prototype/` não existe, `main.tsx` sem o gate
`PROTOTYPE`, `git status` limpo.

---

## Risks and Mitigations

| Risco | Impacto | Mitigação |
|---|---|---|
| ~~O envelope não sobrevive ao Claude real~~ (OQ1 / D2 / D15) | ~~Alto~~ → **resolvido** | **Respondido em 2026-07-25** pela spike `acp-claude-interview-envelope.ts`, antes de qualquer código: bloco válido, 1 `recommended`, `why` e `finding` presentes. Resta o Checkpoint A para o `<loopy-change>` e para o turno 10 |
| Frame novo quebra `apps/menubar/` em tempo de build | Alto | T-001 é a primeira task e já corrige `applyControl`; a Boundary "estender **aditivamente**" vale para todas |
| `discard_change` destrói arquivo do usuário | Alto | `rename` para `.loopy/trash/`, nunca `remove_dir_all` (D21); confinado por `resolve_within`; `cargo test` recusando `..` (SC4/SC16) |
| D20 quebra os 844 testes do app | Médio | T-014 é a **única** task que toca `App.tsx`/`ViewSwitcher.tsx`; teste que quebra por shape de frame é bug **desta** change, não teste a atualizar |
| Conflito de merge entre tasks concorrentes | Médio | As três arestas de serialização acima; nenhuma outra task divide arquivo |
| Contaminação do harness no merge (`.claude/`) | Médio | Lição já paga: eslint ignora `.claude/` + `.worktrees/`, e o step de commit usa `git add -A -- .` puro |
| Dogfooding com `tauri dev` mata o motor-filho | Médio | Rodar o Run pelo CLI, ou `tauri dev --no-watch` |
| Prettier global reprova ~368 arquivos pré-existentes | Baixo | `npx prettier --write <arquivo>` **só** nos arquivos tocados; nunca `npm run format` |

---

## Verification

Ao fechar **qualquer** task:

```bash
npm run typecheck                       # cobre motor E menubar
npm run lint
npm test                                # vitest, tests/** (NÃO cobre o app)
npm test -w apps/menubar                # 844 testes hoje, 49 arquivos
cd apps/menubar/src-tauri && cargo test  # só nas tasks Rust
```

Ponta-a-ponta (os Success Criteria `[M]` da spec):

```bash
npm run dev -- interview /caminho/do/projeto --emit-events   # Fase 2, cru
npm run dev -w apps/menubar                                  # Fase 4, app completo
npm run dev:web -w apps/menubar                              # UI só, sem Rust
```

Roteiro manual mínimo, nesta ordem: **SC5** (lista ordenada, estado dos três `.md`)
→ **SC6** (≥1 cartão com uma única `RECOMENDADA` e o porquê visível) → **SC7** (os
três `.md` na pasta; `todo.md` parseia) → **SC8** ("Abrir o board" + save bar dirty)
→ **SC9** (fechar após a fase `spec`, reabrir, `Continuar` entra em `refine`) →
**SC15** (tudo isso num diretório **sem** `loopy.yml`) → **SC12** (com um Run
rodando, a aba não mata o sidecar e exibe o aviso) → **SC16** (Descartar move para
`.loopy/trash/`) → **SC10**, **SC11**, **SC13**, **SC14**.

---

## Open Questions

Herdadas da spec — nenhuma bloqueia o início:

1. **Quantas perguntas o `/devy:spec` faz na GUI** — medir na primeira Entrevista
   real; o botão "Chega" (D17) é a válvula.
2. **Acessibilidade dos cartões** — hoje `<button>` com spans, sem navegação por
   setas dentro do grupo. Levantada no handoff do protótipo, ainda aberta.
3. **A "volta do debug"** (investigação → `todo.md` direto) segue fora do v1 (D4).
