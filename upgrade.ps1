# ZippyMesh Router — Upgrade script (Windows)
# Usage: .\upgrade.ps1 [-ReleasePath <path-to-new-standalone>] [-SkipBackup]
# Run from the install directory (project root with .env and .next/standalone).

param(
    [string]$ReleasePath = "",
    [switch]$SkipBackup
)

$ErrorActionPreference = "Stop"
$InstallDir = $PSScriptRoot
$DataDir = if ($env:DATA_DIR) { $env:DATA_DIR } else { "$env:APPDATA\zippy-mesh" }
$BackupDir = "$InstallDir\.upgrade-backup-$(Get-Date -Format 'yyyyMMdd-HHmmss')"

function Write-Step { param($msg) Write-Host "`n==> $msg" -ForegroundColor Cyan }
function Write-Ok { param($msg) Write-Host "OK: $msg" -ForegroundColor Green }
function Write-Warn { param($msg) Write-Host "WARN: $msg" -ForegroundColor Yellow }

Set-Location $InstallDir

if (-not (Test-Path ".next\standalone\server.js")) {
    Write-Host "Not an install dir (no .next\standalone\server.js). Run from project root." -ForegroundColor Red
    exit 1
}

Write-Step "Stopping server (if running)"
Get-Process -Name node -ErrorAction SilentlyContinue | Where-Object {
    $_.Path -and (Get-Process -Id $_.Id -ErrorAction SilentlyContinue).Path -like "*node*"
} | ForEach-Object {
    $cmdLine = (Get-CimInstance Win32_Process -Filter "ProcessId=$($_.Id)").CommandLine
    if ($cmdLine -match "standalone\\server\.js") {
        Stop-Process -Id $_.Id -Force -ErrorAction SilentlyContinue
        Write-Ok "Stopped node PID $($_.Id)"
    }
}
Start-Sleep -Seconds 2

if (-not $SkipBackup) {
    Write-Step "Backing up .env and data"
    New-Item -ItemType Directory -Path $BackupDir -Force | Out-Null
    if (Test-Path ".env") { Copy-Item ".env" "$BackupDir\.env" -Force; Write-Ok ".env" }
    if (Test-Path $DataDir) {
        $dataBackup = "$BackupDir\data"
        New-Item -ItemType Directory -Path $dataBackup -Force | Out-Null
        Copy-Item "$DataDir\*" $dataBackup -Recurse -Force -ErrorAction SilentlyContinue
        Write-Ok "data"
    }
    Write-Ok "Backup at $BackupDir"
}

if ($ReleasePath -and (Test-Path $ReleasePath)) {
    Write-Step "Unpacking new release from $ReleasePath"
    $src = $ReleasePath
    if ([System.IO.Path]::GetExtension($ReleasePath) -eq ".zip") {
        Expand-Archive -Path $ReleasePath -DestinationPath "$InstallDir\.upgrade-tmp" -Force
        $first = Get-ChildItem "$InstallDir\.upgrade-tmp" | Select-Object -First 1
        $src = if ($first.PSIsContainer) { $first.FullName } else { "$InstallDir\.upgrade-tmp" }
    }
    @(".next", "package.json", "public") | ForEach-Object {
        if (Test-Path "$src\$_") {
            Copy-Item "$src\$_" $InstallDir -Recurse -Force
            Write-Ok $_
        }
    }
    if (Test-Path "$InstallDir\.upgrade-tmp") { Remove-Item "$InstallDir\.upgrade-tmp" -Recurse -Force }
    Write-Ok "Files updated"
} else {
    Write-Warn "No -ReleasePath provided. Run build locally: npm run build:next && npm run prepare-standalone"
}

Write-Step "Restarting server"
$env:PORT = "20128"
$env:HOSTNAME = "0.0.0.0"
Start-Process -FilePath "node" -ArgumentList ".next\standalone\server.js" -WorkingDirectory $InstallDir -NoNewWindow
Write-Ok "Server starting at http://localhost:20128"
