# ADR-0003 — Smells de qualidade aceitos deliberadamente em `application/`

- **Status:** Accepted
- **Data:** 2026-06-08
- **Decisores:** time de plataforma Liber (Henrique Lima como autor)
- **Escopo:** Backend `apps/backend/src/application/`. Registra os achados do qlty/fallow que
  foram deliberadamente **não refatorados** na limpeza de qualidade `20260608-application-quality-cleanup`,
  por serem idiomáticos ao padrão Result-type/guard-clause do código ou por a extração gerar
  indireção sem ganho mensurável.
- **Specs:** [`.harn/devy/specs/20260608-application-quality-cleanup/plan.md`](../../.harn/devy/specs/20260608-application-quality-cleanup/plan.md);
  débito de origem: [`.harn/devy/debts/20260608-quality-gate-rename-artifacts.md`](../../.harn/devy/debts/20260608-quality-gate-rename-artifacts.md).

## Context

A tarefa de limpeza `20260608-application-quality-cleanup` analisou 94 arquivos e 34 funções de
produção em `application/`. O `qlty smells` (modo `comment`, diff-scoped) reportou 41 smells:
29 `return-statements`, 8 `function-parameters` e 3 `function-complexity` acima do threshold.

O plano priorizou refatorar **apenas onde há complexidade extraível de verdade** (T3.1:
`apply-bank-validation` cyc≈20) e **deixar como estão** os casos em que o smell é consequência
direta do idioma escolhido pelo codebase, não de desorganização do código.

Três categorias foram aceitas explicitamente:

1. **Pipelines de guard/Result** (`#5` no plano): `createLegalRepresentativeIdentityCheck`,
   `submitDocument`, `submitBiometrics`, `submitInvitationBiometrics` — funções com
   `function_complexity` acima do threshold (cyc 11–15) derivada de pipelines lineares de
   early-return.
2. **Resíduo de `many-returns` / `many-params` idiomático** — presentes em ~26 funções de
   update/submit/query; cada `return` mapeia a um `status` distinto do Result-type.
3. **Similaridade residual dos 3 `update.ts` divergentes** (T2.2): `applicant-person`,
   `personal-data` e `banking` — similares em estrutura mas divergem em contratos e semântica;
   ficaram sem extração após a extração dos 3 idênticos para `run-slice-update.ts`.

## Decision

### 1 — `createLegalRepresentativeIdentityCheck` + `submit*` (#5): não refatorar

As quatro funções são **pipelines lineares de guard/Result**: cada `if (!x) return { status: "..." }`
mapeia a um estado de negócio distinto e legível (registro não encontrado, estado inválido,
provider não disponível, falha do CAF, sucesso com ou sem biometria). O padrão é:

```
loadState → guard not_found
         → guard canEditSlice / precondition
         → call provider (CAF / S3)
         → if error: return { status: "provider_error" | "invalid_state" | ... }
         → advanceState
         → return { status: "ok", ... }
```

Extrair os guards atrás de helpers que retornam union obrigaria o caller a re-despachar o
resultado do helper — a complexidade ciclomática migra para o caller, não some. O código ficaria
mais longo e com mais indireção sem reduzir risco de manutenção. A decisão é: **aceitar o smell e
não alterar estas funções.**

### 2 — Resíduo de `many-returns` / `many-params` idiomático: não refatorar em massa

O padrão Result-type (`{ status: "ok" | "not_found" | "invalid_state" | ... }`) produz múltiplos
`return` por design: cada ramo de falha early-returns com o status correspondente. Substituir por
exceções ou por um objeto de erro acoplado violaria o contrato de chamada que os controllers já
consomem. O padrão `deps` + `input` + `correlationId` + `requestId` como parâmetros separados
reflete a separação entre infraestrutura injetada (`deps`) e dados da requisição (`input`) — não
é "too many params" no sentido de acoplamento, é a assinatura da injeção de dependência sem
container.

Refatorar 26+ funções para calar o smell violaria o princípio de "smaller viable change" e
introduziria risco de regressão sem benefício. A decisão é: **aceitar o resíduo idiomático;
não há meta de "zerar smells" do qlty.**

