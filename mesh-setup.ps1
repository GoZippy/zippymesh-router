# ZippyMesh Node Setup (Windows)

Write-Host "--- ZippyMesh Node Setup ---" -ForegroundColor Cyan

# 1. Check for Node.js
if (!(Get-Command node -ErrorAction SilentlyContinue)) {
    Write-Host "Error: Node.js is not installed. Please install Node.js 18+." -ForegroundColor Red
    exit 1
}

# 2. Setup Environment
if (!(Test-Path .env)) {
    Write-Host "Creating .env from example..."
    Copy-Item .env.example .env
    Write-Host "Generated .env. Please edit it to customize your node name/ports if needed." -ForegroundColor Yellow
}

# 3. Install Dependencies
Write-Host "Installing dependencies..."
npm install

# 4. Build Application
Write-Host "Building application..."
npm run build

# 5. Success
Write-Host "--- Installation Complete ---" -ForegroundColor Green
Write-Host "To start your node: npm start"
