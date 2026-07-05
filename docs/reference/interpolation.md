# Referência de interpolação (`${…}`)

As variáveis conhecidas e as regras de substituição em templates do `loopy.yml`.
Derivado de `src/interp/resolver.ts` (`ScopeVars`, `resolve`, `selectPrompt`).

Todo campo templável do config (`prompt`, `retry_prompt`, `run`, `notify`,
`report.index`, …) passa por substituição simples: cada `${chave}` é trocado pelo
valor do escopo naquela chave pontilhada. O escopo é montado **uma vez por
task/tentativa** (AD-4) — o dry-run e o run vivo resolvem strings idênticas.

## Variáveis

| Variável | Tipo | Descrição |
|----------|------|-----------|
| `${task.id}` | string | Id da task (ex.: `T-004`). |
| `${task.slug}` | string | Slug derivado do título (branch/URL-safe). |
| `${task.title}` | string | Título da task. |
| `${task.body}` | string | Corpo (bloco indentado) da task no `todo.md`. |
| `${task.branch}` | string | Branch da task (default `${id}-${slug}`). |
| `${worktree.path}` | string | Path do worktree isolado da task. |
| `${worktree.diff}` | string | Diff atual do worktree (vazio quando não há diff). |
| `${iteration}` | número | Índice estável da task no backlog (AD-4). |
| `${attempt}` | número | Tentativa corrente do loop interno (1-based). |
| `${checks.report}` | string | Report agregado dos checks (vazio antes do 1º run). |
| `${inputs.spec}` | string | Path do documento de spec. |
| `${inputs.plan}` | string | Path do documento de plan. |
| `${inputs.todo}` | string | Path do backlog. |
| `${workspace.root}` | string | Raiz do repositório-alvo. |
| `${workspace.parent_branch}` | string | Parent branch (destino do merge). |
| `${workspace.worktrees_dir}` | string | Diretório dos worktrees. |
| `${change.id}` | string | Id da Change (derivado do path do `todo.md`). |
| `${change.dir}` | string | Diretório da Change. |

## Regras de resolução

- **Sintaxe.** Um placeholder é `${ chave }`; o texto interno é *trimado* antes do
  lookup, então `${ task.id }` e `${task.id}` são equivalentes.
- **Só chaves-folha.** Apenas as chaves-folha da tabela acima existem no escopo.
  Referenciar um namespace (ex.: `${task}` ou `${checks}`) é uma **variável
  desconhecida**.
- **Desconhecida → fail-fast (OQ1).** Uma chave desconhecida (typo, variável não
  declarada) aborta com `InterpolationError` nomeando a variável e o Step, **antes
  de qualquer efeito**. A mensagem lista as variáveis disponíveis.
- **Conhecida-mas-vazia → `""`.** Um valor legitimamente vazio (ex.:
  `${checks.report}` no primeiro prompt, ou `${worktree.diff}` sem diff) resolve
  para a string vazia — é um valor válido, não um erro.
- **Sem reexpansão.** O valor substituído não é reinterpretado: dados
  interpolados nunca viram novos `${…}` nem tokens de shell.

## Seleção de prompt por tentativa

Um Step `agent` escolhe o template pela tentativa (`selectPrompt`):

| Tentativa | Template usado |
|-----------|----------------|
| 1 | `prompt` |
| ≥ 2 | `retry_prompt` se definido; senão, `prompt` |

A seleção é separada da resolução: o template escolhido é resolvido contra o
escopo daquela tentativa.

## Ver também

- [Configuração (`loopy.yml`)](configuration.md) — onde os templates aparecem.
- [Backlog (`todo.md`)](backlog.md) — origem de `task.*`.
