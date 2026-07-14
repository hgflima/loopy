# D-0003 — Não há uma interface única que faça o de/para das particularidades de cada coding agent (mode/model/effort); o dialeto de cada adapter vaza pro yml

> **Status:** resolvido em C-0016 (ADR-0008) · **Severidade:** média · **Área:** `src/acp/session.ts` · `src/acp/capabilities.ts` · `src/steps/agent.ts` · `src/config/schema.ts` · `src/types.ts`
> **Descoberto em:** 2026-07-12 · **Origem:** spikes ACP (`spikes/acp-codex-capabilities.ts` · `spikes/acp-claude-capabilities.ts`) — ao medir os vocabulários reais de Codex e Claude via `session/new`
> **Resolvido em:** 2026-07-14 · **Resolução:** C-0016 / ADR-0008 — resolvido **por outro caminho**: não por abstração (de/para), mas por **descoberta** (`configOptions`). Ver §Resolução abaixo.

## Sintoma

O motor **não tem uma camada que abstraia as particularidades de cada coding
agent**. `mode`, `model` e `effort` são strings cruas que o motor repassa ao
adapter, mas **cada adapter tem vocabulário e semântica próprios**, descobertos só
em runtime. O caso mais gritante é `mode`: um Step com `agent: codex` precisa
`mode: agent`; o **mesmo conceito de autonomia** no Claude chama-se `acceptEdits`.
Não existe uma noção canônica ("quero read-only" / "quero editar") que o motor
resolva para o `modeId` de cada adapter — o de/para fica espalhado entre **a
cabeça do autor do yml** (escrever o mode certo por agente) e **uma validação
fail-hard tardia** no meio do run.

As spikes tornaram a disparidade concreta (Codex/OpenCode 2026-07-12/13; Claude
**recapturado em 2026-07-14 na 0.59**):

| | Codex (codex-acp 1.1.2) | Claude (claude-agent-acp 0.59) |
|---|---|---|
| **modes** | `read-only` / `agent` / `agent-full-access` | `auto` / `default` / `acceptEdits` / `plan` / `dontAsk` / `bypassPermissions` |
| **effort** (`thought_level`) | `low`..`xhigh`, id `reasoning_effort` | `low`..`max`, id **`effort`** |
| **fast mode** | sim, id `fast-mode` | sim, id `fast` |
| **model ids** | `gpt-5.6-*` / `gpt-5.5` / `gpt-5.4*` | `default` / `opus[1m]` / `sonnet` / `haiku` |

Trocar o `agent:` de um Step sem reescrever `mode`/`model`/`effort` no dialeto do
novo agente → falha (mode) ou silêncio (effort/model best-effort).

**O débito piorou com a 0.59** (2026-07-14). Na 0.26 o Claude não anunciava
`thought_level` — a disparidade de effort era *binária* (tem × não tem), e o
no-op silencioso era o pior caso. Agora os dois adapters têm effort com
**vocabulários e ids divergentes** (`max` só existe no Claude; `xhigh` é o topo do
Codex; o id difere), então um `effort: max` que funciona no Claude é
silenciosamente descartado no Codex — a mesma classe de bug, agora com um dial a
mais e sem sinal. Também mostra que o dialeto é **por-Agente _e_ por-versão**: um
`loopy.yml` correto pode virar incorreto só por um `npx -y` puxar uma versão nova
do adapter.

## Causa raiz

Decisão config-driven (AD-1) levada ao limite: o motor **de propósito** não embute
conhecimento de adapter. `modeSchema = nonEmptyString` (`src/config/schema.ts:31`)
e `AgentMode = … | (string & {})` (`src/types.ts:122`) deixam `mode` aberto. A
aplicação é o repasse cru `ctx.session.setMode(step.mode)`
(`src/steps/agent.ts:210`), e a **única** mediação é `setMode` validar o `modeId`
contra `availableModeIds` do `session/new` (`src/acp/session.ts:216`), fail-hard.

Falta o degrau do meio: **não existe um "perfil de capacidades do agente"** (um
port/adaptador tipado) que traduza intenções canônicas do motor
— autonomia (`read-only` / `edit` / `full`), effort (`low`/`med`/`high`), modelo
(`forte`/`rápido`) — para o dialeto de cada adapter. As peças de *descoberta* já
existem (`findConfigId` por categoria em `session.ts:133`; `availableModeIds`);
o que não existe é a **camada de tradução + um contrato único** por cima delas.
Por isso cada divergência é tratada ad-hoc: `mode` é fail-hard, `model`/`effort`
são best-effort no-op (AD-5) — sem um lugar único que arbitre o de/para.

## Impacto

- **Acoplamento config ↔ adapter:** o `loopy.yml` precisa conhecer o vocabulário
  exato de cada agente. Trocar de agente num Step é uma edição não-óbvia — mexe em
  `mode`/`model`/`effort` juntos, cada um no dialeto certo.
- **Escala mal:** cada novo coding agent (Gemini CLI, etc.) multiplica os
  vocabulários que o autor precisa memorizar; **nada centraliza o de/para**. O
  débito cresce linearmente com o nº de adapters × nº de dials.
