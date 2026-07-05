# D-0002 — Verify de checks pesados (suíte completa) sob `concurrency > 1` dá falso-negativo: Tasks pausam com código verde

> **Status:** reconhecido — fix #1 (`testTimeout`) aplicado em `vitest.config.ts` (C-0007); #2/#3 (Verify escopado) seguem abertos · **Severidade:** alta · **Área:** `.harn/devy/changes/*/loopy.yml` (lista `ci`) · `vitest.config.ts` · testes de integração `tests/git/*` e `tests/e2e/*`
> **Descoberto em:** 2026-07-05 · **Origem:** C-0007 (T-005 e T-006 pausaram no `verify` apesar de estarem **verdes**)

## Sintoma

No run paralelo (`concurrency: 5`) da C-0007, **T-005** e **T-006** esgotaram as 3
tentativas do `verify: { run: ci }` e **escalaram para `pause`** — mesmo com a
implementação **correta e verde**. Rodados depois isoladamente, os worktrees passavam
**801/802** testes (typecheck + lint + test verdes, sem uma única alteração de código).

O log só mostra `verify "ci" falhou após 3 tentativa(s); aplicando on_fail: escalate → pause`.
O operador conclui "não conseguimos construir a Task" quando o código **estava pronto**;
a única evidência do falso-negativo é re-rodar os checks **sem contenção**.

## Causa raiz

A lista `ci` termina em `npm test`, que roda a **suíte inteira** (~48 arquivos, ~800
testes) incluindo testes de **integração que sobem `git`/subprocessos reais**
(`tests/git/*`, `tests/e2e/*`). O `vitest.config.ts` **não define `testTimeout`** → todo
teste sem override próprio usa o **default de 5000 ms**.

Quando N Tasks rodam o `verify` em paralelo — cada uma disparando a **suíte completa** no
seu worktree — a CPU fica **sobre-inscrita**. Os testes lentos, que solo já ficam perto
do teto, **estouram os 5000 ms**: p.ex. `initGitRepo` em `tests/git/setup.test.ts`
(git init + commits reais, ~3 s solo) falha com `Error: Test timed out in 5000ms`. Um
único teste vermelho reprova o check `test` → o `ci` inteiro falha → as 3 Tentativas do
loop interno se esgotam **sobre um falso-negativo** → `on_fail: escalate` → `pause`
(fail-closed, `keep_worktree`).

O comentário da própria config (`concurrency: 5`) já antecipava metade disso — *"baixe
para 3–4 se a máquina sofrer com N checks simultâneos"* — mas o gargalo real é rodar a
**suíte inteira × N**, não só o N.

## Impacto

- **Falso-negativo no gate mais crítico** (o Verify que decide se a Task avança): Tasks
  **prontas** pausam e exigem intervenção humana. Pior — o operador pode concluir que a
  implementação falhou e refazer trabalho que já estava correto.
- **Desperdício:** 3 Tentativas de Agente (tokens + tempo) por Task sobre código que já
  passava.
- **Não-determinístico:** depende da carga da máquina; some com `concurrency: 1`,
  reaparece sob paralelismo. Difícil de diagnosticar sem re-rodar isolado.
- **Recorrência alta:** qualquer Change que use a lista `ci` (suíte completa) com
  `concurrency > 1` numa máquina modesta dispara.

Classificado **alta** (falha do gate de verificação sob condição comum), ainda que sem
corrupção de dado — o worktree fica preservado por `keep_worktree`, recuperável (foi o
que permitiu fechar a C-0007 landando T-005/T-006 direto).

## Reprodução

Difícil de forçar deterministicamente (é corrida de recurso). Aproximação: rode a suíte
sob paralelismo com carga concorrente e observe `tests/git/setup.test.ts > initGitRepo`
estourar 5000 ms.

```bash
# dois runs simultâneos da suíte competindo por CPU (simula N verificações paralelas)
npm test & npm test & wait
# => intermitente: "tests/git/setup.test.ts > initGitRepo ... Test timed out in 5000ms"
# solo (npm test sozinho) o mesmo teste passa
```

## Correção proposta

Camadas (defesa em profundidade — a #1 e a #2 atacam a causa raiz):

1. **Folga para os testes de integração:** ✅ **aplicado (C-0007)** — `vitest.config.ts`
   agora define `testTimeout`/`hookTimeout: 20000`, matando o flake do `initGitRepo` local
   e no CI. Resta (opcional) limitar a concorrência **interna** do vitest
   (`poolOptions.threads.maxThreads`, ou `--no-file-parallelism` para `git`/`e2e`) se a
   contenção voltar a apertar. Corrige a causa **proximal**, não a de fundo (ver #2).
2. **Verify escopado, não a suíte inteira:** o Verify de cada Task não precisa rodar ~800
   testes — cada Task já declara a sua `Verificação` estreita (T-005 →
   `npm test -- checks steps`). Usar uma **lista de checks leve** no `verify` (por-step) e
   reservar o `npm test` completo para **um** gate final único (um Step `checks`
   serializado no fim do pipeline), em vez de N execuções da suíte completa em paralelo.
3. **`concurrency` ciente do peso do check:** quando o check é a suíte completa,
   `concurrency` alto multiplica a contenção. Derivar/documentar um teto conservador, ou
   serializar o Step de verify pesado via o mutex da Seção crítica.
4. **Robustez do loop interno (fraca):** um Verify que falha **sempre pelo mesmo timeout**,
   sem o Agente ter mudado nada relevante, é indício de falha-de-recurso e não de código —
   mas distinguir isso é heurística frágil; preferir #1–#3.

## Workaround atual

Rodar backlogs cujo `ci` é a suíte completa sob `concurrency` **baixa** (1–2) em máquinas
modestas; **ou** re-verificar manualmente os worktrees pausados **antes** de concluir que
a Task falhou. Como a escalação usa `keep_worktree: true`, o trabalho fica preservado no
`.worktrees/<id>/` — bastou `commit → merge → cleanup` para fechar T-005/T-006 na C-0007.
