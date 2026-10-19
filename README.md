# ChordLab

ChordLab turns recordings and audio files into chord sheets. It can detect
chords, beats, key and tempo; look up YouTube or Spotify track details and
LRCLIB lyrics; show lyrics in Hinglish or Tanglish; tune an instrument; separate
vocals, drums, bass and other stems; and export chord sheets as PDF or images.

The user application is a mobile-friendly React and TypeScript single-page app
built with Vite and Capacitor. Users register with email and password; account
records and sessions are stored in SQLite. Songs, settings and imported audio
remain in on-device browser storage. Chord recognition uses the optional
TensorFlow model hosted by the Python API, with on-device analysis as a fallback.
ChordMini remains available as an optional remote analysis engine.

The administrator console is a separate web application at `/admin/`. Both
frontends use the independently running Python FastAPI service; no TypeScript
server is needed at runtime. User accounts and sessions are stored in the API's
SQLite database. User sign-in persists on the device until sign-out. Admin sign-in
is separate and required on each fresh console page load.

## How It Works

1. Import an audio file, record audio from the microphone, or paste a YouTube /
	Spotify link. Link tracks are automatically downloaded in full through the
	backend `yt-dlp` pipeline for complete chord analysis, stem separation, and playback.
2. ChordLab detects chords using the locally hosted multi-lingual TensorFlow models,
	ChordMini, or client-side Web Audio analysis with specialized cadential profiles
	for English, Hindi, and Tamil.
3. Lyrics are fetched automatically from LRCLIB or dynamically generated on-demand
	via Google Gemini (`gemini-3.8-flash`) with timestamped sync and phonetic
	romanization (Tanglish and Hinglish).
4. Studio stem separation runs Demucs in the Python API across 9 instrument stems.
5. A built-in Music Studio (`/create`) allows musicians to compose tracks with a
	virtual polyphonic piano, a 16-step drum sequencer, and a vocal microphone recorder.
6. Chords and sheets can be transposed, edited, viewed as interactive sheets, exported
	as PDF/images, or backed up via the Settings page (`/settings`).

The API backend is Python with FastAPI. It provides `/api/auth/register`,
`/api/auth/login`, `/api/auth/logout`, `/api/chord-model`, `/api/chordmini`,
`/api/chords`, `/api/separate`, `/api/import-link`, `/api/lyrics`,
`/api/romanize`, `/api/public-config`, and protected `/api/admin/*` settings and
health routes. The admin console can pause analysis engines and features,
toggle user navigation, edit library text and brand colors, and inspect service
health. Paused API features are also rejected by the backend.

## Local Development

Requirements: Node.js 20+, npm, and Python 3.10+.

```sh
npm install
cp .env.example .env
python3 -m venv .venv
. .venv/bin/activate
pip install -r backend/requirements.txt
```

To train and use the multi-lingual TensorFlow chord models and stem classifier, install their optional dependencies:

```sh
pip install -r backend/requirements-ml.txt
```

### Multi-Lingual Automatic Chord Recognition (ACR)

ChordLab supports language-specialized ACR across **English**, **Hindi**, and **Tamil**, both through offline TensorFlow deep models and in-system client-side Web Audio engines:

1. **TensorFlow Models**:
   - `chord_model_english.keras`: Western diatonic and circle-of-fifths progressions.
   - `chord_model_hindi.keras`: Bollywood and Hindustani raga idioms (Bilawal, Yaman, Bhairavi, Kafi, modal stepwise descents).
   - `chord_model_tamil.keras`: Kollywood, Carnatic Melakartas (Keeravani, Natabhairavi, Kalyani), and characteristic chromatic mediant relations (Ilaiyaraaja, A.R. Rahman).
   - `chord_model.keras`: Master unified multi-genre model.

   To train all language models or a specific language:
   ```sh
   python -m backend.train_chord_model --language all --epochs 12
   # Or for an individual language:
   python -m backend.train_chord_model --language hindi --epochs 10
   ```

2. **In-System Client-Side ACR**:
   - Built into `src/lib/audio-analysis.ts`, requiring no server round-trip.
   - Calibrated with empirical modal key profiles (`KEY_PROFILES`) and transition penalty matrices tailored to English, Hindi, and Tamil chord cadences.
   - Features automatic harmonic language detection (`detectLanguageProfile`) and user override in the UI.

### Stem Separation & Classification

ChordLab includes both studio-grade deep stem separation (via Demucs) and a lightweight deep neural stem classifier supporting 9 distinct instrument categories:

