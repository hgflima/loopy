# D-0010 — `fast mode` (`category: model_config`) revelado pela sondagem mas não exposto no yml

> **Status:** aberto · **Severidade:** baixa · **Área:** `src/acp/capabilities.ts` · `src/config/schema.ts` · `src/types.ts`
> **Descoberto em:** 2026-07-14 · **Origem:** C-0016 (spikes de capabilities nos 3 adapters)

## Sintoma

A sondagem (`configOptions`) revela um toggle `fast mode` nos três adapters
(Claude: `id: fast`; Codex: `id: fast-mode`; OpenCode: ausente), na categoria
`model_config`. O `parseCapabilities` intencionalmente **ignora** essa categoria
(D35 do spec C-0016). O motor não tem campo no schema, no registry nem no step
para ativá-lo — o operador não consegue pedir "fast mode" via `loopy.yml`.

## Causa raiz

Decisão consciente de escopo (D35): expor `fast mode` no yml exigiria campo novo
no schema (`fast?: boolean`), no `StepBase` ou no `AgentDef`, na validação de
capabilities e na GUI. Trabalho suficiente para uma feature própria, fora do
escopo da C-0016 (que já entregou capabilities para mode/model/effort).

## Impacto

Baixo. O operador pode contornar configurando o agente externamente (flag do
adapter, env, ou configuração do vendor). Não há perda silenciosa de dado:
o campo simplesmente não existe — não é que o motor o rejeita.

## Reprodução

```bash
npx tsx spikes/acp-claude-capabilities.ts | jq '.configOptions[] | select(.category == "model_config")'
# → { id: "fast", displayName: "Fast", ... }
```

O campo não é representável no `loopy.yml`.

## Correção proposta

Adicionar `fast?: boolean` (ou string, para acomodar ids por adapter) ao
`StepBase` ou ao `AgentDef`, validar por `configOptions[category="model_config"]`
e expor na GUI como toggle por step ou por agente.

## Workaround atual

Configurar o fast mode externamente ao motor (ex.: env do adapter, se suportado).
