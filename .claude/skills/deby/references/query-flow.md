# Fluxo de query — `query-flow.md`

Carregue para qualquer `/deby:query <pedido>`. É o entrypoint mais usado da skill.

## Cinco passos

1. **Entender se é SQL ou descrição**
   - Se começa com `select|with|insert|update|delete|alter|drop|create|truncate|explain|show|grant|revoke|copy|vacuum|reindex` (case-insensitive), trate como **SQL cru** — vá direto ao passo 4.
   - Caso contrário, é **descrição em pt-BR** — vá ao passo 2.

2. **Discovery do schema** (só se for descrição)
   - Se a descrição menciona uma tabela nominalmente (ex.: "últimas registrations"), invoque o equivalente de `/deby:describe <tabela>` para conhecer colunas antes de escrever o SQL.
   - Se você não sabe nem qual tabela, invoque `/deby:tables` primeiro.
   - Não chute nomes de coluna. Se uma coluna razoável não existir no `describe`, escolha a mais próxima e diga: "assumi que `created_at` é o campo de criação — confirma?".
   - **Fonte da verdade é o banco.** Se o pedido é sobre o que está *persistido* / "na base" (estado runtime, valores gravados, histórico), responda consultando o banco vivo — **não** leia código do backend/aplicação para isso. O código explica a *intenção*; só o banco confirma o que foi de fato armazenado.
   - **Não assuma `public`.** Tabelas relevantes — sobretudo de auditoria/log/evento/histórico — podem viver em outros schemas. Antes de fixar uma tabela, rode `/deby:tables` (lista todos os schemas não-sistêmicos); o default `public` do `/deby:describe` é conveniência, não premissa.

3. **Escrever o SQL**
   - Use `LIMIT 10` por padrão pra preview, a menos que o usuário tenha dito explicitamente quantos quer.
   - Prefira `ORDER BY <chave_temporal> DESC` para "últimas N".
   - Quando agregar, dê alias claro (`count(*) AS total`).
   - Evite `SELECT *` quando souber as colunas relevantes — escolha 4-6 colunas que respondem ao pedido.

4. **Classificar e confirmar**
   ```bash
   echo "$SQL" | bash .claude/skills/deby/scripts/danger-check.sh
   ```
   - Mostre o SQL em bloco ```sql.
   - Aplique o fluxo de `references/safety.md` conforme a classe.

5. **Executar**
   ```bash
   bash .claude/skills/deby/scripts/exec-sql.sh "$profile" -- "$SQL"
   ```
   - O profile usado é o `current` (a menos que o usuário tenha pedido outro explicitamente).
   - Saída do script: markdown table no stdout + `(N linhas — CSV completo em …)`.
   - **SEMPRE exiba essa markdown table na resposta**, integralmente (as até 50 linhas renderizadas), como tabela. Nunca a substitua por prosa, omita ou resuma — o insight curto (abaixo) vem DEPOIS da tabela, não no lugar dela.

## Pós-execução: insight curto

Após o resultado, adicione **um parágrafo** com observação relevante baseada no que apareceu:

- Distribuição enviesada? ("4 das 5 estão em `pending`")
- Valores `NULL` em coluna obrigatória aparente? ("3 linhas têm `email` nulo — pode ser bug do step de cadastro")
- Janela temporal estreita? ("todas criadas em 12 minutos hoje à tarde — pico de tráfego ou job?")
- Sem padrão óbvio? Diga isso: "sem padrão óbvio no resultado".

Não invente. Se quiser confirmar uma hipótese, **sugira** a próxima query, não execute por conta própria.

## Exemplos

### Exemplo 1 — descrição simples

```
Usuário: /deby:query mostra as últimas 5 registrations

Eu:
1. (discovery) /deby:describe registrations → vejo colunas id, cpf, status, created_at
2. Escrevo:
   ```sql
   SELECT id, cpf, status, created_at
   FROM registrations
   ORDER BY created_at DESC
   LIMIT 5;
   ```
3. Classifico: safe
4. "Posso rodar contra o profile local-docker? (y/N)"
5. (com y) executo → mostro tabela + insight.
```

### Exemplo 2 — SQL cru destrutivo

```
Usuário: /deby:query DELETE FROM registrations

Eu:
1. SQL cru, pulo discovery.
2. Classifico: destructive (DELETE sem WHERE).
3. Mostro:
   ```sql
   DELETE FROM registrations
   ```
   ⚠️ Destrutivo. Banco: onboarding. Tabela: registrations.
   Digite exato: `onboarding.registrations`
4. Espero pelo type-to-confirm.
5. Só executo se bater exatamente.
```

### Exemplo 3 — descrição ambígua

```
Usuário: /deby:query quantos users tem hoje

Eu:
1. (discovery) /deby:tables users → não existe.
2. /deby:tables → vejo só `registrations`.
3. Pergunto: "não vi tabela `users`. Você quer count de `registrations` criadas hoje?"
4. Com a resposta, sigo o fluxo normal.
```

## Múltiplos profiles

Se o usuário quiser rodar em outro profile sem trocar o current:

```bash
bash .claude/skills/deby/scripts/exec-sql.sh <other-profile> -- "<SQL>"
```

Você pode oferecer isso quando ele disser "no rds-dev" ou similar.
