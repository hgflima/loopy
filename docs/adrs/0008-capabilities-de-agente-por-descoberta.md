---
number: 0008
title: "Capabilities de agente por descoberta: configOptions como fonte, sem vocabulário canônico"
status: accepted
date: 2026-07-14
status_date: 2026-07-14
supersedes: []
superseded_by: null
---

# ADR-0008 — Capabilities de agente por descoberta: `configOptions` como fonte, sem vocabulário canônico

## Context

O motor é 100% agnóstico a agente (zero `if (agent === 'claude')`; registry de
chave livre; spawn por argv), mas o operador não tem como saber o que escrever
num `loopy.yml` multi-agente sem adivinhar. `mode`, `model` e `effort` são
vocabulário por-Agente **e por-versão** — ex.: `plan` no Claude é `-32602
Invalid params` no Codex; o Codex tem `xhigh` onde o Claude tem `max`; o
OpenCode não tem effort algum — e o yml os aceita como string livre.

Pior: o OpenCode **escapava de qualquer validação** client-side. O motor
validava `mode` contra `session.modes.availableModes` (`session.ts:216`), e o
OpenCode devolve esse campo **nulo**. O `if` simplesmente não rodava — qualquer
`mode:` passava silenciosamente sem checagem.

A crença que sustentava o desenho anterior era: "o OpenCode não anuncia modes,
então precisamos de um vocabulário canônico (`read-only`/`write`/`full-access`)
com tradução por adapter". As spikes (`spikes/acp-opencode-capabilities.ts`,
2026-07-13) derrubaram a premissa: os dados **sempre estiveram lá**, na mesma
estrutura de onde o motor já lia model e effort:

| | `availableModes` | `configOptions[category="mode"].options` |
|---|---|---|
| claude 0.59 | `[auto, default, acceptEdits, plan, dontAsk, bypassPermissions]` | os mesmos 6 |
| codex 1.1.2 | `[read-only, agent, agent-full-access]` | os mesmos 3 |
| **opencode 1.17.9** | **`null`** ← o furo | **`[build, plan]`** ← os dados estão aqui |

`configOptions` é a **mesma** estrutura de onde `findConfigId` já descobria
`model` (categoria `model`) e `effort` (categoria `thought_level`). O motor
estava lendo a **fonte errada** para modes — e a descoberta que se acreditava
impossível funciona nos três adapters, nos três eixos.

Forças em tensão:

1. **AD-1 (config-driven):** o motor não pode embutir tabela de agentes. Mas
   precisa validar antes de gastar tokens.
2. **Validação fail-closed de mode:** mode governa autonomia (read-only ×
   write); um mode inválido silencioso é risco de corretude.
3. **Best-effort de model/effort:** o adapter pode ignorar — o motor deve avisar
   alto, não fingir que funciona nem clampar (escalas diferentes ≠ "equivale").
4. **GUI:** o operador precisa de selects com os valores **reais** do agente,
   não uma tabela hardcoded que envelhece.
5. **Vocabulário por-versão:** o Claude 0.26 não tinha effort; a 0.59 tem. Um
   `npx -y` puxando uma versão nova muda o que o adapter anuncia. A tabela
   estática envelhece; a sondagem, não.

Alternativas consideradas e **rejeitadas**:

- **Vocabulário canônico (`read-only`/`write`/`full-access`) + tabela de
  sinônimos por adapter.** A premissa era "a descoberta falha no OpenCode". É
  falsa. Sem o furo, o canônico vira uma camada de tradução que só adiciona
  indireção e **envelhece** a cada versão de adapter. O yml esconderia o que
  realmente vai ser enviado. (Decisões revogadas D1/D2/D13/D14.)
- **Fallback por tentativa em ordem** (`set_mode` até um pegar). Remendo às
  cegas para o furo que não existe; o match agora é determinístico contra a
  lista anunciada. (D3 revogada.)
- **`mode` traduz.** Não traduz mais: valida. (D4 revogada.)
- **Enforcement client-side de read-only** (permission resolver nega
  `edit`/`delete`/`move`; fs port rejeita write). Dependia do conceito canônico
  como gatilho. Sem conceito, o motor vê `mode: plan` como string opaca do
  vendor. Decisão consciente: confiar no adapter, que é o comportamento de
  hoje — não é regressão, é a melhoria que não será feita. (D19/D20 revogadas.)
