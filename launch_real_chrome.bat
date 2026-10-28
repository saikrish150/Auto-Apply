@echo off
title AutoApply - Launch Real Chrome Profile with Port 9222
echo ========================================================
echo   AutoApply AI Agent - Launching Your Real Chrome
echo ========================================================
echo Closing any lingering Chrome instances to release profile lock...
taskkill /F /IM chrome.exe >nul 2>&1
timeout /t 2 >nul

echo Launching your primary Google Chrome profile with Remote Debugging (Port 9222)...
start "" "C:\Program Files\Google\Chrome\Application\chrome.exe" --remote-debugging-port=9222 --user-data-dir="C:\Users\91868\AppData\Local\Google\Chrome\User Data" https://www.linkedin.com/jobs https://www.naukri.com
echo Chrome launched with your saved logins! Now go to http://localhost:3000 and click Start AutoApply.
