# Capítulo 6: Primeiro conjunto de refatorações

## Core Idea
As refatorações mais usadas e fundamentais — o "pão com manteiga". Giram em torno de extrair/internalizar funções e variáveis, e dar bons nomes. Dominar estas resolve a maioria dos casos.

## Refatorações deste capítulo
- **Extrair função (Extract Function)**: transforme um fragmento em função nomeada pela *intenção*. A mais importante do livro.
- **Internalizar função (Inline Function)**: inversa — quando o corpo é tão claro quanto o nome, ou para reorganizar antes de re-extrair.
- **Extrair variável (Extract Variable)**: dê nome a uma subexpressão para explicá-la.
- **Internalizar variável (Inline Variable)**: inversa, quando a variável não agrega mais que a expressão.
- **Mudar declaração de função (Change Function Declaration)**: renomeie função ou altere parâmetros (também chamada de "renomear função" / "mudar assinatura").
- **Encapsular variável (Encapsulate Variable)**: ponha dados atrás de funções de acesso para controlar leitura/escrita. 1º passo contra dados globais/mutáveis.
- **Renomear variável (Rename Variable)**: nome melhor = código mais claro.
- **Introduzir objeto de parâmetros (Introduce Parameter Object)**: agrupe parâmetros que andam juntos num objeto.
- **Combinar funções em classe (Combine Functions into Class)**: funções que operam sobre os mesmos dados viram métodos de uma classe.
- **Combinar funções em transformação (Combine Functions into Transform)**: alternativa funcional — enriqueça os dados numa transformação que devolve novo registro.
- **Separar em fases (Split Phase)**: divida código que faz duas coisas (ex.: parsing depois cálculo) em fases com estrutura de dados clara entre elas.

## Mental Models
- Nomeie pela **intenção** (o quê), não pela mecânica (como). `amountFor(perf)` > `calc(perf)`.
- Extract/Inline são **reversíveis**: use Inline para juntar e reorganizar, depois Extract para reparticionar melhor.
- `Encapsulate Variable` é a porta de entrada para controlar **dados mutáveis/globais**.

## Code Examples
```javascript
// Extract Function: a função de topo vira narrativa
function printOwing(invoice) {
  printBanner();
  let outstanding = calculateOutstanding(invoice);
  printDetails(invoice, outstanding);   // intenção, não mecânica
}
```
- **What it demonstrates**: cada bloco extraído tem nome que revela o propósito.

## Key Takeaways
1. **Extract Function** é a refatoração nº 1 — nomeie a intenção.
2. Extract ↔ Inline são pares; use-os para reorganizar livremente.
3. **Change Function Declaration** conserta nomes e assinaturas ruins.
4. **Encapsulate Variable** antes de tentar domar dado global/mutável.
5. **Split Phase** quando uma função mistura duas etapas sequenciais.

## Connects To
- **Ch1**: este conjunto é o usado no primeiro exemplo.
- **Ch3**: curas para Função longa, Nome misterioso, Dados globais.
- **Ch7**: encapsulamento aprofundado.
