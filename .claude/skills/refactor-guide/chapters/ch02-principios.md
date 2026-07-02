# Capítulo 2: Princípios da refatoração

## Core Idea
Define refatoração com precisão e responde às perguntas estratégicas: o que é, por que, quando, e quando *não*. Refatoração ≠ "qualquer limpeza" — é mudar a estrutura interna preservando o comportamento observável, via passos pequenos.

## Frameworks Introduced
- **Refatoração (substantivo)**: modificação na estrutura interna do software para deixá-lo mais fácil de entender e mais barato de alterar, **sem mudar o comportamento observável**.
- **Refatorar (verbo)**: reestruturar aplicando uma série de refatorações, sem alterar o comportamento observável.
- **Dois chapéus (Kent Beck)**: a qualquer momento você está *adicionando funcionalidade* OU *refatorando* — nunca os dois juntos. Troque de chapéu conscientemente.
  - When to use: sempre que programa. Se ao adicionar feature percebe que a estrutura atrapalha, troque para o chapéu de refatorar.
- **Regra dos Três (Don Roberts)**: 1ª vez você faz; 2ª vez torce o nariz mas duplica; 3ª vez você refatora.

## Key Concepts
- **Comportamento observável**: o que o usuário percebe deve continuar igual; interfaces internas e performance *podem* mudar.
- **Reestruturação**: termo guarda-chuva; refatoração é um tipo disciplinado de reestruturação.
- **Yagni**: refatoração + entrega incremental tornam viável *não* projetar tudo adiantado.

## Mental Models
- **Hipótese da Estamina no Design (Design Stamina Hypothesis)**: investir em design interno bom aumenta a "estamina" — você avança mais rápido por mais tempo. Sem isso, a velocidade despenca.
- Quatro tipos de refatoração **oportunista**: preparatória (antes de adicionar feature), para compreensão (entender código alheio), para coleta de lixo (limpar o que entendeu mal feito), e a regra do escoteiro (deixe melhor do que achou).
- Refatoração **não é tarefa separada** no plano — acontece o tempo todo, como escrever `if`.

## Anti-patterns
- **Refatorar e código quebrado por dias**: então não era refatoração.
- **Reservar "semanas de refatoração"** desconexas da entrega: prefira oportunista e contínua (com exceções planejadas raras).
- **Refatorar sem testes** quando não há ferramenta automatizada confiável.

## Key Takeaways
1. A melhor hora de refatorar é **logo antes de adicionar uma funcionalidade** (preparatória).
2. Refatore **para entender** código alheio — passe a compreensão para o próprio código.
3. Refatoração e arquitetura: ela viabiliza design evolutivo + **Yagni**.
4. Separe **refatoração de otimização de performance** — propósitos distintos.
5. Cuidado com branches longas: refatoração casa melhor com **integração contínua / CI**.

## Connects To
- **Ch3**: "quando" detalhado via maus cheiros.
- **Ch4**: por que testes são pré-requisito.
- **Ch1**: os princípios em ação.
