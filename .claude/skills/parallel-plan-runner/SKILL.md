---
name: parallel-plan-runner
description: Executa um plano de implementação via Agent Teams do Claude Code com paralelização automática. Use quando o usuário pedir para "rodar esse plan em paralelo", "executar com time de agentes", "paralelizar tasks", "usar Agent Teams", ou referenciar um arquivo de plan que deve ser executado por múltiplos agentes simultâneos. Wizard de 6 passos — aceita plan file, analisa paralelização, checa flag experimental, cria o team, executa com boas práticas, audita.
---

# parallel-plan-runner

Wizard que transforma um plano de implementação em uma execução paralela via **Agent Teams** (feature experimental do Claude Code). Encapsula todas as boas práticas e gotchas — especialmente o do `SendMessage` que derruba primeiras execuções manuais.

Leia `references/agent-teams-best-practices.md` antes do Passo 5. Leia `references/plan-parallelization-rubric.md` no Passo 2.

## Quando ativar

- "Rode esse plan em paralelo"
- "Executa isso com Agent Teams"
- "Quero paralelizar essas tasks"
- "Usa um time de agentes para implementar X"
- Usuário menciona um plan file e pede execução acelerada

## Quando NÃO ativar

- Pedidos de explicação sobre Agent Teams ("como funciona?") — responda direto, sem executar
- Plan com 1 task só — execute direto, sem overhead de team
- Tasks triviais (< ~100 LOC totais) — overhead de team > ganho

## Wizard — 6 passos

### Passo 1 — Aceitar plan file

Aceite o path do plan file como argumento da skill. Se ausente, pergunte em texto livre no chat (não via `AskUserQuestion` — path é texto arbitrário): *"Qual o path do plan file?"*.

Valide:
- `Read` o arquivo — se falhar, abortar com erro claro
- Confirme que é markdown ou texto estruturado
- Procure marcadores de task: headings `## Task`, checklists `- [ ]`, listas numeradas em seção "Implementation Order", tabelas de tasks

Extraia internamente:
- Lista de tasks (título + files tocados + acceptance criteria)
- Dependências declaradas no texto
- Seção de verification commands (blocos ```bash``` em seções Verification/Test/Acceptance)

Se não encontrar tasks parseáveis → perguntar ao usuário se o plan segue um formato diferente ou abortar.

### Passo 2 — Análise de paralelização

Carregue e siga `references/plan-parallelization-rubric.md`.

Classifique o plan em uma das 3 categorias:
- **Fully parallel** — N teammates, 1 por task ou grupo de domínio
- **Partially parallel** — wave-based, cada wave = nível topológico do DAG
- **Sequential** — 1 teammate único (fallback)

Monte a topologia:
- Team name: slug do título do plan (kebab-case, max 30 chars)
- Teammates: máximo 4, com nomes descritivos (não `agent-1`)
- `agent_type` correto: `general-purpose` para implementação, `Explore` para audit/research, `Plan` para design

**Apresente ao usuário** em formato claro:

```markdown
## Topologia proposta

- **Team**: `<slug>`
- **Modo**: Fully parallel | Partially parallel (<N> waves) | Sequential fallback
- **Teammates** (<N>):
  1. `<nome>` (`<agent_type>`) — owner: <tasks>
  2. `<nome>` (`<agent_type>`) — owner: <tasks>
- **Comunicação**: SendMessage direto (lead ↔ teammate) + task list compartilhada em `~/.claude/tasks/<slug>/`
- **Mecanismo**: spawn paralelo numa única mensagem → teammates trabalham → reports via SendMessage → shutdown graceful → TeamDelete
```

Depois confirme via `AskUserQuestion`:
- Header: `Topologia`
- Question: "Proceder com essa topologia?"
- Options: "Sim, criar team" / "Ajustar topologia" (→ itere) / "Cancelar execução"

### Passo 3 — Precheck da flag experimental

Leia os settings files nesta ordem:
1. `.claude/settings.json` (projeto)
2. `~/.claude/settings.json` (user global)

Busque `env.CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS === "1"` em qualquer um. Se encontrar → pular para Passo 5. Senão → Passo 4.

### Passo 4 — Ativação condicional (só se flag ausente)

Pergunte via `AskUserQuestion`:
- Header: `Flag teams`
- Question: "A flag experimental `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS` não está ativa. Ativar em `.claude/settings.json`?"
- Options:
  - "Ativar agora" — prossiga com Edit
  - "Cancelar execução" — aborte limpo

**Se ativar**: use `Edit` para adicionar `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS: "1"` dentro de `env` em `.claude/settings.json` (crie a chave `env` se não existir). Depois **avise claramente** que um **restart do Claude Code é necessário** para a flag ter efeito — as deferred tools (TeamCreate, TeamDelete, SendMessage) são carregadas na inicialização. Abortar esta execução e pedir ao usuário para reiniciar e rodar a skill de novo.

**Se cancelar**: output curto *"Execução cancelada. Agent Teams é requisito desta skill."* e encerrar.

### Passo 5 — Execução via Agent Teams

Antes de tudo, carregue `references/agent-teams-best-practices.md` e aplique cada item.

**5a — Carregar tools**: se `TeamCreate`, `TeamDelete`, `SendMessage` não estão disponíveis ainda, chame `ToolSearch` com query `select:TeamCreate,TeamDelete,SendMessage`.

**5b — TeamCreate**:
```
TeamCreate({
  team_name: "<slug-do-plan>",
  description: "<titulo curto do plan>",
  agent_type: "team-lead"
})
```

**5c — Spawn teammates em paralelo** (uma ÚNICA mensagem com múltiplas chamadas `Agent`):

