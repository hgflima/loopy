# Preflight — agentes, versões e o checklist de "rodar redondo"

## 1. Versão do Node

O motor exige **Node ≥ 22.13** (`node:sqlite` não existe no 20, que é EOL).

```bash
node --version
```

Abaixo disso, pare: nem o dry-run vai rodar. Oriente `nvm install 22` (ou
equivalente) antes de qualquer outra coisa.

## 2. Versão do pacote

O yml gerado usa features recentes (`concurrency: auto`, `metrics:` sem
`report`). Confirme o que o `npx` vai resolver:

```bash
npx -y @hgflima/loopy@latest --version
```

Atenção a dois desalinhamentos conhecidos:

- **`npm link` local**: se `which loopy` aponta para um link do dist local
  (máquina de desenvolvimento do motor), a versão reportada pode mentir e o
  binário pode estar stale. Prefira sempre `npx -y @hgflima/loopy@latest`
  explícito nos comandos que você sugerir.
- **npm atrás do source**: se o projeto-alvo é o próprio repo do motor, o
  source local pode ter features que o npm publicado ainda não tem — nesse
  caso use `npm run dev --` em vez de `npx`.

## 3. Detecção + sondagem dos agentes

Duas etapas por agente. A detecção barata primeiro:

```bash
which claude   # proxy: usuário usa Claude Code nesta máquina
which codex    # binário do Codex CLI (auth via `codex login`)
which opencode # binário do OpenCode (o adapter é `opencode acp`, subcomando)
```

Depois, para cada um detectado, a sondagem — que prova que o adapter **sobe e
autentica**, e grava o cache de capabilities usado pelos campos
`mode`/`model`/`effort` (dialeto literal, muda por versão do adapter):

```bash
npx -y @hgflima/loopy@latest probe-agent --json --command npx -y @agentclientprotocol/claude-agent-acp@0.59.0
npx -y @hgflima/loopy@latest probe-agent --json --command npx -y @agentclientprotocol/codex-acp
npx -y @hgflima/loopy@latest probe-agent --json --command opencode acp
```

`--command` consome o resto da linha (o argv do adapter é opaco), por isso vem
por último. O resultado lista os valores aceitos de `mode`, `model` e
`effort` — **use esses valores no yml, nunca chute**: o motor valida mas não
traduz dialetos (um `mode` inválido é erro em runtime).

Dialetos típicos (confirme sempre pela sondagem):

| Agente | `mode` | `effort` | Observação |
| --- | --- | --- | --- |
| claude | `acceptEdits`, `plan`, … | `low`…`max` (adapter ≥ 0.59) | Preset pina o adapter em 0.59.0. |
| codex | `read-only`, `agent`, `agent-full-access` | `low`…`high` | Auth por subscription (`codex login`). |
| opencode | `build`, `plan` | — (não suporta) | `effort` vira no-op com warning. |

**Nenhum agente passou?** Erro claro e parada. Modelo de mensagem:

> Nenhum agente de código utilizável foi encontrado. Tentei: claude (which:
> ✗/✓, probe: …), codex (…), opencode (…). Instale e autentique ao menos um:
> Claude Code (`npm i -g @anthropic-ai/claude-code` + login), Codex CLI
> (`codex login`), ou OpenCode. Depois rode /devy:loop-setup de novo.

Um agente que passa no `which` mas falha no probe (ex.: sem login) **não
entra no yml** — registre no relatório do preflight o motivo.

## 4. Checklist de "rodar redondo" (usado pelo /devy:loop-setup)

Cada item abaixo já causou um run quebrado em produção; verifique todos.

### `.gitignore` do alvo

Artefatos de runtime nunca podem sujar o parent (o motor exige
`require_clean_parent` e um `.gitignore` incompleto gera `dirty_parent`):

```
.worktrees/
.loopy/
.loopy.stop
.db/
```

### Lockfile

O step `install-deps` canônico usa `npm ci`, que **falha sem
`package-lock.json`**. Repo greenfield sem lockfile: rode `npm install` uma
vez e commite o lockfile — ou troque o step para `npm install --prefix …`.

### Harness `.claude/` commitado

Os prompts do pipeline canônico invocam `/devy:build`, `/devy:code-simplify`
e `/devy:review`. Esses comandos precisam existir no **worktree** — ou seja,
o harness `.claude/` (commands + skills do devy) deve estar **commitado no
parent branch**. Se o alvo não tem o harness, ofereça duas saídas: instalar o
harness (harness-lab) ou reescrever os prompts do yml em texto puro (sem
slash commands).

### Lint não pode tocar o harness nem os worktrees

Lint de repo-inteiro + `git add -A` fizeram tasks concorrentes editarem
`.claude/` e conflitarem no merge. Garanta que o lint do alvo ignora
`.claude/` e `.worktrees/` (eslintignore / `ignores` do flat config).

### Tudo commitado antes do run

O motor exige parent limpo. Depois do setup, liste o que precisa de commit:
`loopy.yml`, o wrapper de cleanup (se gerado), `.gitignore`, os inputs da
change (`.harn/devy/changes/C-…/`), lockfile e o harness `.claude/`.
