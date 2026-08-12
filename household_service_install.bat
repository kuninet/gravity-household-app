@echo off
rem Install Household Gravity as a Windows service via NSSM.
rem Requires NSSM (https://nssm.cc/) on PATH and Administrator privileges.
setlocal

set SERVICE_NAME=HouseholdGravity
set DISPLAY_NAME=Household Gravity
set DESCRIPTION=Household accounting app Gravity (client + server) running via npm run dev
set SCRIPT_DIR=%~dp0
rem Strip trailing backslash for values passed to NSSM. A trailing "\"
rem before the closing quote (e.g. "C:\path\") is parsed as an escaped
rem quote and corrupts AppDirectory.
set APP_DIR=%SCRIPT_DIR:~0,-1%
set RUN_BAT=%SCRIPT_DIR%household_service_run.bat
set LOG_DIR=%SCRIPT_DIR%logs

net session >nul 2>&1
if errorlevel 1 (
    echo [ERROR] Please run as Administrator.
    pause
    exit /b 1
)

where nssm >nul 2>&1
if errorlevel 1 (
    echo [ERROR] nssm not found on PATH. Download from https://nssm.cc/ and add to PATH.
    pause
    exit /b 1
)

if not exist "%RUN_BAT%" (
    echo [ERROR] %RUN_BAT% not found.
    pause
    exit /b 1
)

if not exist "%LOG_DIR%" mkdir "%LOG_DIR%"

sc query %SERVICE_NAME% >nul 2>&1
if not errorlevel 1 (
    echo [INFO] Service %SERVICE_NAME% already exists. Run household_service_uninstall.bat first.
    pause
    exit /b 1
)

echo [INFO] Installing service %SERVICE_NAME% ...
nssm install %SERVICE_NAME% "%RUN_BAT%"
if errorlevel 1 (
    echo [ERROR] nssm install failed.
    pause
    exit /b 1
)

nssm set %SERVICE_NAME% AppDirectory "%APP_DIR%"
nssm set %SERVICE_NAME% DisplayName "%DISPLAY_NAME%"
nssm set %SERVICE_NAME% Description "%DESCRIPTION%"
nssm set %SERVICE_NAME% Start SERVICE_AUTO_START
nssm set %SERVICE_NAME% AppStdout "%LOG_DIR%\service.out.log"
nssm set %SERVICE_NAME% AppStderr "%LOG_DIR%\service.err.log"
nssm set %SERVICE_NAME% AppRotateFiles 1
nssm set %SERVICE_NAME% AppRotateOnline 1
nssm set %SERVICE_NAME% AppRotateBytes 10485760
nssm set %SERVICE_NAME% AppStopMethodSkip 0
nssm set %SERVICE_NAME% AppStopMethodConsole 5000
nssm set %SERVICE_NAME% AppStopMethodWindow 5000
nssm set %SERVICE_NAME% AppStopMethodThreads 5000

echo [INFO] Starting service %SERVICE_NAME% ...
nssm start %SERVICE_NAME%
if errorlevel 1 (
    echo [WARN] Failed to start service. Check Event Viewer and %LOG_DIR%.
    pause
    exit /b 1
)

echo [OK] Service %SERVICE_NAME% installed and started.
echo      Log dir: %LOG_DIR%
endlocal
pause
