---
number: 0010
title: "Catálogo de Agentes: o argv por `preset`, as capabilities por sondagem"
status: accepted
date: 2026-07-14
status_date: 2026-07-14
supersedes: []
superseded_by: null
---

# ADR-0010 — Catálogo de Agentes: o argv por `preset`, as capabilities por sondagem

## Context

O `agents:` exigia `command` — o argv literal do adapter — e o operador tinha
que digitá-lo:

```yaml
agents:
  claude:
    command: ["npx", "-y", "@agentclientprotocol/claude-agent-acp@0.59.0"]
```

Esse argv **não é preferência**: é conhecimento do projeto, e cada um dos três
adapters tem uma armadilha diferente.

- **Claude:** precisa de **pin de versão**. A `0.26` não anuncia `effort`; a
  `0.59` anuncia. Um `npx -y` sem pin muda o vocabulário do agente debaixo do
  yml (é o que a memória do projeto registra como "o dialeto é por-VERSÃO").
- **Codex:** outro pacote npm, outro nome.
- **OpenCode:** **não é npm** — é subcomando do binário (`opencode acp`). Quem
  assume "todo adapter é `npx -y <pacote>`" escreve um comando que não sobe.

Errar qualquer um desses três detalhes não dá erro de config: dá um processo que
não inicia, e o operador recebe "spawn falhou". A GUI expunha o `command` como um
array editável (`+ Add command`), pedindo que o operador adivinhasse o que o
código já sabia.

Já existia um paliativo: `AGENT_PRESETS`, uma lista **GUI-only** (T-011, D27) que
preenchia o array no botão "Add agent". Ela envelheceu à parte — não tinha o pin
do Claude que o `loopy.yml` deste repo carrega — e, uma vez criado o agente, o
argv voltava a ser um array cru na cara do operador. O yml, o motor e a GUI
tinham três respostas diferentes para "qual é o comando do Claude?".

**A tensão com o ADR-0008.** Aquele ADR decidiu **"zero tabela hardcoded"** e
fechou o D-0003 com "não fazer de/para — expor". Um Catálogo parece contradizê-lo.
Não contradiz, e a distinção é a decisão inteira deste ADR:

|  | Muda por versão do adapter? | Descobrível sem subir o processo? |
|---|---|---|
| `mode` / `model` / `effort` | **sim** | sim — o adapter os anuncia em `configOptions` |
| **argv** | não (é *como se sobe* o processo) | **não** — é o pré-requisito da descoberta |

O ADR-0008 proíbe tabela do que o adapter **anuncia**, porque ela envelhece e a
sondagem não. O argv é a única coisa que a sondagem **não pode** descobrir: é o
que ela precisa saber antes de começar. Uma tabela é insustentável; a outra é
o único lugar onde a informação pode morar.

## Decision

### 1. Catálogo de Agentes — argv, e só argv

`src/acp/catalog.ts`: módulo puro (browser-safe, sem `node:`) com o argv de cada
adapter conhecido — `claude` (pinado em 0.59), `codex`, `opencode` — mais um
`label` e uma `note` (o *porquê* daquele argv, que a GUI exibe como hint).

O Catálogo **não declara mode, model nem effort**. Esses três seguem vindo da
Sondagem (ADR-0008), do adapter vivo. O Catálogo carrega exatamente o que a
Sondagem não consegue descobrir: como subir o processo.

### 2. `preset` × `command` — XOR, e um dos dois obrigatório

```yaml
agents:
  claude:
    preset: claude        # empresta o argv do Catálogo
    model: opus[1m]
  meu-adapter:
    command: ["meu-acp", "--stdio"]   # a saída para fora do Catálogo
```

O schema (`.strict()` + `superRefine`) rejeita os dois juntos, rejeita nenhum, e
rejeita um `preset` fora do Catálogo — apontando a saída (`use 'command'`).

**O Catálogo não é allowlist.** O Registry segue de chave livre e um adapter
desconhecido roda igual, via `command`. O que muda é só quem digita o argv.

### 3. O `preset` morre no parse (AD-1)

`resolveAgents` (`src/config/parse.ts`) — o ponto único onde o Registry é
normalizado — troca `preset` por `command` e o `preset` **não sobrevive à
resolução**. Da resolução em diante, todo consumidor (pool, dry-run,
`probe-agent`, o cache de capabilities keyed por argv) vê uma forma só.

É isso que mantém o AD-1 intacto: o motor não ganha nenhum `if (agent ===
'claude')`. O `preset` é conveniência **de escrita** do yml, não um conceito de
runtime. Materializado na assimetria de tipos: `AgentDefSource` (a forma-fonte,
com `preset`) × `AgentDef` (a resolvida, com `command` garantido).

### 4. A GUI consome o mesmo Catálogo

O `ConfigPane` importa o Catálogo pelo barrel `@hgflima/loopy/config`
(browser-safe) e troca o array de `command` por um **select de `preset`**; o
`command` e o `env` vão para um disclosure "avançado", aberto por default só no
custom — onde o argv é de fato o campo principal. Trocar para custom **semeia** o
`command` com o argv que estava valendo (o custom quase sempre é "o preset, com
um ajuste").

Isso mata a terceira cópia: a GUI, o yml e o motor passam a ter **uma** resposta
para "qual é o comando do Claude?".

## Consequences

- **Positivo:** o `loopy.yml` deixa de carregar `npx -y …` (o deste repo tem
  zero argv e resolve para exatamente os mesmos comandos de antes, pin
  incluído); o pin do Claude passa a ser aplicado a todo mundo que usa o preset,
  não só a quem lembrou de digitá-lo; a GUI para de pedir o que o código sabe; a
  lista GUI-only some, e com ela o drift entre as três cópias.
- **Negativo / custo:** o schema congelado muda (`command` deixa de ser
  obrigatório) — mudança **aditiva** e retrocompatível: todo yml com `command`
  segue válido, e os testes existentes provam isso. Um argv do Catálogo que
  quebre (pacote despublicado, versão puxada) vira problema de *todos* os
  usuários do preset, não de um yml — o preço de centralizar. Mitigação: rodar
  `loopy probe-agent` contra um preset novo antes de commitá-lo.
- **Risco aceito:** o pin do Claude (`@0.59.0`) envelhece. Ele é um teto que
  precisa ser subido à mão quando uma versão nova valer a pena — de propósito: é
  a alternativa a deixar `npx -y` trocar o dialeto do agente sem avisar.
- **Fronteira que fica registrada:** capability (o que o adapter anuncia) é
  **sondada**; argv (como o adapter sobe) é **catalogado**. Um ADR futuro que
  queira pôr `mode`/`model`/`effort` no Catálogo está revogando o ADR-0008 — e
  precisa dizer isso.