- **Divergências sem árbitro único:** effort ausente no OpenCode (`setEffort` no-op
  **silencioso**) e com vocabulário divergente entre Codex e Claude (`max` só no
  Claude), id do toggle de fast mode distinto, model ids totalmente distintos —
  hoje cada uma é tratada isoladamente, não por uma política única.
- **Risco de autonomia latente:** `mode` governa read-only × escrita. A rede
  fail-hard evita rodar num mode **inválido**, mas um Step que **omite** `mode` cai
  no *default do adapter* (`agent` no Codex já **escreve**; `default` no Claude
  pede aprovação) — uma intenção "read-only" não-traduzida vira escrita sem erro.

Classificado **média**: é contornável (autoria correta + a rede fail-hard evita o
pior) e **não** há perda silenciosa de dado — mas é uma **armadilha de acoplamento**
com recorrência garantida a cada adapter novo.

## Reprodução

Trocar o agente de um Step Claude para Codex sem ajustar o `mode`:

```yaml
- id: implement
  type: agent
  agent: codex
  mode: acceptEdits   # ← vocabulário Claude; inválido no Codex
```

Em runtime, no **primeiro** Step de Agente:

```
[agent:implement] agente "codex" recusou o mode "acceptEdits":
mode "acceptEdits" não é anunciado por este agente
(modos disponíveis: read-only, agent, agent-full-access). …
```

Para os vocabulários por adapter/versão: `npx tsx spikes/acp-codex-capabilities.ts`
e `npx tsx spikes/acp-claude-capabilities.ts`.

## Correção proposta

Introduzir uma **interface única de capacidades do agente** (um `AgentProfile` /
`CapabilityPort`) que faça o de/para entre **intenções canônicas do motor** e o
**dialeto de cada adapter**, alimentada pela descoberta do `initialize`/`session/new`:

1. **Autonomia canônica** (ex.: `read-only | edit | full`) → `modeId` real por
   adapter (Claude `plan`/`acceptEdits`/`bypassPermissions`; Codex
   `read-only`/`agent`/`agent-full-access`). O yml declara a **intenção**; a
   interface resolve o `modeId`. Retrocompatível: um `mode:` literal continua
   passando cru (escape hatch).
2. **Effort canônico** (`low`/`med`/`high`) → `thought_level` do adapter (id
   `reasoning_effort` no Codex, `effort` no Claude), clampando ao vocabulário
   real do agente (`max` → `xhigh` no Codex) e com **no-op declarado e visível**
   quando ausente (OpenCode) — não um silêncio.
3. **Model** por alias canônico (`strong`/`fast`) → `ModelId` do adapter.
4. **Alternativa leve** (se não quiser abstração canônica agora): mover a
   validação de `mode`+`agent` para o **carregamento da config** (fail-fast no
   dry-run), cruzando contra um perfil estático conhecido por adapter — pega o erro
   **antes** do run vivo, em vez de no primeiro Step de Agente.

Promover para Change quando multi-agente com > 2 adapters no mesmo pipeline virar
caso comum, ou quando um 3º adapter (Gemini/etc.) entrar.

## Workaround atual

*(Não mais necessário — ver Resolução.)*

## Resolução (C-0016, ADR-0008)

O débito pedia "uma interface única que faça o de/para das particularidades de
cada agente" — um `AgentProfile`/`CapabilityPort` com vocabulário canônico
(`read-only`/`edit`/`full`) que traduzisse intenções do motor para o dialeto de
cada adapter.

A resposta é: **não fazer de/para — expor**. O achado que inverteu a direção:
os `configOptions` do `session/new` ACP contêm as listas de modes/models/efforts
de **todos os três adapters** (inclusive o OpenCode, que deixa `availableModes`
nulo). O motor estava lendo a **fonte errada** — e a descoberta que se
acreditava impossível funciona nos três, nos três eixos.

**Por que o de/para envelhece e a descoberta não:** o vocabulário é por-Agente
**e por-versão** (o Claude não tinha effort na 0.26; na 0.59 tem; os model ids
mudam). Uma tabela estática de tradução envelhece a cada `npx -y` que puxa uma
versão nova do adapter. A sondagem, não — pergunta ao adapter vivo. O custo
aceito: trocar de agente exige reescolher os valores no dialeto do novo agente
(a GUI torna isso trivial via selects sondados).

O que foi feito:

1. `parseCapabilities(configOptions)` (`src/acp/capabilities.ts`) — parse puro
   dos `configOptions` por categoria (`mode`/`model`/`thought_level`).
2. `setMode` validado fail-closed contra `capabilities.modes` **nos três
   adapters** (inclusive OpenCode, que antes escapava).
3. `setModel`/`setEffort` emitem **warning visível** (`StoreEvent` `warning`)
   quando o valor está fora da lista, em vez do antigo `logger.debug` silencioso.
4. `loopy probe-agent <nome> [--json]` — sonda, grava cache, encerra.
5. Validação **eager** no início do Run (sessão descartável; zero token gasto).
6. GUI: selects sondados no `StepEditor`, presets de `command` no `ConfigPane`,
   degradação para texto livre quando a sondagem falha.
