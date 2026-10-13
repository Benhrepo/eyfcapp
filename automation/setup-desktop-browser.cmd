@echo off
setlocal
cd /d "%~dp0"
start "" explorer.exe "%~dp0chrome-extension"
if exist "%ProgramFiles%\Google\Chrome\Application\chrome.exe" (
  start "" "%ProgramFiles%\Google\Chrome\Application\chrome.exe" "chrome://extensions/"
) else if exist "%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe" (
  start "" "%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe" "chrome://extensions/"
) else (
  start "" msedge.exe "edge://extensions/"
)
echo Turn on Developer mode, click Load unpacked, and select:
echo %~dp0chrome-extension
echo Then open the extension options and save the same private sync key.
pause
