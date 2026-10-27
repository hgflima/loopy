# Implementation Plan: C-0020 — Distribuição multiplataforma

> Escrito em 2026-10-23 (`/devy:plan`) a partir de `spec.md` (mesma pasta).
> As tasks vivem em `todo.md`; aqui só a forma do trabalho. D1–D4 e E1–E11 da
> spec **não são re-litigados**.

## Overview

Três trilhas independentes que convergem num release:

1. **Pipeline de release** — `ci.yml` (gate de PR), semantic-release (versão a
   partir dos conventional commits), `release.yml` (draft → build em 3 SOs →
   `instructions_install.txt` → npm + publicar), tudo agnóstico ao owner (E11).
2. **GUI empacotável em 3 SOs** — o mínimo para compilar no Windows (W7/W8),
   `bundle.targets` por plataforma, instância única e argv de launch (E2/E3).
3. **`loopy open`** — subcomando que acha a GUI instalada (E1) e a lança no
   projeto com as flags (E2), sem tocar em `loopy [dir]` (D1).

A linha de base (portabilidade já feita na sessão da spec, não commitada) entra
como T-001 e é pré-requisito de quase tudo.

## Architecture Decisions

Decisões do **plano** (as de produto estão na spec):

- **`bundle.targets` em arquivos por plataforma** (`tauri.linux.conf.json`,
  `tauri.macos.conf.json`, `tauri.windows.conf.json`), que o Tauri v2 mescla
  sobre o `tauri.conf.json`. Evita lógica de matriz no workflow e mantém o
  `tauri.conf.json` (e o `version` path-ref que o teste de single-source guarda)
  intocado.
- **Argv inicial da GUI é *pull*, não *push*.** O Rust guarda o `LaunchArgs`
  inicial num `State`; o webview o busca por um comando (`take_launch_args`)
  quando monta. Só a **segunda** instância (E3) chega por evento
  (`launch-args`). Motivo: um `emit` no `setup` corre antes do listener do
  webview existir e se perderia em silêncio.
- **Lógica pura dos scripts de release em `.mjs` + `.d.mts`.** Os scripts rodam
  com `node` puro no CI (Node 22 não executa `.ts`), e o `tsconfig` (strict,
  `include: [src, tests]`, sem `allowJs`) recusaria importar `.mjs` sem tipos
  nos testes. Cada script exporta sua função pura e só executa o CLI quando é o
  entrypoint (`import.meta.url === pathToFileURL(process.argv[1]).href`).
- **Draft encontrado por id, não por tag.** A API `GET /releases/tags/{tag}`
  não enxerga drafts; o job `release` exporta o `id` do draft (listando
  `/releases` e filtrando por `tag_name`) como output, e `build`/`instructions`/
  `publish` o consomem (o `tauri-action` aceita `releaseId`).
- **Builds fazem checkout da tag**, não do `github.sha`: o commit
  `chore(release)` do semantic-release é o que tem a versão nova nos
  `package.json`, e o bundle lê a versão de lá.
- **npm publish é opt-in por Variable** (`NPM_PUBLISH_ENABLED == 'true'`).
  Consequência de E11 ("repo novo sem npm → pula com aviso"): no repo atual a
  Variable precisa ser criada antes do primeiro release real (ask-first).
- **ADR = 0014** (a `0013` já existe: stream semântico, C-0019). A spec diz
  0013 por engano.

## Dependency Graph

```
T-001 linha de base ─┬─ T-002 ci.yml ──────────────────────────┐
                     ├─ T-003 W7/W8 ── T-004 bundle.targets ───┤
                     ├─ T-005 semantic-release (spike) ────────┤
                     │                                          ├─ T-008 release.yml ─┐
T-006 instructions (puro) ──────────────────────────────────────┤                     │
T-007 set-repo (puro) ──────────────────────────────────────────┘                     │
                                                                                       │
T-009 resolveApp ── T-010 `loopy open` ───────────────────────────────────────────────┤
T-001 ── T-011 launch_args.rs ── T-012 single-instance ── T-013 GUI aplica argv ──────┤
                                                                                       └─ T-014 docs + ADR
```

Arestas que existem **só para serializar merge** (mesmo arquivo), não por lógica:
`T-003→T-001` e `T-004→T-003` (`docs/how-to/plataformas.md`), `T-011→T-001`
(`main.rs`), `T-014→*` (docs do código final).

Largura máxima: a primeira camada após T-001 tem T-002, T-003, T-005, T-006,
T-007, T-009, T-011 — até 7 em paralelo (`auto` → teto 4).

## Phases

### Fase 1 — Linha de base e gate de CI — T-001, T-002
Commita o trabalho de portabilidade e liga o `ci.yml`, que passa a validar
todo PR seguinte (inclusive `actionlint` do `release.yml` que virá).
**Checkpoint:** `npm run typecheck && npm run lint && npm test && npm test -w apps/menubar`
e `cargo test` verdes local; `actionlint` limpo; `version-single-source` verde.

