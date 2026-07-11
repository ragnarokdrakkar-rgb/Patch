@echo off
setlocal EnableExtensions
cd /d "%~dp0"
title Depo Injekcije PSA - izdelava EXE

echo =====================================================
echo   DEPO INJEKCIJE PSA - IZDELAVA WINDOWS SETUP.EXE
echo   (electron-builder + NSIS)
echo =====================================================
echo.

where node >nul 2>nul || (
  echo NAPAKA: Node.js ni namescen.
  pause
  exit /b 1
)

where npm.cmd >nul 2>nul || (
  echo NAPAKA: npm.cmd ni najden.
  pause
  exit /b 1
)

echo [1/4] Cistim stare build datoteke ...
if exist "dist" rmdir /s /q "dist"
if exist "READY-EXE" rmdir /s /q "READY-EXE"

echo.
echo [2/4] Namescam potrebne knjiznice ...
call npm.cmd install --no-audit --no-fund
if errorlevel 1 goto :fail

echo.
echo [3/4] Preverjam projekt ...
call npm.cmd test
if errorlevel 1 goto :fail

echo.
echo [4/4] Izdelujem NSIS Setup.exe ...
call npm.cmd run make
if errorlevel 1 goto :fail

mkdir "READY-EXE" >nul 2>nul
for /f "delims=" %%F in ('dir /b /a-d "dist\*.exe" 2^>nul ^| findstr /i /v "uninstaller"') do copy /y "dist\%%F" "READY-EXE\Depo-Injekcije-PSA-Setup.exe" >nul

if not exist "READY-EXE\Depo-Injekcije-PSA-Setup.exe" (
  echo NAPAKA: Installer ni bil najden v mapi dist.
  goto :fail
)

echo.
echo =====================================================
echo USPEH: installer je pripravljen:
echo %CD%\READY-EXE\Depo-Injekcije-PSA-Setup.exe
echo =====================================================
start "" "%CD%\READY-EXE"
pause
exit /b 0

:fail
echo.
echo =====================================================
echo IZDELAVA NI USPELA. Preberi napako nad to vrstico.
echo =====================================================
pause
exit /b 1
