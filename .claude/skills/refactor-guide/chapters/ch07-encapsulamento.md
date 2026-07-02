# Capítulo 7: Encapsulamento

## Core Idea
Encapsular = esconder detalhes internos do resto do mundo. Controlar quem vê e modifica dados (registros, coleções, primitivos) e quão acoplados ficam os módulos. O encapsulamento é o que dá liberdade para mudar a implementação depois.

## Refatorações deste capítulo
- **Encapsular registro (Encapsulate Record)**: troque registro/dado bruto público por classe com acessores — controla o acesso e permite evoluir a representação.
- **Encapsular coleção (Encapsulate Collection)**: nunca exponha a coleção interna direto; dê métodos add/remove e devolva cópia/visão somente-leitura.
- **Substituir primitivo por objeto (Replace Primitive with Object)**: um "número de telefone"/"moeda" merece tipo próprio, não string solta (cura de Primitive Obsession).
- **Substituir variável temporária por consulta (Replace Temp with Query)**: troque a temp por um método que recalcula — facilita extrações posteriores.
- **Extrair classe (Extract Class)**: uma classe fazendo demais → divida responsabilidades em duas.
- **Internalizar classe (Inline Class)**: inversa — classe ociosa some dentro de outra.
- **Ocultar delegação (Hide Delegate)**: cliente fala com um servidor, que delega; esconde a cadeia (cura de Message Chains).
- **Remover intermediário (Remove Middle Man)**: inversa — quando delegação demais vira só repasse, fale direto com o objeto real.
- **Substituir algoritmo (Substitute Algorithm)**: troque o corpo de um método por um algoritmo mais claro/simples.

## Mental Models
- **Hide Delegate ↔ Remove Middle Man**: equilíbrio. Encapsule até virar repasse excessivo; aí remova o intermediário. É um pêndulo, não regra fixa.
- Encapsular dado é **pré-condição** para mudar sua representação sem caçar todos os usos.
- `Replace Temp with Query` desbloqueia `Extract Function` em código com muitas temporárias.

## Code Examples
```javascript
// Encapsulate Collection: não devolva a lista interna nua
get courses() { return this._courses.slice(); }      // cópia defensiva
addCourse(c) { this._courses.push(c); }
removeCourse(c) { /* remove via método controlado */ }
```
- **What it demonstrates**: mutações da coleção passam por métodos da própria classe.

## Key Takeaways
1. **Encapsule registros e coleções** — nunca exponha estrutura interna crua.
2. **Replace Primitive with Object** cura obsessão por primitivos.
3. **Replace Temp with Query** prepara o terreno para extrair funções.
4. **Hide Delegate ↔ Remove Middle Man**: ajuste o nível de delegação conforme o caso.
5. **Extract Class ↔ Inline Class** rebalanceiam responsabilidades.

## Connects To
- **Ch3**: cura Classe grande, Cadeias de mensagens, Obsessão por primitivos, Intermediário.
- **Ch6**: Encapsulate Variable é a versão básica.
- **Ch9**: organização de dados relacionada.
