@echo off
REM Car Mileage Tracker - Setup & Run

echo.
echo ========================================
echo   Car Mileage Tracker - Quick Start
echo ========================================
echo.

REM Check if node_modules exists
if not exist "node_modules" (
  echo Installing dependencies...
  call npm install
  if errorlevel 1 (
    echo ERROR: npm install failed
    pause
    exit /b 1
  )
  echo Dependencies installed successfully!
  echo.
)

REM Start the server
echo Starting server...
echo.
echo ✓ Server will run on: http://localhost:3000
echo ✓ Open http://localhost:3000 in your browser
echo ✓ Login with any username (min 3 chars) and password (min 4 chars)
echo ✓ Press Ctrl+C to stop the server
echo.
echo -------------------------------------------
echo.

node server.js

pause
