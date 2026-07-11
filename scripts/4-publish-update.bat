@echo off
cd /d "%~dp0.."
echo Pred nadaljevanjem mora biti GH_TOKEN nastavljen v tem oknu.
call npm.cmd run publish
pause