### 3 — Similaridade residual dos 3 `update.ts` divergentes (T2.2): não extrair

Os três `update.ts` divergentes (`applicant-person`, `personal-data`, `banking`) compartilham a
estrutura `loadState → guard → upsert → transition → advance`, mas diferem em pontos que tornam
a extração forçada:

| Arquivo                      | Divergência                                                                    |
| ---------------------------- | ------------------------------------------------------------------------------ |
| `applicant-person/update.ts` | `advanceState` recebe `cpfDigits` extra; ramo sem-transition chama `updateCpf` |
| `personal-data/update.ts`    | Retorna `status: "locked"` em vez de `"invalid_state"`                         |
| `banking/update.ts`          | `loadStateAndKind` (kind dinâmico) + campo `isPj` no retorno                   |

Forçar os três no molde de `runSliceUpdate` exigiria parâmetros de escape (`cpfDigits?: string`,
`extraReturn?: ...`) que tornam o helper mais complexo que os próprios callers. O código atual é
mais legível com 3 implementações explícitas do que com 1 abstração com 3 casos especiais. A
similaridade residual flaggada pelo qlty (mass 203, agora abaixo do threshold após extração dos 3
idênticos) é aceita como custo da divergência legítima.

## Consequences

### Positivas

- **Sem indireção especulativa.** O código permanece legível sem helpers que só existem para
  calar uma métrica.
- **Risco de regressão zero** nessas funções: nenhum código foi alterado.
- **Decisão documentada.** PRs futuros que propuserem extrair essas funções têm um ponto de
  referência para avaliar o ganho real antes de agir.

### Negativas / custo

- **O qlty continuará reportando** `function_complexity` ≥ 11 para as quatro funções do #5 e
  `return-statements` / `function-parameters` para ~26 outras. Como o qlty opera em modo
  `comment` (não-bloqueante), isso não quebra o gate — mas leitores novos podem questionar.
- **A similaridade residual dos 3 `update.ts`** permanece detectável via `fallow dupes` se o
  threshold de mass for ajustado para baixo no futuro. Esta ADR é a resposta: a divergência é
  intencional.

## Alternativas rejeitadas

| Alternativa                                                                 | Por que não                                                                                         |
| --------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| Extrair guards de `submitDocument`/`submitBiometrics` para helpers de union | Complexidade migra para o caller (re-dispatch); não some                                            |
| Substituir early-returns por exceções                                       | Quebra o contrato Result-type que os controllers consomem                                           |
| Forçar os 3 `update.ts` divergentes no molde de `runSliceUpdate`            | Helper ficaria mais complexo que os callers; 3 parâmetros de escape para 3 casos especiais          |
| Refatorar todos os `many-returns` / `many-params`                           | Violaria "smallest viable change" + risco de regressão sem ganho; o padrão é idiomático ao codebase |

---

## §4 — `request-upload-url` (agregados distintos): não colapsar

**Contexto (adicionado em 2026-06-09 — spec `20260609-application-quality-followup` T10).**

Existem três arquivos `request-upload-url.ts` em `application/`:

| Arquivo | Agregado |
|---|---|
| `use-cases/registration/individual/document/request-upload-url.ts` | Registro PF — documento de identidade |
| `use-cases/registration/company/company-documents/request-upload-url.ts` | Registro PJ — documentos da empresa |
| `use-cases/legal-representative/document/request-upload-url.ts` | Convite do representante legal |

Os três compartilham a estrutura `loadState → guard → insertPending → presignDocumentUpload`, mas operam em agregados distintos (Registration PF, Registration PJ e LegalRepresentativeInvitation), dependem de portas de persistência diferentes e divergem em contratos de entrada e regras de guarda. Colapsar em um helper genérico exigiria parâmetros de escape por agregado, tornando o helper mais complexo do que os callers. O `qlty similar-code` é consequência da convergência estrutural do padrão de upload presignado, não de código duplicado sem diferença semântica.

**Decisão:** aceitar o `similar-code` nos três arquivos `**/request-upload-url.ts` de `application/`.

