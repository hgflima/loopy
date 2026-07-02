# Plan Parallelization Rubric

Rubric para classificar um plan e propor topologia de team. Usado no Passo 2 do `parallel-plan-runner`.

---

## Passo 1 — Identificar tasks

Procure marcadores de task no plan, em ordem de prioridade:

1. **Headings explícitos**: `## Task N`, `### Step N`, `## Phase N`
2. **Seção "Ordem de Implementação"** ou "Implementation Order" com lista numerada
3. **Tabelas com coluna Task/Step/Etapa**
4. **Checklists em seções de implementação**: `- [ ]` sob heading `## Files to Modify` ou similar
5. **Listas numeradas em seção "Scope"**

Normalize para uma estrutura interna:
```
[
  { id: 1, title, files_touched: [...], acceptance_criteria: [...], dependencies: [...] },
  ...
]
```

Se nenhum marcador claro for encontrado → pergunte ao usuário sobre o formato do plan.

---

## Passo 2 — Identificar dependências

### Dependências explícitas (fáceis)

Busque linguagem declarativa:
- "after X is done", "once X completes", "requires Y", "depends on Z"
- "before committing step 3"
- "using the module created in step 1"
- Setas em diagramas: `→`, `->`, `=>`
- Seções "Dependencies" ou "Depends on" em cada task

### Dependências implícitas (mais difíceis)

- **Mesmo arquivo tocado por duas tasks** → conflito, depende do mesmo estado
- **Task 2 usa tipo/função declarado em Task 1** → dependência por interface
- **Task A altera schema, Task B escreve query contra esse schema** → dependência por contrato
- **Task A configura infra, Task B assume infra pronta** → dependência por precondição

Em caso de dúvida sobre dependência implícita, assuma que **existe** (conservador) — melhor ter uma wave sequencial do que gerar race condition.

---

## Passo 3 — Classificar

### Fully parallel

**Critério**: nenhuma dependência detectada entre as tasks. Cada task toca arquivos/áreas diferentes, sem contratos compartilhados.

**Exemplo**:
> Task A: adicionar endpoint `/users` no backend
> Task B: criar componente `UserList` no frontend (com mock)
> Task C: atualizar README com nova seção

**Topologia**: N teammates, um por task (ou um por grupo de domínio).

### Partially parallel

**Critério**: há pelo menos um par de tasks independentes, mas também dependências. Forma um DAG (grafo acíclico dirigido).

**Exemplo**:
> Task 1: criar tipo `User`
> Task 2: usar `User` no backend
> Task 3: usar `User` no frontend
> Task 4: atualizar docs (paralela a tudo)

Grafo:
- Task 1 é prerequisito de 2 e 3
- Task 4 é independente

**Topologia**: wave-based. Waves = níveis topológicos do DAG.
- **Wave 1**: Task 1 + Task 4 (paralelas)
- **Wave 2**: Task 2 + Task 3 (paralelas, após Wave 1 completar)

Cada wave é um spawn paralelo; entre waves, o lead espera a conclusão antes de iniciar a próxima.

### Sequential (fallback)

**Critério**: tasks formam uma cadeia linear estrita. Não há paralelização possível.

**Exemplo**:
> 1. Escrever schema
> 2. Gerar migração a partir do schema
> 3. Rodar migração
> 4. Verificar dados migrados

**Topologia**: 1 teammate único fazendo tudo em sequência. A skill ainda vale pelo framework de audit automático, mas o ganho de paralelismo é zero. Usuário optou por esse fallback em vez de abortar.

### Ciclos (inválido)

Se o grafo de dependências tem um ciclo (A → B → A), o plan é mal-formado. Não tente executar — alerte o usuário e peça correção.

---

## Passo 4 — Propor topologia

### Regras de agrupamento

1. **Mesmo domínio → considerar 1 teammate**: se 3 tasks são todas do frontend e independentes, 1 teammate pode fazê-las em sequência. Só spawne teammates separados quando há razão concreta (capacity, expertise, paralelismo real de IO/compute).

2. **Domínios distintos → teammates separados**: frontend / backend / tests / docs → 4 teammates com contextos focados. Cada um carrega só o que precisa.

3. **Máximo 4 teammates**: acima disso o custo de contexto (cada teammate = ~1M tokens) ultrapassa o ganho. Se há mais de 4 grupos, agrupe pelos mais correlatos.

4. **Escolha de `agent_type`**:
   - Tasks de implementação (edit/write/run): `general-purpose`
   - Tasks de audit/research/análise de código existente: `Explore`
   - Tasks de design/arquitetura/planejamento: `Plan`
   - Se o projeto tem subagent custom em `.claude/agents/` especializado: prefira-o

5. **Nomes de teammates**: descritivos pelo papel, não pelo número.
   - Bom: `backend-implementer`, `frontend-implementer`, `test-writer`, `doc-updater`
   - Ruim: `agent-1`, `worker-2`, `t3`

6. **Team name**: slug do título do plan, kebab-case, max 30 chars. Ex: `add-user-auth-feature`, `refactor-payment-flow`.

---

## Edge cases

### Plan com 1 task

Não crie team. Responda:
> "Este plan tem só 1 task — executo direto, sem overhead de team."

Execute a task inline.

### Plan com 2 tasks independentes pequenas

Avalie se vale o overhead. Se cada task é trivial (<100 LOC de código ou apenas edição de 1-2 arquivos), a sobrecarga de spawn + shutdown + audit provavelmente > ganho. Confirme com o usuário: mostre a topologia mas sugira execução direta como alternativa.

### Plan sem verification commands

Auditoria fica menos rigorosa (só checklist + diff comparison, sem testes automáticos). Avise o usuário no passo 2 antes de confirmar:
> "Atenção: o plan não tem verification commands declarados. A auditoria final será baseada só em diff analysis."

### Plan com dependências cíclicas

Não execute. Reporte:
> "O plan tem dependências cíclicas entre Task X e Task Y. Preciso que isso seja corrigido antes de executar."

### Plan com tasks gigantes

Se uma única task individual exige >500 LOC de código ou toca >10 arquivos, é um sinal de granularidade errada. Sugira decompor antes de executar.

---

## Exemplos de classificação

### Exemplo 1 — Fully parallel
```
Plan: "Add user profile feature"
Tasks:
  1. Backend: endpoint GET /users/:id
  2. Frontend: página ProfilePage
  3. Tests: adicionar testes E2E
```
→ **Fully parallel**. 3 teammates (`backend`, `frontend`, `tester`), todos em paralelo.

### Exemplo 2 — Partially parallel
```
Plan: "Migrate to new auth system"
Tasks:
  1. Definir novos tipos de auth (shared)
  2. Backend: usar novos tipos
  3. Frontend: usar novos tipos
  4. Remover código antigo (depois que 2 e 3 passem)
```
→ **Partially parallel**, 3 waves:
- Wave 1: Task 1 (único)
- Wave 2: Task 2 + Task 3 (paralelas)
- Wave 3: Task 4 (único)

### Exemplo 3 — Sequential
```
Plan: "Migrate database to v2"
Tasks:
  1. Gerar migration file
  2. Revisar migration manualmente
  3. Rodar migration em staging
  4. Validar integridade
  5. Aplicar em production
```
→ **Sequential**. 1 teammate fazendo tudo em ordem. Zero paralelismo possível.
