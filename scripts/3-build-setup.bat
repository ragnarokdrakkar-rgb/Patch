@echo off
cd /d "%~dp0.."
call npm.cmd run make
echo.
echo Setup je v mapi dist
pause
