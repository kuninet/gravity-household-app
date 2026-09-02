@echo off
rem Update Household Gravity: git pull, refresh dependencies, restart the NSSM service.
setlocal

set SERVICE_NAME=HouseholdGravity
set SCRIPT_DIR=%~dp0
set APP_DIR=%SCRIPT_DIR:~0,-1%
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

where git >nul 2>&1
if errorlevel 1 (
    echo [ERROR] git not found on PATH.
    pause
    exit /b 1
)

where npm >nul 2>&1
if errorlevel 1 (
    echo [ERROR] npm not found on PATH.
    pause
    exit /b 1
)

sc query %SERVICE_NAME% >nul 2>&1
if errorlevel 1 (
    echo [ERROR] Service not installed. Run household_service_install.bat first.
    pause
    exit /b 1
)

cd /d "%APP_DIR%"

rem Detect local changes with a for /f capture rather than errorlevel on
rem git status itself, since "git status --porcelain" always exits 0
rem whether or not it printed anything. Untracked files are excluded on
rem purpose: only tracked modifications should block an update.
set LOCAL_CHANGES=
for /f "delims=" %%i in ('git status --porcelain --untracked-files=no') do set LOCAL_CHANGES=1
if defined LOCAL_CHANGES (
    echo [ERROR] Local changes detected. Commit or stash them before updating.
    pause
    exit /b 1
)

set BEFORE=
for /f "delims=" %%i in ('git rev-parse HEAD') do set BEFORE=%%i
if not defined BEFORE (
    echo [ERROR] Failed to read current commit.
    pause
    exit /b 1
)

echo [INFO] Pulling latest changes ...
git pull --ff-only
if errorlevel 1 (
    echo [ERROR] git pull failed ^(not fast-forward or network error^).
    pause
    exit /b 1
)

set AFTER=
for /f "delims=" %%i in ('git rev-parse HEAD') do set AFTER=%%i
if not defined AFTER (
    echo [ERROR] Failed to read updated commit.
    pause
    exit /b 1
)

if "%BEFORE%"=="%AFTER%" (
    echo [INFO] Already up to date.
)

rem Detect dependency changes with findstr's own errorlevel: piping into
rem findstr reliably sets errorlevel 0 on a match and 1 on no match, which
rem is simpler here than capturing findstr output through for /f. /L makes
rem the search literal so a dot in "package.json" cannot match any
rem character as a regex wildcard.
set DEP_CHANGED=
git diff --name-only %BEFORE% %AFTER% | findstr /i /l /c:"package.json" /c:"package-lock.json" >nul 2>&1
if not errorlevel 1 set DEP_CHANGED=1

if defined DEP_CHANGED (
    echo [INFO] Dependencies changed. Stopping service before npm run setup ...
    nssm stop %SERVICE_NAME% >nul 2>&1
    call npm run setup
    if errorlevel 1 (
        echo [ERROR] npm run setup failed. Service is left stopped.
        pause
        exit /b 1
    )
)

echo [INFO] Restarting service %SERVICE_NAME% ...
nssm stop %SERVICE_NAME% >nul 2>&1
rem Give the service control manager a moment to leave STOP_PENDING.
timeout /t 2 /nobreak >nul
nssm start %SERVICE_NAME%
if errorlevel 1 (
    echo [WARN] Failed to start service. Check Event Viewer and %LOG_DIR%.
    pause
    exit /b 1
)

echo [OK] Update complete. HEAD: %AFTER%
endlocal
pause
