# Spec: `loopy` — Motor de Loop Agêntico Config-Driven via ACP

> Status: **revisado (refine)** · Fase: SPECIFY · Decisões travadas — pronto para `plan`.

## Objective

Construir **`loopy`**, um CLI em TypeScript/Node que executa um **loop agêntico de dois níveis** sobre um diretório local, dirigindo um **agente de código via ACP (Agent Client Protocol)** até concluir um backlog de tasks.

**Diferencial central:** `loopy` é um **motor genérico que interpreta o `loopy.yml`** — ele **não tem pipeline hardcoded**. O que o loop faz (steps, ordem, prompts, comandos shell, modo/autonomia do agente, retries, escalonamento e gates) é **100% definido no `loopy.yml`**; o código só implementa a mecânica.

**Em uma frase:** `loopy .` lê `loopy.yml` + os inputs (`SPEC.md`/`plan.md`/`todo.md`) e, para cada task pendente do backlog, executa o `pipeline` declarado no yml — tipicamente: cria um worktree isolado, faz o agente implementar até os checks passarem, simplifica, audita (read-only), commita, faz merge (com aprovação humana) e limpa — mostrando tudo numa **TUI ao vivo (Ink)**.

**Usuário-alvo:** o próprio dono do repositório (dev), rodando localmente um harness `.claude` já configurado. Quer transformar `SPEC.md`/`plan.md`/`todo.md` em código commitado com o mínimo de babá manual, mas mantendo gates de qualidade e um ponto de aprovação antes de integrar — **e mantendo total controle do loop pelo yml**.

**Como é o sucesso:** dado um backlog em `todo.md`, `loopy .` avança task a task de forma isolada e verificável, seguindo o pipeline do yml; cada task só é marcada `- [x]` quando os checks passam e o merge é aprovado; falhas persistentes escalam com o worktree preservado; e **trocar o comportamento do loop é editar o `loopy.yml`, nunca o motor**.

### A fronteira: Motor vs Configuração

É o eixo do design.

- **Motor (fixo — mecânica):** plumbing ACP (spawn, `ndJsonStream`, builder `client()`), ciclo de sessão (1 processo/run, 1 sessão/task, `/clear`), criação/remoção de worktree, resolução da interpolação `${...}`, laço externo sobre o backlog, execução dos checks + agregação do report, parse de veredito, streaming pra TUI, condições de parada e escalonamento.
- **Configuração (`loopy.yml` — do usuário):** os steps e sua ordem; para cada step `agent` o `prompt`/`mode`/`clear_context`/`verify`/`expect`; para cada step `shell` os `run`; as listas de `checks`; `max_attempts` + `on_fail` por step; gates de `approval`; `stop_conditions`; `concurrency`; valores de interpolação.

O motor expõe **primitivas de step tipadas**, validadas por **zod** no *shape*; o *conteúdo* (prompt, comando, mode, ordem, quantos steps) é do usuário.

### Primitivas de step

| `type` | Papel | Campos configuráveis |
|---|---|---|
| `agent` | Um turno do agente ACP | `prompt`, `retry_prompt`, `mode` (`acceptEdits`/`plan`/…), `clear_context` (default `true`), `verify:{run,max_attempts,on_fail}` (loop interno), `expect` + `on_expect_fail` (gate de veredito) |
| `shell` | Comandos externos (execa) | `run:[...]`, `always`, `on_fail` |
| `checks` | Roda uma lista nomeada de checks standalone | referência à lista em `checks:` |
| `approval` | Gate humano + ação | `prompt`, `run:[...]`, `on_conflict` |

### Modelo de execução (os dois loops)

- **Loop externo** — o motor itera as tasks `- [ ]` do backlog em ordem (`concurrency: 1` no v1). Para cada task, executa o `pipeline` do yml na ordem; um step só começa se o anterior teve sucesso (exceto `always: true`, que roda sempre). Marca `- [x]` **apenas** após o pipeline inteiro da task ter sucesso.
- **Loop interno** — o bloco `verify:` de um step `agent`: `prompt → checks → em falha, re-prompta com ${checks.report}` até passar ou esgotar `max_attempts`, aí aplica `on_fail`.

### Sessão ACP e `/clear` (mecânica do motor)

Verificado no source de `@agentclientprotocol/claude-agent-acp@0.26` e no projeto de referência `ralphy`:

