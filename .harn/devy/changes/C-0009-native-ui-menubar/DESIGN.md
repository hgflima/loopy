# DESIGN — C-0009 Native UI (lente relationship-centric)

> Produzido com a skill **Relationship Design** (agentic UX). Este doc é o
> complemento de design do `spec.md`: aterra os cinco pilares de UX agêntica
> nos invariantes do spec e diz, explicitamente, **o que recusar**. Não altera
> contratos — onde uma recomendação exigiria forkar `reduce`, mutar além do
> gate ou abrir um painel de logs, ela **não entra** (fail-closed).
>
> Artifact navegável equivalente: publicado nesta sessão (mockups + matriz visual).

## Tese

**O app não constrói uma relação — ele é a _janela_ para uma que já existe.**

O paradigma relationship-centric assume que o sistema **age por você** e
**aprende você**. O C-0009 é, por spec, proibido de ambos: apresentação pura
(reusa `reduce`), uma **única** superfície de mutação (o Gate de Aprovação),
sem painel de logs/ACP. Aplicar a skill ingenuamente — memória evolutiva,
autonomia progressiva na UI, timeline de relacionamento — **violaria os
invariantes**.

A inversão que torna a skill produtiva:

```
  user ↔ app  (memória, autonomia)          ← leitura ingênua, viola o spec
  user ↔ loop · app = instrumento de confiança   ← leitura correta
```

A relação de confiança que a skill quer projetar **já existe**: entre o dev e o
Run agêntico ao qual ele delega código. O app não a cria — ele a torna
**legível e governável**. Todo o resto deste doc decorre disso.

## Os 5 pilares × este app

| # | Pilar | Veredito | Racional |
|---|-------|----------|----------|
| 1 | Revolução da memória | **Cede** | `reduce` é a fonte única; a memória de verdade vive no checkpoint. |
| 2 | Confiança como material | **Cabe — núcleo** | Gate + `--yes` = dial literal de delegação. |
| 3 | Arquitetura relationship-centric | **Reframe** | Grafo + Kanban já _são_ a consciência de objetivos. |
| 4 | Sistema que planeja seu caminho | **Cede ao motor** | Quem planeja é o PC; o app renderiza o plano navegado. |
| 5 | Novas métricas de sucesso | **Cabe como lente** | Guia o glance, não vira dashboard. |

