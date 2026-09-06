@echo off
REM Kept as an alias for the documented entry point. `start-stable.cmd` is the
REM one script that starts the standalone build from this source tree; this
REM file forwards to it so older notes and shortcuts keep working.
REM
REM   run-standalone.cmd          loopback only (http://127.0.0.1:20128)
REM   run-standalone.cmd --lan    also reachable from other machines
call "%~dp0start-stable.cmd" %*
