@echo off
title AutoApply - Chrome Launcher (Port 9222)
echo ========================================================
echo   AutoApply AI Agent - Launching Interactive Chrome
echo ========================================================

echo Closing any background Chrome processes...
taskkill /F /IM chrome.exe >nul 2>&1
timeout /t 1 >nul

if not exist "%USERPROFILE%\.autoapply-chrome-profile" mkdir "%USERPROFILE%\.autoapply-chrome-profile"

echo Opening Chrome on your desktop with port 9222...
start "" "C:\Program Files\Google\Chrome\Application\chrome.exe" --remote-debugging-port=9222 --user-data-dir="%USERPROFILE%\.autoapply-chrome-profile" --no-first-run --no-default-browser-check https://www.linkedin.com/login https://www.naukri.com/nlogin/login

echo ========================================================
echo Chrome has opened with LinkedIn and Naukri login tabs!
echo 1. Log into your LinkedIn account in the Chrome window.
echo 2. Log into your Naukri account in the next tab.
echo 3. Open http://localhost:3000 and click 'Start AutoApply'.
echo ========================================================
pause