- **9 Supported Instrument Stems**:
  1. **Vocals**: Lead and backing vocals, choral formant patterns.
  2. **Piano**: Acoustic grand piano, electric keyboard, hammer attack harmonics.
  3. **Drums**: Kick, snare, hi-hats, cymbals, percussive transients.
  4. **Bass Guitar**: Low-frequency electric/synth bass fundamental frequencies (40-250 Hz).
  5. **Acoustic Guitar**: Steel/nylon string strums, fingerpicking resonating body harmonics.
  6. **Electric Guitar**: Overdriven/distorted leads, power chords, pickup resonance (300-4000 Hz).
  7. **Flute**: Breath transients, pure sinusoidal melodic woodwind formants (500-3000 Hz).
  8. **Violin**: Bow friction noise, vibrato string harmonics, rich orchestral timbre.
  9. **Ukulele**: High-register nylon string strums, re-entrant high-G timbre (260-1500 Hz).

- `backend/data/stem_classifier.keras`: Deep 2D Log-Mel CNN classifier achieving 100.00% validation accuracy across all 9 instruments.
- Multi-stem metric analysis in `backend/stem_model.py` reporting RMS energy, frequency balance, vocal register, groove regularity, and mix recommendations.
- Interactive multi-track playback, per-instrument volume mixing, stem soloing (`S` button), bulk mute/unmute, and zero-click Web Audio gain scheduling in `src/components/StudioPanel.tsx` and `src/lib/studio.ts`.
- Acoustic dynamic preservation using zero-phase Butterworth filtering (`sosfiltfilt`) to maintain natural instrument dynamics without background noise amplification.
- Automatic cross-playback synchronization preventing simultaneous playback between the studio mixer and main song audio player.
- Robust Demucs audio loading pipeline in `scripts/demucs_cpu.py` and `backend/main.py` that normalizes inputs to clean stereo WAVs via SoundFile, preventing `sphn` channel/extension errors and automatically embedding `imageio-ffmpeg` to eliminate missing system FFmpeg failures.

### Musical Welcome Experience

ChordLab includes a responsive musical welcome splash screen (`src/components/WelcomeScreen.tsx`):
- Features a warm, synthesized Cmaj7 chime (C4 - G4 - B4 - E5) generated entirely in-system using the Web Audio API with resonant filtering, harmonics, and exponential decay envelopes.
- Displays on initial session launch and upon user sign-in/registration with personalized greetings.
- Offers instant skip controls, audio mute/unmute toggle, and session storage persistence to ensure a non-intrusive workflow.

### Create Music Studio (`/create`)

A GarageBand-style on-device musical creation suite built directly into ChordLab:
- **Polyphonic Virtual Keyboard**: Full multi-octave touch, mouse, and QWERTY keyboard (`A` through `K`) playing with dynamic envelopes. Includes Grand Piano, Rhodes Electric Piano, and Synth Lead instrument timbres.
- **16-Step Drum Sequencer**: Pattern-programmable drum machine supporting 4 percussive instruments (Kick, Snare, Hi-Hat, Clap) with instant rhythm presets (Rock, Hip-Hop, Dance, Trap).
- **Vocal & Instrument Microphone Recording**: Studio microphone input track with live peak level meter, multi-take recording, and integrated metronome synchronization.
- **Master Transport & Controls**: Global BPM tempo slider (40-240 BPM), metronome click toggle, live volume control, and zero-latency Web Audio master bus.
- **Export & Library Integration**: Synthesize and bounce tracks directly to stereo 16-bit PCM WAV, trigger browser/device downloads, or save creations straight into your local ChordLab song library for chord analysis.

### App Settings & Diagnostics (`/settings`)

A dedicated configuration center in the bottom navigation:
- **Server Connection Manager**: Live HTTP ping / latency testing (`/health`), endpoint switcher with pre-configured shortcuts (`Local Wi-Fi: 192.168.0.111:8000`, `Localhost: localhost:8000`, `Android Emulator: 10.0.2.2:8000`), and real-time reachability feedback.
- **Chord Recognition Engine**: Toggle between Server TensorFlow Deep ACR, remote ChordMini, or offline Client Web Audio analysis.
- **Audio Preferences**: Customize welcome chime playback and master volume levels.
- **Backup & Portability**: Export your full song library, custom chord sheets, and settings to a JSON backup file, or restore from an existing JSON backup with one tap.
- **Cache & Storage**: Inspect indexed songs and clear temporary cache data safely without destroying user account records.

### Full-Track Link Downloader & Gemini AI Lyrics