---

## §5 — `similar-code` em `ports/persistence/registration.ts`: assinaturas de interface

**Contexto (adicionado em 2026-06-09 — spec `20260609-application-quality-followup` T10).**

`apps/backend/src/application/ports/persistence/registration.ts` declara dezessete interfaces de porta de persistência do registro. Muitas dessas interfaces declaram métodos com assinaturas estruturalmente idênticas — em particular `advanceState(id, from, to, requestId)` e `loadState(id)` — porque as regras de transição de estado e o invariante de optimistic concurrency são transversais a todos os slices do registro.

A repetição não é acidental nem por falta de abstração: cada interface representa um contrato de porta distinto com uma perspectiva de escrita separada (dados pessoais, bancário, endereço, documentos etc.). Unificar as assinaturas via herança ou mixin violaria a separação de portas e acoplaria adapters de persistência que intencionalmente são independentes entre si. O smell é consequência direta do idioma port-per-slice do hexagonal.

**Decisão:** aceitar o `similar-code` em `ports/persistence/registration.ts`.

---

## §6 — `boolean-logic` no guard de liveness de `submitInvitationBiometrics`: não decompor

**Contexto (adicionado em 2026-06-09 — spec `20260609-application-quality-followup` T10).**

`use-cases/legal-representative/biometrics/submit.ts` contém em `submitInvitationBiometrics` um guard de liveness composto (linha 72–78):

```ts
if (
  liveness.isAlive !== true ||
  liveness.sessionId !== command.sessionId ||
  liveness.personId !== command.personId ||
  liveness.imageUrl !== command.imageUrl ||
  liveness.personId !== inv.repCpf
) {
  return { status: "verification_failed" };
}
```

As cinco condições são um único invariante de segurança atômico: **todas** devem ser verdadeiras para que a resposta de liveness seja aceita. Decompor em helpers separados (ex.: `isValidLivenessSession`, `isPersonMatch`) obrigaria o caller a re-combinar os resultados e tornaria possível, por acidente, aceitar uma resposta parcialmente válida. A complexidade booleana aqui é intencional e legível: ela expressa "a resposta é aceita se e somente se todos estes cinco campos batem". Nem o `boolean-logic` do qlty, nem a extração, reduzem o risco de regressão — pelo contrário, fragmentar aumenta.

**Decisão:** aceitar o `boolean-logic` em `submitInvitationBiometrics`.

---

## §7 — Clones em `__tests__/`: helpers e fixtures de teste duplicados

**Contexto (adicionado em 2026-06-09 — spec `20260609-application-quality-followup` T10).**

Os testes de use-cases de `application/` repetem padrões estruturais semelhantes: factories de deps (`makeDeps`), constantes de IDs de teste, stubs de estado. O `fallow clone` detecta esses blocos como duplicações porque o tamanho de token ultrapassa o threshold de clone.

Extrair essas construções em helpers compartilhados entre `__tests__/` de módulos diferentes criaria acoplamento entre testes de módulos independentes — exatamente o inverso do que testes de unidade devem fazer. Cada módulo deve poder evoluir seus fixtures sem depender de imports externos. A duplicação de boilerplate de teste é um custo aceitável pela independência de cada suite.

**Decisão:** aceitar os `fallow:clone` em `src/application/**/__tests__/`.

---

## §8 — Regulagem de `return-statements` (4→8) + descarte da consolidação de seeds

**Contexto (adicionado em 2026-06-15).**

Triagem do `qualy:report apps/backend/src` (672 achados ativos) com medição before/after, não palpite:

1. **`return-statements` era a regra de maior ruído** — 46 funções (43% de todos os smells qlty
   do backend). A decomposição provou que **42 das 46 não têm `function-complexity` nenhuma**: são
   guard-clauses lineares (o estilo que o `fallow` **exige** ao penalizar complexidade). As 4 com
   complexidade real já são pegas pelo `function-complexity`. E `nested-control-flow` deu **0
   disparos no backend inteiro** — o código é raso; o return-count aqui mede *estilo*, não dificuldade.
