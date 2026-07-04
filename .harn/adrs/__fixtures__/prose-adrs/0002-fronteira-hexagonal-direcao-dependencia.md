# ADR-0002 — Fronteira hexagonal: direção de dependência e enforcement

- **Status:** Accepted
- **Data:** 2026-06-07
- **Decisores:** time de plataforma Liber (Henrique Lima como autor)
- **Escopo:** Backend `apps/backend/`. Consolida a regra de fronteira que vinha
  sendo aplicada de forma incremental pelas Phases 1–5 da refatoração hexagonal
  (`chore/backend-refactor-wip`) e pelo P5 do refactor inbound HTTP.
- **Specs:** [`../../.harn/devy/specs/20260606-chore-backend-refactor-wip/`](../../.harn/devy/specs/20260606-chore-backend-refactor-wip/) (P5/C1);
  PRD `.harn/prd-generator/20260526-backend-hexagonal-refactor.md` (O4, S1.1).

## Context

A refatoração hexagonal do backend estabeleceu rings (`domain`, `application`,
`adapters/inbound`, `adapters/outbound`, `fns`) com uma regra de direção de
dependência. Essa decisão é **transversal** a cinco specs e está hoje espalhada
por checkpoints de TODO, comentários de código e ~6 débitos técnicos — sem um
lar único. O sintoma da ausência de ADR já apareceu: o débito
[`20260526-import-boundary-lint-not-ci-gate`](../../.harn/devy/debts/20260526-import-boundary-lint-not-ci-gate.md)
registra que a barreira "fica documentada mas não garantida pela pipeline".

Sem um ponto de referência, dois erros previsíveis acontecem em PRs futuros:

1. Alguém relaxa a regra do lint sem entender por que ela existe.
2. Alguém faz inline de um port de um método (ex.: `CafErrorMapper`) achando que
   é over-engineering, reintroduzindo a dependência `inbound → outbound`.

Este ADR consolida **a regra**, **o padrão de escape (port-as-seam)**, **o
critério port vs. módulo puro** e **o enforcement** num único documento.

## Decision

### 1. Direção de dependência

A dependência só flui **para dentro**, em direção ao núcleo:

```
fns ─▶ adapters/{inbound,outbound} ─▶ application ─▶ domain
```

Regras concretas, em ordem de endurecimento histórico:

- **`src/domain` não importa nada de infra** (`hono`, `drizzle-orm`, `pg`,
  `ioredis`, `@aws-sdk/*`, `adapters`, `fns`, `db`) — Phase 1 (S1.1/AC2).
- **`src/adapters/inbound` não importa `src/adapters/outbound`** — P5/T5.4 (C1).
  Inbound fala com o mundo externo só através de **ports da `application`**,
  injetados via composition root.
- `application` e `domain` não importam concretos de adapters; conhecem apenas
  os **ports** que eles próprios declaram.

### 2. Port-as-seam (quando inbound precisa de algo que vive em outbound)

Quando um adapter inbound precisa de uma capacidade cuja **implementação ou
dependência mora em outbound**, criamos uma **interface (port) em
`application/ports/`** e injetamos a implementação via deps no composition root.

Caso canônico — mapeamento de erro CAF (Design A, aprovado no CHECKPOINT 5):

- `application/ports/caf-error-mapper.ts` — interface `CafErrorMapper`
  (`toApiError(err: unknown): ApiError`).
- `adapters/outbound/caf/error-mapping.ts` — `mapCafErrorToApiError` (a lógica,
  que depende das classes `CafApiError`/`CafAuthError` de outbound) + o const
  `cafErrorMapper` conformando ao port.
- Controllers inbound (`registration/individual/documents`,
  `registration/individual/identity-checks`,
  `legal-representative/identity-checks`) recebem `cafErrorMapper` via deps; o
  wiring concreto vive nos composition roots (`fns/registration/app.ts`,
  `fns/.../invitations/app.ts`).

O port tem **um método e uma implementação** — e isso é intencional, não
incompleto. Ele não existe por polimorfismo; existe porque as classes de erro
moram em outbound e o inbound não pode importá-las. É o seam mínimo viável.

### 3. Critério port vs. módulo puro

> **Regra de bolso:** crie um **port** quando a implementação carrega uma
> dependência que o núcleo não pode/deve conhecer (I/O, SDK, classes do vendor).
> **Caso contrário** é código de aplicação puro — mora em `application/` e se
> chama direto, sem interface. Port é ferramenta de **inversão de dependência**,
> não de consistência: sem dependência a inverter, um port vira cerimônia
> (Speculative Generality). Não abstraia "por uniformidade" — quando uma função
> pura passar a precisar de I/O, extraia o port **nesse momento**.

Nem tudo que sai de outbound vira port. O critério:

| Situação | Destino |
| --- | --- |
| Capacidade cuja impl/dependência vive em outbound (I/O, SDK, classes de erro do vendor) e o inbound precisa dela | **Port** em `application/ports/` + impl em outbound conformando |
| Código **puro** (sem I/O, sem SDK) que por acaso estava em outbound | **Move direto** para `application/` (módulo puro, sem interface) |

