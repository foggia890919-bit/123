@echo off
setlocal
chcp 65001 >nul
cd /d "%~dp0\..\.."

set SITE=%1
set CODE=%2
if "%SITE%"=="" set SITE=ibjp
if "%CODE%"=="" set CODE=643703630

echo ================================================================
echo  Inspect: site=%SITE%  code=%CODE%
echo ================================================================
echo.
echo (Browser window will open. Do NOT click inside it.)
echo.

set INSPECT_HEADLESS=false
call npm run scrape:inspect -- "%SITE%" "%CODE%"
set RC=%errorlevel%

echo.
if %RC% EQU 0 (
  echo  Done. Output saved under:  debug\%SITE%\
  echo  Open the latest folder there to see screenshots and parsed.json
) else (
  echo  Failed with exit code %RC%. See messages above.
)
echo.
pause
