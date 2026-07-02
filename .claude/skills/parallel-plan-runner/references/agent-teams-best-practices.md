# Agent Teams — Best Practices

Lições críticas para usar a feature experimental **Agent Teams** do Claude Code sem tropeçar nos gotchas. Destiladas de experiência real de execução.

---

## Gotchas descobertos em prática

### 1. SendMessage é OBRIGATÓRIO para comunicação em team mode

**Sintoma**: você spawna um teammate, ele trabalha, vai para `idle_notification`, mas nenhum relatório chega. Silêncio total apesar do teammate ter terminado a pesquisa.

**Causa**: agent types como `Explore` (e provavelmente outros genéricos) não sabem que estão em team mode. Produzem output plain-text como se fossem `Agent` standalone. Esse output fica órfão no contexto deles e **nunca é entregue ao lead**.

**Fix**: no prompt de CADA teammate, incluir instrução explícita e literal:

> "Você está em team mode. Output plain-text fica órfão — nada que você escrever fora de `SendMessage` chega ao team-lead. Envie todo progresso, dúvidas e relatório final via `SendMessage({to: 'team-lead', ...})`. Sem SendMessage, sua voz não existe."

Essa é a regra #1. Ignorá-la causa falha silenciosa.

### 2. Idle notifications ≠ concluído

**Sintoma**: teammate envia `{"type":"idle_notification", "idleReason":"available"}`. Parece que terminou mas nenhum conteúdo veio.

**Verdade**: idle só significa "esperando input". Teammates vão para idle após cada turno — é o estado normal entre ações. É "concluído" quando você recebe uma mensagem real de conteúdo via `SendMessage` do teammate.

**Fix**:
- Ignore `idle_notification` isolados
- Aguarde mensagens reais de conteúdo OU todas as tasks marcadas `completed` via TaskUpdate
- Se um teammate idle > 1 ciclo sem mensagem, pingue: *"Envie seu report final agora via SendMessage."*

### 3. TeamDelete falha com membros ativos

**Regra**: sempre encerre os teammates via `SendMessage({type: "shutdown_request"})` primeiro. Aguarde as confirmações (`teammate_terminated` chega automaticamente). SÓ ENTÃO chame `TeamDelete()`.

Caminho correto:
```
1. SendMessage shutdown_request → cada teammate (em paralelo)
2. Aguardar teammate_terminated para cada um
3. TeamDelete()
```

Caminho errado:
```
1. TeamDelete()   ← falha: "team still has active members"
```

---

## Regras de comunicação

### Refira-se a teammates por NOME, nunca por UUID

```
# Certo
SendMessage({ to: "ts-auditor", ... })

# Errado
SendMessage({ to: "a51fbb73d88938e91", ... })
```

Nomes ficam em `~/.claude/teams/<team_name>/config.json` sob `members[].name`.

### Mensagens chegam automaticamente — não faça polling

Mensagens de teammates aparecem como novos turnos do usuário no seu stream. Você é notificado. **Não** faça `sleep`, **não** chame `TaskList` em loop esperando. Continue com outra coisa até a mensagem chegar (ou se não houver outra coisa, simplesmente aguarde o próximo turno).

### Broadcast (`to: "*"`) é caro

Custo linear no tamanho do team. Use apenas quando todos os membros genuinamente precisam ler a mesma mensagem (ex: mudança de escopo, shutdown global). Para trabalho normal, prefira mensagens direcionadas.

### Não envie JSON estruturado como mensagem de status

```
# Errado — isso não é interpretado pelo sistema
SendMessage({ to: "lead", message: '{"type":"task_completed","id":"3"}' })

# Certo — use TaskUpdate para status
TaskUpdate({ task_id: "...", status: "completed" })
SendMessage({ to: "lead", message: "Task 3 concluída. Mudei src/x.ts linhas 45-89..." })
```

Os únicos JSONs válidos como `message` são os protocol messages: `shutdown_request`, `shutdown_response`, `plan_approval_response`.

---

## Escolha de agent_type para teammates

Match o agent_type à natureza do trabalho:

