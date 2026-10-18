@echo off
title ChordLab Production Server
echo ===================================================
echo ChordLab - Unified Production Server
echo ===================================================
echo.

if not exist dist (
    echo [1/2] Production frontend build not found. Building now...
    call npm.cmd run build
    if errorlevel 1 (
        echo [ERROR] Frontend build failed. Exiting.
        pause
        exit /b 1
    )
    echo [OK] Frontend built successfully.
) else (
    echo [1/2] Using existing production frontend build in /dist
)

echo.
echo [2/2] Launching unified FastAPI server on port 8000...
echo.
echo - Web Application:  http://localhost:8000/
echo - Admin Portal:     http://localhost:8000/admin/
echo - API Documentation: http://localhost:8000/docs
echo.
echo Press Ctrl+C to stop the server.
echo ===================================================
echo.

python -m uvicorn backend.main:app --host 0.0.0.0 --port 8000
pause
