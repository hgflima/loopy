# Capítulo 4: Escrevendo testes

## Core Idea
Refatoração exige testes. Uma suíte robusta e **autoverificável** é a rede que torna seguro mudar a estrutura — e, de quebra, é um detector de bugs que reduz drasticamente o tempo de depuração.

## Frameworks Introduced
- **Código autotestável (self-testing code)**: as classes contêm seus próprios testes; rodar testes deve ser tão fácil quanto compilar.
  - When to use: sempre; e *antes* de refatorar código legado sem testes.
  - How: automatize a verificação do resultado (assert), não a inspeção visual no console.
- **Ciclo TDD (testar-programar-refatorar)**: escreva um teste que falha → faça-o passar → refatore. Muitas vezes por hora.

## Key Concepts
- **Suíte como detector de bugs**: rodando com frequência, qualquer regressão aparece em minutos — o bug está no que você acabou de escrever.
- **Fixture**: estado montado para um conjunto de testes (`beforeEach`), reaproveitado entre casos.
- **Lógica de negócio isolada da UI**: teste o cálculo (lucro/déficit), não o HTML — separe para testar com facilidade.

## Mental Models
- "Garanta que os testes sejam **totalmente automatizados e verifiquem os próprios resultados**" — verde/vermelho, sem leitura manual.
- Escreva testes **antes** de programar: foca você na interface e te dá um critério claro de "pronto".
- Teste onde há **risco**, não getters triviais. Concentre-se nas fronteiras e nas condições que podem dar errado.

## Mecânica de um bom teste
1. Comece com um teste que exercita o caminho feliz da lógica de negócio.
2. Acrescente um teste por comportamento; rode a suíte inteira a cada mudança.
3. **Sonde os limites (boundary conditions)**: coleções vazias, zero, negativos, nulos, valores extremos.
4. Pense como adversário: "como esse código poderia falhar?" e escreva o teste que prova.

## Anti-patterns
- **Refatorar sem testes** confiáveis (a não ser com refatoração automatizada verificável).
- Testes que **dependem de inspeção visual** ou de saída no console.
- Buscar 100% de cobertura testando código trivial em vez de focar no risco.

## Key Takeaways
1. Não refatore sem rede: deixe o código **autotestável** primeiro.
2. Testes verificam **a si mesmos** — verde ou vermelho, nada de olho humano.
3. Rode os testes **com frequência** → bug recém-introduzido é trivial de achar.
4. **Escreva o teste antes** (ou ao menos antes de corrigir um bug — ver `/devy:test` Prove-It).
5. Sonde **boundary conditions**; é onde moram os bugs.

## Connects To
- **Ch2**: testes como pré-requisito do "dois chapéus".
- **Ch1**: a suíte que tornou o primeiro exemplo seguro.
