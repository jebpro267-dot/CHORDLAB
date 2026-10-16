@echo off
title ChordLab Launcher
echo ===================================================
echo Starting ChordLab services on permanent ports...
echo ===================================================
echo.
echo [1/3] Starting FastAPI Backend on http://localhost:8000 ...
start "ChordLab API (Port 8000)" cmd /k "python -m uvicorn backend.main:app --host 0.0.0.0 --port 8000 --reload"

echo [2/3] Starting User App on http://localhost:5173 ...
start "ChordLab App (Port 5173)" cmd /k "npm run dev"

echo [3/3] Starting Admin Console on http://localhost:5174 ...
start "ChordLab Admin (Port 5174)" cmd /k "npm run dev:admin"

echo.
echo All services launched!
echo - User Application:  http://localhost:5173/
echo - Admin Portal:      http://localhost:5174/ (or http://localhost:5173/admin/)
echo - Backend API Docs:  http://localhost:8000/docs
echo.
pause
