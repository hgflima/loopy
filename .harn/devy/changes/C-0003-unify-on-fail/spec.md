# Spec: Unificar ação em falha dos steps em `on_fail` (ADR-0001)

> Feature spec derivada do `SPEC.md` do projeto e **normada pelo**
> `docs/adrs/0001-unificar-acao-em-falha-em-on-fail.md` (accepted, 2026-07-04).
> Mesmo invariante (AD-1): o motor é intérprete genérico; `on_fail` é **config**,
> não comportamento hardcodado. Onde esta spec e o `SPEC.md`-mãe divergirem, o ADR
> vence para tudo que seja a linguagem de falha dos steps.

## Objective

Colapsar as **três chaves** que hoje expressam o mesmo conceito — "a ação quando
este step falha" — numa **única chave `on_fail` por step**. Hoje coexistem:

- `verify.on_fail` — aninhado no bloco `verify` de steps `agent`;
- `on_expect_fail` — step `agent`, quando a string de `expect` não bate;
- `on_conflict` — step `approval`, em conflito de merge.

As três só aceitam `escalate` e são, na prática, **rótulo/atribuição**: o
orchestrator já resolve tudo com o fallback `?? "escalate"`. São o mesmo conceito
vestido com três nomes conforme o gatilho, o que sobrecarrega a linguagem ubíqua
(ver `CONTEXT.md`) e obriga quem lê o yml a decorar qual chave vale em cada tipo
de step.

Depois desta mudança, a **semântica única** (do ADR) fica:

| Step       | `on_fail` dispara quando…                                  |
|------------|------------------------------------------------------------|
| `shell`    | comando com exit ≠ 0                                        |
| `checks`   | a lista de checks falha                                     |
| `agent`    | `verify` esgota `max_attempts` **ou** `expect` não bate     |
| `approval` | conflito de merge                                          |

**Usuário-alvo:** quem escreve `loopy.yml`. É uma mudança de **linguagem/config**,
não de runtime — o único valor possível continua `escalate`, então o
comportamento observável do loop não muda.

**Não-objetivo:** introduzir qualquer valor de `on_fail` além de `escalate`
(exigiria revisar o ADR-0001 → superseded); auto-migração/aliasing das chaves
antigas (descartado — ver Design).

## Enquadramento (o que o pedido esconde)

O trabalho **não é** mudar comportamento — é **renomear/unificar config** sem
regressão e **quebrar bem**. Dois riscos reais:

1. **Blast radius amplo mas raso:** as três chaves aparecem em schema, tipos, dois
   interpretadores, a impressão do dry-run e ~9 arquivos de teste + 2 fixtures.
   Perder um ponto = typecheck vermelho ou teste quebrado.
2. **Breaking change silencioso:** configs existentes com `on_expect_fail` /
   `on_conflict` / `verify.on_fail` precisam de um **erro acionável**, não do
   `Unrecognized key` genérico do zod, senão o usuário fica sem saber para onde
   migrar.

## Tech Stack

Sem novas dependências. TypeScript estrito, zod (`.strict()`), Node ≥ 20, vitest.
Mesmo tooling do motor (eslint + prettier). Mensagens de erro/log em pt-BR.

## Commands

```
Typecheck: npm run typecheck
Lint:      npm run lint
Test:      npm test
Test alvo: npx vitest run tests/config/load.test.ts
Dry-run:   npx tsx src/index.ts <dir> --dry-run     # confere impressão do pipeline
```

## Design

### Contrato: `on_fail` opcional por step, default `escalate`

Cada primitiva de step passa a ter **um** campo `on_fail?: OnFailAction` no nível
do step (opcional; default `escalate` aplicado pelo consumo com `?? "escalate"`,
como já é hoje). Racional para **opcional**: o único valor possível é `escalate` e
o orchestrator já usa esse fallback — tornar obrigatório só adicionaria ruído sem
ganho de expressividade. Fica coerente com `shell`/`checks`, que já são opcionais.

- `VerifyConfig` deixa de ter `on_fail` → passa a ser `{ run, max_attempts }`.
- `AgentStep` ganha `on_fail?` (governa **verify esgotado _ou_ expect não-bate**);
  `on_expect_fail` é **removido**.
- `ApprovalStep` ganha `on_fail?`; `on_conflict` é **removido**.
- `ShellStep.on_fail` / `ChecksStep.on_fail` — **inalterados**.

**Validação cruzada em `agent` (OQ-7):** `on_fail` num step `agent` **exige**
`verify` **ou** `expect`. Sem nenhum dos dois não há modo de falha de agente para
a chave governar (o único caminho é `stopReason ≠ end_turn`, que retorna `ok:false`
sem consultar `on_fail`), então o `on_fail` ficaria **órfão/inerte**. Um
`.refine()` no `agentStepSchema` rejeita esse caso com mensagem pt-BR clara
(path `on_fail`). `approval` **não** recebe guarda equivalente: seu modo de falha
(rejeição do gate / conflito da ação) é intrínseco, nunca órfão.