- **1 processo `claude-agent-acp` para a run inteira** — o cold start do `npx` é pago 1x. É um roteador que hospeda N sessões (Map por `sessionId`).
- **1 sessão ACP por task** (`buildSession(worktree).start()`) — o **cwd é imutável por sessão**, então cada worktree exige sessão própria. Cada sessão carrega o `.claude` do **seu** cwd (via `settingSources` + `cwd`), sem vazamento entre worktrees → **o `.claude` precisa estar commitado no `parent_branch`**.
- **`clear_context: true` (default)** faz o motor enviar `/clear` como prompt antes do prompt do step: o adaptador repassa `/clear` cru pro `cli.js`, que **zera o histórico mantendo o mesmo `sessionId`**. Memória vive no **disco** (worktree/diff) e nas **specs**, nunca na conversa. O 1º prompt da task já nasce limpo (sessão nova).
- **Teardown** da sessão ao fim da task.
- **`prompt()` só devolve `stopReason`** — o texto do agente (stream pra TUI + veredito do audit) vem via `session/update → agent_message_chunk` / `session.readText()`. Não-`end_turn` (`refusal`/`max_tokens`/`max_turn_requests`) é tratado como **falha do step**; `cancelled` é cancelamento nosso (stop-signal).
- **Autonomia** — o modo é aplicado via `session/set_mode` (não é política de `optionId`). Quando o agente pede permissão (`session/request_permission`), o handler decide por `kind` (`allow_once`/`allow_always`/`reject_once`/`reject_always`); default = `allow`. O modo `plan` é read-only (usado pelo `audit`).

### Condições de parada (loop externo — encerra quando QUALQUER uma ocorrer)

- Backlog vazio (nenhum `- [ ]` restante).
- `stop_conditions.max_iterations` atingido (teto de segurança).
- Falha persistente após retries / `AUDIT: FAIL` → aplica `policies.escalation` (`pause` | `skip_task` | `abort_loop`).
- Presença do `stop_conditions.stop_signal_file` (`./.loopy.stop`) → encerra após a task corrente.

## Tech Stack

- **Linguagem/runtime:** TypeScript (ESM, `"type": "module"`) sobre **Node ≥ 20**, executado com **`tsx`** (sem build step no MVP; `tsc --noEmit` para typecheck).
- **ACP SDK:** **`@agentclientprotocol/sdk`** (`^0.29`) — builder `client({name}).onRequest(...).onNotification(...).connectWith(stream, ctx => …)` + `ctx.buildSession(cwd).start()`. Constantes reais: `PROTOCOL_VERSION` (=== `1`, numérico), `CLIENT_METHODS`, `AGENT_METHODS`. `AgentSideConnection` é `@deprecated`; usar o builder.
- **Agente ACP:** subprocesso, default **`npx -y @agentclientprotocol/claude-agent-acp`** (binário `claude-agent-acp`, ponte para `@anthropic-ai/claude-agent-sdk`). Comunicação **stdio / JSON-RPC ndjson** via `ndJsonStream(Writable.toWeb(child.stdin), Readable.toWeb(child.stdout) as ReadableStream<Uint8Array>)`.
- **TUI:** **`ink`** + **`react`**. Fallback para logs de linha quando não há TTY / `--no-tui`.
- **CLI/args:** `commander`.
- **Config:** `yaml` (parse) + **`zod`** (validação de schema + defaults; valida as primitivas de step).
- **Processos externos (git + checks):** `execa`.
- **Testes:** **`vitest`**.
- **Lint/format:** `eslint` + `prettier`.

> Nenhuma dependência nova sem aprovação.

## Commands

Comandos de desenvolvimento do **próprio repo do `loopy`**:

```
Instalar:   npm install
Dev/run:    npx tsx src/index.ts <dir>        # ou: npm run dev -- <dir>
Typecheck:  npm run typecheck                 # tsc --noEmit
Lint:       npm run lint                       # eslint . (--fix p/ corrigir)
Format:     npm run format                     # prettier --write .
Testes:     npm test                           # vitest run
Testes(w):  npm run test:watch                 # vitest
```

Uso do CLI (quando instalado/linkado):

```
loopy [dir]                 # roda o loop no diretório (default ".")
loopy . --config loopy.yml  # caminho alternativo do config
loopy . --dry-run           # planeja e mostra o pipeline resolvido, sem editar/commit/merge
loopy . --yes               # auto-aprova gates (não-interativo / CI)
loopy . --no-tui            # força logs de linha (sem Ink)
loopy . --task T-004        # roda apenas uma task específica
loopy . --max-iterations N  # sobrescreve teto do loop externo
loopy . --verbose           # inclui tráfego ACP no log
```

> **Nota:** os checks (`typecheck`/`lint`/`test`) rodados **dentro do loop** são os comandos do **projeto-alvo**, definidos em `loopy.yml` — não os comandos do `loopy` acima.

