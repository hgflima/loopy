---
name: loopy
description: >-
  Gera e itera interativamente um loopy.yml pronto-para-rodar para a change
  corrente (os {spec,plan,todo}.md produzidos por /devy:spec e /devy:plan),
  detectando os agentes disponíveis (claude/codex/opencode), propondo um
  pipeline resiliente com base nas lições de dogfooding e só salvando com
  aprovação explícita do usuário. Use sempre que o usuário pedir para criar,
  configurar, revisar ou ajustar um loopy.yml, "preparar a change para o
  loopy", "setup do loop", "rodar o loopy nessa change", ou quando
  /devy:loop-setup for invocado — mesmo que ele não mencione "loopy.yml"
  explicitamente.
---

# loopy — setup interativo do loopy.yml

Esta skill configura o **loopy** (`@hgflima/loopy`), um motor de loop agêntico
config-driven via ACP: para cada task pendente de um backlog, ele executa o
`pipeline` declarado no `loopy.yml` (worktree isolado → agente implementa até
os checks passarem → revisão → commit → merge com aprovação humana → cleanup).
O motor **interpreta** o yml — todo o comportamento do loop vive no arquivo que
esta skill gera. Um yml ruim = um run que trava, conflita ou queima tokens; por
isso o processo aqui é deliberado: preflight, proposta, iteração com o usuário
e validação fail-fast antes de declarar pronto.

Regra de interação que governa a skill inteira: **uma pergunta por vez**, via
AskUserQuestion. Nunca despeje um questionário; cada resposta informa a
próxima pergunta.

## Pré-requisitos

A change precisa estar especificada e planejada — três arquivos:

- `spec.md` — o "o quê" (gerado por `/devy:spec`)
- `plan.md` — o "como" (gerado por `/devy:plan`)
- `todo.md` — o backlog de tasks (gerado por `/devy:plan`)

Se algum não existir, **pare** e oriente o usuário a rodar `/devy:spec` e/ou
`/devy:plan` primeiro. Gerar um `loopy.yml` sem inputs é gerar um run vazio.

## Fluxo

### Fase 1 — Descobrir a change

Localize os inputs. Ordem de busca:

1. `.harn/devy/changes/C-*/` — a convenção do devy; se houver mais de uma
   change com `todo.md` contendo tasks pendentes (`- [ ]`), pergunte qual.
2. Raiz do projeto (`spec.md`/`plan.md`/`todo.md`) — alguns projetos usam esse
   layout por escolha explícita.

Se o usuário nomeou a change no pedido, use-a. Se nada for encontrado, pare
com a orientação de pré-requisito acima.

### Fase 2 — Preflight de agentes (fail-fast)

Detecte e **valide** os três agentes suportados. Detecção por PATH é só a
primeira metade — binário presente não prova login/auth, e o preset `claude`
nem usa o binário `claude` (usa o adapter npm). A sondagem via `probe-agent`
prova que o adapter sobe **e** grava o cache de capabilities
(`.loopy/capabilities.json`) do qual os campos `mode`/`model`/`effort` do yml
dependem (dialeto literal, por-versão do adapter).

Siga `references/preflight.md` para os comandos exatos (detecção, sondagem com
`--command`, versão do Node ≥ 22.13, versão do pacote npm).

**Se nenhum dos três agentes passar no preflight, apresente um erro claro e
pare.** Não gere um yml que não pode rodar. O erro deve listar o que foi
tentado e como instalar/autenticar cada agente.

### Fase 3 — Validar o todo.md

O `todo.md` é a fonte do DAG de tasks e dos nomes de branch — formato errado é
a causa nº 1 de "0 tasks encontradas". Valide **antes** de propor o pipeline:

- Tasks marcadas com `- [ ]` na coluna 0 (não `###` headers — o `/devy:plan`
  às vezes gera documento em vez de checklist; ofereça converter).
- Ids casando com um `task_id_pattern` consistente (`T-\d+`, `T\d+\.\d+`, …) —
  derive o pattern do arquivo real, não assuma.