### Migração: erro amigável guiado (decisão travada)

Config antiga com chave removida **falha com erro acionável** (não com o
`Unrecognized key` genérico do zod, nem com auto-migração silenciosa).

- Uma **pré-varredura** em `config/load.ts` (função **pura** sobre o objeto YAML
  cru, sem disco — sem módulo novo em `src/`, inline no `load.ts` conforme o mapa
  de Project Structure) inspeciona o YAML **antes** do zod, detecta as chaves
  removidas por step e lança `ConfigError` citando: o `id` do step, a chave antiga
  → a chave nova, e um ponteiro para `docs/MIGRATION.md`.
- **Coletar-todas (OQ-3):** a varredura percorre o pipeline inteiro e reporta
  **todas** as ocorrências num relatório multi-linha, reaproveitando o cabeçalho
  `Config inválido em "<path>":` da `formatValidationError` (uma linha por
  step/chave). Sem corrigir-rodar-corrigir em ciclos.
  Ex.: `  - step "audit": 'on_expect_fail' foi removido (ADR-0001) — use 'on_fail'. Ver docs/MIGRATION.md`.
- **Match por nome, em qualquer step (OQ-4):** casa a chave antiga onde ela
  aparecer, **sem** condicionar ao `type` do step (robusto a copy-paste e a
  `type` ausente/errado). O `.strict()` continua a rede para chaves realmente
  desconhecidas.
- **Mensagem do `verify.on_fail` explicita a realocação (OQ-5):** como a chave
  **sobe** do bloco `verify` para o nível do step, a mensagem diz "mova para
  'on_fail' no nível do step" — não o texto genérico de rename das outras duas,
  para o usuário não renomear no lugar errado e bater no `.strict()` do
  `verifySchema` de novo.
- **Identificação do step (OQ-6):** usa `step.id` quando for string não-vazia;
  caso contrário, cai para `pipeline[<índice>]` na mensagem.
- Mantém o `schema.ts` **limpo** (sem chaves-fantasma só para dar mensagem).
- Chaves cobertas: `on_expect_fail` (agent), `on_conflict` (approval),
  `on_fail` **dentro** de `verify` (agora inválido).

### Impressão do dry-run (`orchestrator.ts::resolveStep`)

- `verify:` imprime `run=… max_attempts=…` (sem `on_fail`).
- `agent`/`approval` imprimem `on_fail=…` como campo próprio quando presente,
  **no slot da chave removida** (agent: após `expect`; approval: após os
  comandos) → diff mínimo na saída do dry-run.
- `shell`/`checks` — inalterados.

### Config-driven (AD-1)

Zero mudança de comportamento de runtime; apenas a **superfície de config** encolhe.
O motor continua sem política de loop hardcodada.

## Project Structure

```
src/types.ts             → MOD: remove VerifyConfig.on_fail, AgentStep.on_expect_fail,
                           ApprovalStep.on_conflict; adiciona AgentStep.on_fail? e
                           ApprovalStep.on_fail?. ShellStep/ChecksStep inalterados.
src/config/schema.ts     → MOD: verifySchema vira { run, max_attempts };
                           agentStepSchema troca on_expect_fail → on_fail + .refine
                           (on_fail exige verify ou expect, OQ-7);
                           approvalStepSchema troca on_conflict → on_fail.
src/config/load.ts       → MOD: pré-varredura das chaves removidas → erro guiado.
src/steps/agent.ts       → MOD: applyVerdictGate lê step.on_fail (era on_expect_fail);
                           inner-loop lê step.on_fail (era verify.on_fail); doc comments.
src/steps/approval.ts    → MOD: lê step.on_fail (era on_conflict); doc comments.
src/loop/orchestrator.ts → MOD: resolveStep — verify sem on_fail; on_expect_fail/
                           on_conflict → on_fail na impressão.
loopy.yml                → MOD: verify sem on_fail; on_expect_fail/on_conflict → on_fail.
docs/MIGRATION.md        → NOVO: guia enxuto — tabela antiga→on_fail (3 chaves) +
                           diffs yml por caso + nota "escalate é o único valor";
                           header cita ADR-0001.
CONTEXT.md               → JÁ MIGRADO: a verbete "Ação em falha (on_fail)" já
                           define a chave única e lista on_expect_fail/on_conflict/
                           verify.on_fail em _Avoid_. Revalidar, sem mudança prevista.

tests/config/load.test.ts       → MOD + NOVO caso: config com chave removida → erro guiado.
tests/config/schema*.test.ts     → MOD (se houver assert das chaves).
tests/cli/dry-run.test.ts        → MOD: strings esperadas (verify sem on_fail; on_fail próprio).
tests/steps/agent.test.ts        → MOD: fixtures verify {run,max_attempts}; on_fail no step.
tests/steps/approval.test.ts     → MOD: on_conflict → on_fail.
tests/e2e/e2e-agent.test.ts      → MOD: fixtures do pipeline.
tests/loop/orchestrator.test.ts  → MOD: fixtures + asserts de impressão.
tests/loop/run-loop.test.ts      → MOD: fixture (L646).
tests/git/worktree.test.ts       → MOD: comentário on_conflict → on_fail.
tests/fixtures/project/loopy.yml → MOD: migra o fixture de config.
```

