# Capítulo 1: Refatoração — primeiro exemplo

## Core Idea
Refatoração se aprende vendo, não definindo. Fowler pega um programa pequeno e feio (cálculo de fatura de uma companhia teatral) e o transforma em passos minúsculos e seguros, sempre com testes verdes entre cada passo.

## Frameworks Introduced
- **Compilo-testo-faço commit (compile-test-commit)**: depois de cada passo pequeno de refatoração, rode os testes e faça commit. Cada commit é um ponto de retorno seguro.
  - When to use: a cada extração/renomeação/movimentação individual.
  - How: mude uma coisa → rode a suíte → se verde, commit; se vermelho, reverta (não depure por horas).
- **Refatorar antes de adicionar funcionalidade**: quando o código não está estruturado de modo conveniente para a mudança, primeiro refatore para facilitar, depois adicione.

## Key Concepts
- **statement / renderPlainText**: a função monolítica que mistura cálculo e formatação — alvo da refatoração.
- **Separação cálculo × formatação**: o eixo central do exemplo — separar a fase que calcula da fase que renderiza.
- **Calculadora polimórfica**: o destino final — `Replace Conditional with Polymorphism` substitui o `switch` por tipo de peça.

## Mental Models
- Pense na refatoração como **uma série de pequenos passos seguros**, não um grande rewrite. Se o código ficou quebrado por dias, não era refatoração.
- Antes de mexer, garanta **testes robustos e autoverificáveis** — eles são a rede de segurança.
- Quando uma função fica difícil de entender, **extraia** até que cada peça revele sua intenção pelo nome.

## Code Examples
```javascript
function statement(invoice, plays) {
  let result = `Fatura para ${invoice.customer}\n`;
  for (let perf of invoice.performances) {
    result += `  ${playFor(perf).name}: ${usd(amountFor(perf))} (${perf.audience} lugares)\n`;
  }
  return result;
}
```
- **What it demonstrates**: após `Extract Function` (amountFor, playFor) e `Replace Temp with Query`, a função de topo vira uma narrativa legível; o cálculo migra para funções nomeadas e depois para uma classe calculadora polimórfica.

## Key Takeaways
1. Antes de refatorar, **monte uma suíte de testes** em que você confie.
2. Refatore em **passos minúsculos**; rode os testes a cada passo.
3. `Extract Function` é o cavalo de batalha: nomeie a intenção, não a mecânica.
4. **Separe fases** (cálculo vs. formatação) para abrir caminho a polimorfismo.
5. Bom código é aquele em que a estrutura **grita o que faz** — extraia até chegar lá.

## Connects To
- **Ch4**: a suíte de testes que torna tudo isso seguro.
- **Ch6**: Extract Function, Extract Variable, Split Phase usados aqui.
- **Ch10**: Replace Conditional with Polymorphism (a calculadora final).
