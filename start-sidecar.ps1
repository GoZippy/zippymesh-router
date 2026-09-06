# ZippyMesh Sidecar Startup Script
# Builds and runs the sidecar on port 9480 (to match Next.js API)

param(
    [int]$Port = 9480
)

Write-Host "=== Starting ZippyMesh Sidecar ===" -ForegroundColor Cyan
Write-Host "Target port: $Port" -ForegroundColor Gray

# Check if Rust is installed
$rustc = Get-Command rustc -ErrorAction SilentlyContinue
if (-not $rustc) {
    Write-Host "[ERROR] Rust is not installed. Please install from https://rustup.rs/" -ForegroundColor Red
    exit 1
}

# Check if cargo is available
$cargo = Get-Command cargo -ErrorAction SilentlyContinue
if (-not $cargo) {
    Write-Host "[ERROR] Cargo is not installed. Please install from https://rustup.rs/" -ForegroundColor Red
    exit 1
}

# Navigate to sidecar directory
$sidecarDir = Join-Path $PSScriptRoot "sidecar"
if (-not (Test-Path $sidecarDir)) {
    Write-Host "[ERROR] Sidecar directory not found at $sidecarDir" -ForegroundColor Red
    exit 1
}

# --- Sidecar API auth wiring -------------------------------------------------
# The sidecar requires "Authorization: Bearer <SIDE_CAR_SECRET>" on every route
# except /health and /version. Load the secret from the repo .env (written by
# `npm run setup`) so this manually-started sidecar accepts requests from the
# Next.js dev server. If no secret is available anywhere, fall back to
# NODE_ENV=development, which the sidecar treats as open (dev-only behavior).
if (-not $env:SIDE_CAR_SECRET) {
    $envFile = Join-Path $PSScriptRoot ".env"
    if (Test-Path $envFile) {
        $secretLine = Get-Content $envFile | Where-Object { $_ -match '^SIDE_CAR_SECRET=(.+)$' } | Select-Object -First 1
        if ($secretLine -match '^SIDE_CAR_SECRET=(.+)$') {
            $env:SIDE_CAR_SECRET = $Matches[1].Trim()
            Write-Host "[*] Loaded SIDE_CAR_SECRET from .env (API auth enabled)" -ForegroundColor Gray
        }
    }
}
if (-not $env:SIDE_CAR_SECRET -and -not $env:NODE_ENV) {
    $env:NODE_ENV = "development"
    Write-Host "[!] No SIDE_CAR_SECRET found - running OPEN in development mode." -ForegroundColor Yellow
    Write-Host "    Run 'npm run setup' to generate one, or set SIDE_CAR_SECRET yourself." -ForegroundColor Yellow
}
# -----------------------------------------------------------------------------

Push-Location $sidecarDir

try {
    Write-Host "[*] Building sidecar..." -ForegroundColor Yellow
    
    # Build the sidecar
    $buildResult = & cargo build --release 2>&1
    if ($LASTEXITCODE -ne 0) {
        Write-Host "[ERROR] Build failed!" -ForegroundColor Red
        Write-Host $buildResult
        exit 1
    }
    
    Write-Host "[OK] Build successful" -ForegroundColor Green
    
    # Run the sidecar on the specified port
    Write-Host "[*] Starting sidecar on port $Port..." -ForegroundColor Yellow
    Write-Host "    (Press Ctrl+C to stop)" -ForegroundColor Gray
    
    # Start sidecar with custom port
    & cargo run --release -- --api-port=$Port
    
} finally {
    Pop-Location
}
