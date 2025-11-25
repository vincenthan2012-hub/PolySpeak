@echo off
REM PolySpeak - Windows Startup Script
REM This script installs dependencies and starts the development server

REM Enable delayed expansion for error handling
setlocal enabledelayedexpansion

REM Change to script directory
cd /d "%~dp0"

echo ========================================
echo   PolySpeak - Structural Speaking Coach
echo ========================================
echo.
echo Current directory: %CD%
echo.

REM Check if Node.js is installed
echo [1/5] Checking Node.js...
where node >nul 2>nul
if errorlevel 1 (
    echo [ERROR] Node.js is not installed or not in PATH.
    echo Please install Node.js from https://nodejs.org/
    echo.
    goto :error_exit
)
for /f "tokens=*" %%i in ('node --version 2^>nul') do set NODE_VERSION=%%i
echo %NODE_VERSION%
echo [OK] Node.js found
echo.

REM Check if npm is installed
echo [2/5] Checking npm...
where npm >nul 2>nul
if errorlevel 1 (
    echo [ERROR] npm is not installed or not in PATH.
    echo.
    goto :error_exit
)
for /f "tokens=*" %%i in ('npm --version 2^>nul') do set NPM_VERSION=%%i
echo %NPM_VERSION%
echo [OK] npm found
echo.

REM Check if package.json exists
echo [3/5] Checking project files...
if not exist "package.json" (
    echo [ERROR] package.json not found!
    echo Make sure you're running this script from the project root directory.
    echo.
    goto :error_exit
)
echo [OK] package.json found
echo.

REM Check if node_modules exists
echo [4/5] Checking dependencies...
if not exist "node_modules" (
    echo [INFO] Installing dependencies...
    echo This may take a few minutes on first run...
    echo.
    call npm install
    if errorlevel 1 (
        echo.
        echo [ERROR] Failed to install dependencies.
        echo Please check the error messages above.
        echo.
        goto :error_exit
    )
    echo.
    echo [OK] Dependencies installed successfully!
    echo.
) else (
    echo [OK] Dependencies already installed.
    echo.
)

REM Check if .env.local exists
echo [5/5] Checking environment configuration...
if not exist ".env.local" (
    echo [INFO] Creating .env.local file...
    if exist ".env.local.example" (
        copy ".env.local.example" ".env.local" >nul 2>nul
        echo [OK] Created .env.local from example
    ) else (
        echo GEMINI_API_KEY= > .env.local
        echo [OK] Created .env.local file
    )
    echo [INFO] You can edit .env.local to add your GEMINI_API_KEY (optional)
    echo.
) else (
    echo [OK] .env.local exists
    echo.
)

REM All checks passed, start server
echo ========================================
echo   All checks passed!
echo ========================================
echo.
echo Starting development server...
echo The app will be available at http://localhost:3000
echo.
echo Press Ctrl+C to stop the server
echo ========================================
echo.

REM Start the development server
call npm run dev
set SERVER_EXIT_CODE=!ERRORLEVEL!

REM Check if server exited with error
if !SERVER_EXIT_CODE! NEQ 0 (
    echo.
    echo ========================================
    echo [ERROR] Server stopped with error code: !SERVER_EXIT_CODE!
    echo ========================================
    echo.
    echo Common issues:
    echo   - Port 3000 might be in use (try: netstat -ano ^| findstr :3000)
    echo   - Dependencies might be corrupted (try: npm install)
    echo   - Check Node.js version compatibility
    echo.
)

goto :end

:error_exit
echo.
echo ========================================
echo Script encountered an error.
echo ========================================
echo.
echo If you need help, try running: start-debug.bat
echo.

:end
echo.
echo ========================================
echo Press any key to close this window...
echo ========================================
pause >nul
exit /b 0
