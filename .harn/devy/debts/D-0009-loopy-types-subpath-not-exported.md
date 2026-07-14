# D-0009 — O app importa `loopy/types`, mas esse subpath não existe no `exports` do pacote

> **Status:** aberto · **Severidade:** baixa · **Área:** `package.json` · `tsup.config.ts` · `apps/menubar/src/config/`
> **Descoberto em:** 2026-07-14 · **Origem:** sync do Intent Layer (`/write-agent-md sync`)

## Sintoma
Três arquivos do `apps/menubar` importam de `loopy/types`:

```ts
// apps/menubar/src/config/pipeline-edit.ts:1
import type { StepConfig, StepType } from "loopy/types";
// idem StepEditor.tsx:16 e pipeline-edit.test.ts:3
```

Mas o pacote **não exporta** esse subpath. O `exports` do `package.json` da raiz tem exatamente seis entradas: `.`, `./tui/store`, `./tui/view`, `./tui/transport`, `./config`, `./backlog` — e o `tsup.config.ts` não gera um bundle `types`.

## Causa raiz
Os subpaths `loopy/*` do app são resolvidos por **alias wildcard** (`^loopy/(.*)` → `../../src/$1`) em `vite.config.ts`, `vitest.config.ts` e `tsconfig.json`. O alias resolve **qualquer** caminho sob `src/`, exista ou não um export correspondente no pacote. Então `loopy/types` funciona localmente sem nunca ter sido adicionado ao contrato público.

O `exports` do `package.json` cresceu junto com o C-0014 (`./config`, `./backlog` entraram), mas `./types` ficou para trás.

## Impacto
**Hoje, nenhum em runtime** — e é por isso que a severidade é baixa: os três imports são `import type`, então o TypeScript os apaga na emissão e o bundle do app nunca tenta resolver `loopy/types` em tempo de execução. O app também não consome o pacote publicado (usa o alias para o fonte).

O que dói é o **contrato**: um consumidor externo de `@hgflima/loopy` que queira `StepConfig`/`StepType` (para escrever um pipeline programaticamente, ou outro front-end) não tem subpath para isso. E a armadilha é que o alias wildcard **esconde** a falta: nada no repo falha, então a divergência entre "o que o app importa" e "o que o pacote exporta" cresce em silêncio.

## Reprodução
1. `grep -rn 'from "loopy/types"' apps/menubar/src` → 3 hits.
2. `node -e "console.log(Object.keys(require('./package.json').exports))"` → não há `./types`.
3. Num projeto externo: `import type { StepConfig } from "@hgflima/loopy/types"` → *Cannot find module*.

## Correção proposta
Uma das duas, conforme a intenção:

- **Se os tipos de step são contrato público** (a leitura provável — o editor de config precisa deles, e outro consumidor também precisaria): adicionar `"types": "src/types.ts"` às entries do `tsup.config.ts` e `"./types"` ao `exports` do `package.json`. `src/types.ts` é declaration-only, então o bundle é só `.d.ts`.
- **Se não são**: trocar os três imports do app por um tipo local ou por um re-export a partir de `loopy/config`, e manter `types` privado.

Vale também um teste (ou lint) que assere que **todo `loopy/*` importado pelo app tem export correspondente na raiz** — é o que teria pego isto sozinho.

## Workaround atual
Nenhum necessário: funciona em dev, build e typecheck via alias.
