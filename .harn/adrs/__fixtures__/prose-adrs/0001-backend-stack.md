# ADR-0001 — Stack do backend serverless do onboarding PF

- **Status:** Proposed
- **Data:** 2026-05-08
- **Decisores:** time de plataforma Liber (Henrique Lima como autor)
- **Escopo:** Backend serverless do onboarding PF (`feature/backend-cadastro-pf`),
  vivendo em `apps/backend/`. Não cobre PJ, login pós-onboarding, nem o BFF Woovi
  (já decidido em [`../woovi/decisions/ADR-001-bff-obrigatorio.md`](../woovi/decisions/ADR-001-bff-obrigatorio.md)).
- **Spec:** [`../../.harn/devy/specs/20260508-feature-backend-cadastro-pf/spec.md`](../../.harn/devy/specs/20260508-feature-backend-cadastro-pf/spec.md) §3.

## Context

O frontend de onboarding PF está pronto e roda contra MSW. Para sair do mock e
ir a produção precisamos de um backend que:

1. Persista o cadastro em todas as etapas (00..09).
2. Integre com a CAF (KYC/biometria) sem expor credenciais ao navegador
   — premissa já consolidada em `project_caf_backend_only`.
3. Suba dezenas de PRs/dia em paralelo a outras squads sem bloquear deploys
   (cada slice vertical do plano gera ≥ 1 PR).
4. Permita ao desenvolvedor reproduzir cenários de webhook CAF
   (APPROVED, REPROVED, MANUAL_REVIEW, INVALID, TIMEOUT) sem depender da CAF
   sandbox para testes locais e CI.

Como o time Liber já opera em AWS e a Woovi/CAF spikes vivem em Express, a
pergunta é: **qual stack atende os 4 requisitos com o menor custo cognitivo
e a melhor performance de cold start em Lambda?**

A spec §3 lista 8 decisões interligadas (framework HTTP, ORM, runtime, validação,
IDs, auth, mock CAF, hosting frontend). Este ADR consolida-as para que mudanças
futuras tenham um único ponto de referência.

## Decision

Adotar a stack abaixo para **toda Lambda nova** do onboarding PF.

| Eixo                | Escolha                                            |
| ------------------- | -------------------------------------------------- |
| Framework HTTP      | **Hono v4** + adapter `hono/aws-lambda`            |
| ORM                 | **Drizzle ORM** + `drizzle-orm/node-postgres`      |
| Runtime Lambda      | **Node.js 22 LTS arm64** (Graviton)                |
| Validação           | **Zod 3.x** + `@hono/zod-openapi`                  |
| ID externo (HTTP)   | **ULID com prefixo de tipo** (`reg_`, `txn_`, …)   |
| ID interno (DB)     | **uuid** via `gen_random_uuid()`                   |
| Auth                | **JWT RS256 short-lived** (sessionToken 1h)        |
| Mock CAF            | **Endpoint dev-only** `POST /dev/caf/simulate-webhook` (bloqueado em prod) |
| Hosting frontend    | **SST `StaticSite`** (CloudFront + S3)             |
| IaC                 | **SST v3**                                         |
| Bundling            | **esbuild** (`format: 'esm'`, `target: 'node22'`)  |

### Razões

1. **Hono ganha em cold start.** Bundle ~14KB, `app.request()` para tests
   in-process, type inference para `testClient`, e `@hono/zod-openapi` gera o
   `openapi.json` em build (regenera handlers MSW automaticamente, fechando o
   gap de contrato com o frontend). Alternativa **Powertools handlers** força
   mais boilerplate de roteamento/middleware sem ganho técnico.

2. **Drizzle paga zero cold start de engine.** Drizzle não tem runtime engine
   separado — é só SQL gerado em build. Bundle ~50KB, schema em TS é a fonte
   da verdade e `drizzle-kit generate` cria migrations versionadas
   (`0000_init.sql`, `0001_<descrição>.sql`). **Prisma** descartado por engine
   nativo binário (>300ms cold start em Lambda + ~10MB de bundle). **`pg` cru**
   descartado por perda de type-safety nos LEFT JOINs do `GET /v1/registrations/:id`.

