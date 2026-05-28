$env:PORT = "20128"
$env:HOSTNAME = "0.0.0.0"
Set-Location "K:\Projects\ZippyMesh_LLM_Router"
Write-Host "ZippyMesh LLM Router v1.0.0" -ForegroundColor Cyan
Write-Host "http://localhost:20128  |  http://localhost:20128/login" -ForegroundColor Green
Write-Host ""
node .next\standalone\server.js
