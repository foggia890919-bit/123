@echo off
setlocal
chcp 65001 >nul
cd /d "%~dp0\..\.."

echo ================================================================
echo  Scrape PoC - reads codes from src\scrapers\codes\sample.txt
echo  Saves results to output\inventory-(timestamp).csv
echo ================================================================
echo.

call npm run scrape:poc
set RC=%errorlevel%
echo.
if %RC% EQU 0 (
  echo  Done. Opening output folder...
  start "" "output"
) else (
  echo  Failed with exit code %RC%. See messages above.
)
pause