## Project Structure

```
loopy/
├── src/
│   ├── index.ts              # entrypoint: commander -> run()
│   ├── config/
│   │   ├── schema.ts         # zod: loopy.yml (workspace/acp/inputs/checks/pipeline/...) + união das primitivas de step
│   │   └── load.ts           # lê/valida loopy.yml, aplica defaults
│   ├── interp/
│   │   └── resolver.ts       # interpolação ${...} (substituição simples; interface p/ estender a expressões)
│   ├── backlog/
│   │   └── todo.ts           # parse de todo.md (checkbox + id/title + body indentado), mark_done idempotente
│   ├── acp/
│   │   ├── agent.ts          # spawn + ndJsonStream + builder client() (1 processo/run) + initialize
│   │   ├── client.ts         # handlers (permission por kind / fs / terminal) + connect
│   │   └── session.ts        # sessão por task: buildSession, setMode, /clear, prompt, readText, teardown
│   ├── git/
│   │   └── worktree.ts       # add/remove worktree, merge (+on_conflict), require_clean_parent
│   ├── checks/
│   │   └── runner.ts         # roda listas de checks (execa) -> ChecksReport agregado + truncado
│   ├── steps/                # INTERPRETADORES das primitivas (NÃO pipelines hardcoded)
│   │   ├── agent.ts          # type: agent — prompt/mode/clear_context/verify(loop interno)/expect
│   │   ├── shell.ts          # type: shell — run/always/on_fail
│   │   ├── checks.ts         # type: checks — roda lista nomeada
│   │   ├── approval.ts       # type: approval — gate humano + ação + on_conflict
│   │   └── verdict.ts        # parse tolerante de AUDIT: PASS/FAIL sobre readText()
│   ├── loop/
│   │   └── orchestrator.ts   # laço externo: backlog -> interpreta pipeline -> stop conditions / escalonamento
│   ├── tui/
│   │   ├── App.tsx           # árvore de progresso Ink (tasks/tentativas/checks/stream)
│   │   ├── components/       # TaskRow, CheckStatus, StreamPane, ApprovalPrompt
│   │   └── store.ts          # estado observável (parallel-ready: sem singleton de "task atual")
│   ├── logging/
│   │   └── logger.ts         # logs por task + captura opcional do tráfego ACP
│   └── types.ts              # Task, StepConfig (união das primitivas), StepResult, ChecksReport, LoopyConfig
├── tests/                    # espelha src/ (vitest); unit + fixtures de todo.md/loopy.yml
├── loopy.yml                 # config de exemplo (no projeto-alvo)
├── package.json
├── tsconfig.json
└── SPEC.md / tasks/plan.md / tasks/todo.md
```

Artefatos gerados em runtime no **projeto-alvo**: `.worktrees/<id>/` (worktrees), `.loopy/logs/<id>.log`, `.loopy.stop` (stop-signal, criado pelo operador). Todos no `.gitignore`.

## Code Style

Idioma: **código e identificadores em inglês**; mensagens/UI em pt-BR. TypeScript estrito, ESM, funções pequenas e puras onde der, erros como valores/`Result` nos limites de step. Convenções: `type` de step e chaves de config em `snake_case`/`kebab-case`; IDs de task `T-\d+`; interpolação `${...}` resolvida uma vez por task/tentativa.

Snippet representativo do **wrapper ACP** (ancorado no SDK real 0.29 e no `ralphy`):

