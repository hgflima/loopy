# ACP — a ponte com o agente de código (AD-3)

## Purpose & Scope
Toda a plumbing do Agent Client Protocol: subprocesso do agente, conexão JSON-RPC, handlers client-side (permission/fs/terminal/update) e sessões por-task. Traduz "falar com o `claude-agent-acp`" em primitivas que o step `agent` dirige. **Nenhum comportamento de loop aqui** (AD-1) — só mecânica de protocolo.

## Entry Points & Contracts
- `openAgent(opts)` → `AgentHandle` (`agent.ts`). **Um** processo ACP por run (AD-3; `npx` cold-start pago uma vez), hospedando N sessões. `ctx` (long-lived `ClientContext`) é o que a camada de sessão usa para `buildSession(cwd)`. `shutdown()` idempotente.
- `createSessionPool({ ctx, text, cost?, logger })` → `AgentSessionPool` (`session.ts`). Sessões **keyed por caminho de worktree** — cwd é imutável por sessão (AD-3), então 1 worktree = 1 sessão. `concurrency:1` hoje, mas o keying é parallel-ready. `cost` (o `CostBuffer` de `agent.ts`) é opcional — spine/testes omitem.
- `LoopySession` implementa `AgentSession` de `../types.ts`: `setMode`/`clear` (`/clear` raw, mantém `sessionId`)/`prompt` (resolve só com `stopReason`)/`readText`/`cancel` + captura de métricas `drainUsage`/`readCost` (aditivo, C-0005 — ver Pitfalls).
- `createClientApp(opts)` → registra TODOS os handlers **antes** de conectar (`client.ts`).

## Usage Patterns
- **Permissão por `kind`**: `session/request_permission` traz opções tagueadas (`allow_once`/`reject_once`/…). O resolver decide `allow`/`reject`/`cancel`, o handler casa o `optionId`. Default honra `acp.permissions.on_request`.
- **fs/terminal**: `fs/read_text_file`+`fs/write_text_file` via `FileSystemPort` (node fs); `terminal/*` via `TerminalManager` (spawn, merge stdout+stderr, respeita `outputByteLimit`). Anunciados em `initialize`.
- Classificação de turno (`classifyStopReason`): **só `end_turn` é sucesso**; `cancelled` é stop-signal nosso; `refusal`/`max_tokens`/`max_turn_requests` = falha do step.

## Anti-patterns
- Não escrever no stdout do subprocesso para nada além do transporte ndjson (stderr → logs).
- Não abrir mais de um processo ACP por run, nem trocar o cwd de uma sessão viva (imutável — abra outra sessão/worktree).
- Não ler o texto do turno via `readText()` cumulativo da SDK para veredito — use o buffer por-turno (ver Pitfalls).

## Dependencies & Edges
- Contratos `AgentSession`/`StopReason`: `../types.ts`. SDK: `@agentclientprotocol/sdk`.
- Consumido por `../index.ts` (`defaultRunLive` faz `openAgent`+`createSessionPool`) e pelo step `../steps/agent.ts` (via `ctx.session`, injetado pelo `sessionProvider` do orquestrador).

## Patterns & Pitfalls
- **Buffer de turno (OQ3)**: `TurnTextBuffer` acumula `agent_message_chunk` por `sessionId`, resetado antes de cada prompt — é a fonte de verdade do texto do turno (não o `readText()` cumulativo da SDK). Só chunks de texto entram; tool calls/plans/thoughts são streamados mas não bufferizados. É o que `parseVerdict` deve ler.
- **Timing OQ3**: o buffer é alimentado por handler de notificação *posterior* ao `prompt()` resolver. `runTurn` cruza uma macrotask (`flushSessionUpdates`/`setImmediate`) após drenar `readText()` da SDK para garantir buffer completo e não vazar chunk tardio para o próximo turno.
- **Conexão viva**: a SDK fecha uma conexão `connectWith` quando o callback resolve; por isso o callback resolve o handshake e depois `await gate.promise` — só aberto por `shutdown()`.
- `on_request: "policy"` (deny-patterns) ainda não implementado → resolve como `allow` (placeholder, config-change para ativar, fiel ao AD-1).
- **Captura de métricas (C-0005, best-effort)**: `drainUsage()` é acumulador **por-turno** drain-and-reset — soma `PromptResponse.usage` de todo `runTurn` (inclui verify e `/clear`, que dá zeros) e zera; `null` quando nenhum turno reportou. `readCost()` é snapshot **cumulativo da Sessão** (não zera), lido do `CostBuffer` (`client.ts`) alimentado pelo stream `usage_update`. Ambos best-effort: `null` nunca falha turno/step (⇒ `n/d` a jusante). `usage_update.cost` é `@experimental`/UNSTABLE no SDK (cast frouxo). O cost assenta só **após** a barreira `flushSessionUpdates` do `runTurn`, por isso `readCost()` (chamado pelo orquestrador após `execute()`) lê valor estável.
