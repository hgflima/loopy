# Capítulo 3: "Maus cheiros" no código (Code Smells)

## Core Idea
Por Kent Beck e Martin Fowler. Nenhuma métrica supera a intuição humana bem treinada. Em vez de critérios exatos, o capítulo dá **24 "cheiros"** — sinais de que talvez seja hora de refatorar — e, para cada um, as refatorações que costumam curá-lo.

## Frameworks Introduced
Os 24 maus cheiros e suas curas típicas (use como tabela de diagnóstico → tratamento):

- **Nome misterioso (Mysterious Name)** → Change Function Declaration, Rename Variable, Rename Field
- **Código duplicado (Duplicated Code)** → Extract Function, Slide Statements, Pull Up Method
- **Função longa (Long Function)** → Extract Function, Replace Temp with Query, Introduce Parameter Object, Decompose Conditional, Split Loop
- **Lista longa de parâmetros (Long Parameter List)** → Replace Parameter with Query, Preserve Whole Object, Introduce Parameter Object, Remove Flag Argument, Combine Functions into Class
- **Dados globais (Global Data)** → Encapsulate Variable
- **Dados mutáveis (Mutable Data)** → Encapsulate Variable, Split Variable, Slide Statements, Separate Query from Modifier, Remove Setting Method, Replace Derived Variable with Query, Change Reference to Value
- **Alteração divergente (Divergent Change)** → Split Phase, Move Function, Extract Function, Extract Class
- **Cirurgia com rifle (Shotgun Surgery)** → Move Function, Move Field, Combine Functions into Class/Transform, Inline Function/Class
- **Inveja de recursos (Feature Envy)** → Move Function, Extract Function
- **Agrupamentos de dados (Data Clumps)** → Extract Class, Introduce Parameter Object, Preserve Whole Object
- **Obsessão por primitivos (Primitive Obsession)** → Replace Primitive with Object, Replace Type Code with Subclasses, Extract Class
- **Switches repetidos (Repeated Switches)** → Replace Conditional with Polymorphism
- **Laços (Loops)** → Replace Loop with Pipeline
- **Elemento ocioso (Lazy Element)** → Inline Function, Inline Class, Collapse Hierarchy
- **Generalidade especulativa (Speculative Generality)** → Collapse Hierarchy, Inline Function/Class, Change Function Declaration, Remove Dead Code
- **Campo temporário (Temporary Field)** → Extract Class, Move Function, Introduce Special Case
- **Cadeias de mensagens (Message Chains)** → Hide Delegate, Extract Function + Move Function
- **Intermediário (Middle Man)** → Remove Middle Man, Inline Function, Replace Superclass/Subclass with Delegate
- **Trocas escusas (Insider Trading)** → Move Function, Move Field, Hide Delegate, Replace Sub/Superclass with Delegate
- **Classe grande (Large Class)** → Extract Class, Extract Superclass, Replace Type Code with Subclasses
- **Classes alternativas com interfaces diferentes (Alternative Classes w/ Different Interfaces)** → Change Function Declaration, Move Function, Extract Superclass
- **Classe de dados (Data Class)** → Encapsulate Record, Remove Setting Method, Move Function, Extract Function
- **Herança recusada (Refused Bequest)** → Push Down Method/Field, Replace Sub/Superclass with Delegate
- **Comentários (Comments)** → Extract Function, Change Function Declaration, Introduce Assertion

## Mental Models
- Comentários costumam ser **desodorante**: cheiro de que o código é ruim. Refatore primeiro; o comentário vira supérfluo.
- "Coloque junto aquilo que **muda junto**" — base de Divergent Change vs. Shotgun Surgery (opostos).
- Não há limite exato de linhas/campos; desenvolva o **faro**.

## Key Takeaways
1. Diagnostique pelo cheiro, trate pela refatoração indicada.
2. **Divergent Change** (um módulo muda por N razões) vs. **Shotgun Surgery** (uma mudança espalha por N módulos) são espelhos.
3. Comentário "explicando o quê" → `Extract Function` com bom nome.
4. Comentário válido: explicar **por quê**, ou marcar incerteza.

## Connects To
- **Ch2**: o "quando" da refatoração.
- **Ch6–12**: cada cura está no catálogo.
