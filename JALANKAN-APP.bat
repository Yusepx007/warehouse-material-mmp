@echo off
title Warehouse Material MMP
cd /d "C:\Users\user\Documents\warehouse-material-mmp"

echo ============================================
echo   Warehouse Material MMP - Starting...
echo   Buka browser ke: http://localhost:3000
echo ============================================
echo.

"C:\Users\user\Downloads\node-portable\node-v20.18.1-win-x64\node.exe" "node_modules\next\dist\bin\next" dev -p 3000

pause

