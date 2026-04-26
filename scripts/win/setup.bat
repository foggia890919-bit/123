@echo off
setlocal
chcp 65001 >nul
cd /d "%~dp0\..\.."

echo ================================================================
echo  Inventory Scraper - First-time Setup
echo ================================================================
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Node.js is not installed.
  echo.
  echo Please install Node.js LTS from:
  echo   https://nodejs.org/
  echo.
  echo After installation, run this file again.
  pause
  exit /b 1
)

echo [1/3] Node.js detected:
node -v
echo.

if not exist .env (
  echo [2/3] Creating .env from template...
  copy /Y .env.example .env >nul
  echo.
  echo  IMPORTANT: open ".env" with Notepad and fill in:
  echo    SCRAPER_IBJP_ID=your_ibjp_id
  echo    SCRAPER_IBJP_PW=your_ibjp_password
  echo.
  echo  Save the file, then run setup.bat again.
  echo.
  notepad .env
  pause
  exit /b 0
) else (
  echo [2/3] .env already exists - skipping.
)
echo.

echo [3/3] Installing npm dependencies (this may take 2-5 minutes the first time)...
call npm install --no-audit --no-fund
if errorlevel 1 (
  echo [ERROR] npm install failed.
  pause
  exit /b 1
)
echo.

echo Installing Chromium browser for Playwright (~150 MB)...
call npx playwright install chromium
if errorlevel 1 (
  echo [ERROR] Playwright install failed.
  pause
  exit /b 1
)
echo.

echo ================================================================
echo  Setup complete!
echo ================================================================
echo.
echo  Next steps:
echo    - Double-click "inspect.bat" to test login + one search
echo    - Double-click "scrape-poc.bat" to run the small batch
echo.
pause
