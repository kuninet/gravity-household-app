@echo off
rem Entry point invoked by NSSM.
rem Run "npm run dev" in the foreground so NSSM can track the process.
cd /d "%~dp0"
call npm run dev
