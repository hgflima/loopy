---
disable-model-invocation: true
description: Executa o loopy da change corrente — via herdr (se disponível), GUI instalada ou terminal do usuário
---

Execute o loop da change corrente. **Regra de ouro: o run vivo é do usuário** —
a TUI precisa de TTY real e o Gate de Aprovação do merge é interativo; rodar o
loopy dentro do seu Bash degrada a TUI e trava o gate. Seu papel é validar,
preparar e colocar o loop rodando **onde o usuário consegue interagir**.

## 1. Preflight rápido

- `loopy.yml` existe na raiz? Se não: oriente `/devy:loop-setup` e pare.
- `npx -y @hgflima/loopy@latest . --dry-run` passa? Se não: reporte o erro e
  ofereça corrigir (provavelmente re-invocando a skill `loopy`).
- Parent limpo (`git status`)? Se sujo: mostre o que está pendente de commit e
  pare — o motor exige `require_clean_parent`.

## 2. Escolher o veículo de execução (nesta ordem)

**a) Herdr** — se `test "${HERDR_ENV:-}" = 1` passar, invoque a skill `herdr`
e rode o loopy numa **tab nova da primeira workspace**:

- Descubra a primeira workspace com `herdr workspace list` (leia o id do
  JSON, não assuma `w1`).
- Crie a tab (`herdr tab` para descobrir a sintaxe atual), dê um nome útil
  (ex.: `loopy <change>`), e rode `npx -y @hgflima/loopy@latest .` no pane
  resultante com `herdr pane run`.
- Informe ao usuário onde o loop está rodando e que os Gates de Aprovação
  aparecem lá. Não fique bloqueado esperando o run terminar; ofereça
  `/devy:loop-status` para acompanhar.

**b) GUI menubar** — se o app estiver instalado (verifique
`/Applications/Loopy.app` e `~/Applications/Loopy.app`), ofereça abri-lo:
`open -a Loopy`. A GUI roda o motor como sidecar e tem Kanban, grafo e a aba
Insights; o usuário aponta o app para o diretório do projeto.

**c) Terminal do usuário** — fallback universal: sugira que o usuário rode no
prompt desta sessão:

```
! npx -y @hgflima/loopy@latest .
```

(o prefixo `!` executa no terminal da sessão, com TTY e saída visível aqui).

Se mais de um veículo estiver disponível, pergunte qual o usuário prefere
(AskUserQuestion, uma pergunta) em vez de decidir por ele.

## 3. Nunca

- Nunca rode o loop com `-y` (auto-aprova merges) sem pedido explícito.
- Nunca rode `npx @hgflima/loopy` em foreground no seu Bash — sem TTY o gate
  de merge bloqueia e a sessão congela.