| Agent type | Capacidade | Usar para |
|---|---|---|
| `Explore` | Read-only (Glob, Grep, Read, Bash readonly) | Audit, research, análise de código existente |
| `Plan` | Read-only + ExitPlanMode | Design de implementação, arquitetura |
| `general-purpose` | Full (Edit, Write, Bash, todas as tools) | Implementação real de código |
| Custom em `.claude/agents/` | Varia | Verifique individualmente |

**Nunca** atribua tarefa de edição a um agent read-only — o teammate vai ficar travado tentando.

---

## Limites da feature experimental

- **Sem nesting**: teammates não podem criar sub-teams. Apenas o lead pode spawnar.
- **Sem resume**: `/resume` não restaura teammates in-process. Se a sessão reiniciar, o team some.
- **Um team por sessão**: encerre o team atual (`TeamDelete`) antes de criar outro.
- **Custo linear**: cada teammate = contexto próprio (~1M tokens). 3 teammates ≈ 3x o custo de uma sessão.
- **Lead é permanente**: quem chama `TeamCreate` é sempre o lead. Não rotaciona.
- **Requer restart para ativar flag**: mudar `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS` em settings.json exige reiniciar o Claude Code para as tools aparecerem.

---

## Task list é o canal de coordenação oficial

- Tasks são compartilhadas entre todos os membros em `~/.claude/tasks/<team>/`
- Use `TaskUpdate({owner: "nome"})` para atribuir
- Use `TaskUpdate({status: "in_progress"|"completed"})` para progresso
- Teammates devem checar `TaskList` após completar cada task para pegar próximo trabalho unblocked
- Em ordem de ID (lowest first) quando há múltiplas disponíveis — tasks anteriores normalmente setam contexto

Não use mensagens ad-hoc para coordenar assignment — use a task list.

---

## Padrão de shutdown correto

```
# 1. Para cada teammate, em paralelo (mesma mensagem do assistant)
SendMessage({ to: "teammate-1", message: { type: "shutdown_request", reason: "work complete" }})
SendMessage({ to: "teammate-2", message: { type: "shutdown_request", reason: "work complete" }})
SendMessage({ to: "teammate-3", message: { type: "shutdown_request", reason: "work complete" }})

# 2. Aguardar teammate_terminated para cada um (chegam automaticamente como turnos)

# 3. Só então
TeamDelete()
```

Shutdown só deve ser iniciado pelo lead. Teammates não devem chamar `shutdown_request` sozinhos a menos que explicitamente instruídos.

---

## Quando NÃO criar um team

- **1 task só**: execute direto. Zero ganho.
- **Tasks triviais (<100 LOC total)**: overhead de spawn/shutdown > ganho.
- **Tasks estritamente sequenciais**: considere se vale o framework de audit; pode ser mais rápido executar linha direta.
- **Trabalho exploratório sem tasks definidas**: use um único Agent standalone.
- **Auditoria simples**: Agent standalone é mais barato que team.

---

## Checklist de boas práticas (rápido)

Antes de spawn:
- [ ] Flag `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1` ativa
- [ ] ToolSearch carregou `TeamCreate`, `TeamDelete`, `SendMessage`
- [ ] Topologia é proporcional ao paralelismo real (evitar overhead)
- [ ] Cada teammate tem um papel claro e não redundante

No prompt de cada teammate:
- [ ] Regra do `SendMessage` incluída literalmente
- [ ] Instrução de task ownership (`TaskUpdate(owner)`)
- [ ] Nome do team e como ler o config
- [ ] Task(s) atribuída(s) com file paths concretos
- [ ] Formato do report final esperado
- [ ] `agent_type` correto (write-capable vs read-only)

Durante orquestração:
- [ ] Não fazer polling — aguardar turnos automáticos
- [ ] Ignorar idle_notifications isoladas
- [ ] Pingar teammates que entrem em idle sem report
- [ ] Monitorar TaskList em momentos-chave (não em loop)

Ao final:
- [ ] `shutdown_request` para cada teammate em paralelo
- [ ] Aguardar `teammate_terminated` de todos
- [ ] `TeamDelete()` — inclusive em caminhos de erro (cleanup)
