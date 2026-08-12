@echo off
rem 家計簿Gravity を Windows サービスとして登録する。
rem 事前に NSSM (https://nssm.cc/) をダウンロードし PATH に通しておくこと。
chcp 65001 >nul
setlocal

set SERVICE_NAME=HouseholdGravity
set DISPLAY_NAME=家計簿Gravity
set DESCRIPTION=家計簿アプリ Gravity (client + server) を npm run dev で常駐起動
set SCRIPT_DIR=%~dp0
set RUN_BAT=%SCRIPT_DIR%household_service_run.bat
set LOG_DIR=%SCRIPT_DIR%logs

net session >nul 2>&1
if %ERRORLEVEL% neq 0 (
    echo [ERROR] 管理者権限で実行してください。
    pause
    exit /b 1
)

where nssm >nul 2>&1
if %ERRORLEVEL% neq 0 (
    echo [ERROR] NSSM が見つかりません。https://nssm.cc/ からダウンロードし PATH を通してください。
    pause
    exit /b 1
)

if not exist "%RUN_BAT%" (
    echo [ERROR] %RUN_BAT% が存在しません。
    pause
    exit /b 1
)

if not exist "%LOG_DIR%" mkdir "%LOG_DIR%"

sc query %SERVICE_NAME% >nul 2>&1
if %ERRORLEVEL% equ 0 (
    echo [INFO] サービス %SERVICE_NAME% は既に存在します。先に household_service_uninstall.bat で削除してください。
    pause
    exit /b 1
)

echo [INFO] サービス %SERVICE_NAME% を登録します。
nssm install %SERVICE_NAME% "%RUN_BAT%"
if %ERRORLEVEL% neq 0 (
    echo [ERROR] nssm install に失敗しました。
    pause
    exit /b 1
)

nssm set %SERVICE_NAME% AppDirectory "%SCRIPT_DIR%"
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

echo [INFO] サービス %SERVICE_NAME% を開始します。
nssm start %SERVICE_NAME%
if %ERRORLEVEL% neq 0 (
    echo [WARN] サービス開始に失敗しました。イベントログと %LOG_DIR% を確認してください。
    pause
    exit /b 1
)

echo [OK] サービス %SERVICE_NAME% を登録・開始しました。
echo      ログ: %LOG_DIR%
endlocal
pause
