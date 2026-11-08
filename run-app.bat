@echo off
SET NODE_EXE=C:\Users\user\Downloads\node-portable\node-v20.18.1-win-x64\node.exe
SET NEXT_BIN=C:\Users\user\Documents\warehouse-material-mmp\node_modules\next\dist\bin\next
SET WORK_DIR=C:\Users\user\Documents\warehouse-material-mmp

cd /d "%WORK_DIR%"
echo Starting Warehouse App at http://localhost:3000 ...
"%NODE_EXE%" "%NEXT_BIN%" dev -p 3000
pause

