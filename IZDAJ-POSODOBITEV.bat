@echo off
setlocal EnableExtensions
cd /d "%~dp0"
title Depo Injekcije PSA - nova posodobitev

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
  echo Ta mapa se ni Git repozitorij. Najprej sledi navodilom za prvo objavo.
  pause
  exit /b 1
)

call npm test || (
  echo Testi niso uspeli. Posodobitev ni bila izdana.
  pause
  exit /b 1
)

echo.
echo Izberi vrsto verzije:
echo   1 - patch  (1.0.0 -^> 1.0.1; popravek)
echo   2 - minor  (1.0.1 -^> 1.1.0; nova funkcija)
echo   3 - major  (1.1.0 -^> 2.0.0; velika nezdruzljiva sprememba)
choice /c 123 /n /m "Izbira [1/2/3]: "
if errorlevel 3 set VERSION_TYPE=major
if errorlevel 2 set VERSION_TYPE=minor
if errorlevel 1 set VERSION_TYPE=patch

call npm version %VERSION_TYPE%
if errorlevel 1 goto :fail

git push origin main
if errorlevel 1 goto :fail
git push origin --tags
if errorlevel 1 goto :fail

echo.
echo Posodobitev je poslana. GitHub Actions bo izdelal nov Setup.exe.
echo Spremljaj zavihek Actions in nato Releases v GitHub repozitoriju.
pause
exit /b 0

:fail
echo.
echo Posodobitev ni uspela. Preberi napako nad to vrstico.
pause
exit /b 1
