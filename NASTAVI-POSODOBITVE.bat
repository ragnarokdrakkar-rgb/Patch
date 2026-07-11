@echo off
setlocal EnableExtensions
title Depo Injekcije PSA - GitHub posodobitve
set /p GH_OWNER=GitHub uporabnisko ime ali organizacija: 
set /p GH_REPO=Ime GitHub repozitorija: 
if "%GH_OWNER%"=="" goto :bad
if "%GH_REPO%"=="" goto :bad
powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "$ErrorActionPreference='Stop';$docs=[Environment]::GetFolderPath('MyDocuments');$dir=Join-Path $docs 'Depo Injekcije';New-Item -ItemType Directory -Force -Path $dir|Out-Null;[ordered]@{owner='%GH_OWNER%';repo='%GH_REPO%'}|ConvertTo-Json|Set-Content -Encoding UTF8 (Join-Path $dir 'update-config.json')"
if errorlevel 1 goto :bad
echo Nastavljeno. Ponovno odpri aplikacijo.
pause
exit /b 0
:bad
echo Nastavitev ni uspela.
pause
exit /b 1
