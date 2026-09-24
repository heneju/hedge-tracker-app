# Instalacao do Tracking numa maquina nova, em um comando.
#
# Ele instala o que faltar -- git e Python vem pelo winget -- clona o codigo
# e entrega para o install.ps1. Numa maquina limpa, o unico pre-requisito e
# o token de leitura do repo.
#
#   & ([scriptblock]::Create((irm https://heneju.github.io/hedge-tracker-app/bootstrap.ps1)))
#
# Ele pede o token e voce cola.
#
# Roda o texto direto, sem salvar arquivo: em PC limpo o Windows bloqueia
# script baixado -- ou pela ExecutionPolicy, ou pela marca de "veio da
# internet" -- e a instalacao morria antes de comecar, com uma mensagem que
# nao diz o que fazer.
#
# Este arquivo e publico de proposito -- ele nao contem segredo nenhum. O que da
# acesso ao codigo e o token, passado por quem instala, e ele so le UM repo.
#
# Depois de clonar, entrega para o install.ps1, que cuida de dependencias,
# credenciais e agendamento.

param(
    [string]$Token = "",
    [string]$Repo = "heneju/tracking-collector",
    [string]$Path = "$env:USERPROFILE\Desktop\tracker"
)

$ErrorActionPreference = "Stop"
function Step($n, $text) { Write-Host "`n[$n] $text" -ForegroundColor Cyan }

Write-Host "Tracking -- instalacao" -ForegroundColor Green

# O token e conferido ANTES de instalar qualquer coisa. Ele so e usado la na
# frente, no clone, e descobrir que estava errado depois de dois minutos
# instalando git e Python e o tipo de espera que nao ensina nada.
#
# E ele e PEDIDO, nao passado na linha de comando: digitar o prefixo e colar
# um token que ja tem prefixo virava "ghp_ghp_..." -- aconteceu tres vezes
# seguidas numa instalacao real. Pedindo, a pessoa so cola.
#
# Os dois formatos, com o tamanho de cada um -- so o prefixo nao basta:
#   fine-grained: github_pat_ + ~82 caracteres
#   classico:     ghp_ + 36 caracteres
$formato = "^(github_pat_[A-Za-z0-9_]{50,}|ghp_[A-Za-z0-9]{36})$"
$tentativas = 0
while ($Token.Trim().Trim('"') -notmatch $formato) {
    if ($Token) {
        Write-Host "    esse token nao tem o formato do GitHub -- cole o texto inteiro, sem digitar nada antes" -ForegroundColor Yellow
    }
    if ($tentativas -ge 3) {
        throw @"
Token invalido tres vezes.

Gere um em https://github.com/settings/personal-access-tokens/new
  . Repository access: Only select repositories -> $Repo
  . Permissions: Contents -> Read-only

Copie com o botao de copiar e cole inteiro, sem digitar nada antes dele.
"@
    }
    $Token = Read-Host "    cole o token do GitHub"
    $tentativas++
}
$Token = $Token.Trim().Trim('"')

# ------------------------------------------------------------- pre-requisitos
#
# Instalar git e Python a mao, em duas paginas diferentes, marcando "Add to
# PATH" na tela certa, era o passo que mais travava instalacao em maquina de
# terceiro. O winget ja vem no Windows 10 e 11 e faz os dois.
Step 1 "Conferindo git e Python"

function Atualiza-Path {
    # O winget mexe no PATH do sistema, mas esta sessao so enxerga o PATH de
    # quando ela abriu -- sem isto o proprio script nao acha o que acabou de
    # instalar.
    $env:Path = [Environment]::GetEnvironmentVariable("Path", "Machine") + ";" +
                [Environment]::GetEnvironmentVariable("Path", "User")
}

function Tem-Python {
    if (-not (Get-Command python -ErrorAction SilentlyContinue)) { return $false }
    # A Microsoft Store deixa um `python.exe` que so abre a loja: ele responde
    # ao comando, mas nao e Python. A saida denuncia, entao ela e que decide.
    # `cmd /c` para a mensagem de erro nao virar excecao do PowerShell.
    $saida = cmd /c "python --version 2>&1"
    if ("$saida" -notmatch "Python (\d+)\.(\d+)") { return $false }
    return ([version]"$($Matches[1]).$($Matches[2])" -ge [version]"3.10")
}

function Instala($nome, $pacote) {
    if (-not (Get-Command winget -ErrorAction SilentlyContinue)) {
        throw "$nome nao esta instalado, e esta maquina nao tem winget. Instale o 'App Installer' pela Microsoft Store e rode de novo, ou instale $nome a mao."
    }
    Write-Host "    instalando $nome -- o Windows pode pedir confirmacao"
    winget install --id $pacote --exact --source winget `
        --accept-package-agreements --accept-source-agreements
    if ($LASTEXITCODE -ne 0) {
        throw "A instalacao do $nome falhou (codigo $LASTEXITCODE). Se a janela do Windows pediu permissao e foi recusada, abra o PowerShell como administrador e rode de novo."
    }
    Atualiza-Path
}

if (-not (Get-Command git -ErrorAction SilentlyContinue)) { Instala "git" "Git.Git" }
if (-not (Tem-Python)) { Instala "Python" "Python.Python.3.12" }

if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
    throw "git continua fora do PATH. Feche esta janela, abra outra e rode de novo -- e o que falta depois de instalar."
}
if (-not (Tem-Python)) {
    throw "Python 3.10 ou mais novo continua fora do PATH. Feche esta janela, abra outra e rode de novo."
}
Write-Host "    ok"

# -------------------------------------------------------------------- codigo
Step 2 "Baixando o codigo"
# O token fica na URL do remoto para que o auto-update tambem funcione depois;
# sem isso o primeiro `git pull` pediria senha e o coletor ficaria parado.
$remote = "https://x-access-token:$Token@github.com/$Repo.git"

if (Test-Path "$Path\.git") {
    Write-Host "    ja existe em $Path -- atualizando"
    git -C $Path remote set-url origin $remote
    git -C $Path pull --ff-only --quiet
} else {
    New-Item -ItemType Directory -Force (Split-Path $Path) | Out-Null
    git clone --quiet $remote $Path
    if ($LASTEXITCODE -ne 0) {
        throw "Clone recusado. Confira o token -- ele precisa de leitura em '$Repo'."
    }
}
Write-Host "    codigo em $Path"

# ------------------------------------------------------------------ instalar
Step 3 "Entregando para o instalador"
# Num PC limpo a ExecutionPolicy e Restricted, e ela vale para ARQUIVO: o
# bootstrap passa por ela porque roda como texto, mas o install.ps1 esta em
# disco e seria recusado -- "running scripts is disabled on this system", com
# o codigo ja baixado e a instalacao pela metade.
#
# O processo filho nasce com Bypass, e os scripts que o instalador chama
# depois (install_task.ps1, build_addon.ps1) herdam a politica dele.
& powershell.exe -NoProfile -ExecutionPolicy Bypass -File "$Path\install.ps1"
if ($LASTEXITCODE -ne 0) {
    throw "O instalador terminou com erro (codigo $LASTEXITCODE). O codigo ja esta em $Path -- da para rodar de novo com:  powershell -NoProfile -ExecutionPolicy Bypass -File `"$Path\install.ps1`""
}
