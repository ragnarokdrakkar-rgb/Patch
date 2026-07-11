@echo off
setlocal
cd /d "%~dp0"
where node >nul 2>nul || (
  echo Node.js ni namescen.
  pause
  exit /b 1
)
if not exist "node_modules" (
  echo Namescam knjiznice ...
  call npm.cmd install --no-audit --no-fund || exit /b 1
)
call npm.cmd test || (
  pause
  exit /b 1
)
call npm.cmd start
