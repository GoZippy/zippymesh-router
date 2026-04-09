@echo off
setlocal
cd /d "%~dp0"
if not exist ".next\standalone\server.js" (
  echo Run build first: npm run build:next
  echo Then: node scripts\prepare-standalone.cjs
  exit /b 1
)
if not exist ".next\standalone\.next\static" (
  node scripts\prepare-standalone.cjs
)
set PORT=20128
set HOSTNAME=0.0.0.0
REM Run from project root so .env and DATA_DIR use your existing data and login
REM HOSTNAME=0.0.0.0 allows API requests from other machines (Claude Code, OpenClaw, etc.)
echo Starting ZippyMesh Router at http://localhost:%PORT% (HOSTNAME=%HOSTNAME% for network access)
node .next\standalone\server.js
