@echo off
rem NSSM から起動される実体スクリプト。
rem `npm run dev` をフォアグラウンドで実行し、
rem NSSM がプロセス生存を追跡できるようにする。
chcp 65001 >nul
cd /d "%~dp0"
call npm run dev