### Fase 2 — Release: fundações de alto risco primeiro — T-005, T-006, T-007, T-003, T-004
T-005 é o **spike** do semantic-release: prova, com `--dry-run`, que a versão é
calculada e que o `prepare` sincroniza as duas `package.json` — antes de o
`release.yml` (T-008) apostar nisso. T-006/T-007 são puros e paralelos.
T-003/T-004 deixam a GUI compilável e empacotável por SO.
**Checkpoint:** `npx semantic-release --dry-run --no-ci` imprime a próxima
versão esperada (`0.6.1` só com os `fix:` atuais); `npm run menubar` no Linux
gera `.AppImage` e `.deb`; testes de `render-instructions`/`set-repo` verdes.

### Fase 3 — O workflow de release — T-008
Junta tudo num `release.yml`. **Não há como provar end-to-end sem push na
`main`** — por isso é o último da trilha e depende de todos os insumos.
**Checkpoint (humano, ask-first):** `actionlint` limpo; revisão do YAML;
decidir Open Questions 1–2; configurar Variables e o Trusted Publisher; **só
então** autorizar o primeiro push que publica de verdade.

### Fase 4 — `loopy open` e a GUI que o recebe — T-009, T-010, T-011, T-012, T-013
Independente da Fase 2–3 (pode rodar em paralelo). Duas pontas puras e testadas
(T-009 no TS, T-011 no Rust) e as costuras de I/O em cima.
**Checkpoint (smoke manual Linux, critério 6/7 da spec):**
1. `npm run menubar`; `LOOPY_APP=<AppImage> loopy open ~/liber/onboarding-loopy` abre o board populado.
2. Com o app aberto, `loopy open <outro>` **foca** a janela e troca de projeto (sem segunda janela); com `loopy.yml` sujo, aparece o dirty guard.
3. `loopy open <dir> --run` inicia o Run só depois do yml carregar; sem `--run`, nunca inicia.
4. Sem GUI instalada (`LOOPY_APP` inexistente, sem instalação), `loopy open .` sai ≠ 0 listando onde procurou.
5. `loopy .` (sem `open`) continua rodando o loop.

### Fase 5 — Documentação e fechamento — T-014
**Checkpoint final:** todos os critérios de sucesso verificáveis localmente
cobertos; guarda de portabilidade (`grep hgflima/loopy`) limpa; pronto para o
primeiro release real (decisão humana).

## Risks and Mitigations

| Risco | Impacto | Mitigação |
|-------|---------|-----------|
| `release.yml` só é testável de verdade no push da `main`, que publica no npm | Alto | `actionlint` no CI (T-002); spike de semantic-release em dry-run (T-005); `NPM_PUBLISH_ENABLED` desligado por default — o primeiro release pode sair sem npm; primeiro push é ask-first |
| Branch protection impede o commit `chore(release)` | Alto | Open Question 2; T-008 isola o commit-back no plugin `@semantic-release/git` — trocável por "versão só na tag" sem refazer o resto |
| Draft invisível à API por tag → jobs de build não acham o release | Médio | Decisão "draft por id" acima; T-008 exporta o id como output |
| Argv inicial perdido por corrida webview × `emit` | Médio (silencioso) | Modelo pull (`take_launch_args`) — T-012/T-013 |
| `tauri-plugin-single-instance` no Linux depende de D-Bus | Médio | Smoke manual da Fase 4; sem D-Bus a segunda instância abre outra janela (degradação, não quebra) |
| Builds de macOS/Windows compilam mas não rodam um Run | Aceito (spec) | Template marca as plataformas como **experimentais** (T-006) |
| AppImage exige `libfuse2` | Baixo | Template checa e instala (T-006) |
| `ci.yml` precisa das libs de sistema do Tauri para `cargo test` | Baixo | Lista do `apt` já documentada em `plataformas.md` §2; T-002 reusa |

## Open Questions

Herdadas da spec — nenhuma bloqueia a implementação, todas bloqueiam o
**primeiro release real**:

1. **Owner do repo (D4)** — define Trusted Publisher, `NPM_PACKAGE_NAME`, `NPM_PUBLISH_ENABLED`.
2. **Branch protection na `main`** — commit-back do release com `GITHUB_TOKEN` ou com App/token com bypass.
3. **Primeira versão** — com os `feat:` desta change, `0.7.0`. Confirmar que não se espera `1.0.0`.
4. **`loopy open` sem dir** — o plano assume a proposta da spec: **sem dir = só abre/foca o app, sem trocar de projeto** (T-010/T-011/T-013). Se a resposta for "abre o cwd", muda uma linha em T-010.
