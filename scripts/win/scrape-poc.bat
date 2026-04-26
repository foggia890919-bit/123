@echo off
setlocal
chcp 65001 >nul
cd /d "%~dp0\..\.."

echo ================================================================
echo  Scrape PoC - reads codes from src\scrapers\codes\sample.txt
echo  Saves results to output\inventory-(timestamp).csv
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

echo.
echo [run] starting scraper...
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
