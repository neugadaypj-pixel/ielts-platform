@echo off
echo ========================================
echo   Writing Test Fix - Auto Restart
echo ========================================
echo.
echo This script will:
echo 1. Stop any running server
echo 2. Start the server
echo 3. Wait for it to be ready
echo 4. Open the cache clear page
echo 5. Open a test writing test
echo.
echo Press Ctrl+C to cancel, or
pause

echo.
echo [1/5] Stopping any running Node processes...
taskkill /F /IM node.exe 2>nul
timeout /t 2 /nobreak >nul

echo [2/5] Starting server...
start "Test Platform Server" cmd /k "npm start"

echo [3/5] Waiting for server to start (15 seconds)...
timeout /t 15 /nobreak

echo [4/5] Opening cache clear page...
start http://localhost:3000/force-clear-cache

echo [5/5] Waiting 3 seconds...
timeout /t 3 /nobreak

echo.
echo ========================================
echo   Setup Complete!
echo ========================================
echo.
echo Next steps:
echo 1. Wait for the cache clear page to load
echo 2. Click the link to go to admin dashboard
echo 3. Navigate to a writing test
echo 4. Test that timer and buttons work!
echo.
echo The server is running in a separate window.
echo Close that window to stop the server.
echo.
pause