> Pontos grep-confirmados no levantamento (arquivo:linha) estão anexados na
> plan.md; a lista acima é o mapa de arquivos.

## Code Style

Módulo puro + wrapper de I/O no molde de `config/load.ts` (`parseConfig`/
`loadConfig`). A pré-varredura de migração é uma função pura sobre o objeto YAML
cru, testável sem disco. Erros como valores/exceções claras nas fronteiras.
Mensagens em pt-BR. `verifySchema`/`VerifyConfig` seguem `.strict()`/`readonly`.

## Testing Strategy

vitest, testes espelhando `src/`. **Regressão zero de comportamento** é critério —
como o único valor é `escalate`, os casos de "esgota max_attempts → falha com
report" e "veredito FAIL bloqueia o step" continuam passando, agora lendo
`step.on_fail`.

- **Atualizar** os fixtures/expects listados na Project Structure para a forma nova.
- **Novo (load.ts):** três casos de erro guiado — `on_expect_fail`, `on_conflict`
  e `verify.on_fail` → mensagem cita a chave antiga, o step e "on_fail"; e um caso
  com **duas** chaves antigas → ambas no mesmo relatório (coletar-todas, OQ-3).
- **Novo (schema, OQ-7):** step `agent` com `on_fail` **sem** `verify` nem
  `expect` → rejeitado pelo `.refine` com mensagem pt-BR; com `verify` **ou**
  `expect` presente → aceito.
- **Dry-run:** `verify` imprime `run=… max_attempts=…` sem `on_fail`; o `on_fail`
  do step aparece como campo próprio.
- Gate final: `npm run typecheck && npm run lint && npm test` verdes.

## Boundaries

- **Always:** `on_fail` opcional, default `escalate`; preservar comportamento de
  runtime (só renomeação de config); erro de migração acionável (step + chave nova
  + `docs/MIGRATION.md`); migrar `loopy.yml` de exemplo **e** o fixture; rodar
  `typecheck`+`lint`+`test` antes de commit.
- **Ask first:** introduzir qualquer valor de `on_fail` além de `escalate` (fora de
  escopo; revisaria o ADR-0001); adicionar dependência; mudar outros blocos do
  schema.
- **Never:** reintroduzir `on_expect_fail`/`on_conflict`/`verify.on_fail` como
  aliases (auto-migração foi descartada); hardcodar política de loop no motor
  (AD-1); commitar com algum dos três checks vermelho.

## Success Criteria

1. `verify:` aceita **apenas** `{ run, max_attempts }`; `on_fail` aninhado é
   rejeitado.
2. `on_expect_fail` e `on_conflict` **não existem mais** no schema nem nos tipos;
   `agent` e `approval` usam `on_fail` (opcional, default `escalate`). Em `agent`,
   `on_fail` sem `verify` nem `expect` é **rejeitado** pelo `.refine` (OQ-7).
3. Config com qualquer das três chaves removidas falha com **erro guiado** citando
   step + chave nova + `docs/MIGRATION.md` (não o `Unrecognized key` genérico).
4. `loopy.yml` de exemplo e `tests/fixtures/project/loopy.yml` migrados e válidos.
5. `--dry-run` imprime `verify: run=… max_attempts=…` (sem `on_fail`) e `on_fail`
   do step como campo próprio quando presente.
6. `docs/MIGRATION.md` documenta o antes→depois das três chaves; `CONTEXT.md`
   reflete a chave única.
7. **Regressão zero:** comportamento de runtime idêntico; toda a suíte verde.

## Open Questions

- **OQ-1 (resolvido):** migração = **erro amigável guiado** (não `.strict()`
  genérico, não auto-migração/alias). Confirmado pelo usuário.
- **OQ-2 (resolvido):** `on_fail` é **opcional** em todos os steps, default
  `escalate` — coerente com `shell`/`checks` e com o fallback já existente.
- **OQ-3 (resolvido):** pré-varredura **coleta todas** as chaves removidas e
  reporta junto, reaproveitando o cabeçalho `Config inválido em "..."`.
- **OQ-4 (resolvido):** match **por nome em qualquer step**, sem condicionar ao
  `type`; `.strict()` cobre o resto.
- **OQ-5 (resolvido):** mensagem do `verify.on_fail` **explicita a realocação**
  ("mova para 'on_fail' no nível do step").
- **OQ-6 (resolvido):** identificação do step usa `id` quando string não-vazia,
  senão `pipeline[<índice>]`. Pré-varredura é função pura inline no `load.ts`.
- **OQ-7 (resolvido):** `on_fail` num step `agent` **exige** `verify` ou `expect`
  (`.refine` rejeita o caso órfão). `approval` não recebe guarda equivalente (seu
  modo de falha é intrínseco). Confirmado pelo usuário.
