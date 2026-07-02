# Capítulo 10: Simplificando lógicas condicionais

## Core Idea
Condicionais complexas são um dos maiores focos de confusão. Decompor, consolidar, achatar com guard clauses e — o caso mais poderoso — substituir condicional por polimorfismo.

## Refatorações deste capítulo
- **Decompor condicional (Decompose Conditional)**: extraia condição, ramo-then e ramo-else em funções bem nomeadas. `if (isSummer()) charge = summerCharge()`.
- **Consolidar expressão condicional (Consolidate Conditional Expression)**: várias checagens que levam ao *mesmo* resultado viram uma só condição (com `||`/`&&`), depois extraída.
- **Substituir condicional aninhada por cláusulas de guarda (Replace Nested Conditional with Guard Clauses)**: trate casos especiais/saídas cedo no topo, achatando o aninhamento. "Saia rápido" para os casos excepcionais.
- **Substituir condicional por polimorfismo (Replace Conditional with Polymorphism)**: switch/if que varia por tipo → cada tipo vira uma subclasse que sobrescreve o método (cura de Switches repetidos). A refatoração-assinatura de OO.
- **Introduzir caso especial (Introduce Special Case / Null Object)**: repetidas checagens do mesmo valor especial (ex.: `if (customer === "unknown")`) → crie um objeto de caso especial com o comportamento default.
- **Introduzir asserção (Introduce Assertion)**: torne explícita uma suposição que o código assume como verdadeira.

## Mental Models
- **Guard clauses** sinalizam "isto é anormal, lide e saia"; o `if/else` simétrico sinaliza "ambos os ramos são normais". Use a forma que comunica a intenção.
- **Polimorfismo vs. condicional**: nem toda condicional deve virar polimorfismo. Use quando há *switch repetido* sobre o mesmo tipo em vários lugares.
- **Special Case (Null Object)** elimina a repetição de tratar o mesmo "valor faltante".

## Code Examples
```javascript
// Replace Conditional with Polymorphism
class Bird { get plumage() { return "normal"; } }
class NorwegianBlueParrot extends Bird {
  get plumage() { return this.voltage > 100 ? "scorched" : "beautiful"; }
}
```
- **What it demonstrates**: o ramo por tipo de pássaro vira override; o chamador some o `switch`.

## Key Takeaways
1. **Decompose Conditional**: dê nome à condição e aos ramos.
2. **Guard Clauses** achatam aninhamento tratando casos especiais cedo.
3. **Replace Conditional with Polymorphism** cura switches repetidos por tipo.
4. **Introduce Special Case** (Null Object) remove checagens repetidas do mesmo valor.
5. Use polimorfismo com critério — só quando o switch se repete.

## Connects To
- **Ch3**: cura Switches repetidos, Campo temporário.
- **Ch1**: a calculadora polimórfica final.
- **Ch12**: herança/subclasses que sustentam o polimorfismo.
