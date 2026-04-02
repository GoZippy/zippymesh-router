@echo off
setlocal EnableDelayedExpansion
cd /d "%~dp0"

REM Load .env from standalone folder if it exists
if exist ".next\standalone\.env" (
  for /f "usebackq tokens=1,* delims==" %%a in (".next\standalone\.env") do (
    set "%%a=%%b"
  )
)

REM Default values (can be overridden by .env)
if not defined PORT set PORT=20128
if not defined HOSTNAME set HOSTNAME=0.0.0.0
if not defined DATA_DIR set DATA_DIR=%APPDATA%\zippy-mesh
if not exist ".next\standalone\server.js" (
  echo Run build first: npm run build:next
  echo Then: node scripts\prepare-standalone.cjs
  exit /b 1
)
if not exist ".next\standalone\.next\static" (
  node scripts\prepare-standalone.cjs
)
echo Starting ZippyMesh Router at http://localhost:%PORT% (HOSTNAME=%HOSTNAME% for network access)
node .next\standalone\server.js
