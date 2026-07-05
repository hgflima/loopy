# Referência do loopy

Descrição técnica precisa da superfície de uso do `loopy`, organizada para
consulta. Cada página espelha uma peça da máquina e é derivada de uma fonte de
verdade no código.

| Página | Descreve | Fonte de verdade |
|--------|----------|------------------|
| [CLI](cli.md) | O comando `loopy`, argumentos e flags | `src/index.ts` |
| [Configuração (`loopy.yml`)](configuration.md) | Todo bloco, chave, tipo e default do config | `src/config/schema.ts` |
| [Interpolação (`${…}`)](interpolation.md) | As variáveis conhecidas e as regras de substituição | `src/interp/resolver.ts` |
| [Backlog (`todo.md`)](backlog.md) | O formato do backlog que o loop externo itera | `src/backlog/todo.ts` |

## Documentos relacionados

- **[Tutoriais](../tutorials/README.md)** — lições orientadas a aprender (comece
  por *Meu primeiro loop*), para quem está chegando agora.
- **[How-to guides](../how-to/README.md)** — guias orientados a tarefa (o *como*),
  ex.: pôr o `loopy` para rodar num projeto existente.
- **`CONTEXT.md`** (raiz) — glossário da linguagem ubíqua; a fonte canônica dos
  termos do domínio (Motor, Run, Step, Verify, Verdict, Worktree, …).
- **`README.md`** (raiz) — visão geral, instalação e uso.
- **`docs/adrs/`** — decisões de arquitetura (o *porquê*).

## Convenções desta referência

- **Tipos** usam a notação do schema: `string`, `number`, `boolean`, `string[]`
  (lista), `A | B` (união), `<lista de checks>` (nome que referencia uma chave de
  `checks`), `<step-id>` (`id` de um step existente).
- **Obrigatório/opcional**: uma chave é obrigatória salvo indicação de *default*
  ou do sufixo *opcional*. Chaves com default podem ser omitidas.
- **`.strict()`**: todo objeto do `loopy.yml` rejeita chaves desconhecidas — um
  typo vira erro de config, não é ignorado em silêncio.
