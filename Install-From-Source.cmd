@echo off
setlocal EnableExtensions
cd /d "%~dp0"
title GDDXX-Jarvis Source Installer

echo [1/4] Checking Windows and Node.js...
where node.exe >nul 2>nul || goto :missing_node
where npm.cmd >nul 2>nul || goto :missing_node
node scripts\check-windows-source.cjs || goto :failed

echo [2/4] Installing locked dependencies...
call npm.cmd ci || goto :failed

echo [3/4] Verifying Electron and native modules...
call npm.cmd run doctor:install || goto :failed

echo [4/4] Building the interface...
call npm.cmd run build:ui || goto :failed

echo.
echo GDDXX-Jarvis is ready. Launching now...
call npm.cmd run start:desktop
exit /b %errorlevel%

:missing_node
echo.
echo Node.js 22 LTS is required for a source installation.
echo Download it from https://nodejs.org/ and run this file again.
pause
exit /b 1

:failed
echo.
echo Installation stopped at the failed step above.
echo Run "npm.cmd run doctor:install" for a focused diagnosis.
pause
exit /b 1