2. **A consolidação dos seeds de teste foi tentada e medida.** Hipótese: extrair `seedRegistration`
   dos 28 testes de `fns/registration/__tests__/` reduziria os `fallow:clone` (584 em `__tests__`).
   Medição `fallow dupes` antes/depois: **745 → 753 clone_groups** (instâncias empatadas). Não
   reduz — apenas redistribui os clones para os call-sites e para o próprio helper. Confirma §7.

### Decisão 1 — descartar a consolidação de seeds; estender §7 a `fns/`

O princípio de §7 (duplicação de boilerplate de teste é custo aceitável pela independência das
suites) vale igualmente para `src/fns/**/__tests__/`. Extrair helpers de seed compartilhados acopla
testes de módulos independentes sem mover o indicador. **Aceitar os `fallow:clone` em
`src/fns/**/__tests__/`** e descartar a spec `20260615-test-seed-helper-consolidation`.
Pela mesma razão, **aceitar o `fallow:complexity` do helper `seedRegistration`**: a complexidade é
inerente ao setup (monta o estado completo da registration) e decompor o helper é justamente a
consolidação já medida e descartada acima.

### Decisão 2 — `return_statements` threshold 4 → 8 (`.qlty/qlty.toml` + espelho `severity.ts`)

O return-count mistura dois sinais opostos: complexidade real (já coberta por `function-complexity`,
threshold 11) e guard-clause/Result-type (estilo correto, idiomático ao codebase — §1, §2). O
threshold 8 alinha as duas réguas: dispara só quando coincide com complexidade genuína. Medição:
**return-statements 46 → 3**; total qlty **108 → 60**. Os 3 remanescentes (`wooviWebhookController`
11, `processDocument` 9, `submitDocument` 9) já disparam `function-complexity` — são consistentes,
não contraditórios, e cobertos por §1. Zero linha de código de produção alterada.

---

## §9 — Clones em `inbound/**/__tests__/`: boilerplate de teste no anel inbound

**Contexto (adicionado em 2026-06-16 — spec `20260616-hexagonal-audit-remediation` T5).**

Os testes de `adapters/inbound/` repetem padrões estruturais semelhantes entre suites independentes: factories de `makeDeps`, fixtures de request/response HTTP e stubs de gateway. O `fallow:clone` detecta esses blocos como duplicações porque o tamanho de token ultrapassa o threshold de clone.

O princípio de §7 (duplicação de boilerplate de teste é custo aceitável pela independência das suites) vale igualmente para `src/adapters/inbound/**/__tests__/`. Extrair helpers compartilhados entre suites de controllers distintos criaria acoplamento entre testes de controllers independentes. O glob `src/adapters/inbound/**/__tests__/**` é restrito exclusivamente à pasta de testes — nenhum clone de produção do anel inbound é isentado.

**Alcance sobre o selo de Duplicação.** Esta entrada aceita os 94 `fallow:clone` de `inbound/**/__tests__/`; findings aceitos são excluídos do cálculo do selo (`severity.ts#sealFor` filtra `accepted == null`), portanto nenhum deles dirige o selo "crítico" — inclusive os 12 com lines ≥ 16 que, sem a isenção, disparariam 2× o threshold. O selo `critical` de Duplicação é dirigido por clones de **produção** de ≥ 16 linhas que vivem fora do anel inbound — `src/fns/woovi/webhook/processor/*`, `src/fns/enrichment/processor/*`, `src/deploy/manifest.ts`, `src/shared/errors.ts`, `src/shared/ulid.ts` (`qlty:similar-code`), além de clones em `db/schema`, `db/__tests__` e `domain/**/__tests__`. Nenhum desses é alcançável pela cadeia inbound do plano (T5→T6→T7→T10): T6 isenta apenas os 3 `*documents.controller.ts` e T7 mede `function-parameters` (outra dimensão). Logo, **esta entrada não tira a dimensão Duplicação de "crítico" por si só**, nem a cadeia inbound completa o faz na árvore atual; seu objetivo é a paridade de boilerplate de teste com §7, não o selo. Tirar Duplicação de "crítico" exige um checkpoint que trate os clones de produção de `fns/`/`shared/`/`deploy/`, fora do escopo de T5/T6/T7.

