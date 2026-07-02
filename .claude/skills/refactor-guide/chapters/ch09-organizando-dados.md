# Capítulo 9: Organizando dados

## Core Idea
Dados mal estruturados são fonte de bugs sutis. Separar variáveis com papéis múltiplos, nomear campos e decidir entre referência e valor.

## Refatorações deste capítulo
- **Separar variável (Split Variable)**: uma variável que é atribuída mais de uma vez com *significados diferentes* deve virar duas (cura de Mutable Data). Variável = uma responsabilidade.
- **Renomear campo (Rename Field)**: nomes de campos de estruturas amplamente usadas importam tanto quanto nomes de classe.
- **Substituir variável derivada por consulta (Replace Derived Variable with Query)**: elimine dado mutável que pode ser *calculado* a partir de outro — remova a fonte de inconsistência.
- **Mudar referência para valor (Change Reference to Value)**: trate o objeto interno como **imutável**, substituindo-o inteiro em vez de mutar campos — mais seguro para objetos pequenos compartilhados.
- **Mudar valor para referência (Change Value to Reference)**: inversa — quando várias cópias deveriam ser a *mesma* entidade compartilhada (ex.: um único Customer), use uma referência com repositório.

## Mental Models
- **Uma variável, um propósito**: se você reusa a mesma variável para coisas diferentes, separe — clareza e segurança.
- **Value ↔ Reference** é decisão de *identidade*: o objeto representa um valor (intercambiável quando igual) ou uma entidade única (mudanças devem propagar)?
- Prefira **derivar (query)** a armazenar dado calculado — menos estado mutável para sincronizar.

## Code Examples
```javascript
// Split Variable: 'temp' tinha dois papéis
const perimeter = 2 * (height + width);
const area = height * width;
// antes: let temp = 2*(h+w); ... temp = h*w;  (mesma var, sentidos distintos)
```
- **What it demonstrates**: cada cálculo ganha sua própria variável imutável e bem nomeada.

## Key Takeaways
1. **Split Variable**: nunca reaproveite uma variável para significados diferentes.
2. **Replace Derived Variable with Query**: calcule em vez de guardar — mata estado mutável.
3. **Change Reference to Value** quando o objeto é pequeno e imutável.
4. **Change Value to Reference** quando deve haver uma única instância compartilhada.
5. Nomes de **campo** merecem o mesmo cuidado que nomes de função.

## Connects To
- **Ch3**: cura Dados mutáveis.
- **Ch7**: encapsulamento de dados.
- **Ch11**: APIs que expõem esses dados.
