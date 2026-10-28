@echo off
title AutoApply AI Agent Control Center
echo ===================================================
echo   AutoApply AI Agent - Local Job Automation Suite
echo ===================================================
echo Starting local backend server...
start http://localhost:3000
node server.js
pause
