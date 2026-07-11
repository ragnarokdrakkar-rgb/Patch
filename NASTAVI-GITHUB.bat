@echo off
setlocal
cd /d "%~dp0"
where node >nul 2>nul || (
  echo Node.js ni namescen.
  pause
  exit /b 1
)
set /p GH_OWNER=Vnesi GitHub uporabnisko ime ali organizacijo: 
set /p GH_REPO=Vnesi ime repozitorija (npr. depo-injekcije-desktop): 
if "%GH_OWNER%"=="" goto :bad
if "%GH_REPO%"=="" goto :bad
node tools\configure-github.js "%GH_OWNER%" "%GH_REPO%"
if errorlevel 1 goto :bad
echo.
echo GitHub nastavitve so zapisane.
pause
exit /b 0
:bad
echo Nastavitev ni uspela.
pause
exit /b 1
