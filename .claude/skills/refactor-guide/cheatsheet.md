# Cheatsheet — Refatoração (Fowler)

## Loop fundamental
**Compilo → testo → faço commit.** Passo minúsculo, suíte verde, commit. Vermelho? Reverta, não depure por horas.

## Os dois chapéus
| Chapéu | O que faço | Testes |
|--------|-----------|--------|
| Adicionar feature | escrevo comportamento novo | adiciono testes novos |
| Refatorar | só reestruturo | não mudo testes (salvo interface) |
Nunca os dois ao mesmo tempo.

## Quando refatorar
- **Regra dos Três** — 3ª vez que vê duplicação, refatore.
- **Preparatória** — logo antes de adicionar feature.
- **Para compreensão** — ao tentar entender código alheio.
- **Coleta de lixo / escoteiro** — deixe melhor do que achou.

## Diagnóstico: cheiro → cura (os mais comuns)
| Cheiro | Refatoração-chave |
|--------|-------------------|
| Função longa | Extract Function; Replace Temp with Query |
| Nome misterioso | Change Function Declaration; Rename Variable/Field |
| Código duplicado | Extract Function; Pull Up Method |
| Lista longa de parâmetros | Introduce Parameter Object; Preserve Whole Object |
| Dados globais/mutáveis | Encapsulate Variable; Split Variable |
| Switches repetidos | Replace Conditional with Polymorphism |
| Laços | Replace Loop with Pipeline |
| Inveja de recursos | Move Function |
| Cirurgia com rifle | Move Function/Field; Combine Functions into Class |
| Alteração divergente | Split Phase; Extract Class |
| Obsessão por primitivos | Replace Primitive with Object |
| Cadeias de mensagens | Hide Delegate |
| Classe grande | Extract Class |
| Comentários (desodorante) | Extract Function; Change Function Declaration |
| Herança recusada | Push Down Method/Field; Replace Subclass with Delegate |

## Pares inversos (escolha a direção pela necessidade)
- Extract Function ↔ Inline Function
- Extract Variable ↔ Inline Variable
- Extract Class ↔ Inline Class
- Hide Delegate ↔ Remove Middle Man
- Pull Up ↔ Push Down (Method/Field)
- Change Reference to Value ↔ Change Value to Reference
- Replace Parameter with Query ↔ Replace Query with Parameter
- Replace Function with Command ↔ Replace Command with Function
- Move Statements into Function ↔ to Callers

## Condicionais — escada de simplificação
1. **Decompose Conditional** — nomeie condição e ramos.
2. **Consolidate Conditional Expression** — junte checagens de mesmo resultado.
3. **Replace Nested Conditional with Guard Clauses** — saia cedo dos casos especiais.
4. **Replace Conditional with Polymorphism** — switch repetido por tipo → subclasses.
5. **Introduce Special Case (Null Object)** — valor especial repetido.

## Regras de ouro
- **Extract Function** nomeia a *intenção*, não a mecânica.
- **Sem testes confiáveis, não refatore** (salvo refatoração automatizada da IDE).
- **Encapsule** antes de mudar a representação de um dado.
- **Coloque junto o que muda junto**; **comportamento mora com os dados**.
- **Herança primeiro, delegação quando doer** (composição > herança, sem dogma).
- Comentário bom explica **por quê**, não **o quê**.