**Decisão:** aceitar os `fallow:clone` em `src/adapters/inbound/**/__tests__/`, em paridade com §7 (application) e a entrada outbound do `quality-allow.jsonc`.

---

## §10 — `*documents.controller.ts` (inbound): convergência estrutural entre agregados distintos

**Contexto (adicionado em 2026-06-16 — spec `20260616-hexagonal-audit-remediation` T6).**

Três controllers inbound convergem no bloco de validação + presign:

| Arquivo | Agregado |
|---|---|
| `registration/individual/documents.controller.ts` | Registro individual — documentos de identidade |
| `registration/company/company-documents.controller.ts` | Registro company — documentos da empresa |
| `legal-representative/documents.controller.ts` | Representante legal — documentos do convite |

Os três repetem o padrão `validar body → chamar policy → presign`, mas operam em agregados distintos com contratos de entrada e regras de guarda diferentes. A validação pura já está centralizada em `application/policy/document-upload-policy.ts`. Extract de um helper genérico foi avaliado e descartado: reacoplaria os três contratos via flags de escape (`_links` sim/não, `documentType`/`slot`) e tornaria o helper mais complexo do que os próprios controllers.

A convergência detectada pelo `fallow:clone` e pelo `qlty:similar-code` é consequência do padrão de upload presignado compartilhado, não de código duplicado sem diferença semântica.

**Decisão:** aceitar o `fallow:clone` e o `qlty:similar-code` nos três arquivos `src/adapters/inbound/http/**/*documents.controller.ts`.

---

## §11 — `enrichment-upserts.ts`: writer table-injected com 4 parâmetros

**Contexto (adicionado em 2026-06-16 — spec `20260616-hexagonal-audit-remediation` T7).**

`adapters/outbound/persistence/drizzle/enrichment/internal/enrichment-upserts.ts` exporta quatro funções `upsert*` com a assinatura `(db, table, registrationId, data)` — exatamente 4 parâmetros, no limiar do threshold de `function_parameters`.

| Função | Linha | Contagem |
|---|---|---|
| `upsertPhones` | 79 | 4 |
| `upsertEmails` | 124 | 4 |
| `upsertAddresses` | 164 | 4 |
| `upsertCreditScore` | 219 | 4 |

O quarto parâmetro `table` é a injeção do schema drizzle concreto (ex.: `enrichmentPersonPhones | enrichmentCompanyPhones`) que permite às 4 funções operarem tanto na tabela de PF quanto na de PJ sem duplicar o SQL. É a consequência direta da política de não-abstração cross-table aceita no débito `20260611-outbound-adapters-refactor-smells` (D7): unificar com um Parameter Object ocultaria o contrato de injeção de schema e adicionaria indireção sem ganho de manutenção.

A spec verificou a premissa do veredito: o threshold flagueia `>= 4` (não `> 4`), então os 4 `upsert*` com exatamente 4 parâmetros são de fato ativos no `qualy:report`. A medição confirmou 4 achados ativos em `enrichment-upserts.ts` antes da allowlist.

**Decisão:** aceitar o `function-parameters` nas 4 funções `upsert*` de `enrichment-upserts.ts`.

---

## §12 — `identity-review-gateway.ts`: helper interno e método de port com assinaturas fixadas

**Contexto (adicionado em 2026-06-16 — spec `20260616-hexagonal-audit-remediation` T7).**

`adapters/outbound/persistence/drizzle/shared/identity-review-gateway.ts` tem dois achados ativos de `function-parameters`:

| Função | Linha | Contagem | Papel |
|---|---|---|---|
| `insertStatusReasonRow` | 12 | 5 | Helper interno de guard sentinel+insert |
| `reproveInvitation` | 151 | 4 | Método da interface `IdentityReviewGateway` |

`insertStatusReasonRow(db, helper, table, statusReasonCode, insert)`: os 5 parâmetros carregam contexto de diagnóstico (`helper`, `table`) necessário para a mensagem de erro do guard sentinel + o payload do insert (`statusReasonCode`, `insert`). Colapsar em Parameter Object esconderia o contrato de guard sem reduzir a complexidade do caller.

