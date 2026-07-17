# Como ligar a telemetria e anotar vereditos

Este guia mostra como ativar a **telemetria** opt-in do `loopy` num projeto-alvo
e como registrar as **anotações humanas** — veredito por task, bugs e o
fechamento de uma change — para responder as perguntas que os fatos sozinhos não
respondem: _quanto custou esta change e onde?_, _o pipeline está melhorando run
a run?_, _onde o review do Agente deixou passar defeito?_

Para o _significado_ dos termos (Uso, Custo, Tentativa, Veredito humano, Defeito
escapado, Insights) veja o cluster **Telemetria** em
[`CONTEXT.md`](../../CONTEXT.md); para o _porquê_, a
[ADR-0011](../adrs/0011-telemetria-sqlite-insert-only-e-granularidade-por-tentativa.md)
(que estende a
[ADR-0003](../adrs/0003-metricas-de-execucao-contrato-aditivo-best-effort-acp.md));
para as flags exatas, a
[referência da CLI](../reference/cli.md#anotações-de-telemetria-verdict--bug--change).

## Pré-requisitos

- Um projeto-alvo já rodando com o `loopy` — o resultado do guia
  [Configurar um projeto-alvo](configurar-projeto-alvo.md).
- **Node ≥ 22.13** (a telemetria usa `node:sqlite`; é o `engines` do pacote).
- Para a **leitura**: a GUI menubar (`apps/menubar/`) — a aba **Insights** é a
  única leitura da telemetria. Em headless/CI não há relatório algum, **por
  design** (ADR-0011).

## Passos

### 1. Ligue o gate `metrics:` no `loopy.yml`

O gate é **por presença, não por valor** — um bloco vazio liga:

```yaml
metrics: {}
```

Com o bloco presente, a run cria e popula `<root>/.db/telemetry.db` (SQLite,
WAL) no projeto-alvo. Sem o bloco, nenhum `.db` é criado e a run é byte-idêntica
à de antes (regressão zero).

> Se o seu yml ainda tem `metrics.report`, remova: a chave é **obsoleta**
> (C-0017) — parseia por retrocompat, mas o motor a ignora e emite warning. O
> Relatório de change (`index.md`) e o Relatório de execução (stderr) foram
> aposentados.

### 2. Ignore o `.db` no git

O `.db/` é um Artefato de runtime no projeto-alvo — como `require_clean_parent`
exige o parent limpo, um `.db` não-ignorado quebra a run:

```gitignore
.db/
```

### 3. Rode e entenda o que é gravado

```bash
loopy .
```

Durante a run, o motor grava os **fatos** (insert-only, nunca `UPDATE`):

- **Uma linha de `step` por Tentativa** do verify — cada retry tem seus próprios
  tokens, custo e duração. É o que responde "quanto custa o loop errar".
- **Uso** (tokens) e **Custo** (USD) são best-effort: se o agente não os emite,
  a coluna fica nula (`n/d` na leitura) — a coleta nunca falha um Step.
- O custo por Task/Change é **`SUM(cost_usd)`** sobre as linhas — não confie em
  somas feitas à mão sobre snapshots.
- A dimensão `change` abre no início da run e fecha sozinha como `merged` quando
  o backlog zera. Os outros desfechos são seus (passo 6).

### 4. Anote o veredito humano de cada task

Depois de inspecionar o resultado de uma task (merjada ou não), registre o seu
julgamento — o **veredito humano**, distinto do Verdict que o Agente emite no
`expect`:

```bash
loopy verdict set --task C-0017/T-003 --pass
loopy verdict set --task C-0017/T-005 --fail --note "quebrou o resume" --by henrique
loopy verdict clear --task C-0017/T-005
```

- O `--task` usa o **id da telemetria**, no formato `<change>/<task>` — não o
  `T-\d+` cru do backlog. O id da change deriva do path do `todo.md`
  (`basename` do diretório; com o backlog na raiz, cai para o `name` do config).
- O veredito é tri-estado: `pass` / `fail` / não-avaliada (o estado inicial, ao
  qual `clear` retorna). `set` é upsert.
- Uma task **merjada** com veredito `fail` é um **defeito escapado** — o sinal
  de "o review do Agente deixou passar" — e ganha destaque na aba Insights.

### 5. Registre bugs ligados a tasks

```bash
loopy bug add --task C-0017/T-003 --severity high \
  --title "resume re-roda cleanup" --found-in C-0018
```

O bug tem FK para a task, mas **sem restrição de change**: encontrar um bug numa
change posterior (`--found-in`) ligado a uma task antiga é o caso normal.

### 6. Feche a change fora do caminho feliz

O desfecho `merged` acontece sozinho. Se você abandonar a change (ou ela falhar
em definitivo), feche a dimensão à mão para o baseline não acumular changes
"em andamento" para sempre:

```bash
loopy change --abandoned   # ou --failed
```

Sem `--change <id>`, o comando usa a única change aberta no `.db`.

### 7. Leia na aba Insights

Abra a GUI menubar e vá ao 4º segmento do `ViewSwitcher` — **Insights**. A aba
compara a change corrente contra a **média±desvio das changes merged** e contra
outra change escolhida (Δ%, absoluto ↔ normalizado por churn), e destaca
defeitos escapados. Funciona em idle (revisão fria) e durante a run.

A aba também **escreve**: os formulários de veredito/bug invocam os mesmos
subcomandos da CLI como subprocesso — anotar pela GUI ou pelo terminal dá no
mesmo `.db`.

## Verificação

Após uma run com `metrics:` presente, `<root>/.db/telemetry.db` existe e a aba
Insights lista a change com custo, tokens e duração por task. Os subcomandos de
anotação aceitam o id `<change>/<task>` sem reclamar que o `.db` não existe.

## Troubleshooting

### `verdict`/`bug`/`change` falham dizendo que o `.db` não existe

Os subcomandos de anotação **não criam** o `.db` — ele nasce numa run com
`metrics:` presente. Rode ao menos uma task com o gate ligado antes de anotar.

### Tokens ou custo aparecem como `n/d`

Não é erro: Uso e Custo são **best-effort** por contrato (ADR-0003) — o adapter
daquele agente não emitiu o dado naquele turno. Steps `shell`/`checks`/
`approval` nem têm Uso (`n/a`): só Steps de Agente consomem tokens.

### Warning `'metrics.report' está obsoleto e é ignorado`

Remova a chave `report` do bloco `metrics` (passo 1). Os relatórios em arquivo
e stderr foram aposentados na C-0017; a leitura é a aba Insights.

### Uma change antiga não aparece no baseline

Change rodada **sem** `metrics:` é um buraco no histórico — não há backfill. O
baseline começa na primeira change rodada com o gate ligado; as anteriores
degradam para "sem telemetria" na aba.

## Ver também

- [Configuração — `metrics`](../reference/configuration.md#metrics) — o gate e a
  chave obsoleta.
- [CLI — Anotações de telemetria](../reference/cli.md#anotações-de-telemetria-verdict--bug--change)
  — todas as flags de `verdict`, `bug` e `change`.
- [ADR-0011](../adrs/0011-telemetria-sqlite-insert-only-e-granularidade-por-tentativa.md)
  — o _porquê_ do SQLite insert-only, da granularidade por-Tentativa e da aba
  Insights como única leitura.
- [`CONTEXT.md`](../../CONTEXT.md) — o cluster Telemetria da linguagem ubíqua
  (Uso × Custo × Veredito humano × Defeito escapado).
