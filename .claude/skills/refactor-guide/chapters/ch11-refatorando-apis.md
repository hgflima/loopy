# Capítulo 11: Refatorando APIs

## Core Idea
APIs são as junções entre módulos; boas APIs separam claramente o que faz (modificadores) do que pergunta (consultas), e escondem o que é detalhe. Este capítulo refina assinaturas e contratos.

## Refatorações deste capítulo
- **Separar consulta de modificador (Separate Query from Modifier)**: uma função não deve, ao mesmo tempo, retornar valor *e* causar efeito colateral observável. Separe em duas (princípio Command-Query Separation).
- **Parametrizar função (Parameterize Function)**: funções quase iguais que diferem por valores literais → uma função com parâmetro.
- **Remover argumento de flag (Remove Flag Argument)**: `setDimension(true)` é opaco; crie funções explícitas (`setHeight`/`setWidth`) em vez de flag booleana.
- **Preservar objeto inteiro (Preserve Whole Object)**: em vez de extrair vários campos e passá-los, passe o objeto inteiro (reduz lista de parâmetros).
- **Substituir parâmetro por consulta (Replace Parameter with Query)**: se a função pode obter o valor por conta própria, remova o parâmetro.
- **Substituir consulta por parâmetro (Replace Query with Parameter)**: inversa — quando quer remover uma dependência interna (ex.: referência global) e tornar a função mais pura/testável.
- **Remover método de escrita (Remove Setting Method)**: campos que não devem mudar após a criação perdem o setter (imutabilidade).
- **Substituir construtor por função de factory (Replace Constructor with Factory Function)**: factory dá nome melhor, esconde a classe concreta e permite variar o retorno.
- **Substituir função por comando (Replace Function with Command)**: uma função complexa vira objeto-comando — útil quando precisa de estado intermediário, undo, ou decompor uma função grande.
- **Substituir comando por função (Replace Command with Function)**: inversa — quando o comando é simples demais para justificar a classe.

## Mental Models
- **Command-Query Separation**: perguntar não deve mudar nada; quem só lê pode chamar à vontade.
- **Flag argument** esconde a intenção no call site — prefira funções explícitas.
- **Replace Query with Parameter ↔ Replace Parameter with Query**: move a fronteira de responsabilidade entre quem chama e a função; escolha pela testabilidade/acoplamento.

## Code Examples
```javascript
// Remove Flag Argument: explícito > booleano opaco
book.premiumConcert(customer);     // em vez de book(customer, true)
book.regularConcert(customer);
```
- **What it demonstrates**: o nome no call site revela a intenção; sem decifrar `true`.

## Key Takeaways
1. **Separate Query from Modifier**: nunca misture retorno com efeito colateral.
2. **Remove Flag Argument**: funções explícitas no lugar de booleanos opacos.
3. **Preserve Whole Object** encurta listas de parâmetros.
4. **Replace Function with Command** quando precisa de estado/undo/decomposição.
5. **Factory Function** dá nomes e esconde classes concretas.

## Connects To
- **Ch3**: cura Lista longa de parâmetros, Dados mutáveis.
- **Ch6**: Change Function Declaration é a base.
- **Ch8**: Move Statements relacionado.