`reproveInvitation(id, cafId, snapshot, reasons)`: assinatura do método `IdentityReviewGateway` — port definido em `application/ports/`. Refatorar para Parameter Object mudaria a interface pública do port e exigiria atualizar todos os callers de use-cases que injetam o gateway; vai contra a política de não-abstração do débito `20260611` (D7) de assinaturas exportadas pinadas.

A medição confirmou 2 achados ativos em `identity-review-gateway.ts` antes da allowlist.

**Decisão:** aceitar o `function-parameters` em `insertStatusReasonRow` e `reproveInvitation` de `identity-review-gateway.ts`.

---

---

## §13 — `wireLocal` e `dimensions.ts`: complexity por estrutura inextricável

**Contexto (adicionado em 2026-06-16 — spec `20260616-hexagonal-audit-remediation` T10).**

Dois hotspots de complexity fora de `application/` sem allowlist prévia — um `function-complexity` e um `file-complexity`:

| Arquivo | Escopo | Regra qlty | Métrica | Natureza |
|---|---|---|---|---|
| `src/deploy/local.ts` | `wireLocal` | `function-complexity` | ~12 (function) | Fan-out de DI/wiring |
| `src/fns/documents/processor/dimensions.ts` | (arquivo inteiro) | `file-complexity` | ~36 (file) | Parsing PNG/JPEG binário |

**`wireLocal` (wiring fan-out):** a função instancia e conecta ~12 adapters concretos em série (pools, gateways, readers, stores). Cada ramo é uma injeção distinta — não há lógica de negócio nem decisão condicional extraível. Descompor em helpers de wiring menores redistribuiria a complexity para os helpers sem reduzir o grafo real de dependências; o número de instanciações permanece o mesmo. O pattern é idêntico às factories de composition root já aceitas (`fns/caf/webhook/app.ts` etc.) — a única diferença é a escala (wiring completo de dev vs. wiring de uma function).

**`dimensions.ts` (parsing binário denso):** o arquivo implementa um parser de dimensões de imagem PNG/JPEG lendo bytes diretamente de um `Buffer`. Cada branch cobre um marcador de formato (PNG chunk `IHDR`, JPEG markers SOF0/SOF1/SOF2, APP1/EXIF). A complexity é estrutural ao protocolo binário — equivalente a um parser de especificação, onde cada caso é necessário e independente. Extrair cada marcador em uma função privada fragmentaria a sequência de bytes sem reduzir o número de desvios reais.

Em ambos os casos, a refatoração foi avaliada e descartada pela spec `20260616-hexagonal-audit-remediation` (G5): o único efeito seria redistribuir complexity, não eliminá-la. Os dois achados saem do tally ativo via `quality-allow.jsonc`.

**Decisão:** aceitar o `qlty:function-complexity` em `deploy/local.ts#wireLocal` e o `qlty:file-complexity` em `fns/documents/processor/dimensions.ts`.

---

## Referências

- ADR de fronteira hexagonal: [`./0002-fronteira-hexagonal-direcao-dependencia.md`](./0002-fronteira-hexagonal-direcao-dependencia.md).
- Plano de limpeza: [`.harn/devy/specs/20260608-application-quality-cleanup/plan.md`](../../.harn/devy/specs/20260608-application-quality-cleanup/plan.md) (§Fase 3, T3.2/T3.3, "Fora de escopo").
- Débito de origem (achados aceitos no de-vendoring): [`.harn/devy/debts/20260608-quality-gate-rename-artifacts.md`](../../.harn/devy/debts/20260608-quality-gate-rename-artifacts.md).
- Débito de complexidade de controllers (escopo distinto — inbound, não application): `.harn/devy/debts/20260606-controllers-high-complexity-qlty-smells.md`.
- Spec de follow-up (Fase 2 T10): [`.harn/devy/specs/20260609-application-quality-followup/plan.md`](../../.harn/devy/specs/20260609-application-quality-followup/plan.md).
