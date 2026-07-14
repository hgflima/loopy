# D-0011 — Sondar um agente recém-criado na GUI exige salvar o `loopy.yml` antes

> **Status:** **resolvido** em 2026-07-14 (sondagem por argv) · **Severidade:** ~~baixa~~ **alta** (ver "Revisão da severidade") · **Área:** `apps/menubar/src-tauri/src/project_fs.rs` · `src/index.ts` (`probe-agent`) · `apps/menubar/src/config/useAgentCapabilities.ts`
> **Descoberto em:** 2026-07-14 · **Origem:** C-0016 (ADR-0010 — Catálogo de Agentes; investigação do `dir` que nunca chegava ao `ConfigPane`)

## Revisão da severidade (2026-07-14)

A avaliação original ("fricção de edição, não corretude") **subestimou o débito**.
Ela só considerou o caso do agente **novo**, em que o probe *falha* — ruidoso, mas
honesto. O caso que faltou é o do agente **existente cujo `preset` foi trocado**:
o nome continua no yml salvo, então o probe **não falha** — ele responde, com as
capabilities do **adapter antigo**. Trocar `codex` → OpenCode e ver
`modes: read-only, agent, agent-full-access` na tela é dado errado exibido como
certo, e leva o operador a gravar um `model`/`effort` do dialeto errado.

Lição: um lookup que resolve pelo **nome** enquanto o resto da feature resolve
pelo **argv** não erra só quando o nome falta — erra (em silêncio) quando o nome
existe e aponta para outra coisa.

## Correção aplicada

Exatamente a proposta abaixo: `probe-agent` aceita `--command <argv...>` (+ `--env
K=V`), o comando Rust os repassa e o `useAgentCapabilities` sonda pelo argv do
**draft**. O `<nome>` continua válido para o CLI. Com `--command`, o `loadConfig`
vira opcional (a política de permissão cai no default), então um projeto cujo yml
nunca foi salvo também é sondável.

## Sintoma

Na aba Config, ao adicionar um Agente novo (por preset ou custom) e clicar em
**⟳ sondar** *antes* de salvar, a sondagem falha com `agente "<nome>" não existe
em 'agents'` — mesmo que o agente esteja ali, preenchido, na frente do operador.
Os selects de `mode`/`model`/`effort` degradam para texto livre (D31) até que se
clique em **Save**.

Só morde um argv **nunca sondado antes**. Um preset cujo argv já está no cache
(`.loopy/capabilities.json`) acerta o cache na hora — sem probe, sem Save.

## Causa raiz

A sondagem lê o yml **do disco**, não o draft em memória. O comando Rust monta o
argv do sidecar com `-c <dir>/loopy.yml` (`project_fs.rs:86-97`) e o
`executeProbeAgent` (`src/index.ts:980-1050`) faz `loadConfig(configPath)` e
procura o nome em `config.resolvedAgents.byName` — que é o **arquivo salvo**. O
`ConfigPane` edita um draft (`useConfigDraft`) que só toca o disco no Save, então
o agente novo é invisível para o probe.

Ou seja: `probe-agent` é indexado por **nome de agente + config em disco**,
enquanto tudo o mais nessa feature é indexado por **argv** — o cache de
capabilities é keyed por `command.join(" ")` (`src/acp/capabilities-cache.ts:31`),
e o hook da GUI já resolve o argv sozinho (`agent-source.ts` → `agentCommandOf`).
O nome é o único elo que ainda exige o disco.

## Impacto

Fricção de edição, não corretude — nada é gravado errado e nada falha em runtime.
O operador vê uma sondagem falhar num agente que existe, e a saída (Save) não é
óbvia pela mensagem de erro. Custa mais em fluxo de descoberta ("quero ver quais
models esse agente tem antes de decidir se fico com ele") do que em fluxo de
edição normal.

Atenuado pelo ADR-0010: com `preset`, o argv de um adapter conhecido tende a já
estar no cache (foi sondado num Run ou numa edição anterior), e o cache-hit
dispensa o probe. Sobra o caso do argv inédito — um preset novo no catálogo, ou
um agente custom.

## Reprodução

1. Abrir a GUI num projeto cujo `.loopy/capabilities.json` não tenha o argv do OpenCode.
2. Aba **Config** → **Agents** → botão **OpenCode** (cria `opencode: { preset: opencode }`).
3. Clicar em **⟳** no card do agente novo, sem salvar.
4. Sondagem falha: `agente "opencode" não existe em 'agents' (disponíveis: …)`.
5. Clicar em **Save** e sondar de novo → funciona.

## Correção proposta

Sondar **por argv**, não por nome — alinhando o `probe-agent` com o resto da
feature (o cache já é keyed por argv):

- CLI: aceitar `loopy probe-agent --command <argv...>` como alternativa ao
  `<nome>`; com `--command`, pular o `loadConfig` e montar o `AgentDef` na hora.
  Mantém o `-c` só para achar a raiz do cache.
- Rust: `probe_agent(dir, command: Vec<String>)`, repassando o argv.
- GUI: passar `agentCommandOf(agent)` (que já é calculado para a chave do cache)
  em vez do nome. O draft passa a ser sondável sem tocar o disco.

**Ressalva a resolver no fix:** o `env` do agente (auth por API key,
`${env.KEY}`) hoje vem do `agentDef` do yml salvo. Sondando por argv puro, um
agente que dependa de `env` para autenticar sondaria sem ele. Ou o `--command`
também aceita `--env`, ou o fix passa o `env` do draft junto.

## Workaround atual

Salvar o `loopy.yml` (o Save é fail-closed, então o yml precisa estar válido) e
então sondar. Uma vez sondado, o argv fica no cache e não precisa mais do disco.
