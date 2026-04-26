@echo off
setlocal
chcp 65001 >nul
cd /d "%~dp0\..\.."

echo ================================================================
echo  Inspect: site=%~1  code=%~2
echo  (auto-pulls latest code, then runs)
echo ================================================================
echo.

where git >nul 2>nul
if not errorlevel 1 (
  echo [pull] fetching latest...
  git pull --quiet
) else (
  echo [warn] git not in PATH - skipping auto-update.
  echo        Use GitHub Desktop -^> Pull origin once, or install
  echo        https://gitforwindows.org once for one-click updates.
)

echo [install] checking dependencies (silent if up to date)...
call npm install --no-audit --no-fund --silent

set SITE=%~1
set CODE=%~2
if "%SITE%"=="" set SITE=ibjp
if "%CODE%"=="" set CODE=643703630

set INSPECT_HEADLESS=false
echo.
echo [run] inspect %SITE% %CODE%
call npm run scrape:inspect -- "%SITE%" "%CODE%"
set RC=%errorlevel%

echo.
if %RC% EQU 0 (
  echo  Done. Output saved under:  debug\%SITE%\
  start "" "debug\%SITE%"
) else (
  echo  Failed with exit code %RC%. See messages above.
)
pause
