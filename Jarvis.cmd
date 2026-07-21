@echo off
setlocal
cd /d "%~dp0"
where node.exe >nul 2>nul || (
  echo [GDDXX-Jarvis] Node.js was not found.
  echo Install Node.js 22 LTS from https://nodejs.org/ and run this file again.
  pause
  exit /b 1
)
where npm.cmd >nul 2>nul || (
  echo [GDDXX-Jarvis] npm was not found. Repair the Node.js installation and try again.
  pause
  exit /b 1
)
if not exist "node_modules\electron\dist\electron.exe" (
  echo [GDDXX-Jarvis] Dependencies are not installed.
  echo Run Install-From-Source.cmd once before starting Jarvis.
  pause
  exit /b 1
)
npm.cmd run start:desktop
if errorlevel 1 (
  echo.
  echo [GDDXX-Jarvis] Startup failed. Run: npm.cmd run doctor:install
  echo Log: runtime\jarvis\jarvis-electron.log
  pause
)