Caso canônico do segundo — política de upload de documento (T5.2):
`application/policy/document-upload-policy.ts` (allowlist, limite, key-derivation)
é módulo puro chamado diretamente pelo inbound. **Não é port** porque não há
dependência a inverter — é só código que estava na pasta errada.

### 4. Enforcement

Regra de lint via `oxlint` `no-restricted-imports`, em `apps/backend/oxlint.json`:

- override em `src/domain/**` proíbe imports de infra (Phase 1);
- override em `src/adapters/inbound/**` proíbe `@/adapters/outbound`,
  `@/adapters/outbound/**` e `**/adapters/outbound/**` (pega alias e relativo) —
  P5/T5.4;
- testes em inbound (`**/*.test.ts(x)`) são **excluídos** da regra: injetam o
  mapper real e simulam `CafApiError`/`CafAuthError`, então precisam importar
  outbound legitimamente.

## Consequences

### Positivas

- **A direção de dependência é verificável, não só convencionada.** Um import
  proibido falha o lint (exit 1).
- **Testabilidade:** ports são pontos de injeção naturais; o núcleo
  (`application`/`domain`) testa sem AWS/Hono.
- **Um lar único** para a decisão, acima de qualquer spec/checkpoint individual.

### Negativas / custo

- **O seam é de lint, não de tipos.** Nada no compilador impede o import; a
  garantia é a regra do oxlint. Mitigação parcial: os padrões cobrem alias e
  caminho relativo.
- **O enforcement ainda não é gate de CI efetivo.** O root `pnpm lint` ignora
  `apps/**` e o lint do backend tem erros pré-existentes — ver débito
  [`20260526-import-boundary-lint-not-ci-gate`](../../.harn/devy/debts/20260526-import-boundary-lint-not-ci-gate.md)
  (agora abrange também a regra `inbound⊄outbound`).
- **`boundaries=0`/`coupling=0` é conformidade léxica, não semântica.**
  O override de `src/adapters/inbound/**` no `oxlint.json` banava `@/adapters/outbound`
  mas **não** banava `drizzle-orm` nem `@/db/**`. Enquanto esse buraco existiu,
  arquivos de inbound com import direto de drizzle (ex.:
  `webhook-receiver.base.ts`, `idempotency.ts`) não geravam violação de lint —
  o "zero" nos contadores de boundary/coupling do `qualy:report` era mecânico
  (o detector não via o import proibido), não uma prova de conformidade semântica.
  **Resolvida por G2** (auditoria hexagonal 2026-06-16, `chore/backend-refactor-wip`):
  o override passa a incluir `paths:["drizzle-orm"]` e `patterns:["@/db/**","**/db/**"]`,
  após os 3 vazamentos (G1 webhook, G1b caf-token, G1c idempotency) serem dissolvidos
  atrás de ports na mesma onda. A partir daí `boundaries=0` em `inbound/` tem
  significado semântico: qualquer import de drizzle ou `@/db` nesse anel falha o lint.
- **Ports de um método parecem over-engineering** a quem não conhece a razão.
  Este ADR é a defesa: não faça inline de `CafErrorMapper`.
- **Assimetria residual de política de upload.** Documento foi para
  `application/policy`; biometria permaneceu em `outbound/s3` — ver débito
  [`20260607-biometrics-policy-still-in-outbound`](../../.harn/devy/debts/20260607-biometrics-policy-still-in-outbound.md).

## Alternativas rejeitadas

| Alternativa | Por que não |
| --- | --- |
| `dependency-cruiser` / `eslint-boundaries` | Ferramenta extra na toolchain; o `oxlint` já é o linter do backend e `no-restricted-imports` cobre o caso com config mínima |
| Deixar inbound importar outbound direto | É exatamente a dependência que o C1 corta; controllers ficariam acoplados a classes de erro/SDK do vendor |
| Mover `CafApiError`/`CafAuthError` para `shared` | São conceitos de cliente upstream (outbound); promovê-los a shared vazaria detalhe de I/O para o núcleo |
| Fazer port também para `document-upload-policy` | Não há dependência a inverter (código puro) — port seria abstração especulativa |

## Referências

- ADR base de stack: [`./0001-backend-stack.md`](./0001-backend-stack.md).
- Spec P5: [`../../.harn/devy/specs/20260606-chore-backend-refactor-wip/todo.md`](../../.harn/devy/specs/20260606-chore-backend-refactor-wip/todo.md) (T5.1–T5.4, CHECKPOINT 5).
- PRD hexagonal: `.harn/prd-generator/20260526-backend-hexagonal-refactor.md` (O4, S1.1/AC2, Phase 5/E5).
- Débitos relacionados: `20260526-import-boundary-lint-not-ci-gate`, `20260607-biometrics-policy-still-in-outbound`, `20260530-t415-rep-legal-duplicate-error-map`.
