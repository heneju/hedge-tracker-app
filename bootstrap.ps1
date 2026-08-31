# Instalacao do Tracking numa maquina nova, em um comando.
#
#   $t = "github_pat_..."
#   irm https://heneju.github.io/hedge-tracker-app/bootstrap.ps1 -OutFile t.ps1; .\t.ps1 -Token $t
#
# Este arquivo e publico de proposito -- ele nao contem segredo nenhum. O que da
# acesso ao codigo e o token, passado por quem instala, e ele so le UM repo.
#
# Depois de clonar, entrega para o install.ps1, que cuida de dependencias,
# credenciais e agendamento.

param(
    [Parameter(Mandatory = $true)][string]$Token,
    [string]$Repo = "heneju/tracking-collector",
    [string]$Path = "$env:USERPROFILE\Desktop\tracker"
)

$ErrorActionPreference = "Stop"
function Step($n, $text) { Write-Host "`n[$n] $text" -ForegroundColor Cyan }

Write-Host "Tracking -- instalacao" -ForegroundColor Green

# ------------------------------------------------------------- pre-requisitos
Step 1 "Conferindo git e Python"
foreach ($tool in @("git", "python")) {
    if (-not (Get-Command $tool -ErrorAction SilentlyContinue)) {
        throw "'$tool' nao encontrado. Instale antes: git -> https://git-scm.com/download/win | python -> https://python.org/downloads"
    }
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
& "$Path\install.ps1"