### 1 — Memória · **Cede**
App é apresentação pura: nenhum estado de domínio duplicado. A única memória
legítima é o `LaunchConfig` (último dir + flags, refino #3) — e honestamente é
_static settings_, não "padrões que evoluem". Correto assim. A memória de
verdade do Run vive em `.loopy/state.json`.

- **Move:** superfície **"este Run pode retomar"** a partir do checkpoint — o
  app _revela_ memória, não a possui.
- **Resista a:** relationship-timeline, preference-evolution map (violam pureza).

### 2 — Confiança · **Cabe (núcleo)**
O Gate de Aprovação + toggle `--yes` é a **única** superfície de mutação e a
única relação real do app: um dial literal de delegação humano→agente. Os três
estágios da skill mapeiam direto (ver seção seguinte).

- **Move:** trate `--yes` como **nível de confiança**, não flag. O prompt do
  gate carrega o contexto que levou ali (`task` · `step` · `verdict` /
  `checks.report`) **e** o custo de reprovar (escala). Badge ⚠, FIFO honesto —
  igual ao `ApprovalController` Ink.

### 3 — Arquitetura relationship-centric · **Reframe**
A relação contínua é user↔loop. O grafo Deps e o Kanban **já são** as
superfícies de "consciência contínua de objetivos": objetivos = backlog /
`todo.md`; progresso = status por task; o "como" = `plan.md`. O Desvio (`goto`,
card voltando de coluna) é o **aprender-com-a-falha tornado visível**.

- **Move:** nomeie o Kanban pelo que ele é — a relação em andamento, não um
  board de tarefas. O "contexto que influencia o agora" é o próprio grafo.

### 4 — Sistema que planeja seu caminho · **Cede ao motor**
Quem planeja o caminho é o **loop** — o Program counter navegando o grafo do
pipeline, Desvios, fix-loops. O app não planeja: renderiza o plano sendo
navegado. Mas é aqui que mora a vista de maior valor: Kanban
Steps-como-colunas + goto-como-retorno = **assistir o agente construir o
próprio caminho** ao vivo.

- **Move:** o **fix-loop é a estrela**. O retorno de coluna num `goto` é o
  momento mais expressivo do app — dê a ele o mesmo realce que a task ativa
  recebe (pulso/destaque).

### 5 — Métricas · **Cabe como lente (sem dashboard)**
"Sem painel de logs/ACP" impede um dashboard de métricas. Mas a _lente_
relationship-quality deve guiar o que o glance mostra: não cliques/sessão, e sim
**conforto de delegação** (`--yes`? quantos gates?), **onde quebrou** (card
`escalated` exibe o Step que falhou — refino #6 já faz) e **disciplina de
sinal**.

- **Elogio (manter):** a política de notificação #8 (avisa em `approval` /
  `run_finished` / `escalated` / `paused`, **nunca** por-task-`done`) já é
  relationship-correct: otimiza pelo **sinal que precisa de um humano**, que é a
  essência do conforto de delegação.

## O instrumento de confiança: Transparência → Seletivo → Autônomo

O `--yes` não é um checkbox de conveniência: é onde o dev move o nível de
autonomia que concede ao loop.

| Estágio | Flag | Comportamento |
|---------|------|---------------|
| **1 · Transparência** | `--yes` OFF (default, SC #6) | Todo merge pausa. Prompt completo (task · step · summary) + notificação + janela. O dev vê tudo e aprova cada um — fase de calibração de confiança. |
| **2 · Seletivo** | **vive no motor/yml, não no app** | Aprovar _só o incerto_ exige política, e política é lógica de domínio. O app **não pode forkar** isso (Boundary: nunca mutar além do gate). Contribuição honesta: tornar o _estado_ de confiança legível (rodando com `--yes`? cadência de gates?), sem decidir por você. |
| **3 · Autônomo** | `--yes` ON | Delegação plena. O app recua a observador puro + só notifica em terminal/escalada. **Recuperação de confiança embutida:** um run autônomo ruim **escala** → notifica → o dev re-engaja. A escalada _é_ o protocolo de undo/correção da skill. |

**Ponto de design deliberado:** o estágio 2 **não pode viver no app**. Reconhecê-lo
evita a armadilha mais comum da lente (um slider de autonomia na UI).

## As três superfícies

Aterradas nas decisões do refino (2026-07-08).

1. **Glance no popover** (refino #2) — não "sessão" nem "clicks", e sim os
   números que dizem _o quanto está delegado e onde precisa de você_:
   `done/total · running · ⚠ gates`, mais `delegação: --yes ON/OFF · N gates ·
   retomável`. O pulso do ícone da barra ecoa `pulseFrame` da TUI.
2. **Janela plena — Kanban default** (refino #6, #9) — Steps como colunas
   (Backlog → Steps → Fim); card na coluna do Step corrente; `escalated` exibe
   **o Step onde quebrou**. ViewSwitcher → grafo Deps (mesmo layout dagre da
   TUI, jamais auto-layout). O `goto` = card retornando a uma coluna anterior.
3. **Prompt de aprovação** (refino #7) — a **única** superfície de mutação. A
   notificação só _alerta_; a decisão vive numa superfície confiável (o plugin
   `notification` tem action-buttons irregulares). Carrega contexto (verdict,
   checks) + o custo de reprovar. Transport: `approval_requested` (stdout) →
   `approval_decision` (stdin), FIFO.

## A disciplina — o que NÃO construir

O maior risco desta lente é o **over-design**. Cada item abaixo é uma tentação
legítima do paradigma relationship-centric e viola um invariante. Recusá-los
**é** a decisão de design.

| ✕ Não construir | Por quê |
|-----------------|---------|
| Timeline de relacionamento / preference-evolution map | viola apresentação pura |
| Slider de autonomia por-categoria **no app** | política = lógica de domínio (yml) |
| Dashboard de métricas / tokens / custo ("compounding value") | viola "sem painel de logs/ACP" |
| Heurística própria de confiança ou auto-layout do grafo | forka `reduce` / `computeDagreLayout` |
| Notificar a cada task `done` | ruído — quebra a disciplina de sinal (#8) |

## Rastreio ao spec

- Reframe user↔loop ⟶ Objective + Boundaries ("app é apresentação pura",
  "nunca mutar além do gate").
- Estágios de confiança ⟶ SC #6, refino #7/#11 (`--yes` default OFF).
- Fix-loop como estrela ⟶ SC #5 (Kanban `goto`), refino #6.
- Disciplina de sinal ⟶ refino #8 (política de notificação).
- Glance ⟶ refino #2/#3 (popover + LaunchConfig persistido).
