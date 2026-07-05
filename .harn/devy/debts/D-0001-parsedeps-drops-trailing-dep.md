# D-0001 — `parseDeps` descarta a última dependência quando a linha `Deps:` tem texto após os ids

> **Status:** aberto · **Severidade:** média · **Área:** `src/backlog/todo.ts`
> **Descoberto em:** 2026-07-05 · **Origem:** C-0007 (montagem do `loopy.yml` paralelo — o DAG saía achatado no `--dry-run`)

## Sintoma

Quando a linha `Deps:` de uma Task no `todo.md` contém **qualquer texto após a lista de
ids** (tipicamente `. Files: … Scope: …` colado na mesma linha), o parser **perde a
última dependência** da linha — silenciosamente, sem erro nem warning. Nas Tasks com
**uma só** dependência, a dep some **inteira** e a Task vira um **root falso** no
Grafo de tasks.

Medido no backlog real da C-0007 (antes do workaround):

| Task | `Deps:` reais | lidas pelo motor |
|------|---------------|------------------|
| T-003 | T-002 | **[]** (perdida) |
| T-005 | T-004 | **[]** (perdida) |
| T-006 | T-004 | **[]** (perdida) |
| T-008 | T-001, T-004, T-007 | T-001, T-004 (perde **T-007**) |
| T-009 | T-001, T-002, T-003 | T-001, T-002 (perde **T-003**) |
| T-010 | T-009 | **[]** (perdida) |
| T-011 | …, T-010 | perde **T-010** |

## Causa raiz

`parseDeps` (`src/backlog/todo.ts:154-169`) assume que a linha após o prefixo `Deps:`
contém **apenas** ids separados por vírgula. Ele faz `raw.split(",")` de **todo** o
resto da linha e filtra cada token por `idValidationRegex` — que é **ancorado**:
`new RegExp("^(?:" + pattern + ")$")` (`todo.ts:89`, com `pattern = "T-\\d+"`).

Numa linha como:

```
    Deps: T-002. Files: src/tui/view.ts, src/tui/view.test.ts. Scope: M. RISCO ALTO.
```

o `split(",")` produz `["T-002. Files: src/tui/view.ts", " src/tui/view.test.ts", " package.json. Scope: M. RISCO ALTO."]`.
O primeiro token — que carrega a dep real — é `"T-002. Files: …"`, que **não casa**
`^(?:T-\d+)$` (tem sufixo) e é **descartado**. O `filter` da `:166` remove todos os
tokens não-id, e a docstring já avisa o comportamento como intencional
(`:152`: *"Ids that don't match `task_id_pattern` are silently dropped."*) — mas a
intenção era descartar **lixo**, não **engolir uma dep válida grudada em texto**.

Toda dep que **não** é a última da linha sobrevive porque a vírgula a separa do texto
(`"T-001"`, `" T-004"` → `"T-004"` casam). Só a **última** (a que encosta no `. Files:`)
morre — daí o padrão da tabela.

## Impacto

Corretude do **DAG de tasks** (ADR-0004), silenciosamente:

- Sob `concurrency > 1`, uma Task cuja dep foi perdida entra no **ready set cedo demais**
  e roda **antes** do predecessor terminar — sobre código incompleto, com Merge fora de
  ordem. Foi exatamente o que o `--dry-run` da C-0007 mostrou: `T-010` mergeando antes de
  `T-009`.
- **Nenhum sinal**: não há erro, exceção nem warning. O motor parece funcionar; o DAG só
  está errado.
- Com `concurrency: 1` o dano é mascarado (o backlog costuma já estar em ordem topológica,
  então o scheduler pega a próxima ready em ordem de arquivo) — o que torna o bug fácil de
  não notar até ligar o paralelismo.
- **Alto potencial de recorrência**: o `/devy:plan` gera o `todo.md` com `Deps:`, `Files:`
  e `Scope:` na **mesma linha**, então qualquer backlog nesse formato dispara o bug.

Classificado **média** (e não alta) só porque é trivialmente contornável e não corrompe
dado persistido; o vetor (perda silenciosa de dependência) é de corretude.

## Reprodução

```bash
npx tsx -e '
import { parseBacklog } from "./src/backlog/todo.ts";
const src = `- [ ] T-003: exemplo
    corpo qualquer
    Deps: T-002. Files: a.ts, b.ts. Scope: M.`;
const [t] = parseBacklog(src, { pendingMarker:"- [ ]", doneMarker:"- [x]", taskIdPattern:"T-\\d+", depsPattern:"Deps:" });
console.log(t.id, "deps:", JSON.stringify(t.deps)); // => T-003 deps: []  (esperado ["T-002"])
'
```

## Correção proposta

Extrair **todos** os ids da linha por match global, em vez de `split(",")` + filtro
ancorado. Substituir o corpo do retorno (`todo.ts:163-166`) por algo como:

```ts
// tolera ids colados em pontuação/texto: "Deps: T-002. Files: …" e "T-1, T-2"
const idGlobal = new RegExp(opts.taskIdPattern, "g");
return raw.match(idGlobal) ?? [];
```

Isso captura `T-002` mesmo grudado em `. Files:`, e continua funcionando para listas com
vírgula. Cuidados:

- Manter o early-return de `nenhuma` (`:161`) — que hoje já exige o token isolado; após a
  mudança, `Deps: nenhuma. Files: …` continua retornando `[]` (o match global simplesmente
  não acha nenhum `T-\d+` na linha), então o caso segue coberto.
- Adicionar teste em `src/backlog/todo.test.ts` com a linha `Deps: T-002. Files: a.ts. Scope: M.`
  esperando `["T-002"]`, e um caso multi-dep com texto após o último id.
- Considerar promover a `/devy:plan` a gerar a linha `Deps:` **isolada** de qualquer forma
  (defesa em profundidade), mas o fix do parser é a causa raiz.

## Workaround atual

Manter a linha `Deps:` **isolada** — só os ids (ou `nenhuma`), **sem** `. Files:`/`Scope:`
na mesma linha:

```
    Deps: T-002
    Files: src/tui/view.ts, … Scope: M. RISCO ALTO.
```

Foi o que se aplicou ao `todo.md` da C-0007 (formatação apenas; conteúdo intacto),
desbloqueando o DAG correto sob `concurrency: 5`. Enquanto o parser não for corrigido,
todo `todo.md` que quiser paralelismo precisa desse formato.
