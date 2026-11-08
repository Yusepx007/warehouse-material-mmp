@echo off
setlocal
cd /d "%~dp0"

echo Checking port 3000...
for /f "tokens=5" %%P in ('netstat -ano ^| findstr /R /C:":3000 .*LISTENING"') do (
  echo Stopping existing server PID %%P...
  taskkill /PID %%P /F >nul 2>&1
)

if not exist "node_modules\.bin\next.cmd" (
  echo Next.js dependencies are missing from this project.
  echo Install Node.js and dependencies first, then run this file again.
  pause
  exit /b 1
)

if exist ".next\dev\lock" del /f /q ".next\dev\lock" >nul 2>&1

echo Starting Warehouse Material MMP at http://localhost:3000
call "node_modules\.bin\next.cmd" dev -p 3000
pause
