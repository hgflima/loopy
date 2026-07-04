# ADR-0005 — Não adotar contrato tipado BE↔FE (carcaça OpenAPI removida)

- **Status:** Accepted
- **Data:** 2026-06-09
- **Decisores:** time de plataforma Liber (Henrique Lima como autor)
- **Escopo:** Backend `apps/backend/` e Frontend `apps/frontend/`. Remove o scaffolding morto de
  contrato tipado OpenAPI (emissão de spec no backend + codegen de tipos no frontend) e registra a
  decisão de **não** adotar um contrato tipado BE↔FE neste momento.
- **Specs:** [`.harn/devy/specs/20260609-application-quality-followup/spec.md`](../../.harn/devy/specs/20260609-application-quality-followup/spec.md)
  (§4, §7.1) + [`plan.md`](../../.harn/devy/specs/20260609-application-quality-followup/plan.md) (Task 6).
- **Precedente:** [ADR-0001](./0001-backend-stack.md) (stack do backend);
  [ADR-0004](./0004-calibracao-instrumento-dead-code.md) (calibração do instrumento de dead-code).

## Context

O backend tinha um scaffolding de contrato tipado OpenAPI introduzido cedo (spec §6 conv) que nunca
foi adotado. A cadeia estava morta ponta a ponta, sem nenhum consumidor real:

```
package.json "build:openapi" → emit-openapi.ts → createOpenApiApp → errorEnvelopeSchema → openapi.json (stub 1094 B)
                                                                                              ↓
                                          frontend sync-contracts.ts → contracts.gen.ts (15 linhas) → ninguém importa
```

Provas de uso-zero levantadas no refino `20260609-application-quality-followup`:

- **Nenhum dos 25 controllers** usa `createRoute`/`OpenAPIHono` — nada é registrado no documento
  OpenAPI. O `openapi.json` emitido continha apenas `info` + `components` (apenas `ErrorEnvelope` e
  `bearerAuth`), sem nenhum `path`.
- `createOpenApiApp`, `errorEnvelopeSchema` e `OpenApiAppOptions` (`src/contracts/openapi.ts`):
  **0 usos** em `src/`. Os únicos consumidores eram `scripts/emit-openapi.ts` e o teste
  `src/contracts/__tests__/openapi.test.ts` — ambos parte da própria carcaça.
- `contracts.gen.ts` (frontend): **0 importadores**. `ErrorEnvelope`/`API_PATHS`/`ApiPath` exportados
  ali não eram consumidos por nenhum service ou componente.
- A dependência `@hono/zod-openapi` era importada **exclusivamente** por `openapi.ts`.

O frontend e o backend continuam conversando por contrato implícito (Zod nos `*BodySchema` do backend
para validação de input; `services/` no frontend modelando as respostas à mão). Não há intenção de
introduzir um pipeline de contrato tipado gerado agora.

## Decision

**Não adotar um contrato tipado BE↔FE neste momento** e **remover a carcaça especulativa** (YAGNI),
em vez de mantê-la como pipeline-zumbi. A remoção cobre as duas pontas para não deixar um lado órfão:

### Backend (`apps/backend/`)
- Deletado `src/contracts/openapi.ts` (`createOpenApiApp`, `errorEnvelopeSchema`, `OpenApiAppOptions`).
- Deletado `src/contracts/openapi.json` (stub emitido, sem paths).
- Deletado `src/contracts/__tests__/openapi.test.ts` (único consumidor dos símbolos acima).
- Deletado `scripts/emit-openapi.ts`.
- Removido o script `build:openapi` de `package.json`.
- Removida a dependência `@hono/zod-openapi` de `package.json` (importada só por `openapi.ts`).

### Frontend (`apps/frontend/`)
- Deletado `scripts/sync-contracts.ts`.
- Deletado `src/services/contracts.gen.ts`.
- Removido o script `sync-contracts` de `package.json`.

Os `*BodySchema` (Zod) do backend **permanecem** — são a validação de input real dos controllers e
não fazem parte da carcaça OpenAPI.

## Consequences

**Positivas:**
- O selo `dead-code` do `qualy:report` deixa de mostrar essa cadeia como morta — o instrumento passa
  a refletir só código vivo.
- Uma dependência a menos (`@hono/zod-openapi`) e dois scripts mortos a menos (`build:openapi`,
  `sync-contracts`) — menos superfície de manutenção e de confusão para quem chega.
- Sem pipeline-zumbi: não sobra um lado (BE ou FE) emitindo/consumindo artefato sem par.

**Negativas / trade-offs:**
- O contrato BE↔FE continua implícito (sem tipos gerados). Mudanças de shape de resposta não são
  pegas em compile-time no frontend — dependem de testes e revisão.

**Reversibilidade:**
- Se um contrato tipado gerado se justificar no futuro, ele deve ser (re)introduzido **com adoção
  real** — controllers registrando rotas via `createRoute`/`OpenAPIHono` e o frontend importando os
  tipos gerados — e não como scaffolding vazio. Esta decisão remove só o scaffolding não-adotado, não
  veta a ideia.
