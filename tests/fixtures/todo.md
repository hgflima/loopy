# Backlog fixture

> Intro quote line at column 0 — ignored by the parser.
> Second quote line — also ignored.

## Fase 0 — Fundação

- [x] T-001: Scaffold do projeto + types.ts
      package.json (ESM) + tsconfig estrito + eslint/prettier + vitest.
      src/types.ts com Task, StepConfig, StepResult. Depende de nada.

- [ ] T-002: Schema + loader do loopy.yml
      config/schema.ts (zod) e config/load.ts.
      Deps: T-001

- [ ] T-003: Simplificação do parser (T-\d+)
      Corpo com caracteres especiais: `- [ ]` literal no meio do texto,
      e uma linha extra indentada.
      Deps: T-001, T-002

## Checkpoint A — revisão humana.

## Fase 1 — Spine

- [ ] T-010: Task sem corpo
- [ ] T-011: Última task com corpo final

      body após linha em branco interna.
