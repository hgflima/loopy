# How-to guides do `loopy`

Guias orientados a **tarefa**: cada um resolve um objetivo concreto, partindo do
princípio de que você já sabe o que quer e tem competência básica com o `loopy`.
Diferente dos [tutoriais](../tutorials/README.md) (aprender do zero), da
[referência](../reference/README.md) (o _quê_) e dos [ADRs](../adrs/) (o
_porquê_), aqui o foco é **como fazer**.

> Nunca usou o `loopy`? Comece pelo tutorial
> [Meu primeiro loop](../tutorials/meu-primeiro-loop.md) e volte aqui para
> aplicá-lo a um projeto de verdade.

| Guia                                                                            | Objetivo                                                                                                                                                    |
| ------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [Configurar um projeto-alvo](configurar-projeto-alvo.md)                        | Pôr o `loopy` para rodar num repositório existente, do zero à primeira task merjada — incluindo concorrência N com DAG de tasks.                            |
| [Usar múltiplos agentes](usar-multiplos-agentes.md)                             | Migrar para o Registry `agents:` e selecionar agente, model e effort por Step — presets do Catálogo, sondagem de dialeto (`probe-agent`) e validação eager. |
| [Ligar a telemetria e anotar vereditos](ligar-telemetria-e-anotar-vereditos.md) | Ativar o gate `metrics:`, entender o que a run grava no `.db`, e anotar veredito humano, bugs e o fechamento de uma change — lendo tudo na aba Insights.    |
| [Recuperar uma task pausada ou escalada](recuperar-task-escalada.md)            | Investigar o worktree preservado e decidir entre retomar do checkpoint ou descartar com `--clean` — incluindo a armadilha de editar o pipeline no meio.     |

## Documentos relacionados

- **[Tutoriais](../tutorials/README.md)** — lições orientadas a aprender, do zero
  a um resultado visível (comece por _Meu primeiro loop_).
- **[Referência](../reference/README.md)** — descrição técnica precisa da CLI, do
  `loopy.yml`, da interpolação e do backlog.
- **[ADRs](../adrs/)** — as decisões de arquitetura por trás do comportamento.
- **`CONTEXT.md`** (raiz) — glossário da linguagem ubíqua.
- **`README.md`** (raiz) — visão geral, instalação e uso.
