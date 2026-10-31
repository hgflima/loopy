# Como instalar o loopy a partir de um release

Este guia instala as duas peças do `loopy` numa máquina, **na mesma versão**:

- o **app de desktop** (a GUI `Loopy`, que vive no tray/menubar), baixado do
  GitHub Release;
- a **CLI** `loopy`, que vem do npm.

E termina com `loopy open .` abrindo a GUI no projeto da pasta atual.

> **Prefere delegar a um agente?** Cada release traz um
> `instructions_install.txt`: um prompt autocontido, já com a versão e as URLs
> **daquele** release, que um agente de código lê e executa passo a passo
> (verificando cada um). Baixe-o da página do release e entregue ao agente.

## Onde ficam os releases

Na página de releases do repositório do loopy:

```
https://github.com/<owner>/<repo>/releases
```

`<owner>/<repo>` é o repositório de onde você recebeu o loopy (o mesmo que
aparece no `repository` do `package.json`). Este guia não fixa um owner de
propósito — o repositório pode mudar
(veja [Trocar o repositório](trocar-repositorio.md)). Use o release **mais
recente** (`Latest`).

Cada release tem:

| Asset                          | Plataforma                                       |
| ------------------------------ | ------------------------------------------------ |
| `Loopy_<versão>_amd64.deb`     | Linux x86_64 — Debian/Ubuntu e derivadas         |
| `Loopy_<versão>_aarch64.dmg`   | macOS Apple Silicon (arm64) — **experimental**   |
| `Loopy_<versão>_x64-setup.exe` | Windows x64 (instalador NSIS) — **experimental** |
| `instructions_install.txt`     | O prompt de instalação para um agente            |

> **Linux só com `.deb`.** Não há AppImage nesta versão (adiado — ver
> [plataformas](plataformas.md#bundles-por-plataforma-bundletargets)). Distros
> sem `dpkg`/`apt` ainda não têm instalador pronto.

> **macOS e Windows são experimentais.** Os instaladores são gerados a cada
> release, mas não passam por teste funcional; no Windows, iniciar um Run ainda
> não funciona (o mapa do que falta está em [plataformas](plataformas.md)).

## Pré-requisitos

- **Node.js ≥ 22.13** e `npm` (a CLI é um pacote npm, e os agentes ACP rodam
  via `npx`): `node --version`.
- Um **agente de código** instalado e logado (ex.: Claude Code, para o preset
  `claude`) — sem ele o app abre, mas nenhum Run anda.

## 1. Instalar o app

### Linux (Debian/Ubuntu e derivadas)

```bash
sudo apt install ./Loopy_<versão>_amd64.deb
```

Confira:

```bash
dpkg -s loopy | grep -E '^(Status|Version):'   # install ok installed / <versão>
command -v loopy-menubar                        # /usr/bin/loopy-menubar
```

O `.deb` cria a entrada **Loopy** no menu de aplicativos. No Linux a janela
principal abre ao iniciar; o ícone do tray pode não aparecer no GNOME sem a
extensão AppIndicator — o app funciona igual pela janela.

### macOS (experimental)

Abra o `.dmg` e arraste o **Loopy** para **Aplicativos**.

O app **não é assinado nem notarizado**, então o Gatekeeper avisa
"desenvolvedor não identificado" e bloqueia a abertura. Contorne **só para este
app** — nunca desligue o Gatekeeper do sistema (`spctl --master-disable`):

```bash
xattr -dr com.apple.quarantine /Applications/Loopy.app
```

(Alternativa pela interface: tente abrir o app uma vez e, em **Ajustes do
Sistema → Privacidade e Segurança**, clique em **Abrir Mesmo Assim** para o
Loopy.)

### Windows (experimental)

Rode o `Loopy_<versão>_x64-setup.exe`. Ele instala **por usuário**, sem pedir
administrador.

O instalador **não é assinado**, então o SmartScreen mostra "O Windows protegeu
o computador". Contorne **só para este arquivo**: **Mais informações** →
**Executar assim mesmo**. Não desative o SmartScreen nem o Defender.

## 2. Instalar a CLI (mesma versão do app)

```bash
npm i -g <pacote>@<versão>
loopy --version          # deve imprimir exatamente <versão>
```

`<pacote>` é o nome do pacote npm do loopy — o `name` do `package.json` do
repositório (num fork pode ser outro; o `instructions_install.txt` do release
já traz o nome certo).

Se `loopy` não for encontrado, o diretório global do npm não está no `PATH`:
rode `npm prefix -g` e acrescente `<prefixo>/bin` (Linux/macOS) ou o próprio
`<prefixo>` (Windows) ao `PATH`.

> **Linux:** o `.deb` também instala `/usr/bin/loopy` — é o motor embutido que
> a GUI usa como sidecar, não a CLI do npm. Se `command -v loopy` responder
> `/usr/bin/loopy`, ponha o bin global do npm **antes** de `/usr/bin` no `PATH`.

## 3. Abrir um projeto na GUI

```bash
cd ~/meu-projeto
loopy open .
```

A GUI abre (ou, se já estiver aberta, é focada) com essa pasta como projeto.
Abrir **nunca** inicia um Run sozinho; para isso existe `--run`. Flags e a
ordem de busca do app estão na [referência da CLI](../reference/cli.md#open).

Se der erro dizendo que o app não foi encontrado, a mensagem lista cada lugar
onde procurou. Confira o passo 1 ou aponte o executável à mão:

```bash
LOOPY_APP=/caminho/do/executavel loopy open .
```

## Verificação

- `loopy --version` imprime a versão do release.
- `loopy open --help` mostra o uso `loopy open [dir]` e sai com 0.
- `loopy open .` abre a janela do Loopy com a pasta atual.

## Relacionados

- [Rodar no Linux e no Windows](plataformas.md) — status por SO e o mapa de
  portabilidade.
- [Trocar o repositório](trocar-repositorio.md) — mover releases e publicação
  para outro `owner/repo`.
- [Configurar um projeto-alvo](configurar-projeto-alvo.md) — o próximo passo
  depois de instalar.
