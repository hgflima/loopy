# Débitos técnicos (`devy/debts`)

> Registro de **débitos técnicos conhecidos**: bugs tolerados, atalhos deliberados,
> refactors adiados e armadilhas do motor que **não cabem numa Change agora**, mas
> precisam ficar rastreáveis para não se perderem. Um débito documenta algo que
> *já sabemos que está errado ou frágil* — não é backlog de feature (isso é uma
> Change em `devy/changes/`).

## Quando registrar um débito

- Um bug encontrado **de passagem**, fora do escopo da Change corrente (o caso típico:
  você estava fazendo outra coisa e esbarrou nele).
- Um **atalho consciente** tomado para entregar (ex.: "fiz fail-closed no lugar de
  tratar o caso X porque X é raro").
- Uma **armadilha** que vai reaparecer (formato de input que quebra silenciosamente,
  invariante frágil, acoplamento que dificulta mudança).

Se o item vira trabalho planejado, ele **promove para uma Change** (`devy/changes/C-XXXX-*`);
o débito passa a `status: resolvido` apontando a Change que o absorveu.

## Convenção de arquivos

- **Um arquivo por débito**, em `.harn/devy/debts/D-XXXX-{slug}.md`.
- **`XXXX`** = número **incremental global de 4 dígitos**, zero-padded (`0001`, `0042`,
  `0110`, `2120`). Sequencial na ordem de descoberta; **nunca reusar** um número, mesmo
  após resolver/descartar (o histórico fica).
- **`{slug}`** = resumo curto em `kebab-case` do sintoma (ex.: `parsedeps-drops-trailing-dep`).
- O **próximo número** é `max(existentes) + 1`. Hoje o maior é o registrado na tabela
  abaixo.

## Estrutura de cada arquivo

Título `# D-XXXX — <frase do sintoma>` + um blockquote de metadados, seguido das seções:

```markdown
# D-0001 — <sintoma numa frase>

> **Status:** aberto · **Severidade:** média · **Área:** `src/caminho/arquivo.ts`
> **Descoberto em:** AAAA-MM-DD · **Origem:** C-XXXX (contexto onde apareceu)

## Sintoma          — o que se observa (comportamento errado, sem teoria)
## Causa raiz        — o porquê, ancorado em `arquivo.ts:linha`
## Impacto           — a quem/quando dói; silencioso? fail-closed? corretude vs. cosmético
## Reprodução        — passos/snippet mínimo que demonstra
## Correção proposta — a direção do fix (não obrigatoriamente implementada)
## Workaround atual  — como conviver com ele até lá (se houver)
```

Campos do cabeçalho:

- **Status:** `aberto` → `reconhecido` (ciente, priorizado) → `resolvido` (com a
  Change/commit que resolveu) · ou `descartado` (`wont-fix`, com a justificativa).
- **Severidade:** `baixa` (cosmético/conveniência) · `média` (frágil, contornável) ·
  `alta` (corretude/perda silenciosa de dado, ou risco de falha em produção).
- **Área:** o(s) módulo(s)/arquivo(s) principais afetados.
- **Origem:** a Change ou tarefa durante a qual o débito foi descoberto.

Ao **resolver**, edite o débito (não o apague): mude `Status` para `resolvido em C-XXXX`
/ `resolvido em <commit>`, e atualize a linha no índice. Arquivos ficam como registro
histórico.

## Índice

| ID | Título | Área | Sev. | Status |
|----|--------|------|------|--------|
| [D-0001](D-0001-parsedeps-drops-trailing-dep.md) | `parseDeps` descarta a última dep quando a linha `Deps:` tem texto após os ids | `src/backlog/todo.ts` | média | aberto |
| [D-0002](D-0002-heavy-verify-false-negative-under-concurrency.md) | Verify de suíte completa sob `concurrency > 1` dá falso-negativo (Tasks verdes pausam) | `loopy.yml` (`ci`) · `vitest.config.ts` | alta | reconhecido (fix #1 aplicado) |
| [D-0003](D-0003-no-unified-agent-capability-adapter.md) | Sem interface única p/ o de/para das particularidades de cada coding agent (mode/model/effort); o dialeto de cada adapter vaza pro yml | `src/acp/session.ts` · `src/steps/agent.ts` · `src/config/schema.ts` | média | aberto |
| [D-0004](D-0004-check-events-never-emitted-in-live-run.md) | `check_started`/`check_finished` nunca são emitidos num Run real (o port de produção descarta os callbacks) | `src/index.ts` · `src/checks/runner.ts` | média | aberto |
| [D-0005](D-0005-approval-requested-frame-has-empty-taskid.md) | Control frame `approval_requested` sai com `taskId`/`stepId` vazios (hardcoded) | `src/tui/start.ts` | média | aberto |
| [D-0006](D-0006-cancelsignal-seam-never-wired.md) | `cancelSignal` é seam morto: o hard-stop nunca chega ao step `shell` | `src/steps/index.ts` · `src/steps/shell.ts` | média | aberto |
| [D-0007](D-0007-approval-onfail-goto-renders-object-object.md) | `on_fail: { goto }` em step `approval` renderiza `[object Object]` na `reason` | `src/steps/approval.ts` | baixa | aberto |
| [D-0008](D-0008-run-cost-undercounts-since-task-cost-became-a-sum.md) | Custo do Run subconta: Task virou soma (ADR-0006), Run/Change seguem *last-non-null* | `src/metrics/folds.ts` · `src/types.ts` | média | aberto |
