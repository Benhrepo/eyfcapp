@echo off
setlocal
cd /d "%~dp0"
where node >nul 2>&1
if errorlevel 1 (
  echo Node.js was not found. Install Node.js LTS from https://nodejs.org/ first.
  pause
  exit /b 1
)
echo Starting the EUYFC management-portal helper.
echo Leave this window open, or install the automatic logon task with install-desktop-sync.ps1.
node desktop-sync-service.mjs
pause
