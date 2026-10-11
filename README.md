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

1. Import an audio file or record audio from the microphone. A YouTube or Spotify
	link imports track metadata only; those services do not provide downloadable
	audio through this app.
2. ChordLab tries the locally hosted TensorFlow chord recognizer when enabled.
	If it has not been trained or is unavailable, ChordMini and then Web Audio
	analysis can provide fallbacks. ChordMini is also an optional alternative
	engine.
3. Optional API requests look up chord diagrams, track lyrics and link metadata.
	Romanization uses the configured AI provider, with an offline Tanglish
	fallback for Tamil text.
4. The result is saved locally and can be edited, transposed, viewed as a chord
	sheet, and exported. Studio stem separation runs Demucs in the Python API.

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

To train and use the TensorFlow chord model, install its optional dependencies
and download GuitarSet:

```sh
pip install -r backend/requirements-ml.txt
python -m backend.train_chord_model --download
```

For a quick baseline, run
`python -m backend.train_chord_model --max-groups 12 --epochs 5`. The full
dataset command above trains on all available song groups. Both modes keep
validation recordings separate by song group and report held-out accuracy.
Training outputs the `.keras` model and matching `.labels.json` file to
`backend/data/`.

The training command downloads GuitarSet's mono microphone audio and chord
annotations from [Zenodo](https://zenodo.org/records/3371780) (about 696 MB),
verifies their checksums, and stores the dataset and resulting model under
`backend/data/`, which is git-ignored. GuitarSet is released under CC BY 4.0;
cite Xi et al., *GuitarSet: A Dataset for Guitar Transcription*, ISMIR 2018, if
you use it. To train from an already extracted copy, pass `--data-dir PATH`
without `--download`. Training keeps validation recordings separate from
training recordings. The included initial baseline was trained on all 30 song
groups for 6 epochs and reached 32.6% held-out chord accuracy; retrain it with
more epochs and evaluate it on your own recordings before relying on it. The
dataset is guitar-focused, so results may not generalize to other instruments
or recording styles. ChordLab does not train on users' local audio or scrape
copyrighted recordings; audio without aligned chord labels is not suitable
supervised training data.

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
expose `AI_API_KEY` in a `VITE_` variable. In production,
deploy the frontend and FastAPI service separately, set the frontend's
`VITE_BACKEND_URL` to the public API origin, and configure the corresponding
`CORS_ORIGINS` value on FastAPI.
