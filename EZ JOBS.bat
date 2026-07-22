@echo off
rem EZ JOBS launcher - starts the server (daily 9am scan) and opens the app
cd /d "%~dp0"
start "EZ JOBS Server" /min node server.js
timeout /t 2 /nobreak >nul
start "" "http://localhost:3796"
