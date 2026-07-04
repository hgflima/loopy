# ADR-0004 — Calibração do instrumento de dead-code (`fallow`)

- **Status:** Accepted
- **Data:** 2026-06-09
- **Decisores:** time de plataforma Liber (Henrique Lima como autor)
- **Escopo:** Backend `apps/backend/`. Define a configuração do `fallow` (`apps/backend/.fallowrc.json`)
  que calibra a análise de dead-code do `qualy:report` para o padrão hexagonal do backend — declarando
  entrypoints implícitos, suprimindo membros de classe que satisfazem porta via `implements`, e
  ignorando exports usados só no próprio arquivo (over-export).
- **Specs:** [`.harn/devy/specs/20260609-application-quality-followup/spec.md`](../../.harn/devy/specs/20260609-application-quality-followup/spec.md)
  (§2 D2/D3/D4, §3 G1/G2) + [`plan.md`](../../.harn/devy/specs/20260609-application-quality-followup/plan.md) (Task 1).
- **Precedente:** [ADR-0002](./0002-fronteira-hexagonal-direcao-dependencia.md) (fronteira hexagonal);
  [ADR-0003](./0003-smells-de-qualidade-aceitos.md) (smells idiomáticos aceitos).

## Context

O refino `20260609-application-quality-followup` investigou os 227 achados de `dead-code` do
`qualy:report` grupo a grupo. Dois grupos inteiros eram **100% falso-positivo** — não código morto,
mas limitação estrutural do `fallow` rodando sem configuração:

- **G1 — 16 `unused-file`:** o `fallow` deriva alcance por reachability a partir de entrypoints. Sem
  config, ele não enxerga os entrypoints que o backend carrega **por string** ou via runner externo:
  - 6 handlers Lambda (`src/fns/**/handler.ts`) — referenciados por string em `src/deploy/manifest.ts`
    (ex.: `handler: "src/fns/caf/webhook/handler.handler"`), nunca por `import`.
  - `sst.config.ts` — entrypoint do CLI `sst`; `src/deploy/remote.ts` — importado em cascata por ele.
  - 3 `scripts/*` (`capture-caf-transaction`, `create-rep-invitation`, `staging-migrate`) — CLIs
    executados via `tsx`/`deploy.sh`.
  - `tests/e2e/global-setup.ts` — carregado pelo test-runner.
  - 4 assets de template do próprio `qualy:report` (`scripts/quality-report/template/assets/*`) —
    **copiados** por `render.ts` e referenciados por `<link>`/`<script>` no HTML gerado, não importados.

- **G2 — 113 `unused-class-member`:** o `fallow` não reconhece **obrigação de interface**. Um método
  de adapter outbound (`adapters/outbound/**`) existe porque a classe declara `implements <Port>` e é
  chamado via dependência **tipada pela porta** (`deps.reader.findInvitation()`,
  `repos.registrations.save()`) — nunca pela classe concreta. Estaticamente o `fallow` não liga o
  call-site (tipo = interface) ao membro (classe concreta) e marca o membro como morto. Provado:
  110 membros em `adapters/outbound/**` + 3 em fakes de teste (`FakeSqs.receive`/`deleteMessage`,
  `FakeRedis.reset`, ambos `implements SqsClientLike`/`RedisLike`).

- **D4 — over-export rotulado como dead:** símbolo exportado mas consumido **só dentro do próprio
  arquivo** (ex.: `COMPANY_DOCUMENT_SLOTS`, que alimenta `companyDocumentSlotSchema` no mesmo módulo)
  é reportado como `unused-export`. Isso é *over-export* (visibilidade larga demais), não *dead-code* —
  o report confundia as duas categorias.

Sem calibrar o instrumento, agir sobre esses 129 findings (16+113) seria agir sobre alarme falso:
deletar entrypoints quebraria runtime; deletar membros de adapter quebraria o `implements` da porta.

## Decision

Criar `apps/backend/.fallowrc.json` (nome canônico via `fallow init`, versão 2.89.0) com três knobs:

### 1 — `entry`: declarar entrypoints implícitos (resolve G1)

Regra de calibração: **"um entrypoint carregado por string (handler Lambda em `manifest.ts`),
por CLI externo (`sst`, `tsx`, `deploy.sh`) ou por test-runner não está morto, mesmo sem `import`."**