3. **Node 22 LTS arm64 é o sweet spot custo×perf.** Graviton ~20% mais barato
   e ~15% mais rápido em I/O bound; LTS até abril 2027; Node 22 acelera JSON
   parse e regex que dominam o hot path de toda Lambda HTTP.

4. **Zod fecha o loop de contrato.** Padrão de fato em Hono; cold start ~10ms
   na primeira validação; permite tipagem cliente para o frontend e regeneração
   automática dos handlers MSW. **Valibot** descartado: ecossistema Hono ainda
   menos maduro, ganho de bundle marginal.

5. **ULID com prefixo é debugável e sortable.** ULIDs ordenam por tempo (vs UUID
   v4), são legíveis (`reg_01J2K4X9...`) e o prefixo de tipo separa namespaces
   sem custo. DB usa `uuid` interno (boundary HTTP converte) — mantém compat
   com `pg §Primary Keys`. **UUID v7** descartado por suporte ainda inconsistente.

6. **JWT RS256 short-lived elimina IdP no MVP.** Server stateless
   (`restful §Statelessness`); par de chaves em AWS Secrets Manager, rotação
   semestral manual com `kid` no header (rotação sem downtime). Cognito/Auth0
   adicionam cold start, custos e cognitive load para um MVP **sem login**.
   Migrar para Cognito quando login pós-onboarding chegar (V2).

7. **Mock CAF dev-only ganha sobre container e MSW.** Endpoint
   `POST /dev/caf/simulate-webhook` enfileira evento no SQS `caf-webhook-events`
   com payload idêntico ao da CAF — exercita o mesmo path de produção. Guard
   duplo: handler verifica `STAGE !== 'prod'` e o `sst.config.ts` não cria a
   rota em prod (defesa em profundidade). Alternativas descartadas:
   - **Container no docker-compose**: força Docker mesmo em testes unitários,
     fica órfão se `pnpm dev` morre abrupto.
   - **MSW preservado para SDK CAF**: não simula o lado servidor (webhook),
     deixa lacuna entre cliente (mock) e backend (real).

8. **SST `StaticSite` substitui o Vercel/manual deploy.** Abstrai bucket
   privado + OAI + CloudFront + invalidação no deploy; injeta
   `VITE_API_BASE_URL` resolvido para `Resource.OnboardingApi.url` em
   build-time. Mantém o frontend (`apps/frontend/`) como artefato estático,
   sem SSR.

### Forma do mock CAF

```
POST /dev/caf/simulate-webhook
Authorization: Bearer <sessionToken>
Content-Type: application/json

{
  "transactionId": "txn_…",
  "outcome": "APPROVED" | "REPROVED" | "MANUAL_REVIEW" | "INVALID" | "TIMEOUT",
  "delayMs": 0
}
```

## Consequences

### Positivas

- **Cold start P50 < 200ms** alvo factível para Hono+Drizzle+Node22 arm64
  (validação na Fase 3 do plano via k6, alvos da spec §12.7).
- **Type safety end-to-end:** Drizzle schema → Zod → OpenAPI → handlers MSW
  regenerados. O frontend deixa de depender de tipos paralelos manuais.
- **Mock CAF in-process:** zero dependência de Docker para reproduzir
  webhook; CI roda APPROVED/REPROVED/MANUAL_REVIEW/INVALID/TIMEOUT sem
  serviços auxiliares (spec §18.1 resolvida com hipótese `CAF_MODE=fake`
  até credenciais sandbox chegarem).
- **Reuso entre Lambdas:** `createApp()`, middlewares (`auth`, `idempotency`,
  `audit`, `rate-limit`) compartilhados em `src/shared/`. Cada Lambda nova
  é só rota + handler.
- **IaC unificada (SST v3):** uma única `sst.config.ts` orquestra VPC, Aurora,
  RDS Proxy, Redis, S3, SQS, EventBridge, API Gateway HTTP e o `StaticSite`.

### Negativas / custo

