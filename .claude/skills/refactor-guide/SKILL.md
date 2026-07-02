---
name: refactor-guide
description: "Base de conhecimento do livro \"Refatoração: Aperfeiçoando o design de códigos existentes\" (2ª ed.) de Martin Fowler. Use ao aplicar as refatorações e princípios do Fowler — code smells, catálogo de refatorações (Extract Function, Replace Conditional with Polymorphism etc.), dois chapéus, testes — ao estudar o livro, ou ao referenciar seus conceitos."
allowed-tools:
  - Read
  - Grep
argument-hint: "[tópico, nome de refatoração (PT ou EN), cheiro, ou número do capítulo]"
---

# Refatoração: Aperfeiçoando o design de códigos existentes (2ª edição)
**Autor**: Martin Fowler (com Kent Beck) | **Páginas**: ~480 | **Capítulos**: 12 | **Gerado**: 2026-06-05

## Como usar esta skill

- **Sem argumentos** — carrega os frameworks centrais para referência.
- **Com um tópico** — pergunte sobre `feature envy`, `polimorfismo`, `dois chapéus`, `extract function`; eu acho e leio o capítulo relevante.
- **Com um cheiro** — descreva o sintoma ("função longa", "switch repetido") → indico a refatoração e a mecânica.
- **Com capítulo** — peça `ch10`; carrego aquele arquivo.
- **Navegar** — "que capítulos você tem?" mostra o índice.

Quando a pergunta sair do que está em Core abaixo, leio o arquivo de capítulo (ou `patterns.md`/`glossary.md`) antes de responder.

---

## Core Frameworks & Mental Models

**O que é refatoração (precisão importa).** *Substantivo*: modificação na estrutura interna para facilitar compreensão e baratear alteração, **sem mudar o comportamento observável**. *Verbo*: reestruturar aplicando uma série dessas modificações. Refatoração ≠ "qualquer limpeza" — é mudança estrutural em **passos pequenos**, cada um com a suíte verde. Se o código ficou quebrado por dias, não era refatoração.

**O loop: compilo-testo-faço commit.** Cada passo minúsculo → rode os testes → se verde, commit (ponto de retorno). Vermelho? Reverta, não depure por horas. Esse ritmo é o que torna a refatoração segura.

**Os dois chapéus (Kent Beck).** A qualquer momento você ou *adiciona funcionalidade* ou *refatora* — nunca os dois juntos. Adicionando feature: não mude estrutura existente, só acrescente + testes. Refatorando: não acrescente comportamento. Troque de chapéu conscientemente.

**Refatoração exige testes.** Código **autotestável** (testes automatizados que verificam o próprio resultado, rodados com frequência) é a rede de segurança e um detector de bugs que corta o tempo de depuração. Sem testes confiáveis (ou refatoração automatizada verificável da IDE), não refatore.

**Quando refatorar (oportunista, no fluxo).** **Regra dos Três** (3ª duplicação → refatore); **preparatória** (logo antes de adicionar feature — a melhor hora); **para compreensão** (passe o entendimento para o código); **coleta de lixo / regra do escoteiro** (deixe melhor do que achou). Não é fase separada do plano — é como escrever `if`. **Hipótese da Estamina no Design**: bom design interno faz você ir mais rápido por mais tempo. Casa com **Yagni** e CI.

**Diagnóstico por maus cheiros → cura por refatoração.** Não há métrica que supere o faro treinado. Os mais comuns:
- **Função longa** → Extract Function, Replace Temp with Query
- **Código duplicado** → Extract Function, Pull Up Method
- **Nome misterioso** → Change Function Declaration, Rename
- **Switches repetidos** → Replace Conditional with Polymorphism
- **Inveja de recursos** → Move Function (comportamento mora com os dados)
- **Lista longa de parâmetros** → Introduce Parameter Object, Preserve Whole Object
- **Dados globais/mutáveis** → Encapsulate Variable, Split Variable
- **Obsessão por primitivos** → Replace Primitive with Object
- **Comentário "explicando o quê"** → Extract Function (comentário é desodorante)

