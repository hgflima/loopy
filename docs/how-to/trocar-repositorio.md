# Como trocar o repositório do loopy (releases e npm)

Este guia move o pipeline de release para outro repositório GitHub — um fork na
sua organização, ou o repositório oficial mudando de dono. Ao fim, o próximo
push na `main` **daquele** repositório gera o release lá, com o
`instructions_install.txt` apontando para ele.

Nada no pipeline tem o repositório escrito à mão: o `release.yml` usa
`${{ github.repository }}` e os scripts de `scripts/release/` recebem `--repo`.
O que não dá para derivar do contexto vem de **Variables** do GitHub Actions.
O porquê está na [ADR-0014](../adrs/0014-distribuicao-e-release-automatico.md).

## Pré-requisitos

- O código do loopy no repositório novo, com `.github/workflows/release.yml`,
  `.releaserc.json` e `scripts/release/`.
- Acesso de admin ao repositório novo (Settings).
- Para publicar no npm: uma conta npm com permissão de publicar o nome do
  pacote escolhido.

## 1. Apontar o `package.json` para o repositório novo

```bash
node scripts/release/set-repo.mjs <owner>/<repo>
```

Reescreve só `repository.url`, `bugs.url` e `homepage` do `package.json` da
raiz (preserva o resto do arquivo) e recusa qualquer coisa fora do formato
`owner/repo`. Commite com um tipo que **não** gera release (ex.:
`chore: aponta o package.json para <owner>/<repo>`).

O script **não** muda o nome do pacote npm, o `identifier` nem o `productName`
do app — esses ficam como estão.

## 2. Configurar as Variables do Actions

Em **Settings → Secrets and variables → Actions → Variables**:

| Variable              | Valor                            | Efeito                                                                                                                                                           |
| --------------------- | -------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `NPM_PUBLISH_ENABLED` | `true` para publicar             | Liga o `npm publish` do job `publish`. Qualquer outro valor (ou ausente) pula o npm com um aviso.                                                                |
| `NPM_PACKAGE_NAME`    | ex.: `@sua-org/loopy` (opcional) | Nome publicado no npm e usado no `npm i -g` do `instructions_install.txt`. Ausente = o `name` do `package.json`. O job aplica o nome só na hora (`npm pkg set`). |

Um fork normalmente **não** pode publicar o nome original (o escopo npm é de
outro dono): defina `NPM_PACKAGE_NAME` com um nome seu.

## 3. Registrar o Trusted Publisher no npm

O publish autentica por OIDC (Trusted Publishing), sem token. No npmjs.com,
nas **settings do pacote** → **Trusted Publisher** → **GitHub Actions**:

- **Organization or user:** `<owner>`
- **Repository:** `<repo>`
- **Workflow filename:** `release.yml` (só o nome do arquivo)
- **Environment name:** vazio (o workflow não usa environments)
- **Allowed actions:** permita o `npm publish` direto — é o que o job roda.

A configuração vive nas settings de um pacote **existente**: um nome novo
precisa ser criado no npm antes. Segundo a documentação do npm, o primeiro
publish pelo Trusted Publisher tem de acontecer em até 2 dias, ou a
configuração expira. A provenance é gerada só quando o repositório e o pacote
são públicos.

## 4. Permissões do Actions e proteção da `main`

- O `release.yml` declara as permissões **por job** (`contents: write`; o
  `publish` também `id-token: write`). Confira em **Settings → Actions →
  General** que o Actions está habilitado e que nenhuma política da organização
  restringe o `GITHUB_TOKEN` abaixo disso.
- O semantic-release **escreve na `main`**: o commit
  `chore(release): X.Y.Z [skip ci]` (versão em `package.json`,
  `package-lock.json`, `apps/menubar/package.json` e `CHANGELOG.md`) e a tag
  `vX.Y.Z`, com o `GITHUB_TOKEN`. Se a `main` tiver branch protection ou
  ruleset que barre esse push, o job `release` falha. **Ainda em aberto
  (Open Question 2 da C-0020):** dar bypass ao Actions, usar um App/token com
  bypass, ou abrir mão do commit de volta (versão só na tag).

## O que acontece sem npm configurado

Com `NPM_PUBLISH_ENABLED` diferente de `true`, o release **sai igual** — tag,
changelog, os três instaladores e o `instructions_install.txt` — e o job
`publish` só emite o aviso
`NPM_PUBLISH_ENABLED != 'true' — publish no npm pulado` antes de tornar o
release público. Nada falha. O `instructions_install.txt` ainda manda instalar a
CLI pelo npm, então quem seguir o release precisa de um pacote publicado com
aquele nome e versão.

## Verificação

- `grep -E 'repository|bugs|homepage' -A1 package.json` mostra o repositório
  novo.
- Push na `main` com pelo menos um `feat:`/`fix:`: o workflow `release` cria o
  draft, builda os três SOs, anexa o `instructions_install.txt` (com URLs de
  `https://github.com/<owner>/<repo>/releases/download/…`) e publica.
- Um push só com `docs:`/`chore:` não gera release (o job `release` termina
  com "Nenhum release nesta execução").

## Recuperar um release que parou no meio

O `release.yml` aceita `workflow_dispatch` com o input `tag` (ex.: `v0.7.0`):
pula o semantic-release e retoma build → instruções → publish sobre o release
já existente dessa tag. Útil quando um build de SO falhou e o draft ficou para
inspeção.
