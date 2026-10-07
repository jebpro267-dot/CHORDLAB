# ChordLab

ChordLab turns recordings and audio files into chord sheets. It can detect
chords, beats, key and tempo; look up YouTube or Spotify track details and
LRCLIB lyrics; show lyrics in Hinglish or Tanglish; tune an instrument; separate
vocals, drums, bass and other stems; and export chord sheets as PDF or images.

The web interface is a React and TypeScript app built with TanStack Start and
Vite. Song data, settings and imported audio are stored in the browser, so the
core library does not require an account. Audio analysis runs locally in the
browser by default, with ChordMini available as a server-assisted option.

## How It Works

1. Import an audio file or record audio from the microphone. A YouTube or Spotify
	link imports track metadata only; those services do not provide downloadable
	audio through this app.
2. ChordLab tries ChordMini for beat and chord recognition when enabled. If it
	is unavailable, Web Audio analysis estimates the chords on the device.
3. Optional API requests look up chord diagrams, track lyrics and link metadata.
	Romanization uses the configured AI provider, with an offline Tanglish
	fallback for Tamil text.
4. The result is saved locally and can be edited, transposed, viewed as a chord
	sheet, and exported. Studio stem separation runs Demucs in the Python API.

The API backend is Python with FastAPI. It provides `/api/chordmini`,
`/api/chords`, `/api/separate`, `/api/import-link`, `/api/lyrics`, and
`/api/romanize`. TanStack Start still serves the TypeScript-rendered web app;
the application API and audio-processing backend run as a separate FastAPI
service.

## Local Development

Requirements: Node.js 20+, npm, and Python 3.10+.

```sh
npm install
cp .env.example .env
python3 -m venv .venv
. .venv/bin/activate
pip install -r backend/requirements.txt
```

Start the FastAPI API in one terminal:

```sh
uvicorn backend.main:app --reload --port 8000
```

Start the web app in another terminal:

```sh
npm run dev
```

The web app runs on Vite's local development URL. FastAPI's interactive API
documentation is available at `http://localhost:8000/docs`. Set
`VITE_BACKEND_URL` if the API is hosted somewhere other than
`http://localhost:8000`.

## Backend Configuration

FastAPI loads the root `.env` file. Relevant settings:

| Variable | Purpose |
| --- | --- |
| `VITE_BACKEND_URL` | API base URL embedded in the web app build. |
| `CAPACITOR_SERVER_URL` | Optional hosted web URL used by the native shell; otherwise bundled assets are used. |
| `CORS_ORIGINS` | Comma-separated allowed web and Capacitor origins. |
| `CHORDMINI_API_URL` | ChordMini service URL; defaults to `https://chordmini.me`. |
| `CHORDMINI_APP_CHECK_TOKEN` | Optional token for the public ChordMini service. |
| `CHORDS_API_URL` | Chord catalog API base URL. |
| `AI_API_BASE_URL` | OpenAI-compatible API base URL for lyric romanization. |
| `AI_API_KEY` | Server-side key for the configured AI provider. |
| `AI_MODEL` | Model name; defaults to `gpt-4o-mini`. |
| `DEMUCS_PYTHON` | Python executable containing Demucs; defaults to `python3`. |
| `DEMUCS_MODEL` | Demucs model; defaults to `htdemucs`. |

Install Demucs in the Python environment used by the API to enable stem
separation, for example with
`pip install -U git+https://github.com/facebookresearch/demucs.git`. Do not
expose `AI_API_KEY` in a `VITE_` variable. In production,
deploy the frontend and FastAPI service separately, set the frontend's
`VITE_BACKEND_URL` to the public API origin, and configure the corresponding
`CORS_ORIGINS` value on FastAPI.
