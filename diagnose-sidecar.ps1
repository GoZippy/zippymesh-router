# ZippyMesh Sidecar Diagnostic Script
# Checks if sidecar is running and on what port

Write-Host "=== ZippyMesh Sidecar Diagnostics ===" -ForegroundColor Cyan

# Check common sidecar ports
$ports = @(9480, 8081, 20128)
$sidecarFound = $false

Write-Host "`n[*] Checking for running processes..." -ForegroundColor Yellow

# Check for any process using the expected ports
foreach ($port in $ports) {
    $connections = netstat -ano 2>$null | Select-String ":$port\s"
    if ($connections) {
        Write-Host "  [FOUND] Port $port is in use:" -ForegroundColor Green
        $connections | ForEach-Object { Write-Host "    $_" }
        
        # Try to get the process name
        $line = ($connections | Select-Object -First 1).ToString()
        if ($line -match "LISTENING\s+(\d+)") {
            $procId = $matches[1]
            $proc = Get-Process -Id $procId -ErrorAction SilentlyContinue
            if ($proc) {
                Write-Host "    Process: $($proc.ProcessName) (PID: $pid)" -ForegroundColor Cyan
            }
        }
    }
}

# Try to connect to health endpoints
Write-Host "`n[*] Testing health endpoints..." -ForegroundColor Yellow

$endpoints = @(
    @{Url="http://localhost:9480/health"; Port=9480},
    @{Url="http://localhost:8081/health"; Port=8081}
)

foreach ($ep in $endpoints) {
    Write-Host "  Testing $($ep.Url)..." -NoNewline
    try {
        $response = Invoke-WebRequest -Uri $ep.Url -TimeoutSec 3 -ErrorAction SilentlyContinue
        Write-Host " OK (Status: $($response.StatusCode))" -ForegroundColor Green
        $sidecarFound = $true
    } catch {
        Write-Host " FAILED" -ForegroundColor Red
    }
}

# Check if Rust/Cargo is installed
Write-Host "`n[*] Checking Rust toolchain..." -ForegroundColor Yellow
$rustc = Get-Command rustc -ErrorAction SilentlyContinue
if ($rustc) {
    $version = & rustc --version 2>$null
    Write-Host "  [OK] Rust installed: $version" -ForegroundColor Green
} else {
    Write-Host "  [WARN] Rust not found - cannot build sidecar" -ForegroundColor Yellow
}

# Summary
Write-Host "`n=== Summary ===" -ForegroundColor Cyan
if ($sidecarFound) {
    Write-Host "Sidecar is RUNNING - health check passed" -ForegroundColor Green
} else {
    Write-Host "Sidecar is NOT RUNNING" -ForegroundColor Red
    Write-Host "`nTo start the sidecar, run:" -ForegroundColor Yellow
    Write-Host "  cd sidecar && cargo run" -ForegroundColor White
}

Write-Host "`nNote: The Next.js app expects sidecar at port 9480 by default." -ForegroundColor Gray
Write-Host "Current docker-compose.yml shows sidecar on port 8081." -ForegroundColor Gray
