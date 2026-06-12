# =============================================================================
# ZippyMesh LLM Router — Windows Upgrade Script
# Usage: .\upgrade.ps1 -Zip "C:\Downloads\zippymesh-router-v0.3.2-alpha.zip"
# =============================================================================
param(
    [Parameter(Mandatory=$true)]
    [string]$Zip
)

$ErrorActionPreference = "Stop"

function Write-Info    { param($msg) Write-Host "[upgrade] $msg" -ForegroundColor Cyan }
function Write-Success { param($msg) Write-Host "[upgrade] $msg" -ForegroundColor Green }
function Write-Warn    { param($msg) Write-Host "[upgrade] $msg" -ForegroundColor Yellow }
function Write-Fail    { param($msg) Write-Host "[upgrade] ERROR: $msg" -ForegroundColor Red; exit 1 }

# ── Validate zip ──────────────────────────────────────────────────────────────
if (-not (Test-Path $Zip)) { Write-Fail "File not found: $Zip" }
$Zip = Resolve-Path $Zip
$NewVersion = [regex]::Match([System.IO.Path]::GetFileNameWithoutExtension($Zip), 'v[\d\.\-a-z]+$').Value

# ── Detect install directory ──────────────────────────────────────────────────
$InstallDir = $env:ZIPPYMESH_INSTALL_DIR

if (-not $InstallDir) {
    # Try to find from NSSM or sc service
    $svcPath = (sc.exe qc "ZippyMesh" 2>$null | Select-String "BINARY_PATH_NAME") -replace '.*BINARY_PATH_NAME\s+:\s+',''
    if ($svcPath) { $InstallDir = Split-Path $svcPath -Parent }
}

if (-not $InstallDir) {
    # Try common locations
    foreach ($d in @("$env:LOCALAPPDATA\ZippyMesh", "$env:ProgramFiles\ZippyMesh", "$env:USERPROFILE\zippymesh")) {
        if (Test-Path "$d\package.json") { $InstallDir = $d; break }
    }
}

if (-not $InstallDir) {
    Write-Fail "Could not detect install directory. Set env var ZIPPYMESH_INSTALL_DIR and retry."
}

$CurrentVersion = "unknown"
$pkgJson = Join-Path $InstallDir "package.json"
if (Test-Path $pkgJson) {
    $CurrentVersion = (Get-Content $pkgJson | ConvertFrom-Json).version
}

Write-Info "Install directory : $InstallDir"
Write-Info "Current version   : $CurrentVersion"
Write-Info "Upgrading to      : $NewVersion"

# ── Stop service ──────────────────────────────────────────────────────────────
$ServiceStopped = $false
$ServiceType = ""

$svc = Get-Service "ZippyMesh" -ErrorAction SilentlyContinue
if ($svc -and $svc.Status -eq "Running") {
    Write-Info "Stopping Windows service..."
    Stop-Service "ZippyMesh"
    $ServiceStopped = $true
    $ServiceType = "windows-service"
} else {
    # Try to stop node process running server.js from install dir
    $procs = Get-WmiObject Win32_Process -Filter "Name='node.exe'" | Where-Object { $_.CommandLine -match [regex]::Escape($InstallDir) }
    if ($procs) {
        Write-Warn "No Windows service found. Stopping node process(es)..."
        $procs | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }
        Start-Sleep 2
        $ServiceStopped = $true
        $ServiceType = "process"
    } else {
        Write-Warn "No running ZippyMesh service found. Proceeding anyway."
    }
}

# ── Backup .env ───────────────────────────────────────────────────────────────
$EnvFile = Join-Path $InstallDir ".env"
$EnvBackup = $null
if (Test-Path $EnvFile) {
    $EnvBackup = [System.IO.Path]::GetTempFileName()
    Copy-Item $EnvFile $EnvBackup
    Write-Info "Backed up .env to $EnvBackup"
}

# ── Extract zip ───────────────────────────────────────────────────────────────
Write-Info "Extracting $Zip..."
$TmpDir = Join-Path $env:TEMP "zippymesh-upgrade-$(Get-Random)"
Expand-Archive -Path $Zip -DestinationPath $TmpDir -Force

$Extracted = $TmpDir
$entries = Get-ChildItem $TmpDir
if ($entries.Count -eq 1 -and $entries[0].PSIsContainer) {
    $Extracted = $entries[0].FullName
}

Write-Info "Installing new files..."
Copy-Item "$Extracted\*" $InstallDir -Recurse -Force
Write-Success "Files installed."
Remove-Item $TmpDir -Recurse -Force

# ── Restore .env ──────────────────────────────────────────────────────────────
if ($EnvBackup) {
    Copy-Item $EnvBackup $EnvFile -Force
    Write-Success "Restored .env"

    # Merge new keys from .env.example
    $ExampleFile = Join-Path $InstallDir ".env.example"
    if (Test-Path $ExampleFile) {
        $currentEnv = Get-Content $EnvFile
        $added = 0
        $newLines = @()
        foreach ($line in (Get-Content $ExampleFile)) {
            if ($line -match '^([A-Z_][A-Z0-9_]*)=') {
                $key = $Matches[1]
                if (-not ($currentEnv | Where-Object { $_ -match "^${key}=" })) {
                    if ($added -eq 0) {
                        $newLines += ""
                        $newLines += "# -- Added by upgrade to $NewVersion --"
                    }
                    $newLines += "# $line"
                    $added++
                }
            }
        }
        if ($added -gt 0) {
            Add-Content $EnvFile $newLines
            Write-Warn "$added new config keys added (commented out) to .env — review and uncomment as needed"
        }
    }
    Remove-Item $EnvBackup
}

# ── Restart service ───────────────────────────────────────────────────────────
if ($ServiceStopped) {
    Write-Info "Restarting service..."
    switch ($ServiceType) {
        "windows-service" { Start-Service "ZippyMesh"; Start-Sleep 3 }
        "process" {
            Write-Warn "Restarting as background process — for a permanent service, use NSSM (see docs/RUNNING.md)"
            Start-Process "node" -ArgumentList "server.js" -WorkingDirectory $InstallDir -WindowStyle Hidden
            Start-Sleep 3
        }
    }
}

# ── Verify ────────────────────────────────────────────────────────────────────
$Port = 20128
$envContent = Get-Content $EnvFile -ErrorAction SilentlyContinue
$portLine = $envContent | Where-Object { $_ -match '^PORT=(\d+)' }
if ($portLine) { $Port = [int]($portLine -replace 'PORT=','') }

$HealthUrl = "http://localhost:$Port/api/health"
Write-Info "Checking $HealthUrl ..."
try {
    $response = Invoke-RestMethod $HealthUrl -TimeoutSec 5
    Write-Success "ZippyMesh is running — version: $($response.version)"
} catch {
    Write-Warn "Service not responding yet on port $Port. Check Windows Event Viewer or Task Manager."
}

Write-Host ""
Write-Host "Upgrade complete!" -ForegroundColor Green
Write-Host "  From : $CurrentVersion"
Write-Host "  To   : $NewVersion"
Write-Host "  Data : $env:APPDATA\zippy-mesh (untouched)"
