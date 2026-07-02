# Capítulo 5: Apresentação do catálogo

## Core Idea
Define o **formato padrão** de cada refatoração no catálogo (caps 6–12) e como navegá-lo. Cada refatoração é uma receita testada, com nome, motivação e mecânica passo a passo.

## Frameworks Introduced
- **Formato de uma refatoração** — cada entrada do catálogo tem:
  1. **Nome**: vocabulário comum (PT + nome canônico em inglês). O nome importa — é como conversamos sobre design.
  2. **Esboço (sketch)**: um antes→depois rápido para reconhecimento visual.
  3. **Motivação**: por que (e quando) fazer; também quando *não* fazer.
  4. **Mecânica**: passos mínimos e seguros, em ordem, para aplicar sem quebrar.
  5. **Exemplos**: código real (JavaScript) demonstrando.

## Key Concepts
- **Nomes canônicos**: preserve "Extract Function", "Replace Conditional with Polymorphism" etc. — são o vocabulário compartilhado. Não troque por paráfrases.
- **Refatorações antagônicas**: a maioria tem inversa (Extract ↔ Inline, Pull Up ↔ Push Down, Change Reference to Value ↔ Change Value to Reference). Escolha a direção pela necessidade atual.
- **Mecânica conservadora**: os passos parecem pequenos demais de propósito — o objetivo é nunca deixar o código quebrado por mais de alguns segundos.

## Mental Models
- O catálogo é uma **referência de consulta**, não leitura linear: identifique o cheiro (Ch3), ache a refatoração, siga a mecânica.
- A mecânica é especialmente valiosa em **código complexo ou desconhecido** — quando você não confia em fazer o passo de cabeça.
- Refatorações maiores são **composições** de menores.

## Key Takeaways
1. Cada refatoração = Nome + Esboço + Motivação + **Mecânica** + Exemplos.
2. Use o **nome canônico**; é o vocabulário de design da equipe.
3. Siga a **mecânica passo a passo** quando o código for arriscado — confie no processo, não na memória.
4. Toda refatoração tem trade-offs; a **Motivação** diz quando *não* aplicar.

## Connects To
- **Ch3**: o índice cheiro → refatoração.
- **Ch6–12**: o catálogo em si.
- **patterns.md**: lista completa indexada por capítulo.
