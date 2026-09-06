$env:PORT = "20128"
$env:HOSTNAME = "0.0.0.0"
# Run from wherever this script lives, not from one machine's checkout path.
Set-Location -LiteralPath $PSScriptRoot
Write-Host "ZippyMesh LLM Router v1.0.0" -ForegroundColor Cyan
Write-Host "http://localhost:20128  |  http://localhost:20128/login" -ForegroundColor Green
Write-Host ""
node .next\standalone\server.js
