@echo off
REM ZippyMesh LLM Router - start the production standalone build from a SOURCE TREE.
REM
REM   start-stable.cmd          loopback only (http://127.0.0.1:20128)
REM   start-stable.cmd --lan    also reachable from other machines on the network
REM
REM A released zip carries its own start-stable.cmd next to server.js; this one is
REM for running the build you produced with `npm run build` out of the repo.
setlocal
cd /d "%~dp0"

if not exist ".next\standalone\server.js" (
  echo No standalone build found. Run:  npm run build
  exit /b 1
)
if not exist ".next\standalone\.next\static" (
  node scripts\prepare-standalone.cjs
)

REM server.js chdir()s into .next\standalone, so it would otherwise only see
REM .next\standalone\.env. Point it at the .env in this directory instead.
if exist ".env" set ZIPPY_ENV_FILE=%CD%\.env

REM Do NOT default PORT / ZIPPY_BIND_HOST here: server.js resolves them from the
REM environment first, then .env, then falls back to 127.0.0.1:20128.
if /i "%~1"=="--lan" (
  set ZIPPY_BIND_HOST=0.0.0.0
  echo LAN mode: this node will be reachable from other machines. Enable login at /setup first.
)

echo Starting ZippyMesh Router (default http://127.0.0.1:20128; .env can override PORT / ZIPPY_BIND_HOST)
node .next\standalone\server.js
