@echo off
setlocal
cd /d "%~dp0"
where node >nul 2>&1
if errorlevel 1 (
  echo Node.js was not found. Install Node.js LTS from https://nodejs.org/ first.
  pause
  exit /b 1
)
node desktop-sync.mjs
if errorlevel 1 (
  echo.
  echo The report failed safely. No Full-Time data was applied.
  pause
  exit /b 1
)
echo.
echo Scrape complete. Open Results Uploader in the management portal, load the pending report, review it and approve it.
pause
