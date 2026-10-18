#!/usr/bin/env bash
set -e

echo "==================================================="
echo "ChordLab - Unified Production Server"
echo "==================================================="
echo ""

if [ ! -d "dist" ]; then
    echo "[1/2] Production frontend build not found. Building now..."
    npm run build
    echo "[OK] Frontend built successfully."
else
    echo "[1/2] Using existing production frontend build in /dist"
fi

PORT="${PORT:-8000}"
HOST="${HOST:-0.0.0.0}"

echo ""
echo "[2/2] Launching unified FastAPI server on http://${HOST}:${PORT}..."
echo ""
echo "- Web Application:  http://${HOST}:${PORT}/"
echo "- Admin Portal:     http://${HOST}:${PORT}/admin/"
echo "- API Documentation: http://${HOST}:${PORT}/docs"
echo ""
echo "Press Ctrl+C to stop the server."
echo "==================================================="
echo ""

exec uvicorn backend.main:app --host "${HOST}" --port "${PORT}" --workers "${WORKERS:-2}"