**As refatorações-assinatura.** *Extract Function* (a nº 1: nomeie a **intenção**, não a mecânica) e sua inversa *Inline*; *Replace Conditional with Polymorphism* (switch repetido por tipo → subclasses); *Split Phase* (separe etapas sequenciais); *Encapsulate Variable* (porta de entrada para domar dados); *Replace Subclass/Superclass with Delegate* (herança vira fardo → delegação). Quase toda refatoração tem **inversa** — escolha a direção pela necessidade atual.

**Princípios transversais.** Coloque junto o que **muda junto**. Comportamento **mora com os dados**. Uma variável, um propósito. **Command-Query Separation** (perguntar não muda nada). Herança primeiro, **delegação quando doer** (composição > herança, sem dogma). Comentário bom explica **por quê**, não **o quê**.

---

## Chapter Index

| # | Título | Frameworks-chave |
|---|--------|------------------|
| [ch01](chapters/ch01-primeiro-exemplo.md) | Refatoração: primeiro exemplo | compilo-testo-commit, Extract Function, Split Phase |
| [ch02](chapters/ch02-principios.md) | Princípios da refatoração | dois chapéus, Regra dos Três, Estamina no Design, Yagni |
| [ch03](chapters/ch03-maus-cheiros.md) | "Maus cheiros" no código | os 24 code smells → curas |
| [ch04](chapters/ch04-escrevendo-testes.md) | Escrevendo testes | código autotestável, TDD, boundary conditions |
| [ch05](chapters/ch05-apresentacao-catalogo.md) | Apresentação do catálogo | formato (Nome/Motivação/Mecânica), nomes canônicos |
| [ch06](chapters/ch06-primeiro-conjunto.md) | Primeiro conjunto | Extract/Inline Function, Change Declaration, Split Phase |
| [ch07](chapters/ch07-encapsulamento.md) | Encapsulamento | Encapsulate Record/Collection, Hide Delegate |
| [ch08](chapters/ch08-movendo-recursos.md) | Movendo recursos | Move Function/Field, Replace Loop with Pipeline |
| [ch09](chapters/ch09-organizando-dados.md) | Organizando dados | Split Variable, Reference ↔ Value |
| [ch10](chapters/ch10-logicas-condicionais.md) | Simplificando condicionais | Guard Clauses, Replace Conditional with Polymorphism |
| [ch11](chapters/ch11-refatorando-apis.md) | Refatorando APIs | Separate Query from Modifier, Remove Flag Argument |
| [ch12](chapters/ch12-lidando-com-heranca.md) | Lidando com herança | Pull Up/Push Down, Replace Subclass with Delegate |

## Topic Index

- **Catálogo completo (PT→EN)** → patterns.md
- **Code smells (24)** → ch03
- **Command-Query Separation** → ch11
- **Delegação vs. herança** → ch12
- **Dois chapéus** → ch02
- **Encapsulamento** → ch06, ch07
- **Extract Function** → ch06, ch01
- **Feature Envy / Inveja de recursos** → ch03, ch08
- **Guard clauses** → ch10
- **Mecânica do catálogo** → ch05
- **Mover função/campo** → ch08
- **Parâmetros (objeto/flag/whole object)** → ch06, ch11
- **Pipeline (substituir laço)** → ch08
- **Polimorfismo (substituir condicional)** → ch10, ch12
- **Princípios / quando refatorar** → ch02
- **Reference vs. Value** → ch09
- **Split Phase / Split Variable / Split Loop** → ch06, ch09, ch08
- **Testes / TDD / autotestável** → ch04
- **Yagni / Estamina no Design** → ch02

## Supporting Files

- [glossary.md](glossary.md) — termos centrais com definição e capítulo
- [patterns.md](patterns.md) — catálogo completo de refatorações (PT→EN), por capítulo
- [cheatsheet.md](cheatsheet.md) — loop, dois chapéus, cheiro→cura, pares inversos

---

## Scope & Limits

Cobre o conteúdo do livro (exemplos em JavaScript, edição Novatec 2019). Para aplicar no seu código, combine com a suíte de testes do projeto e as ferramentas de refatoração da IDE. Para tópicos além do livro, consulte outras skills ou pergunte direto.
