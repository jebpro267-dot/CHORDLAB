# ChordLab

ChordLab turns recordings and audio files into chord sheets. It can detect
chords, beats, key and tempo; look up YouTube or Spotify track details and
LRCLIB lyrics; show lyrics in Hinglish or Tanglish; tune an instrument; separate
vocals, drums, bass and other stems; and export chord sheets as PDF or images.

The user application is a mobile-friendly React and TypeScript single-page app
built with Vite and Capacitor. Users register with email and password; account
records and sessions are stored in SQLite. Songs, settings and imported audio
remain in on-device browser storage. Audio analysis runs locally by default,
with ChordMini available as an optional server-assisted engine.

The administrator console is a separate web application at `/admin/`. Both
frontends use the independently running Python FastAPI service; no TypeScript
server is needed at runtime. User accounts and sessions are stored in the API's
SQLite database. User sign-in persists on the device until sign-out. Admin sign-in
is separate and required on each fresh console page load.

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

The API backend is Python with FastAPI. It provides `/api/auth/register`,
`/api/auth/login`, `/api/auth/logout`, `/api/chordmini`,
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

The user app runs at `http://localhost:5173/`; the standalone admin console is
at `http://localhost:5174/`. FastAPI's interactive API documentation is at
`http://localhost:8000/docs`. Both Vite servers proxy `/api` requests to FastAPI
on port 8000. Set `VITE_BACKEND_URL` when deploying the frontends and API to
separate origins.

Set `ADMIN_PASSWORD` on the FastAPI server before the first admin sign-in. The
admin username defaults to `jebin` and can be changed with `ADMIN_USERNAME`.
On first authentication, FastAPI creates the administrator in
`backend/data/chordlab.sqlite3` and stores a salted password hash. User passwords
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
expose `AI_API_KEY` in a `VITE_` variable. In production,
deploy the frontend and FastAPI service separately, set the frontend's
`VITE_BACKEND_URL` to the public API origin, and configure the corresponding
`CORS_ORIGINS` value on FastAPI.