Para cada teammate, o prompt DEVE incluir estes blocos obrigatórios:

```text
Você faz parte do team "<team_name>" como <role>.

Task(s) atribuída(s):
<lista concreta com file paths, acceptance criteria, e contexto>

## REGRAS CRÍTICAS (obrigatórias em team mode)

1. **SendMessage é seu único canal de comunicação com o team-lead**.
   Output plain-text fica órfão em team mode — nada que você escrever
   fora de SendMessage chega ao lead. Todo progresso, dúvida e relatório
   final DEVE ir via SendMessage({to: "team-lead", ...}).

2. **Task ownership**: antes de começar, chame TaskUpdate para claim
   suas tasks (set owner para o seu nome). Marque status="completed"
   quando terminar cada uma.

3. **Referência a peers**: use NOMES, nunca UUIDs. Config do team em
   ~/.claude/teams/<team_name>/config.json tem os nomes.

4. **Ao terminar**: envie relatório final detalhado via SendMessage
   (summary + files modificados + o que mudou + como verificar) e vá
   para idle. NÃO chame shutdown sozinho — o lead fará.

## Seu trabalho

<briefing específico da task do plan — file paths, o que fazer,
 acceptance criteria, comandos de teste se aplicável>

## Formato do report final (via SendMessage)

- Summary: <1-2 linhas>
- Files changed: <lista com paths absolutos>
- Mudanças chave: <bullets>
- Como verificar: <comando ou passos>
- Blockers encontrados: <se houver>
```

Escolha `subagent_type` conforme o trabalho:
- `general-purpose` para implementação (precisa editar arquivos)
- `Explore` para audit/análise read-only
- `Plan` para design/planejamento

**5d — Orquestração**:
- Mensagens dos teammates chegam automaticamente como turnos. Não faça polling/sleep.
- `idle_notification` com `idleReason: "available"` **não** significa concluído — só "esperando". Ignore até receber mensagens de conteúdo real OU até todas as tasks estarem `completed` na task list.
- Se um teammate entrar em idle sem enviar report e não houver progresso: pingue explicitamente com `SendMessage({to: "<nome>", message: "Envie seu relatório final agora via SendMessage seguindo o formato pedido no briefing."})`.
- Consulte `TaskList` periodicamente para ver progresso.

**5e — Shutdown graceful**: quando todas as tasks estão `completed` E todos os reports esperados chegaram, encerre cada teammate em paralelo:
```
SendMessage({
  to: "<nome>",
  message: { type: "shutdown_request", reason: "work complete" }
})
```
Aguarde a chegada de `teammate_terminated` para cada um antes de prosseguir.

**5f — TeamDelete**:
```
TeamDelete()
```
Chame mesmo em caminhos de erro (cleanup). Se falhar por membros ativos, tente shutdown novamente.

### Passo 6 — Auditoria (Auditor + testes)

**6a — Auditor agent standalone** (NÃO via team — mais barato):
```
Agent({
  subagent_type: "Explore",
  description: "Audit plan execution vs diff",
  prompt: "Você é auditor READ-ONLY do plan localizado em <plan_path>.

Rode `git diff` (e `git status`) e compare o resultado task-por-task contra
o plan original.

Para cada task declarada no plan, reporte:
1. As mudanças esperadas aparecem no diff? (PASS/FAIL com file_path:line)
2. Os acceptance criteria estão atendidos? (check item a item)
3. Há regressões óbvias ou arquivos fora do escopo da task?
4. Há código não relacionado que foi tocado?

Reporte em markdown estruturado:

## Audit por task
- [x] Task 1: <título> — PASS (<evidência>)
- [ ] Task 2: <título> — FAIL (<gap concreto>)

## Desvios detectados
<lista de mudanças fora do escopo>

## Score
<N>/<M> tasks verificadas com sucesso"
})
```

**6b — Verification commands**: extraia os comandos de verificação do plan (bash blocks em seções Verification/Test/Acceptance) e execute cada um via `Bash`. Capture exit code + últimas 20 linhas de stdout/stderr.

**6c — Report final consolidado** ao usuário:

```markdown
## Execution Audit — <plan title>

### Plan coverage
- [x] Task 1: <titulo> — PASS (<evidência curta>)
- [ ] Task 2: <titulo> — FAIL (<razão>)

### Verification commands
- `<cmd1>` — PASS (exit 0)
- `<cmd2>` — FAIL (exit 1, erro: <última linha>)

### Summary
<N>/<M> tasks PASS · <K>/<L> verification commands PASS

### Próximos passos
<se houver FAILs: ações concretas. Senão: "Plan executado conforme especificado.">
```

## Erros comuns a evitar

- **Spawnar sem a regra do SendMessage** no prompt → reports ficam órfãos, skill trava esperando
- **Interpretar idle como concluído** → skill marca trabalho como feito sem resultado real
- **Chamar TeamDelete antes de shutdown_request aprovado** → falha por membros ativos
- **Pular a auditoria** → usuário não sabe se o plan foi seguido
- **Criar team para 1-2 tasks triviais** → overhead > ganho; execute direto
- **Usar agent_type read-only (Explore/Plan) para tasks de implementação** → teammate trava sem conseguir editar
- **Editar settings.json global em vez do projeto** — respeite o escopo da skill (projeto)
- **Esquecer de cleanup em caminhos de erro** — sempre tente TeamDelete no finally

## Referências

- `references/agent-teams-best-practices.md` — 12 lições críticas e checklist
- `references/plan-parallelization-rubric.md` — como classificar um plan e propor topologia
