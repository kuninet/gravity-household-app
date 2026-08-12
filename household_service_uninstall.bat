@echo off
rem 家計簿Gravity の Windows サービスを停止・削除する。
chcp 65001 >nul
setlocal

set SERVICE_NAME=HouseholdGravity

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

sc query %SERVICE_NAME% >nul 2>&1
if %ERRORLEVEL% neq 0 (
    echo [INFO] サービス %SERVICE_NAME% は登録されていません。
    pause
    exit /b 0
)

echo [INFO] サービス %SERVICE_NAME% を停止します。
nssm stop %SERVICE_NAME%

echo [INFO] サービス %SERVICE_NAME% を削除します。
nssm remove %SERVICE_NAME% confirm
if %ERRORLEVEL% neq 0 (
    echo [ERROR] サービス削除に失敗しました。
    pause
    exit /b 1
)

echo [OK] サービス %SERVICE_NAME% を削除しました。
endlocal
pause