```ts
import { spawn } from "node:child_process";
import { Readable, Writable } from "node:stream";
import {
  client, ndJsonStream, PROTOCOL_VERSION, CLIENT_METHODS, AGENT_METHODS,
} from "@agentclientprotocol/sdk";

/** Sobe UM agente ACP para a run inteira; abre uma sessão por worktree. */
export async function openAgent(opts: {
  command: string[];
  onUpdate: (u: SessionUpdate) => void;                       // alimenta a TUI
  onPermission: (req: RequestPermissionParams) => Promise<string>; // devolve optionId (por kind)
}) {
  const child = spawn(opts.command[0], opts.command.slice(1), {
    stdio: ["pipe", "pipe", "inherit"], // stderr -> logs; stdin/stdout = JSON-RPC ndjson
  });
  const stream = ndJsonStream(
    Writable.toWeb(child.stdin!),
    Readable.toWeb(child.stdout!) as ReadableStream<Uint8Array>,
  );

  // Handlers ANTES do connect: o agente faz callbacks no meio do turno.
  const app = client({ name: "loopy" })
    .onRequest(CLIENT_METHODS.session_request_permission, async ({ params }) => ({
      outcome: { outcome: "selected", optionId: await opts.onPermission(params) },
    }))
    .onNotification(CLIENT_METHODS.session_update, async ({ params }) => {
      opts.onUpdate(params.update);
    });

  return app.connectWith(stream, async (ctx) => {
    await ctx.request("initialize", {
      protocolVersion: PROTOCOL_VERSION, // === 1 (numérico)
      clientCapabilities: { fs: { readTextFile: true, writeTextFile: true }, terminal: true },
      clientInfo: { name: "loopy", version: "0.1.0" },
    });
    return {
      /** Abre uma sessão nova no worktree (cwd imutável por sessão). */
      openSession: async (cwd: string) => {
        const session = await ctx.buildSession(cwd).start();
        const id = session.sessionId;
        return {
          sessionId: id,
          setMode: (modeId: string) => ctx.request("session/set_mode", { sessionId: id, modeId }),
          clear: () => session.prompt("/clear"),                    // zera contexto, mantém a sessão
          /** prompt() resolve com o stopReason; o TEXTO vem por onUpdate/readText(). */
          prompt: (text: string) => session.prompt(text).then((t) => t.stopReason),
          readText: () => session.readText(),                       // concatena os text chunks do turno
          cancel: () => ctx.notify(AGENT_METHODS.session_cancel, { sessionId: id }),
        };
      },
      shutdown: () => child.kill(),
    };
  });
}
```

### Schema de `loopy.yml` (resumo)

Ver o `loopy.yml` de exemplo (config-driven completo). Blocos: `workspace`, `acp` (mecânica + `permissions`), `inputs.backlog`, `checks` (listas nomeadas), `pipeline` (lista ordenada de steps tipados), `stop_conditions`, `concurrency`, `policies`, `logging`. Cada item de `pipeline` é uma das 4 primitivas (`agent`/`shell`/`checks`/`approval`), validadas por zod.

## Testing Strategy

- **Framework:** `vitest` (`tests/` espelhando `src/`). Cobre a lógica pura e os limites; I/O externo mockado.
- **Unit (a maioria):**
  - `backlog/todo.ts` — parse de checkboxes, extração de id/slug/title/body (bloco indentado), `mark_done` idempotente (fixtures de `todo.md`).
  - `config/schema.ts` — zod: rejeita config inválido, aplica defaults, valida cada primitiva de step (agent/shell/checks/approval) e o `verify`.
  - `interp/resolver.ts` — substituição `${...}`, variáveis desconhecidas, `retry_prompt` vs `prompt`.
  - `checks/runner.ts` — agrega exit/stdout/stderr em `ChecksReport`; trunca saídas grandes; roda todos (não fail-fast).
  - `steps/verdict.ts` — parser tolerante de `AUDIT: PASS` / `AUDIT: FAIL: <motivo>` sobre `readText()` (última ocorrência).
  - `steps/agent.ts` — loop interno (`verify`): para no sucesso, retry no fracasso com `${checks.report}`, respeita `max_attempts`, aplica `on_fail`; trata `stopReason` não-`end_turn` como falha (ACP mockado).
  - `loop/orchestrator.ts` — ordem de steps, `always`, condições de parada, escalonamento, `mark_done` só no fim (git + ACP mockados).
- **Integração (poucas, marcadas):** `acp/*` contra um **fake agent** (subprocesso stub que fala JSON-RPC ndjson) para exercitar spawn → initialize → session → `/clear` → prompt → update → permission → set_mode sem depender do Claude real.
- **Git:** operações de worktree/merge testadas contra um **repo temporário** real no `beforeEach` (não mockar git).
- **Fora do escopo de teste automatizado (v1):** rendering visual do Ink (validar via store/estado) e chamadas reais ao agente Claude (manual/e2e).

## Boundaries

- **Always (sempre):**
  - **Interpretar o `pipeline` do yml fielmente** — nenhum comportamento de loop hardcoded no motor.
  - Rodar os checks configurados após cada `verify`; devolver o `${checks.report}` completo ao agente em caso de falha.
  - Isolar cada task no seu worktree; nunca editar direto o `parent_branch`.
  - `/clear` antes de cada prompt quando `clear_context: true` (default).
  - Marcar `- [x]` **apenas** após o pipeline inteiro da task ter sucesso; commitar essa marcação para manter o parent limpo.
  - Validar `loopy.yml` com zod antes de iniciar; abortar com erro claro se inválido.
  - Preservar o worktree em escalonamento (`keep_worktree: true`).
  - Registrar todos os steps por task; capturar tráfego ACP quando `capture_acp_traffic`.
