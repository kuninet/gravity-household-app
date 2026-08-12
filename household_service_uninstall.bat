@echo off
rem Stop and remove the Household Gravity Windows service.
setlocal

set SERVICE_NAME=HouseholdGravity

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

sc query %SERVICE_NAME% >nul 2>&1
if errorlevel 1 (
    echo [INFO] Service %SERVICE_NAME% is not installed.
    pause
    exit /b 0
)

echo [INFO] Stopping service %SERVICE_NAME% ...
nssm stop %SERVICE_NAME%

echo [INFO] Removing service %SERVICE_NAME% ...
nssm remove %SERVICE_NAME% confirm
if errorlevel 1 (
    echo [ERROR] Failed to remove service.
    pause
    exit /b 1
)

echo [OK] Service %SERVICE_NAME% removed.
endlocal
pause