- **Curva de aprendizado SST v3** para quem só conhece Serverless Framework
  ou Terraform. Mitigação: spec já documenta cada `Resource` e o plano tem
  uma fase 1 dedicada à infra antes de qualquer slice vertical.
- **Drizzle migrations são unidirecionais por padrão.** Não há `down`
  automático — rollback exige migration reversa manual. Mitigação:
  `apps/backend/docs/rollback-runbook.md` (Fase 4) documenta o procedimento.
- **JWT roll-your-own carrega risco de implementação.** Mitigação:
  RS256 (não HS256), chaves em Secrets Manager, `kid` no header,
  pen test interno na Fase 3 (todo §3.4).
- **Mock CAF em prod-staging exige rigor.** Se o guard falhar, cenário
  REPROVED/APPROVED pode ser disparado por atacante. Mitigação: defesa
  em profundidade (handler check + sst.config.ts ausência da rota + WAF
  block `/dev/*` em prod).
- **arm64 obriga build cross-arch em CI.** Mitigação: GitHub Actions
  Linux x86_64 com `esbuild` produz bundle Node-compatível independente
  da arch do builder; Lambda runtime arm64 executa o bundle ESM.

### Mitigações operacionais

- **Observabilidade:** X-Ray ativo em todas as Lambdas (subsegments para
  Drizzle, Redis, HTTP, S3); 10 alarmes CloudWatch listados na spec §14.3.
- **Rate limit:** Hono middleware + WAF rate limit por IP — defesa dupla
  para `/v1/registrations` e `/v1/registrations/*/biometrics/verify`.
- **Secrets:** `JwtSigningKey`, `CafApiKey`, `CafWebhookHmacKey`,
  `CafWebhookAllowedIps` em Secrets Manager por stage; rotação documentada
  no runbook.

## Alternativas rejeitadas (resumo)

| Alternativa                       | Por que não                                                          |
| --------------------------------- | -------------------------------------------------------------------- |
| AWS Powertools handlers nativos   | Mais boilerplate, perde type inference do `testClient`               |
| Prisma                            | Engine binário >300ms cold start, +10MB bundle                       |
| `pg` cru sem ORM                  | LEFT JOINs frágeis, sem type safety end-to-end                       |
| Node x86_64                       | ~20% mais caro, ~15% mais lento em I/O bound vs arm64                |
| Valibot                           | Ecossistema Hono menos maduro, ganho marginal de bundle              |
| UUID v4                           | Não-sortable, debugging em logs sofre                                |
| UUID v7                           | Suporte de libs ainda inconsistente (out of scope MVP)               |
| Cognito / Auth0                   | Cold start, custo, cognitive load — sem login no MVP                 |
| Container CAF mock                | Força Docker em testes unitários, processo órfão                     |
| MSW preservado para CAF           | Não simula o lado servidor (webhook)                                 |
| Vercel / Netlify para frontend    | Sai do controle AWS, duplicaria DNS/cert/observabilidade             |

## Referências

- Spec: [`../../.harn/devy/specs/20260508-feature-backend-cadastro-pf/spec.md`](../../.harn/devy/specs/20260508-feature-backend-cadastro-pf/spec.md) §3 (Decisões técnicas) e §18 (Open Questions).
- Plan: [`../../.harn/devy/specs/20260508-feature-backend-cadastro-pf/plan.md`](../../.harn/devy/specs/20260508-feature-backend-cadastro-pf/plan.md) Fases 0–4.
- TODO checklist: [`../../.harn/devy/specs/20260508-feature-backend-cadastro-pf/todo.md`](../../.harn/devy/specs/20260508-feature-backend-cadastro-pf/todo.md) — esta ADR é a tarefa **0.1**.
- ADR análogo: [`../woovi/decisions/ADR-001-bff-obrigatorio.md`](../woovi/decisions/ADR-001-bff-obrigatorio.md).
- Memória de projeto: `project_caf_backend_only` (CAF proíbe integração frontend; BFF/backend obrigatório).
- Documentação SST v3: <https://sst.dev/docs/>
- Documentação Hono: <https://hono.dev/>
- Documentação Drizzle: <https://orm.drizzle.team/>
