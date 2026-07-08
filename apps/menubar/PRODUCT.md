# Product

## Register

product

## Users

Desenvolvedores que rodam **loopy** — o motor de loop agêntico config-driven — sobre seus repositórios. loopy é publicado no npm (`@hgflima/loopy`) e este app menubar é parte do produto shipável: outros devs instalam e usam, não é ferramenta interna.

O contexto de uso é distinto: o dev **dispara um run** e depois **observa loops agênticos rodando sozinhos** por minutos ou horas — um agente de código implementa tasks, verifica, simplifica, audita e pede aprovação humana no merge. O trabalho do usuário durante o run é majoritariamente *vigília*: acompanhar o progresso pelo canto do olho a partir da tray, entrar quando um gate de aprovação aparece, e intervir se algo desanda. O app vive na barra de menu do macOS (accessory app), com um popover compacto para a olhada rápida e uma janela completa para o dashboard (Kanban, grafo de dependências, streams do agente).

O job-to-be-done: **saber, a qualquer instante e sem esforço, o que o loop está fazendo, se precisa de mim, e poder intervir com confiança** — sem precisar voltar ao terminal.

## Product Purpose

Substituir a TUI Ink do loopy por uma UI nativa de macOS que torna um processo autônomo e de longa duração **legível e governável** a partir da barra de menu. Sucesso é o dev conseguir deixar um run rodando, tocar outro trabalho, e confiar que:

1. o estado do run é sempre claro num relance (badge na tray, popover);
2. quando o motor precisa de uma decisão humana (Gate de Aprovação no merge), isso o alcança de forma inequívoca (notificação + janela ao fronte);
3. o que o agente está fazendo agora é observável em detalhe quando ele quer olhar (streams, Kanban Backlog→Steps→Fim, grafo de deps);
4. ele pode intervir — aprovar, parar, inspecionar — sem atrito.

A UI **serve** essa vigília. Ela some quando não é necessária e aparece com precisão quando é.

## Brand Personality

**Vivo, transparente, sob controle.** Observabilidade *é* a personalidade.

- **Vivo** — o app mostra o trabalho acontecendo de forma honesta e legível: o Kanban se move, os streams fluem, o grafo pulsa no fix-loop. Não é uma tela estática de status; é uma janela para um processo em andamento. Mas "vivo" nunca vira ruído: cada movimento carrega significado de estado.
- **Transparente** — nada de mágica escondida. O dev vê a Tentativa atual, o Step corrente, o Verdict da auditoria, o porquê de uma falha. Confiança vem de poder ver tudo, não de ser poupado dos detalhes.
- **Sob controle** — o usuário sempre sente que manda. Gates de aprovação são inequívocos; parar um run é imediato; nada acontece de irreversível sem ele. Serenidade sob automação.

Voz: precisa, técnica, sem cerimônia nem fofura. Fala a língua ubíqua do loopy (Run, Task, Step, Tentativa, Gate, Verdict) porque o público é fluente nela. Feel de infraestrutura madura que se orgulha de ser confiável, não de ser chamativa.

## Anti-references

- **Mímica de terminal.** O ponto de partida (fundo índigo-hacker `#0f0f23`, monospace em tudo, magenta/cyan de esquema de cor de terminal, glyphs ASCII decorativos) é explicitamente o que abandonar. loopy nasceu de uma TUI, mas o app menubar é um app **nativo de macOS** — deve parecer Raycast/Linear/Things, não um TUI com uma janela em volta.
- **Dashboard "AI SaaS".** Nada de grid infinito de cards idênticos, hero-metric gigante com gradiente, glassmorphism decorativo, eyebrows minúsculas em toda seção. O slop genérico de dashboard.
- **Devtool sobrecarregado.** Densidade caótica estilo Grafana/Datadog — 20 painéis competindo, cor sem semântica, tudo gritando ao mesmo tempo. Transparência é legibilidade, não sobrecarga: mostrar tudo *organizado*, não tudo *ao mesmo tempo*.
- **Brinquedo excessivamente animado.** Sem motion decorativo, confetes, transições coreografadas longas ou personalidade "fofa". O app é infraestrutura de trabalho. Motion existe só para comunicar mudança de estado.

## Design Principles

1. **A UI serve a vigília, não a si mesma.** Some quando não é necessária (popover mínimo, tray discreta); aparece com precisão quando o motor precisa do humano. O melhor estado do app na maior parte do tempo é *quieto e legível de relance*.
2. **Movimento carrega significado.** Tudo que se anima comunica uma transição de estado real (task avançou de coluna, agente emitiu um chunk, fix-loop pulsou). Nunca movimento por decoração — isso trai as anti-refs "vivo demais" e "AI slop" de uma vez.
3. **Legível de relance, aprofundável sob demanda.** Três altitudes de leitura: tray (um badge), popover (uma linha: done/total · running · ⚠), dashboard (Kanban + grafo + streams). Cada uma completa em si; o detalhe está a um clique, não empurrado na cara.
4. **O gate humano é inequívoco.** Quando o motor pede aprovação, isso é o momento mais importante da UI — precisa alcançar o dev (notificação + janela ao fronte) e apresentar a decisão sem ambiguidade. Nunca deixar um gate se perder no ruído.
5. **Falar a língua ubíqua, sem tradução.** Termos do domínio (Task, Step, Tentativa, Gate, Verdict, Worktree) são o vocabulário do público — usá-los com precisão é respeito, não jargão. A UI é uma janela fiel ao modelo do motor.
6. **Vocabulário nativo consistente.** Mesmos controles, mesmos estados (default/hover/focus/active/disabled/loading/error), mesma iconografia em todas as telas. Familiaridade macOS é uma feature: a ferramenta desaparece na tarefa.

## Accessibility & Inclusion

- **Segue a aparência do sistema:** temas claro e escuro completos, alternando com o macOS. O dark **não** é o índigo-terminal atual — é um dark neutro nativo. O light tem feel Things/Linear-claro.
- **WCAG 2.1 AA de contraste** em ambos os temas: corpo ≥4.5:1, texto grande ≥3:1. Atenção especial à cor semântica (running/done/blocked/failed/approval) — nunca depender só de cor: pareá-la com glyph, rótulo ou posição para daltonismo.
- **`prefers-reduced-motion` honrado** em toda animação de estado (pulso do fix-loop, transições de coluna do Kanban, streams): alternativa por crossfade ou transição instantânea.
- **Navegação por teclado** para as ações-chave, sobretudo o Gate de Aprovação (aprovar/rejeitar sem mouse) — coerente com um público que vive no teclado.
- Foco visível e semântica de foco nativa; respeitar tamanho de fonte do sistema onde viável.
