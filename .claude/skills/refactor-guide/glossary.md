# Glossário — Refatoração (Fowler, 2ª ed.)

Termos centrais com definição e capítulo. Refatorações nomeadas estão em `patterns.md`.

**Alteração divergente (Divergent Change)** — um módulo é alterado por razões diferentes em momentos diferentes; sinal para separar contextos (Ch3).

**Asserção (Assertion)** — afirmação que o código assume verdadeira em um ponto; documenta suposições (Ch10).

**Cadeias de mensagens (Message Chains)** — `a.getB().getC().getD()`; acopla o cliente à estrutura de navegação (Ch3).

**Cirurgia com rifle (Shotgun Surgery)** — uma única mudança exige editar muitos módulos; oposto de Alteração divergente (Ch3).

**Código autotestável (self-testing code)** — código que carrega testes automatizados que verificam o próprio resultado (Ch4).

**Comportamento observável** — o que o usuário percebe; deve permanecer inalterado numa refatoração (interfaces internas e performance podem mudar) (Ch2).

**Command-Query Separation** — funções ou consultam (retornam, sem efeito) ou modificam (efeito, sem retorno), nunca os dois (Ch11).

**Dados globais (Global Data)** — estado acessível/mutável de qualquer ponto; fonte de bugs por ação à distância (Ch3).

**Dois chapéus (Two Hats)** — metáfora de Kent Beck: ou se adiciona funcionalidade, ou se refatora; nunca ao mesmo tempo (Ch2).

**Esboço (sketch)** — o antes→depois rápido no topo de cada refatoração do catálogo (Ch5).

**Fixture** — estado montado para testes, reutilizado entre casos (Ch4).

**Guard clause (cláusula de guarda)** — checagem que trata caso especial e sai cedo, achatando aninhamentos (Ch10).

**Hipótese da Estamina no Design (Design Stamina Hypothesis)** — bom design interno aumenta a velocidade sustentável de desenvolvimento ao longo do tempo (Ch2).

**Internalizar (Inline)** — operação inversa de extrair: trazer o corpo de volta ao ponto de uso (Ch6–7).

**Inveja de recursos (Feature Envy)** — função que usa mais dados de outro módulo que do próprio; mova-a para perto dos dados (Ch3).

**Maus cheiros (Code Smells)** — sintomas estruturais que sugerem refatoração; 24 catalogados no Ch3.

**Mecânica (mechanics)** — passos mínimos e ordenados para aplicar uma refatoração sem quebrar o código (Ch5).

**Null Object / Caso especial (Special Case)** — objeto que encapsula o comportamento default de um valor faltante/especial, eliminando checagens repetidas (Ch10).

**Obsessão por primitivos (Primitive Obsession)** — usar tipos primitivos (string/number) onde um tipo de domínio caberia melhor (Ch3).

**Polimorfismo** — despachar comportamento por tipo via subclasses sobrescrevendo métodos, no lugar de switch/if repetidos (Ch10, Ch12).

**Refatoração (substantivo)** — modificação na estrutura interna para facilitar compreensão e baratear alteração, sem mudar o comportamento observável (Ch2).

**Refatorar (verbo)** — reestruturar aplicando uma série de refatorações, sem alterar o comportamento observável (Ch2).

**Refatoração oportunista** — feita no fluxo do trabalho: preparatória, para compreensão, para coleta de lixo, regra do escoteiro (Ch2).

**Refatoração preparatória (preparatory refactoring)** — refatorar logo antes de adicionar uma feature, para facilitá-la (Ch2).

**Regra dos Três (Rule of Three)** — refatore na terceira vez que vir a duplicação (Ch2).

**Reestruturação** — termo guarda-chuva para reorganizar código; refatoração é um tipo disciplinado dela (Ch2).

**Referência vs. Valor** — objeto-referência tem identidade única (mudanças propagam); objeto-valor é intercambiável quando igual e tratado como imutável (Ch9).

**Separar em fases (Split Phase)** — dividir código que faz duas etapas sequenciais em fases distintas com estrutura de dados clara entre elas (Ch6).

**TDD (Test-Driven Development)** — ciclo testar(falha)-programar-refatorar, muitas vezes por hora (Ch4).

**Trocas escusas (Insider Trading)** — módulos que trocam dados demais, aumentando acoplamento (Ch3).

**Yagni (You Aren't Gonna Need It)** — não adicione generalidade especulativa; refatoração viabiliza adiar decisões (Ch2).