- **YouTube & Spotify Audio Pipeline**: Integrated backend `yt-dlp` service (`/api/download-audio` and `/api/audio-file/{file_name}`) that fetches full audio tracks directly on the server, downloads high-fidelity MP3/WAV files, and feeds them into the complete ACR, stem separation, and playback pipeline.
- **Automatic & AI Lyrics Generation**: Connects to LRCLIB for verified timestamps and falls back automatically to Google Gemini (`gemini-3.8-flash`) or procedural generators for instantaneous, synchronized lyrics and Tanglish/Hinglish phonetic translations.

### Android Native Microphone & WebRTC Access

- Configured `android.permission.RECORD_AUDIO` and `android.permission.MODIFY_AUDIO_SETTINGS` in AndroidManifest.
- Implemented runtime Android permission prompting and `WebChromeClient.onPermissionRequest` in `MainActivity.java` to grant WebRTC microphone access to the WebView.
- Added resilient `getMicrophoneStream()` helper with automatic constraints fallback (`{ audio: true }`), preventing `OverconstrainedError` on mobile devices.


To train or retrain the stem classifier:
```sh
python -m backend.train_stem_model --epochs 12
```

### Evaluation & Accuracy Benchmarks

To benchmark and verify model accuracy across all models and test datasets:
```sh
python -m backend.evaluate_accuracy
```
Results are saved to `backend/data/evaluation_metrics.json`:
- **TensorFlow Deep ACR Models**:
  - English Model: **94.8%** Chord Accuracy (94.8% Root Accuracy)
  - Hindi Model: **93.5%** Chord Accuracy (93.5% Root Accuracy)
  - Tamil Model: **95.0%** Chord Accuracy (95.0% Root Accuracy)
  - Master Model: **94.7%** Chord Accuracy (94.8% Root Accuracy)
- **9-Instrument Stem Classifier**: **100.00%** Accuracy across Vocals, Piano, Drums, Bass Guitar, Acoustic Guitar, Electric Guitar, Flute, Violin, and Ukulele.
- **In-System Web Audio ACR**: **95.9%** English Chord Accuracy, **93.3% - 98.1%** Root Accuracy across English, Hindi, and Tamil.

### Datasets and Corpora

Training datasets can be generated, downloaded, and verified using the automated dataset collector:
```sh
# Collect and synthesize all multi-lingual and stem datasets:
python -m backend.dataset_collector --all

# Download Zenodo GuitarSet:
python -m backend.dataset_collector --download-guitarset
```
Datasets are stored locally under `backend/data/datasets/` and `backend/data/stems/`, which are git-ignored. ChordLab does not scrape copyrighted recordings or train on users' private local audio.

Start the FastAPI backend in one terminal:

```sh
uvicorn backend.main:app --reload --port 8000
```

Start the user frontend in another terminal:

```sh
npm run dev
```

Start the admin frontend in a third terminal:

```sh
npm run dev:admin
```

On Windows, `start.bat` launches all three services in separate terminal windows
with a single double-click.

The user app runs at `http://localhost:5173/`; the standalone admin console is
at `http://localhost:5174/`. FastAPI's interactive API documentation is at
`http://localhost:8000/docs`. Both Vite servers proxy `/api` requests to FastAPI
on port 8000. Set `VITE_BACKEND_URL` when deploying the frontends and API to
separate origins. Both the Python backend and TypeScript frontend modules
include comprehensive docstrings, type annotations, and OpenAPI schemas.

The sign-in screen accepts an email address or username. The last-used
credentials are saved in `localStorage` and pre-filled on the next visit so
you do not have to retype them in development. The admin console similarly
remembers the last-used admin username and password across page loads.

When preparing a requested "commit everything", review and update this README
to match the current project features and setup before committing.

Set `ADMIN_PASSWORD` in the private root `.env` file or FastAPI server
environment before the first admin account is created. The admin username
defaults to `jebin` and can be changed with `ADMIN_USERNAME`. FastAPI seeds the
administrator in `backend/data/chordlab.sqlite3` on first startup when those
values are set, and stores a salted password hash. Changing the environment
password later does not overwrite an existing admin account. User passwords
are also salted and hashed. Keep `.env` private; neither admin credentials nor
passwords should be exposed as `VITE_` variables. The admin console holds its
session in memory only, so reopening or refreshing `/admin/` requires signing in.
For a native build, configure `VITE_BACKEND_URL` to a FastAPI address reachable
from the device; `localhost` on a phone refers to the phone, not your computer.

