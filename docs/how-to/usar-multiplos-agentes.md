# Como usar múltiplos agentes na mesma run

Este guia mostra como migrar de um agente único (`acp.command`) para o
**Registry de Agentes** (`agents:`) e selecionar agente, modelo e reasoning
effort **por Step** — por exemplo: implementar com um modelo forte, simplificar
com um agente mais barato e revisar com outro fornecedor, tudo na mesma run.

Para o _significado_ dos termos (Agente, Processo de Agente, Sessão, Dialeto,
Capability, Sondagem) veja o glossário em [`CONTEXT.md`](../../CONTEXT.md);
para o _porquê_, os ADRs [0006](../adrs/0006-multi-agente-acp.md) (Registry),
[0008](../adrs/0008-capabilities-de-agente-por-descoberta.md) (capabilities por
descoberta) e [0010](../adrs/0010-catalogo-de-agentes-argv-por-preset.md)
(Catálogo de presets); para cada chave e default, a
[referência de configuração](../reference/configuration.md#agents).

## Pré-requisitos

- Um projeto-alvo já configurado e rodando com **um** agente — é o resultado do
  guia [Configurar um projeto-alvo](configurar-projeto-alvo.md).
- Os agentes que você quer usar **instalados e autenticados** na máquina (ex.:
  `codex login`, `opencode auth login`). O `loopy` não gerencia credenciais:
  omitir `env` na definição do agente usa a subscription/login do próprio
  agente.

## Passos

### 1. Troque `acp.command` pelo Registry `agents:`

`agents:` e `acp.command` são **mutuamente exclusivos** — o Registry substitui o
modo legado de agente único. Remova o `command` do bloco `acp` (o resto dele
fica) e declare os agentes por nome:

```yaml
agents:
  claude:
    preset: claude # o argv vem do Catálogo de Agentes
  codex:
    preset: codex
    effort: low # default por-agente (dialeto literal do codex)
  opencode:
    preset: opencode

acp:
  default_agent: claude
  request_timeout_seconds: 1800
  permissions:
    default_mode: acceptEdits
    on_request: allow
```

Cada agente precisa de `preset` **ou** `command` (nunca os dois): `preset`
empresta o argv do **Catálogo de Agentes** — que carrega as armadilhas que você
não quer redescobrir (o pin de versão do claude, o fato de o opencode não ser
pacote npm) — e `command` é a saída para um adapter fora do Catálogo:

```yaml
agents:
  meu-adapter:
    command: ["meu-acp", "--stdio"]
```

O Catálogo **não é allowlist**: um adapter desconhecido roda igual; só muda quem
digita o argv. Ver a
[tabela do Catálogo](../reference/configuration.md#preset--o-catálogo-de-agentes).

### 2. Descubra o dialeto de cada agente (`loopy probe-agent`)

Os valores de `mode`, `model` e `effort` são o **dialeto literal** de cada
agente — o motor os envia tal qual, **sem traduzir** (`acceptEdits` existe no
claude; no opencode o equivalente é `build`; o effort `max` do claude não
existe no codex). Antes de escrevê-los no yml, sonde cada agente:

```bash
loopy probe-agent claude
loopy probe-agent codex
loopy probe-agent opencode
```

A saída lista os modos, modelos e níveis de effort que aquele agente (naquela
versão) **realmente aceita** — vem dos `configOptions` da sessão ACP, a fonte
canônica. O resultado é cacheado em `.loopy/capabilities.json`.

> **OpenCode:** o effort deriva do _model_ corrente (são as variants dele), e o
> cache é keyed por argv + model. Sonde com o model que você pretende usar:
> `loopy probe-agent opencode --model zai-coding-plan/glm-5.2`. Ver
> [por que a sondagem aplica um `model`](../reference/cli.md#por-que-a-sondagem-aplica-um-model).

### 3. Defina o agente default dos Steps

A resolução do `agent:` de um Step segue três regras:

- **`acp.default_agent` definido** → Steps sem `agent:` usam esse agente.
- **Registry com um único agente** → ele é o default implícito.
- **Registry com >1 agente e sem `default_agent`** → todo Step de agente
  **deve** declarar `agent:` — o schema rejeita a omissão.

Se um agente aparece no Registry mas nenhum Step o referencia, o processo dele
**nunca sobe** — declarar a mais não custa nada em runtime.

### 4. Selecione agente, model e effort por Step

Nos Steps `agent`, escolha o agente pelo nome do Registry e, se quiser,
sobrescreva `model`/`effort` só naquele Step (o default por-agente do passo 1
cobre o resto):

```yaml
pipeline:
  - id: implement
    type: agent
    agent: claude # implementa com o modelo forte
    mode: acceptEdits
    prompt: |
      Implemente a task ${task.id} — ${task.title}.
      ${task.body}
      ${checks.report}
    verify: { run: ci, max_attempts: 3 }

  - id: simplify
    type: agent
    agent: codex # simplifica com o agente barato
    mode: agent # dialeto do codex — não "acceptEdits"
    effort: low
    prompt: |
      Simplifique o que está no worktree sem alterar comportamento.
      ${worktree.diff}
    verify: { run: ci, max_attempts: 3 }

  - id: review
    type: agent
    agent: claude
    mode: default
    prompt: |
      Reveja a task ${task.id}. NUNCA EDITE NADA.
      ${worktree.diff}
      Responda na ÚLTIMA linha "REVIEW: PASS" ou "REVIEW: FAIL: <motivo>".
    expect: "REVIEW: PASS"
    on_fail: { goto: implement }
```

Dois cuidados ao editar:

- **`mode`/`model`/`effort` acompanham o `agent:` do Step.** Trocar o agente de
  um Step exige reescolher os três no dialeto do novo agente — o
  `mode: acceptEdits` que funcionava com o claude falha com o opencode.
- Uma Task que usa N agentes tem N **Sessões** (uma por agente, todas com cwd no
  worktree da Task) — o contexto **não** é compartilhado entre agentes; o que um
  Step precisa saber do anterior vai pelo prompt (ex.: `${worktree.diff}`).

### 5. Valide e rode

```bash
loopy . --dry-run
loopy . --task T-001
```

O `--dry-run` não sonda (zero processo): ele **reporta** pelo cache de
capabilities quando existe — sem cache, imprime `capabilities: não verificadas`.
A autoridade é a **validação eager** no início da run: assim que cada Processo
de Agente sobe, o motor lê as capabilities do adapter vivo e valida todos os
Steps que o referenciam. Um `mode` inválido aborta **em segundos** — zero
worktree, zero token. `model`/`effort` inválidos não abortam: viram warning
visível e o valor é ignorado (best-effort).

## Verificação

No início da run, o motor spawna **um Processo por agente referenciado**
(eager — falha de spawn aborta a run na hora). Com mais de um agente ativo, os
streams da TUI prefixam cada linha com `[<agente>]`. Ao final, o custo por Task
soma os snapshots das N Sessões.

## Troubleshooting

### O processo do agente não sobe ("spawn falhou")

Quase sempre é argv errado no `command` — cada adapter tem uma armadilha
(pacote npm errado, falta de pin, o opencode que é subcomando de binário e não
pacote). Prefira `preset`, que carrega o argv correto; para um adapter fora do
Catálogo, teste o argv antes com
`loopy probe-agent --command <argv...>` (sonda sem passar pelo Registry).

### `mode 'X' não é aceito por '<agente>' (aceita: …)`

A validação eager é **fail-closed** para `mode`: o valor não está na lista que o
agente anuncia. Rode `loopy probe-agent <nome>` e use um valor da lista — o
motor não traduz dialetos, nem entre sinônimos óbvios.

### Warning dizendo que `model`/`effort` foi ignorado

Para `model` e `effort` a validação é **best-effort**: valor fora da lista (ou
capability que o agente não tem — o opencode sem variants não tem effort) vira
warning e é ignorado, sem clamp — o motor não finge que o `xhigh` de um agente
"equivale" ao `max` de outro. Reescolha o valor no dialeto do agente do Step.

### O dialeto mudou depois de atualizar um adapter

O vocabulário é **por-versão** (o claude < 0.59 nem anunciava effort). É por
isso que o preset do claude é pinado. Se você atualizar o pin (ou usar
`command` sem pin), re-sonde com `loopy probe-agent` para renovar o cache — um
cache velho pode fazer o `--dry-run` reportar erro num yml correto (a
autoridade continua sendo a validação eager, contra o adapter vivo).

## Ver também

- [Configuração — `agents`](../reference/configuration.md#agents) — todas as
  chaves do Registry, o Catálogo e as regras de resolução.
- [CLI — `probe-agent`](../reference/cli.md#probe-agent) — a sondagem em
  detalhe, inclusive `--command` e `--model`.
- [ADR-0006](../adrs/0006-multi-agente-acp.md) — o _porquê_ do Registry, dos N
  Processos e do best-effort.
- [ADR-0008](../adrs/0008-capabilities-de-agente-por-descoberta.md) — por que
  não há vocabulário canônico (dialeto literal + descoberta).
- [ADR-0010](../adrs/0010-catalogo-de-agentes-argv-por-preset.md) — por que o
  argv vive num Catálogo e as capabilities não.
- [`examples/loopy.yml`](../../examples/loopy.yml) — o config canônico com o
  Registry completo.
