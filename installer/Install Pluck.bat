@echo off
rem Installs Pluck into Premiere Pro on Windows. Double-click it (see "READ ME FIRST.txt" if Windows warns you).
setlocal
set "SRC=%~dp0Pluck"
set "DEST=%APPDATA%\Adobe\CEP\extensions\com.dedkul.pluck"

if not exist "%SRC%\CSXS\manifest.xml" (
  echo Can't find the Pluck folder next to this file. Unzip the download first, then run this again.
  pause
  exit /b 1
)

echo Installing Pluck...
rem Pluck isn't signed by Adobe yet, so Premiere has to be told to load it.
reg add "HKCU\Software\Adobe\CSXS.11" /v PlayerDebugMode /t REG_SZ /d 1 /f >nul
reg add "HKCU\Software\Adobe\CSXS.12" /v PlayerDebugMode /t REG_SZ /d 1 /f >nul

if exist "%DEST%" rmdir /s /q "%DEST%"
robocopy "%SRC%" "%DEST%" /E /NFL /NDL /NJH /NJS /NP >nul
if errorlevel 8 (
  echo Copying failed. Close Premiere Pro and try again.
  pause
  exit /b 1
)
rem Windows marks downloaded files as "from the internet" and may block Pluck's bundled tools.
powershell -NoProfile -Command "Get-ChildItem -LiteralPath $env:DEST -Recurse | Unblock-File"

echo Done. Restart Premiere Pro, then open Window ^> Extensions ^> Pluck.
pause