- **Selects de vocabulário canônico/união.** Substituídos por selects sondados:
  valores reais do agente, não um vocabulário inventado nem uma união que mistura
  escalas. (D21/D25 revogadas.)
- **Cache do dialeto resolvido por agente.** Sem tradução, não há dialeto a
  resolver. O cache que resta é o das capabilities. (D22 revogada.)

## Decision

### 1. `configOptions` é a fonte da verdade (não `availableModes`)

O motor descobre `mode`, `model` e `effort` **por categoria** nos `configOptions`
do `session/new` ACP — o mecanismo que `findConfigId` já usava para model e
effort, agora estendido a mode. Materializado em `parseCapabilities(configOptions,
fallbackModes?)` (`src/acp/capabilities.ts`): parse puro (AD-6) que retorna
`AgentCapabilities { modes, models, efforts }` + os `configId`s. Legacy
`availableModes` serve de fallback quando `configOptions` não anuncia a
categoria `mode`.

### 2. Sem canônico, sem tradução — dialeto literal

O yml guarda o **dialeto literal** do Agente (`mode: plan`, `mode: build`). O
motor **não traduz nada** — o arquivo diz exatamente o que será enviado. Trocar
de agente exige reescolher os valores; a GUI torna isso trivial (selects
sondados) e o motor falha alto se o operador esquecer.

### 3. Validação por assimetria: fail-closed × best-effort + warning

- **`mode`:** fail-closed contra a lista anunciada, **nos três adapters**
  (inclusive OpenCode, que antes escapava). Mensagem acionável: `mode
  'acceptEdits' não é aceito por 'opencode' (aceita: build, plan)`.
- **`model`/`effort`:** ignora (não chama `set_config_option`) e emite
  **warning visível** (novo `StoreEvent` `warning`, 14.º tipo). Não clampa: o
  motor não finge que `xhigh` do Codex "equivale" ao `max` do Claude.

### 4. Validação eager no início do Run (D36)

Assim que cada Processo de Agente sobe (spawn eager, `pool.ts`), o motor abre
uma **sessão descartável** no `workspace.root`, lê as capabilities, valida
**todos os steps que o referenciam** e grava o cache. Um yml errado aborta em
segundos — **zero worktree, zero token**. Sem isso, a validação fail-closed
chegaria tarde demais.

### 5. Sondagem para a GUI e CLI (D30)

Novo subcomando `loopy probe-agent <nome> [--json]`: spawna o adapter, faz
`initialize` + `session/new`, imprime as capabilities e encerra. A GUI chama ao
selecionar um agente e popula os selects com **os valores reais**. Zero tabela
hardcoded. Cache em `.loopy/capabilities.json` (Artefato, gitignored), keyed
pelo `command`, com botão de refresh.

### 6. Dry-run valida pelo cache (D37)

O `--dry-run` **não sonda** (zero processo, por contrato), mas lê o cache quando
existe e reporta. Sem cache, imprime `capabilities: não verificadas (rode
'loopy probe-agent')`. A autoridade é a validação eager do Run (D36), contra o
adapter vivo.

## Consequences

- **Positivo:** o OpenCode passa a ser validado; mode inválido falha **no início
  do Run** (zero token gasto); a GUI oferece **exatamente** o que o agente
  aceita, sem tabela estática; effort/model inválidos viram aviso visível em vez
  de silêncio; zero dependência nova; o `loopy.yml` mostra sem ambiguidade o que
  vai ser enviado.
- **Negativo / custo:** trocar de agente num Step exige reescolher mode/model/
  effort no dialeto do novo agente (a GUI ajuda; o motor falha alto se esquecer).
  A sondagem custa ~1s por agente (o `npx -y` pode baixar o pacote); mitigada
  pelo cache. Cache velho pode reprovar um yml correto no dry-run — por isso o
  dry-run apenas reporta (não decide); a autoridade é a validação eager.
- **Decisão consciente:** enforcement client-side de read-only **não é feito**
  (dependia do canônico como gatilho). O `mode` do adapter é a única fronteira,
  como já era — não é regressão.
- **Risco aceito:** `configOptions` é a estrutura que o SDK ACP expõe; se um
  adapter futuro não a popular, o fallback `availableModes` entra para mode e os
  outros dois eixos degradam para listas vazias (informação real: "não anuncia").
- **D-0003 fechado:** o débito pedia "uma interface única que faça o de/para". A
  resposta é **não fazer de/para — expor**. O de/para envelhece a cada versão de
  adapter; a descoberta, não.