```jsonc
"entry": [
  "sst.config.ts",
  "src/deploy/remote.ts",
  "src/fns/**/handler.ts",
  "scripts/capture-caf-transaction.ts",
  "scripts/create-rep-invitation.ts",
  "scripts/staging-migrate.ts",
  "tests/e2e/global-setup.ts"
]
```

Os assets de template (`scripts/quality-report/template/**`) saem por `ignorePatterns` — são
copiados/referenciados por HTML, não fazem parte do grafo de módulos:

```jsonc
"ignorePatterns": ["scripts/quality-report/template/**"]
```

### 2 — `usedClassMembers` escopado por `implements`: obrigação de interface (resolve G2)

Regra de calibração: **"membro de classe que satisfaz uma interface declarada via `implements`
(consumida via DI, tipada pela porta) não está morto, mesmo sem chamador direto da classe concreta."**

O `fallow` 2.89 suporta regra `usedClassMembers` constrita por heritage (`{ "implements": "<Iface>",
"members": ["*"] }`). **Não há wildcard de interface** (`implements: "*"` foi testado e não casa) —
cada porta implementada pelos adapters outbound é declarada explicitamente. O escopo é por **nome de
interface**, não por path: isso é mais estreito e correto que exentar `adapters/outbound/**` em bloco
— suprime só os membros que satisfazem aquelas portas específicas.

Decorrência importante: a regra é **interface-scoped, não path-scoped**. Os fakes de teste
(`FakeSqs implements SqsClientLike`, `FakeRedis implements RedisLike`) ficam cobertos pelas mesmas
entradas `SqsClientLike`/`RedisLike` — **sem exentar `__tests__` em bloco**. Um membro de classe
genuinamente morto que **não** satisfaça nenhuma porta listada continua sendo reportado.

As ~52 entradas correspondem 1:1 às portas de `application/ports/**` implementadas pelos adapters de
`adapters/outbound/**` (e pelos 2 fakes). Ao adicionar um adapter novo que implemente uma porta nova,
adicione a entrada correspondente.

### 3 — `ignoreExportsUsedInFile: true`: over-export ≠ dead-code (resolve D4)

```jsonc
"ignoreExportsUsedInFile": true
```

Símbolos exportados e consumidos no próprio arquivo (`COMPANY_DOCUMENT_SLOTS`,
`companyDocumentSlotSchema`) deixam de chegar como `unused-export`. Isso é classificação correta:
over-export é candidato a remover só o `export` (Fase 2 / T8), não a deletar o símbolo.

## Consequences

**Positivas:**
- `fallow dead-code` (de `apps/backend`) reporta **0** `unused-file` (G1) e **0** `unused-class-member`
  (G2). O selo `dead-code` do `qualy:report` passa a refletir só achados reais (G3 contratos,
  G4 resíduo, G5 deps).
- A supressão de membros é **estreita por interface** — não cega o instrumento para dead-code futuro
  de teste ou de classes que não satisfazem porta.
- A regra de calibração fica versionada e auditável, fora do allowlist do report (que continua só
  para smells de qlty sem knob de config — complexity/dup/boolean-logic).

**Negativas / manutenção:**
- A lista de `usedClassMembers` é manual e acopla a config ao conjunto de portas. Adapter novo →
  porta nova → exige nova entrada (senão o membro reaparece como falso-positivo). Mitigação: a entrada
  é mecânica (uma linha por interface) e o `qualy:report` flagra a omissão na hora.
- `implements: "*"` não é suportado pela versão atual do `fallow` (2.89.0); se uma versão futura
  adicionar wildcard de heritage, a lista pode colapsar para uma entrada só.

## Escopo explícito (o que esta calibração NÃO faz)

- ❌ Não exenta `__tests__` em bloco — só os fakes que satisfazem `SqsClientLike`/`RedisLike` via a
  regra interface-scoped (ADR-0003 e spec §3-G2).
- ❌ Não deleta nenhum símbolo — é calibração do instrumento (Fase 1). Deleções provadas e remoções de
  `export` são Fase 2 (T5/T8).
- ❌ Não toca o allowlist do `quality-report.ts` (`quality-allow.jsonc`) — esse canal permanece só para
  smells de qlty.
