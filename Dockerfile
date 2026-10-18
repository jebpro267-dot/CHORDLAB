# =============================================================================
# Stage 1: Build Frontend Single-Page Applications (User App & Admin Console)
# =============================================================================
FROM node:20-slim AS frontend-builder
WORKDIR /app

# Install dependencies with frozen lockfile for deterministic builds
COPY package.json package-lock.json ./
RUN npm ci

# Copy frontend source files and configuration
COPY tsconfig.json vite.config.ts vite.admin.config.ts ./
COPY index.html ./
COPY admin ./admin
COPY public ./public
COPY src ./src

# Build production bundles into /app/dist (both user and admin applications)
RUN npm run build

# =============================================================================
# Stage 2: Production Python Server (FastAPI + ML Models + Static SPAs)
# =============================================================================
FROM python:3.10-slim AS production

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PORT=8000 \
    HOST=0.0.0.0

# Install system dependencies:
# - ffmpeg: audio decoding, stem separation, and conversion
# - libsndfile1: uncompressed audio I/O for SoundFile
# - curl: container healthcheck probe
# - git & build-essential: required for Demucs and specific C extensions
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    libsndfile1 \
    curl \
    ca-certificates \
    git \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install PyTorch CPU wheels first to keep the Docker image lightweight (~200MB vs ~3GB CUDA)
RUN pip install --no-cache-dir --upgrade pip && \
    pip install --no-cache-dir torch torchaudio --index-url https://download.pytorch.org/whl/cpu

# Install Python requirements
COPY backend/requirements.txt ./backend/
RUN pip install --no-cache-dir -r backend/requirements.txt

# Install ML requirements (Demucs, Librosa, SoundFile, TensorFlow)
COPY backend/requirements-ml.txt ./backend/
RUN pip install --no-cache-dir -r backend/requirements-ml.txt

# Copy built frontend assets from builder stage
COPY --from=frontend-builder /app/dist ./dist

# Copy application backend, helper scripts, and lexicon
COPY backend ./backend
COPY scripts ./scripts
COPY src/lib/tanglish-lexicon.json ./src/lib/tanglish-lexicon.json

# Expose port (default 8000)
EXPOSE 8000

# Health check probe
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
    CMD curl -f http://localhost:8000/health || exit 1

# Launch the unified FastAPI application using Uvicorn
CMD ["uvicorn", "backend.main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "2"]
