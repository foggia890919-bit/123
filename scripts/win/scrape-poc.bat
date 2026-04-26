@echo off
setlocal
chcp 65001 >nul
cd /d "%~dp0\..\.."

echo ================================================================
echo  Scrape PoC (codes from src\scrapers\codes\sample.txt)
echo ================================================================
echo.

if "%DATABASE_URL%"=="" (
  findstr /B /C:"DATABASE_URL=" .env >nul 2>nul
  if errorlevel 1 (
    echo [ERROR] DATABASE_URL is not set in .env
    echo Add this line to .env, using your Supabase connection string:
    echo    DATABASE_URL=postgresql://...
    pause
    exit /b 1
  )
)

call npm run scrape:poc
set RC=%errorlevel%
echo.
if %RC% EQU 0 (
  echo  PoC complete. Check Supabase ^> Table Editor ^> InventorySnapshot
) else (
  echo  Failed with exit code %RC%. See messages above.
)
pause
