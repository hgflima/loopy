---
number: 0007
title: "Transport NDJSON duplex para Native UI"
status: accepted
date: 2026-07-08
status_date: 2026-07-08
supersedes: []
superseded_by: null
---

# ADR-0007 — Transport NDJSON duplex para Native UI

## Context

A Native UI (app menubar macOS, C-0009) precisa observar ao vivo o mesmo
`StoreState` que a TUI Ink renderiza, sem forkar o reducer nem o layout. O canal
entre o motor (`loopy`) e o app externo (Tauri v2) passa pelo stdout/stdin de um
sidecar (`loopy --no-tui --emit-events <dir>`) — precisa de um protocolo de
framing que:

1. Transporte cada `StoreEvent` existente **sem perda** (round-trip fiel).
2. Transporte frames de controle que só existem no protocolo de transporte
   (`run_started`, `run_finished`, `approval_requested`) — não são eventos do
   store.
3. Aceite comandos do app de volta ao motor (`approval_decision`) pelo stdin.
4. Seja **aditivo e gated** (AD-1): motor byte-idêntico com/sem a flag; o
   transport nunca bloqueia nem lança exceção para o engine.
5. Seja parseável linha-a-linha (stream-friendly, sem framing binário).

Alternativas consideradas:

- **JSON-RPC sobre stdio.** Rejeitada: overhead de envelope (`jsonrpc`, `id`,
  `method`, `params`) para eventos fire-and-forget que não precisam de resposta;
  não agrega valor ao cenário unidirecional.
- **Protocol Buffers / MessagePack.** Rejeitadas: dependência adicional, framing
  binário dificulta debug com `| jq`, e os payloads já são objetos JSON nativos.
- **Server-Sent Events (SSE) sobre HTTP local.** Rejeitada: exige um servidor
  HTTP no motor, porta fixa/dinâmica, e não cobre o caminho stdin (commands).

## Decision

### Protocolo: NDJSON (Newline-Delimited JSON)

Cada frame é **uma linha** (`JSON.stringify(obj) + "\n"`). Três direções:

| Direção         | Canal   | Frames transportados                                   |
| --------------- | ------- | ------------------------------------------------------ |
| Motor -> App    | stdout  | `event` (StoreEvent), `control` (run_started, etc.)    |
| App -> Motor    | stdin   | `command` (approval_decision)                          |
| Diagnóstico     | stderr  | Texto livre (logs, erros internos)                     |

### Duas classes de frame (discriminante `frame`)

1. **`"event"`** — wrapper fino sobre um `StoreEvent` existente. O campo `frame`
   é adicionado na serialização e removido no parse; o payload restante é o
   `StoreEvent` inalterado:

   ```jsonc
   {"frame":"event","type":"task_started","taskId":"T-001"}
   {"frame":"event","type":"stream_chunk","taskId":"T-001","text":"impl...\n"}
   ```

2. **`"control"`** — frames que existem **apenas no protocolo de transporte**
   (nunca entram no store reducer):

   ```jsonc
   {"frame":"control","control":"run_started"}
   {"frame":"control","control":"run_finished","result":{"ok":true}}
   {"frame":"control","control":"approval_requested","requestId":"r1","taskId":"T-001","stepId":"gate","summary":"Approve?"}
   ```

3. **`"command"`** (stdin, app -> motor):

   ```jsonc
   {"frame":"command","command":"approval_decision","requestId":"r1","approved":true}
   ```

### API (`src/tui/transport.ts`)

```typescript
// Serialização (motor -> sink)
createEventTransport(sink: (line: string) => void): EventTransport
  .emit(event: StoreEvent): void      // best-effort, never throws
  .emitControl(control: ControlFrame): void  // best-effort, never throws

// Parse (linha -> frame tipado)
parseTransportLine(line: string): ParseResult
  // { ok: true, frame: "event", event: StoreEvent }
  // | { ok: true, frame: "control", control: ControlFrame }
  // | { ok: true, frame: "command", command: CommandFrame }
  // | { ok: false, error: string }
```

### Invariantes

- **Best-effort (AD-1):** `createEventTransport` engole qualquer exceção do
  `sink` — o motor nunca é perturbado por um consumidor quebrado.
- **Erros como valores (AD-5):** `parseTransportLine` nunca lança; linhas
  malformadas retornam `{ ok: false, error }`.
- **Round-trip sem perda:** `serialize -> parse -> toEqual(original)` para cada
  variante de `StoreEvent`, cada `ControlFrame` e cada `CommandFrame`.
- **Uma linha = um frame:** `JSON.stringify` garante que não há `\n` embutidos
  no payload (caracteres especiais ficam escapados).

## Consequences

**Positivas:**

- Protocolo trivial de implementar em qualquer linguagem (Rust, TS, Python) —
  `readline` + `JSON.parse` é suficiente.
- Debug amigável: `loopy --emit-events <dir> 2>/dev/null | jq .` inspeciona o
  fluxo ao vivo.
- Sem dependência de runtime (nem framework HTTP nem lib de serialização).
- O app consome `reduce` e `computeDagreLayout` do motor via subpath exports,
  replayando os events recebidos — paridade garantida pelo mesmo reducer.

**Negativas:**

- Sem backpressure: se o consumidor for lento, o buffer do pipe OS cresce (ou o
  motor bloqueia no write do stdout). Mitigação: o app Tauri lê rápido e o
  volume de events é baixo (~dezenas/s, não milhares).
- Sem versionamento explícito no protocolo. Mitigação: `StoreEvent` já é um
  union discriminado por `type`; novos eventos são adicionados ao union e o
  parser existente os roteia automaticamente.

**Neutras:**

- O `frame` discriminante ocupa bytes extras por linha (~10 bytes), irrelevante
  para o volume de tráfego esperado.
