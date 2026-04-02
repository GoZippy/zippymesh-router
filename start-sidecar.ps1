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