- **Ask first (pedir aprovação humana):**
  - **Merge no `parent_branch`** (step `approval`, salvo `--yes`).
  - `git init` / commit inicial quando o diretório não é repo git.
  - Adicionar dependências ou mudar o schema do `loopy.yml`.
  - Rodar comandos de check não declarados no `loopy.yml`.
- **Never (nunca):**
  - **Hardcodar no motor comportamento de loop que deveria vir do yml.**
  - Commitar segredos ou fazer force-push em branch compartilhada.
  - Editar `node_modules`, `.git` interno, ou remover checks para "passar" o gate.
  - Fazer merge com checks falhando ou `AUDIT: FAIL`.
  - Deixar o `audit` editar (é `mode: plan`, read-only).
  - Prosseguir para a próxima task se `require_clean_parent` e o `parent_branch` estiver sujo.
  - Continuar após criar `.loopy.stop` (encerra ao fim da task corrente).

## Success Criteria

Testáveis; a spec está "feita" quando:

1. `loopy .` num repo git com `loopy.yml` válido + `todo.md` com N tasks pendentes processa as tasks em ordem, executando o `pipeline` do yml, e termina com backlog vazio ou parada explícita.
2. **Trocar o comportamento do loop é editar o `loopy.yml`** — reordenar/adicionar/remover steps, mudar prompts, modos, comandos, `max_attempts` e escalonamento **sem tocar no código do motor**.
3. Cada task marcada `- [x]` corresponde a **um commit + um merge** no `parent_branch` com todos os checks verdes e `AUDIT: PASS`.
4. Uma task cujos checks falham `max_attempts` vezes **não** é marcada, o worktree é **preservado**, e a política de escalonamento é aplicada e logada.
5. O gate de merge (`approval`) pausa e só integra após aprovação (ou `--yes`); criar `.loopy.stop` encerra após a task corrente.
6. A TUI mostra, ao vivo: lista de tasks, tentativa atual (`try k/max`), status por check e o stream do agente; degrada para logs de linha sem TTY / com `--no-tui`.
7. Ao final, o `parent_branch` compila/linta/testa verde e nenhum worktree/branch temporário sobra (exceto os preservados por escalonamento).
8. `--dry-run` resolve e imprime o pipeline (com interpolação) sem nenhuma escrita/commit/merge.

## Decisões (Open Questions resolvidas)

1. **Caminhos dos inputs (Q1).** `SPEC.md` na raiz + `tasks/plan.md` + `tasks/todo.md` — alinhado ao que o harness `devy` gera. Todos configuráveis em `inputs`.
2. **Harness nos worktrees (Q2).** O agente resolve o `.claude` do **cwd da sessão** (= worktree), verificado no source do adaptador → o `.claude` **precisa estar commitado no `parent_branch`**.
3. **Contexto por task (Q3).** **Contexto fresco por step** via `/clear` (knob `clear_context`, default `true`): 1 sessão ACP por task, `/clear` antes de cada prompt. Memória vive no disco (worktree/diff) e nas specs.
4. **Concorrência (Q4).** **Sequencial no v1** (`concurrency: 1`), mas store/orchestrator **parallel-ready** (sem singleton de "task atual"; pool de sessões keyed por worktree). O adaptador já hospeda N sessões, então subir para N depois é incremental.
5. **Conflitos de merge (Q5).** `on_conflict: escalate` — `git merge --abort` + escalonamento (preserva worktree). Raro no v1 sequencial. Configurável.
6. **Robustez do audit (Q6).** Step `agent` com `mode: plan` (read-only), contexto (SPEC+plan+diff) **embutido no prompt**, `expect: "AUDIT: PASS"`, parse **tolerante da última linha** de `readText()`. Só julga — não corrige.
7. **Nome/binário (Q7).** `loopy` (bin `loopy`, config `loopy.yml`, stop-signal `.loopy.stop`).

### Notas operacionais (decisões menores restantes)

- **node_modules por worktree.** Worktrees não compartilham `node_modules`; o `pipeline` de exemplo instala deps no `create-worktree` (`npm ci`, ajustável ao gerenciador do projeto-alvo).
- **Mark-done + parent limpo.** Após o merge, o motor marca `- [x]` em `tasks/todo.md` e **commita** essa mudança, para não sujar o `parent_branch` (que quebraria `require_clean_parent` na próxima task).
- **Setup git no primeiro run.** Se o diretório não for repo git: `git init` + commit inicial (incluindo `.claude`) + `.gitignore` com `.worktrees/`, `.loopy/`, `.loopy.stop` — sempre atrás de aprovação humana.