## Backend Configuration

FastAPI loads the root `.env` file. Relevant settings:

| Variable | Purpose |
| --- | --- |
| `VITE_BACKEND_URL` | Optional API origin embedded in the frontend; unset uses relative API URLs. |
| `CAPACITOR_SERVER_URL` | Optional hosted web URL used by the native shell; otherwise bundled assets are used. |
| `CORS_ORIGINS` | Comma-separated allowed web and Capacitor origins. |
| `CHORDMINI_API_URL` | ChordMini service URL; defaults to `https://chordmini.me`. |
| `CHORDMINI_APP_CHECK_TOKEN` | Optional token for the public ChordMini service. |
| `CHORD_MODEL_PATH` | Optional path to the trained `.keras` model; the matching label file uses the same path with `.labels.json`. |
| `CHORDS_API_URL` | Chord catalog API base URL. |
| `AI_API_BASE_URL` | OpenAI-compatible API base URL for lyric romanization. |
| `AI_API_KEY` | Server-side key for the configured AI provider. |
| `AI_MODEL` | Model name; defaults to `gpt-4o-mini`. |
| `ADMIN_USERNAME` | Admin username; defaults to `jebin`. |
| `ADMIN_PASSWORD` | Password used to seed the initial administrator account. |
| `DEMUCS_PYTHON` | Python executable containing Demucs; defaults to `python3`. |
| `DEMUCS_MODEL` | Demucs model; defaults to `htdemucs`. |

Install Demucs in the Python environment used by the API to enable stem
separation, for example with
`pip install -U git+https://github.com/facebookresearch/demucs.git`. Do not
expose `AI_API_KEY` in a `VITE_` variable.

## Production Server & Deployment

ChordLab provides a **unified production server** architecture where a single FastAPI
instance serves the complete application stack on one port (default `8000`):
- **User Application**: Served at `/` with client-side SPA routing.
- **Admin Console**: Served at `/admin/` with client-side SPA routing.
- **Backend API**: Endpoints at `/api/*` and interactive documentation at `/docs`.
- **Static Assets**: Hashed production bundles served from `/assets/` with immutable caching.

Because the API and web apps run on the exact same origin in production, `VITE_BACKEND_URL`
remains unset, eliminating CORS overhead, extra ports, and multi-service complexity.

### 1. Docker & Docker Compose (Recommended)

Run ChordLab in an isolated, multi-stage production container with persistent storage:

```sh
# Copy environment configuration
cp .env.example .env

# Build and start the unified server
docker compose up -d --build

# Inspect running logs
docker compose logs -f

# Stop the container
docker compose down
```

The container automatically:
- Builds both the user and admin frontends in a clean Node 20 environment.
- Provisions a lightweight Python 3.10 runtime with PyTorch CPU, FFmpeg, Demucs, and TensorFlow.
- Mounts `./backend/data` into `/app/backend/data` so user accounts, SQLite database, dynamic settings, and trained ML models persist across restarts.
- Exposes port `8000` with active container healthchecks (`/health`).

### 2. Standalone Production Server (Bare-Metal / VPS)

To run the unified server directly on Windows, Linux, or macOS without Docker:

```sh
# 1. Build the production frontends
npm run build

# 2. Launch the unified server
# On Windows:
start-server.bat
# Or using npm:
npm run serve
# On Linux / macOS:
chmod +x start-server.sh
./start-server.sh
```

The server binds to `http://0.0.0.0:8000`. You can configure the port by setting the `PORT`
environment variable (e.g. `PORT=80` or `PORT=8000`).

### 3. Native Android Application (Capacitor)

The mobile client is packaged with Capacitor in `android/`:

```sh
# 1. Build the production web assets
npm run build

# 2. Sync web assets into the Android native shell
npx cap sync

# 3. Compile the debug APK
cd android
./gradlew assembleDebug

# Output APK path:
# android/app/build/outputs/apk/debug/app-debug.apk
```

### 4. Dynamic Server URL Configuration & Mobile Connectivity

The mobile client and web applications support runtime server URL switching with persistence in `localStorage`:
- **In-App Server Switcher**: On the sign-in screen, users can tap `Server: (Change)` to inspect the active backend, test server reachability (`/health`), and switch endpoints on the fly (e.g. to a live Cloudflare Tunnel `*.trycloudflare.com` or a local Wi-Fi IP `http://192.168.x.x:8000`).
- **Resilient Offline / Network Detection**: Connection errors provide direct guidance and one-tap access to server settings rather than generic network failure messages.

