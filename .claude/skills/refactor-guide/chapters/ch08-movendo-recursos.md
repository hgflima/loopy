# Capítulo 8: Movendo recursos

## Core Idea
Decidir *onde* o código deve morar. Mover funções, campos e instruções para o módulo certo — junto dos dados que usam — e reorganizar laços e código morto.

## Refatorações deste capítulo
- **Mover função (Move Function)**: leve a função para o módulo/classe com os dados que ela mais usa (cura de Feature Envy).
- **Mover campo (Move Field)**: o dado pertence à classe que mais o usa/altera.
- **Mover instruções para uma função (Move Statements into Function)**: instruções que sempre acompanham uma chamada entram na função.
- **Mover instruções para os pontos de chamada (Move Statements to Callers)**: inversa — quando o comportamento comum começa a divergir entre chamadores.
- **Substituir código internalizado por chamada de função (Replace Inline Code with Function Call)**: troque código que reimplementa algo por chamada à função existente (ex.: usar `includes` em vez de laço manual).
- **Deslocar instruções (Slide Statements)**: aproxime declarações de onde são usadas; agrupa código relacionado antes de extrair.
- **Dividir laço (Split Loop)**: um laço que faz duas coisas vira dois laços (cada um com uma responsabilidade) — habilita extração mesmo ao custo de iterar duas vezes.
- **Substituir laço por pipeline (Replace Loop with Pipeline)**: troque o laço por operações encadeadas (map/filter/reduce) — revela o fluxo dos dados (cura de Loops).
- **Remover código morto (Remove Dead Code)**: apague o que não é usado; o histórico do versionamento guarda se precisar.

## Mental Models
- "Coloque o comportamento **junto dos dados** que ele referencia." É o princípio por trás de Move Function/Field.
- **Split Loop** parece ineficiente (itera 2×), mas clareza vem primeiro; otimize só se medir necessidade.
- **Remove Dead Code** é higiene barata e de alto valor — não deixe "por via das dúvidas".

## Code Examples
```javascript
// Replace Loop with Pipeline
const names = input
  .filter(p => p.office === "London")
  .map(p => p.name);
```
- **What it demonstrates**: o pipeline mostra de relance o que entra, o filtro e o resultado — melhor que um `for` acumulando.

## Key Takeaways
1. **Move Function/Field**: comportamento mora com os dados.
2. **Slide Statements** agrupa o relacionado e prepara extrações.
3. **Split Loop** separa responsabilidades antes de extrair cada uma.
4. **Replace Loop with Pipeline** torna o fluxo de dados legível.
5. **Remove Dead Code** sempre que sobrar — sem medo, o git lembra.

## Connects To
- **Ch3**: cura Inveja de recursos, Cirurgia com rifle, Laços, Generalidade especulativa.
- **Ch6**: usa Extract Function como passo preparatório.