- Linhas `Deps:` **isoladas** (só os ids, nada depois): texto após os ids
  engole a última dependência silenciosamente (bug D-0001) e o DAG achata.
- **Análise de colisão**: se duas tasks sem aresta `Deps:` entre si declaram
  mexer nos mesmos arquivos, elas vão rodar em paralelo e gerar conflito real
  de merge que rebase não resolve. Proponha adicionar `Deps:` para
  serializá-las (ou reduzir a concorrência).

### Fase 4 — Montar a proposta

Monte o `loopy.yml` seguindo `references/configuration.md` (o schema) e
`references/pipeline-patterns.md` (o pipeline canônico resiliente e os gotchas
que ele encoda). Decisões fixas desta skill, salvo pedido contrário do
usuário:

- `concurrency: auto` + `max_concurrency: 3`
- `metrics: {}` (telemetria opt-in — Node ≥ 22.13 já é requisito do motor)
- Agentes: **todos** os que passaram no preflight entram no Registry
  (`preset:`), com `acp.default_agent` apontando para o melhor implementador
  disponível (ordem de preferência: claude → codex → opencode).
- Steps adaptados à entrega: leia o `plan.md` e os scripts do `package.json`
  do alvo para escolher os checks reais (typecheck/lint/test/build — o que
  existir), e distribua papéis entre os agentes disponíveis (implementar /
  simplificar / revisar). Com um agente só, todos os papéis são dele.

Checks e steps `shell` rodam **argv sem shell** — nada de `&&`, pipes ou
redirects; quando precisar de composição, use um script npm do alvo como
wrapper.

### Fase 5 — Iterar até a aprovação

Apresente a proposta **completa** (o yml inteiro, comentado) com um resumo em
prosa do fluxo: quais steps, quais agentes, o que acontece em falha, onde o
humano aprova. Então pergunte se o usuário aprova (AskUserQuestion, uma
pergunta).

- **Aprovou** → Fase 6.
- **Não aprovou** → entenda o porquê antes de mexer: pergunte o que
  incomoda (uma pergunta por vez — objetivo do step? agente errado? checks
  demais/de menos? política de falha?). Ajuste a proposta e reapresente o
  diff do que mudou. Repita até a aprovação.

**Nunca grave o arquivo antes da aprovação explícita.** A proposta vive na
conversa até lá.

### Fase 6 — Salvar e validar

1. Grave o `loopy.yml` na raiz do projeto-alvo.
2. Se o pipeline usa o wrapper de cleanup idempotente (ver
   `references/pipeline-patterns.md`), grave-o também.
3. Valide com dry-run (zero escrita, resolve pipeline + DAG):

   ```bash
   npx -y @hgflima/loopy@latest . --dry-run
   ```

   O dry-run pega: yml inválido (schema zod), 0 tasks parseadas, deps órfãs,
   ciclos no DAG e `goto` para step inexistente. Se falhar, corrija e rode de
   novo — não entregue um yml que não passa no próprio dry-run.
4. Reporte o resultado: tasks encontradas, camadas do DAG, concorrência
   efetiva, agentes registrados.

## O que esta skill NÃO faz

- **Não executa o run vivo.** Rodar o loop é do usuário (a TUI precisa de TTY
  e o Gate de Aprovação do merge é interativo). Quem orquestra execução é o
  comando `/devy:run-loop`.
- **Não inventa comportamento de loop fora do yml.** Se o usuário quer que o
  loop faça algo diferente, a resposta é sempre editar o `loopy.yml`.

## Referências

| Arquivo | Quando ler |
| --- | --- |
| `references/preflight.md` | Fase 2 — comandos de detecção/sondagem, versões, e o checklist de "rodar redondo" (gitignore, lockfile, harness, lint). |
| `references/configuration.md` | Fase 4 — o schema do `loopy.yml` destilado (chaves, tipos, defaults, validações). |
| `references/pipeline-patterns.md` | Fase 4 — o pipeline canônico resiliente, template comentado e a tabela de gotchas de dogfooding que ele encoda. |
