@echo off
setlocal EnableExtensions
cd /d "%~dp0"
title Depo Injekcije PSA - deploy patch 2.0.3

where git >nul 2>nul || (
  echo Git ni namescen.
  pause
  exit /b 1
)
where node >nul 2>nul || (
  echo Node.js ni namescen.
  pause
  exit /b 1
)
if not exist ".git" (
  echo Ta mapa ni Git repozitorij. Najprej nalozi projekt v GitHub.
  pause
  exit /b 1
)
findstr /c:"CHANGE_ME" release-config.js >nul && (
  echo Najprej zazeni NASTAVI-GITHUB.bat in vpisi GitHub uporabnika ter repozitorij.
  pause
  exit /b 1
)

call npm.cmd test || goto :fail

git add .
git diff --cached --quiet || git commit -m "Patch 2.0.3 - varna domaca ambulanta in updater bootstrap"
if errorlevel 1 goto :fail

git rev-parse "v2.0.3" >nul 2>nul
if errorlevel 1 git tag v2.0.3
if errorlevel 1 goto :fail

git push origin main
if errorlevel 1 goto :fail
git push origin v2.0.3
if errorlevel 1 goto :fail

echo.
echo Patch 2.0.3 je poslan. GitHub Actions bo izdelal Release.
echo Odpri GitHub - Actions in nato Releases.
pause
exit /b 0

:fail
echo.
echo Deploy ni uspel. Preberi napako zgoraj.
pause
exit /b 1
