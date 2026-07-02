# Catálogo de refatorações (nomes canônicos PT → EN)

Toda refatoração nomeada do livro, por capítulo. Formato: **PT (EN)** — quando usar. Muitas têm inversa (↔).

## Ch6 — Primeiro conjunto
- **Extrair função (Extract Function)** — fragmento com intenção própria vira função nomeada. ↔ Inline Function.
- **Internalizar função (Inline Function)** — corpo tão claro quanto o nome, ou reorganizar antes de re-extrair.
- **Extrair variável (Extract Variable)** — dar nome a subexpressão. ↔ Inline Variable.
- **Internalizar variável (Inline Variable)** — variável não agrega à expressão.
- **Mudar declaração de função (Change Function Declaration)** — renomear função / mudar parâmetros.
- **Encapsular variável (Encapsulate Variable)** — pôr dado atrás de acessores; 1º passo contra global/mutável.
- **Renomear variável (Rename Variable)** — nome melhor.
- **Introduzir objeto de parâmetros (Introduce Parameter Object)** — agrupar parâmetros que andam juntos.
- **Combinar funções em classe (Combine Functions into Class)** — funções sobre os mesmos dados viram classe.
- **Combinar funções em transformação (Combine Functions into Transform)** — enriquecer dados numa transformação (estilo funcional).
- **Separar em fases (Split Phase)** — dividir duas etapas sequenciais (ex.: parse → calcular).

## Ch7 — Encapsulamento
- **Encapsular registro (Encapsulate Record)** — dado bruto público → classe com acessores.
- **Encapsular coleção (Encapsulate Collection)** — métodos add/remove + cópia defensiva; nunca exponha a lista nua.
- **Substituir primitivo por objeto (Replace Primitive with Object)** — cura Obsessão por primitivos.
- **Substituir variável temporária por consulta (Replace Temp with Query)** — temp → método; habilita Extract Function.
- **Extrair classe (Extract Class)** — classe grande → duas. ↔ Inline Class.
- **Internalizar classe (Inline Class)** — classe ociosa some em outra.
- **Ocultar delegação (Hide Delegate)** — esconder cadeia de navegação. ↔ Remove Middle Man.
- **Remover intermediário (Remove Middle Man)** — delegação virou só repasse; fale com o objeto real.
- **Substituir algoritmo (Substitute Algorithm)** — trocar corpo por algoritmo mais claro.

## Ch8 — Movendo recursos
- **Mover função (Move Function)** — função vai para perto dos dados que usa. Cura Feature Envy.
- **Mover campo (Move Field)** — campo vai para a classe que mais o usa.
- **Mover instruções para uma função (Move Statements into Function)** — instruções que sempre acompanham a chamada. ↔ to Callers.
- **Mover instruções para os pontos de chamada (Move Statements to Callers)** — comportamento comum começou a divergir.
- **Substituir código internalizado por chamada de função (Replace Inline Code with Function Call)** — reusar função existente.
- **Deslocar instruções (Slide Statements)** — aproximar código relacionado antes de extrair.
- **Dividir laço (Split Loop)** — um laço, uma responsabilidade.
- **Substituir laço por pipeline (Replace Loop with Pipeline)** — map/filter/reduce; cura Loops.
- **Remover código morto (Remove Dead Code)** — apagar o não usado.

## Ch9 — Organizando dados
- **Separar variável (Split Variable)** — uma variável, um propósito.
- **Renomear campo (Rename Field)** — nomes de campos importam.
- **Substituir variável derivada por consulta (Replace Derived Variable with Query)** — calcular em vez de armazenar.
- **Mudar referência para valor (Change Reference to Value)** — objeto pequeno imutável. ↔ Value to Reference.
- **Mudar valor para referência (Change Value to Reference)** — entidade única compartilhada (repositório).

## Ch10 — Lógicas condicionais
- **Decompor condicional (Decompose Conditional)** — extrair condição e ramos em funções nomeadas.
- **Consolidar expressão condicional (Consolidate Conditional Expression)** — checagens com mesmo resultado viram uma.
- **Substituir condicional aninhada por cláusulas de guarda (Replace Nested Conditional with Guard Clauses)** — saída cedo p/ casos especiais.
- **Substituir condicional por polimorfismo (Replace Conditional with Polymorphism)** — switch por tipo → subclasses. Cura Switches repetidos.
- **Introduzir caso especial (Introduce Special Case / Null Object)** — encapsular valor especial repetido.
- **Introduzir asserção (Introduce Assertion)** — tornar suposição explícita.

## Ch11 — Refatorando APIs
- **Separar consulta de modificador (Separate Query from Modifier)** — Command-Query Separation.
- **Parametrizar função (Parameterize Function)** — funções quase iguais → uma com parâmetro.
- **Remover argumento de flag (Remove Flag Argument)** — funções explícitas no lugar de booleano opaco.
- **Preservar objeto inteiro (Preserve Whole Object)** — passe o objeto, não vários campos.
- **Substituir parâmetro por consulta (Replace Parameter with Query)** — função obtém o valor sozinha. ↔ Query with Parameter.
- **Substituir consulta por parâmetro (Replace Query with Parameter)** — remover dependência interna; mais testável/pura.
- **Remover método de escrita (Remove Setting Method)** — imutabilidade pós-criação.
- **Substituir construtor por função de factory (Replace Constructor with Factory Function)** — nome melhor, esconde classe concreta.
- **Substituir função por comando (Replace Function with Command)** — objeto-comando: estado intermediário, undo, decompor função grande. ↔ Command with Function.
- **Substituir comando por função (Replace Command with Function)** — comando simples demais.

## Ch12 — Herança
- **Subir método (Pull Up Method)** / **Subir campo (Pull Up Field)** / **Subir corpo do construtor (Pull Up Constructor Body)** — comum sobe. ↔ Push Down.
- **Descer método (Push Down Method)** / **Descer campo (Push Down Field)** — específico desce. Cura Refused Bequest.
- **Substituir código de tipos por subclasses (Replace Type Code with Subclasses)** — destrava polimorfismo.
- **Remover subclasse (Remove Subclass)** — subclasse ociosa → campo.
- **Extrair superclasse (Extract Superclass)** — comum entre duas classes sobe.
- **Condensar hierarquia (Collapse Hierarchy)** — super e sub muito parecidas se fundem.
- **Substituir subclasse por delegação (Replace Subclass with Delegate)** — herança rígida → delegado.
- **Substituir superclasse por delegação (Replace Superclass with Delegate)** — subclasse usa só parte / viola interface.
