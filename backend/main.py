from __future__ import annotations

import asyncio
import base64
import hashlib
import hmac
import importlib.util
import json
import os
import re
import secrets
import sqlite3
import subprocess
import tempfile
import zipfile
from pathlib import Path
from urllib.parse import quote, urlsplit

import httpx
from fastapi import Depends, FastAPI, File, Form, Header, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field, HttpUrl
from starlette.concurrency import run_in_threadpool
from dotenv import load_dotenv


ROOT = Path(__file__).resolve().parent.parent
load_dotenv(ROOT / ".env")
SETTINGS_PATH = ROOT / "backend" / "data" / "app_settings.json"
DATABASE_PATH = Path(os.getenv("APP_DATABASE_PATH", ROOT / "backend" / "data" / "chordlab.sqlite3"))
MAX_ANALYSIS_BYTES = 20 * 1024 * 1024
MAX_SEPARATION_BYTES = 50 * 1024 * 1024
STEM_NAMES = ("vocals", "drums", "bass", "other")
CHORDMINI_DEFAULT = "https://chordmini.me"
CHORDS_DEFAULT = "https://chords.alday.dev/v1"
TAMIL_RE = re.compile(r"[\u0b80-\u0bff]")
LRC_STAMP = re.compile(r"\[(\d{1,2}):(\d{2})(?:[.:](\d{1,3}))?\]")

VOWELS = {
    "அ": "a", "ஆ": "aa", "இ": "i", "ஈ": "ee", "உ": "u", "ஊ": "oo",
    "எ": "e", "ஏ": "ae", "ஐ": "ai", "ஒ": "o", "ஓ": "oa", "ஔ": "au",
}
SIGNS = {
    "ா": "aa", "ி": "i", "ீ": "ee", "ு": "u", "ூ": "oo", "ெ": "e",
    "ே": "ae", "ை": "ai", "ொ": "o", "ோ": "oa", "ௌ": "au", "்": "",
}
CONSONANTS = {
    "க": "k", "ங": "ng", "ச": "ch", "ஞ": "nj", "ட": "t", "ண": "n",
    "த": "th", "ந": "n", "ப": "p", "ம": "m", "ய": "y", "ர": "r",
    "ல": "l", "வ": "v", "ழ": "zh", "ள": "l", "ற": "r", "ன": "n",
    "ஜ": "j", "ஶ": "sh", "ஷ": "sh", "ஸ": "s", "ஹ": "h",
}

try:
    TANGLISH_LEXICON = json.loads((ROOT / "src/lib/tanglish-lexicon.json").read_text())
except (OSError, json.JSONDecodeError):
    TANGLISH_LEXICON = {}

app = FastAPI(title="ChordLab API", version="1.0.0")
allowed_origins = [
    origin.strip()
    for origin in os.getenv(
        "CORS_ORIGINS",
        "http://localhost:5173,http://127.0.0.1:5173,capacitor://localhost,http://localhost",
    ).split(",")
    if origin.strip()
]
app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins,
    allow_origin_regex=r"https?://(localhost|127\.0\.0\.1)(:\d+)?",
    allow_credentials=False,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["Content-Type", "Authorization"],
)


class LinkImport(BaseModel):
    url: HttpUrl


class LyricsLookup(BaseModel):
    title: str = Field(min_length=1, max_length=200)
    artist: str | None = Field(default=None, max_length=200)
    duration: float | None = Field(default=None, ge=0, le=3600)


class RomanizeRequest(BaseModel):
    lyrics: str = Field(min_length=1)
    style: str = Field(pattern="^(hinglish|tanglish|auto|english)$")


class UserCredentials(BaseModel):
    email: str = Field(min_length=3, max_length=254)
    password: str = Field(min_length=8, max_length=128)


class AdminCredentials(BaseModel):
    username: str = Field(min_length=1, max_length=80)
    password: str = Field(min_length=1, max_length=128)


class FeatureFlags(BaseModel):
    song_analysis: bool = True
    tensorflow_analysis: bool = True
    chordmini_analysis: bool = True
    local_analysis: bool = True
    link_import: bool = True
    lyrics_lookup: bool = True
    lyric_romanization: bool = True
    stem_separation: bool = True
    chord_diagrams: bool = True
    live_detection: bool = True
    tuner: bool = True


class NavigationSettings(BaseModel):
    library: bool = True
    analyze: bool = True
    live: bool = True
    chords: bool = True
    tuner: bool = True


class AppearanceSettings(BaseModel):
    app_name: str = Field(default="ChordLab", min_length=1, max_length=40)
    home_title: str = Field(default="Your song library", min_length=1, max_length=80)
    home_description: str = Field(
        default="Chords, key, tempo, lyrics and printable sheets — all on your device.",
        min_length=1,
        max_length=240,
    )
    empty_title: str = Field(default="No songs analyzed yet", min_length=1, max_length=80)
    empty_description: str = Field(
        default="Upload an audio file and ChordLab will work out the chords, key and tempo.",
        min_length=1,
        max_length=240,
    )
    primary_color: str = Field(default="#eeb64a", pattern="^#[0-9a-fA-F]{6}$")
    accent_color: str = Field(default="#4bbdb4", pattern="^#[0-9a-fA-F]{6}$")


class LayoutSettings(BaseModel):
    show_quick_actions: bool = True
    show_song_search: bool = True


class AppSettings(BaseModel):
    features: FeatureFlags = Field(default_factory=FeatureFlags)
    navigation: NavigationSettings = Field(default_factory=NavigationSettings)
    appearance: AppearanceSettings = Field(default_factory=AppearanceSettings)
    layout: LayoutSettings = Field(default_factory=LayoutSettings)


def load_app_settings() -> AppSettings:
    try:
        payload = json.loads(SETTINGS_PATH.read_text())
        return AppSettings.model_validate(payload)
    except (OSError, json.JSONDecodeError, ValueError):
        return AppSettings()


def save_app_settings(settings: AppSettings) -> AppSettings:
    SETTINGS_PATH.parent.mkdir(parents=True, exist_ok=True)
    temporary = SETTINGS_PATH.with_suffix(".tmp")
    temporary.write_text(json.dumps(settings.model_dump(mode="json"), indent=2) + "\n")
    temporary.replace(SETTINGS_PATH)
    return settings


def _connect_database() -> sqlite3.Connection:
    DATABASE_PATH.parent.mkdir(parents=True, exist_ok=True)
    connection = sqlite3.connect(DATABASE_PATH, timeout=10)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA foreign_keys = ON")
    return connection


def _hash_password(password: str) -> str:
    salt = secrets.token_bytes(16)
    iterations = 420_000
    digest = hashlib.pbkdf2_hmac("sha256", password.encode(), salt, iterations)
    return "$".join((
        "pbkdf2_sha256",
        str(iterations),
        base64.b64encode(salt).decode(),
        base64.b64encode(digest).decode(),
    ))


def _verify_password(password: str, stored: str) -> bool:
    try:
        algorithm, rounds, salt, expected = stored.split("$", 3)
        if algorithm != "pbkdf2_sha256":
            return False
        digest = hashlib.pbkdf2_hmac(
            "sha256", password.encode(), base64.b64decode(salt), int(rounds)
        )
        return hmac.compare_digest(base64.b64encode(digest).decode(), expected)
    except (ValueError, TypeError):
        return False


def _initialize_auth_database() -> None:
    with _connect_database() as connection:
        connection.execute(
            """CREATE TABLE IF NOT EXISTS accounts (
                id TEXT PRIMARY KEY,
                kind TEXT NOT NULL CHECK (kind IN ('user', 'admin')),
                email TEXT UNIQUE,
                username TEXT UNIQUE,
                password_hash TEXT NOT NULL,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            )"""
        )
        connection.execute(
            """CREATE TABLE IF NOT EXISTS sessions (
                token_hash TEXT PRIMARY KEY,
                account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            )"""
        )
        admin_password = os.getenv("ADMIN_PASSWORD", "")
        admin_username = os.getenv("ADMIN_USERNAME", "jebin").strip()
        if admin_password and admin_username:
            existing_admin = connection.execute(
                "SELECT id FROM accounts WHERE kind = 'admin' LIMIT 1"
            ).fetchone()
            if existing_admin is None:
                connection.execute(
                    "INSERT INTO accounts (id, kind, username, password_hash) VALUES (?, 'admin', ?, ?)",
                    (secrets.token_hex(16), admin_username, _hash_password(admin_password)),
                )


def _issue_session(account_id: str, replace_existing: bool = False) -> str:
    token = secrets.token_urlsafe(36)
    token_hash = hashlib.sha256(token.encode()).hexdigest()
    with _connect_database() as connection:
        if replace_existing:
            connection.execute("DELETE FROM sessions WHERE account_id = ?", (account_id,))
        connection.execute(
            "INSERT INTO sessions (token_hash, account_id) VALUES (?, ?)",
            (token_hash, account_id),
        )
    return token


def _account_for_token(token: str) -> sqlite3.Row | None:
    _initialize_auth_database()
    token_hash = hashlib.sha256(token.encode()).hexdigest()
    with _connect_database() as connection:
        return connection.execute(
            """SELECT accounts.id, accounts.kind, accounts.email, accounts.username
               FROM sessions JOIN accounts ON accounts.id = sessions.account_id
               WHERE sessions.token_hash = ?""",
            (token_hash,),
        ).fetchone()


def require_account(authorization: str | None = Header(default=None)) -> sqlite3.Row:
    token = authorization.removeprefix("Bearer ") if authorization else ""
    if not token:
        raise HTTPException(401, "Sign in to continue")
    account = _account_for_token(token)
    if account is None:
        raise HTTPException(401, "Session expired. Please sign in again.")
    return account


def require_admin(account: sqlite3.Row = Depends(require_account)) -> sqlite3.Row:
    if account["kind"] != "admin":
        raise HTTPException(403, "Administrator access required")
    return account


def require_user(account: sqlite3.Row = Depends(require_account)) -> sqlite3.Row:
    if account["kind"] != "user":
        raise HTTPException(403, "User account required")
    return account


def _session_response(account: sqlite3.Row, token: str) -> dict:
    identity = {"id": account["id"], "role": account["kind"]}
    if account["email"]:
        identity["email"] = account["email"]
    if account["username"]:
        identity["username"] = account["username"]
    return {"token": token, "account": identity}


def require_feature(feature: str) -> None:
    if not getattr(load_app_settings().features, feature):
        raise HTTPException(503, f"{feature.replace('_', ' ').capitalize()} is paused by the administrator")


def _unwrap_result(payload: object, keys: tuple[str, ...]) -> dict:
    if isinstance(payload, list):
        return {"results": payload}
    if not isinstance(payload, dict):
        return {}
    for key in keys:
        if isinstance(payload.get(key), list):
            return {key: payload[key]}
    return payload


async def _call_chordmini(
    client: httpx.AsyncClient,
    base: str,
    path: str,
    audio: bytes,
    filename: str,
    model: str,
    app_check: str | None,
) -> object:
    data = {"detector": model, "model": model} if model else {}
    headers = {"X-Firebase-AppCheck": app_check} if app_check else {}
    response = await client.post(
        f"{base}{path}",
        files={"file": (filename or "audio", audio)},
        data=data,
        headers=headers,
        timeout=120,
    )
    if response.status_code == 429:
        raise HTTPException(429, "ChordMini is rate-limited right now")
    try:
        payload = response.json()
    except ValueError:
        payload = {}
    if response.is_error or (isinstance(payload, dict) and payload.get("success") is False):
        if isinstance(payload, dict):
            detail = payload.get("error", payload.get("message", f"{path} returned {response.status_code}"))
        else:
            detail = f"{path} returned {response.status_code}"
        raise RuntimeError(str(detail))
    return payload


@app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok", "service": "ChordLab API"}


@app.post("/api/auth/register")
async def register_user(credentials: UserCredentials) -> dict:
    email = credentials.email.strip().lower()
    if not re.fullmatch(r"[^@\s]+@[^@\s]+\.[^@\s]+", email):
        raise HTTPException(422, "Enter a valid email address")
    _initialize_auth_database()
    account_id = secrets.token_hex(16)
    try:
        with _connect_database() as connection:
            connection.execute(
                "INSERT INTO accounts (id, kind, email, password_hash) VALUES (?, 'user', ?, ?)",
                (account_id, email, _hash_password(credentials.password)),
            )
    except sqlite3.IntegrityError as error:
        raise HTTPException(409, "An account with this email already exists") from error
    with _connect_database() as connection:
        account = connection.execute(
            "SELECT id, kind, email, username FROM accounts WHERE id = ?", (account_id,)
        ).fetchone()
    return _session_response(account, _issue_session(account_id))


@app.post("/api/auth/login")
async def login_user(credentials: UserCredentials) -> dict:
    _initialize_auth_database()
    email = credentials.email.strip().lower()
    with _connect_database() as connection:
        account = connection.execute(
            "SELECT id, kind, email, username, password_hash FROM accounts WHERE kind = 'user' AND email = ?",
            (email,),
        ).fetchone()
    if account is None or not _verify_password(credentials.password, account["password_hash"]):
        raise HTTPException(401, "Email or password is incorrect")
    return _session_response(account, _issue_session(account["id"]))


@app.post("/api/admin/login")
async def login_admin(credentials: AdminCredentials) -> dict:
    _initialize_auth_database()
    if not os.getenv("ADMIN_PASSWORD"):
        raise HTTPException(503, "Set ADMIN_PASSWORD on the FastAPI server before admin sign-in")
    username = credentials.username.strip()
    with _connect_database() as connection:
        account = connection.execute(
            "SELECT id, kind, email, username, password_hash FROM accounts WHERE kind = 'admin' AND username = ?",
            (username,),
        ).fetchone()
    if account is None or not _verify_password(credentials.password, account["password_hash"]):
        raise HTTPException(401, "Username or password is incorrect")
    return _session_response(account, _issue_session(account["id"], replace_existing=True))


@app.get("/api/auth/me")
async def current_user(account: sqlite3.Row = Depends(require_user)) -> dict:
    return {"id": account["id"], "email": account["email"], "role": "user"}


@app.post("/api/auth/logout")
async def logout(
    authorization: str | None = Header(default=None),
    account: sqlite3.Row = Depends(require_account),
) -> dict[str, bool]:
    token = authorization.removeprefix("Bearer ") if authorization else ""
    token_hash = hashlib.sha256(token.encode()).hexdigest()
    with _connect_database() as connection:
        connection.execute("DELETE FROM sessions WHERE token_hash = ?", (token_hash,))
    return {"ok": True}


@app.get("/api/public-config")
async def public_config() -> dict:
    return load_app_settings().model_dump(mode="json")


@app.get("/api/admin/settings", dependencies=[Depends(require_admin)])
async def admin_settings() -> dict:
    return load_app_settings().model_dump(mode="json")


@app.put("/api/admin/settings", dependencies=[Depends(require_admin)])
async def update_admin_settings(settings: AppSettings) -> dict:
    return save_app_settings(settings).model_dump(mode="json")


async def _probe_service(client: httpx.AsyncClient, name: str, url: str) -> dict[str, str]:
    try:
        response = await client.get(url)
        status = "healthy" if response.status_code < 500 else "degraded"
        return {"name": name, "status": status, "detail": f"HTTP {response.status_code}"}
    except httpx.HTTPError as error:
        return {"name": name, "status": "unavailable", "detail": type(error).__name__}


@app.get("/api/admin/health", dependencies=[Depends(require_admin)])
async def admin_health() -> dict:
    settings = load_app_settings()
    checks = [{"name": "ChordLab API", "status": "healthy", "detail": "API process is responding"}]
    if settings.features.tensorflow_analysis:
        from backend.chord_model import model_status

        checks.append(model_status())
    async with httpx.AsyncClient(timeout=3) as client:
        probes = []
        if settings.features.chordmini_analysis:
            base = os.getenv("CHORDMINI_API_URL", CHORDMINI_DEFAULT).rstrip("/")
            probes.append(_probe_service(client, "ChordMini", base))
        if os.getenv("AI_API_KEY"):
            base = os.getenv("AI_API_BASE_URL", "https://api.openai.com/v1").rstrip("/")
            probes.append(_probe_service(client, "AI provider", f"{base}/models"))
        if probes:
            checks.extend(await asyncio.gather(*probes))
    checks.append({
        "name": "Demucs",
        "status": "healthy" if importlib.util.find_spec("demucs") else "unavailable",
        "detail": "Python package installed" if importlib.util.find_spec("demucs") else "Install Demucs in the API environment",
    })
    return {"checks": checks, "features": settings.features.model_dump(mode="json")}


@app.post("/api/chordmini", dependencies=[Depends(require_user)])
async def chordmini(
    file: UploadFile = File(...),
    beatModel: str = Form(default="auto"),
    chordModel: str = Form(default="chord-cnn-lstm"),
) -> dict:
    require_feature("song_analysis")
    require_feature("chordmini_analysis")
    audio = await file.read(MAX_ANALYSIS_BYTES + 1)
    if not audio:
        raise HTTPException(400, "Audio file is empty")
    if len(audio) > MAX_ANALYSIS_BYTES:
        raise HTTPException(413, "Audio file is larger than 20 MB")
    if beatModel not in {"auto", "madmom", "beat-transformer"} or chordModel != "chord-cnn-lstm":
        raise HTTPException(400, "Unknown model requested")

    base = os.getenv("CHORDMINI_API_URL", CHORDMINI_DEFAULT).rstrip("/")
    app_check = os.getenv("CHORDMINI_APP_CHECK_TOKEN")
    try:
        async with httpx.AsyncClient() as client:
            beats, chords = await asyncio.gather(
                _call_chordmini(client, base, "/api/detect-beats", audio, file.filename or "audio", beatModel, app_check),
                _call_chordmini(client, base, "/api/recognize-chords", audio, file.filename or "audio", chordModel, app_check),
            )
        return {
            "ok": True,
            "beats": _unwrap_result(beats, ("beats", "beat_times", "beatTimes")),
            "chords": _unwrap_result(chords, ("chords", "chord_sequence", "chordSequence", "chord_predictions", "predictions", "segments", "results")),
            "models": {"beatModel": beatModel, "chordModel": chordModel},
        }
    except HTTPException as error:
        return {"ok": False, "reason": error.detail}
    except (httpx.TimeoutException, asyncio.TimeoutError):
        return {"ok": False, "reason": "ChordMini timed out"}
    except Exception as error:
        return {"ok": False, "reason": f"ChordMini could not analyse this audio: {error}"}


@app.post("/api/chord-model", dependencies=[Depends(require_user)])
async def chord_model(file: UploadFile = File(...)) -> dict:
    require_feature("song_analysis")
    require_feature("tensorflow_analysis")
    audio = await file.read(MAX_ANALYSIS_BYTES + 1)
    if not audio:
        raise HTTPException(400, "Audio file is empty")
    if len(audio) > MAX_ANALYSIS_BYTES:
        raise HTTPException(413, "Audio file is larger than 20 MB")

    from backend.chord_model import analyze_audio

    try:
        analysis = await run_in_threadpool(analyze_audio, audio)
    except ValueError as error:
        raise HTTPException(400, str(error)) from error
    except RuntimeError as error:
        raise HTTPException(503, str(error)) from error
    return {
        "ok": True,
        "beats": {},
        "chords": {"results": analysis["chords"]},
        "models": {"chordModel": "chordlab-cnn-v1"},
    }


def _note_id(root: str) -> str:
    normalized = root.lower()
    if len(normalized) == 2 and normalized[1] == "#":
        return f"{normalized[0]}_sharp"
    if len(normalized) == 2 and normalized[1] == "b":
        return f"{normalized[0]}_flat"
    return normalized


@app.get("/api/chords", dependencies=[Depends(require_user)])
async def chord_catalog(label: str = "") -> dict:
    require_feature("chord_diagrams")
    match = re.fullmatch(r"([A-Ga-g](?:#|b)?)(.*)", label)
    if not match:
        raise HTTPException(400, "Invalid chord label")
    root, quality = match.groups()
    chord_type = {"": "major", "maj": "major", "m": "minor", "min": "minor", "dim": "dim", "7": "7"}.get(quality)
    if chord_type is None:
        return {"ok": True, "chord": None}
    base = os.getenv("CHORDS_API_URL", CHORDS_DEFAULT).rstrip("/")
    try:
        async with httpx.AsyncClient(timeout=5) as client:
            response = await client.get(
                f"{base}/chords",
                params={"note": _note_id(root), "type": chord_type, "limit": "all"},
            )
        if not response.is_success:
            return {"ok": True, "chord": None}
        expected = f"{root}{quality}".lower().replace("maj", "major")
        if re.fullmatch(r"[a-g](?:#|b)?m", expected):
            expected = expected[:-1] + "minor"
        data = response.json().get("data", [])
        chord = next(
            (
                item for item in data
                if isinstance(item, dict)
                and re.sub(r"\s+", "", item.get("name", {}).get("eng", "")).lower() == expected
            ),
            None,
        )
        return {"ok": True, "chord": chord}
    except (httpx.HTTPError, ValueError, AttributeError):
        return {"ok": True, "chord": None}


def _separate_audio(audio: bytes, filename: str) -> bytes:
    with tempfile.TemporaryDirectory(prefix="chordlab-demucs-") as work_dir:
        work = Path(work_dir)
        safe_name = re.sub(r"[^a-zA-Z0-9._-]", "_", Path(filename or "audio.mp3").name)
        source = work / safe_name
        source.write_bytes(audio)
        output = work / "output"
        model = os.getenv("DEMUCS_MODEL", "htdemucs")
        script = ROOT / "scripts" / "demucs_cpu.py"
        try:
            subprocess.run(
                [os.getenv("DEMUCS_PYTHON", "python3"), str(script), "-n", model, "--float32", "-o", str(output), str(source)],
                check=True,
                timeout=600,
                capture_output=True,
                text=True,
            )
        except subprocess.CalledProcessError as error:
            detail = error.stderr or error.stdout or str(error)
            if "No module named" in detail:
                raise RuntimeError("Install Demucs with: python3 -m pip install -U demucs") from error
            raise RuntimeError(detail[-1200:]) from error
        stems_dir = output / model
        archive_path = work / "stems.zip"
        with zipfile.ZipFile(archive_path, "w", compression=zipfile.ZIP_DEFLATED) as archive:
            for stem in STEM_NAMES:
                matches = list(stems_dir.rglob(f"{stem}.wav"))
                if matches:
                    archive.write(matches[0], f"{stem}.wav")
        with zipfile.ZipFile(archive_path) as archive:
            if len(archive.namelist()) != len(STEM_NAMES):
                raise RuntimeError("Demucs completed without producing all four stems")
        return archive_path.read_bytes()


@app.post("/api/separate", dependencies=[Depends(require_user)])
async def separate(file: UploadFile = File(...)):
    require_feature("stem_separation")
    from fastapi.responses import Response

    audio = await file.read(MAX_SEPARATION_BYTES + 1)
    if not audio:
        raise HTTPException(400, "The audio file is empty.")
    if len(audio) > MAX_SEPARATION_BYTES:
        raise HTTPException(400, "That file is too large to separate (50 MB max).")
    try:
        archive = await run_in_threadpool(_separate_audio, audio, file.filename or "audio.mp3")
        return Response(content=archive, media_type="application/zip")
    except Exception as error:
        raise HTTPException(502, f"Demucs could not separate this audio. {error}") from error


@app.post("/api/import-link", dependencies=[Depends(require_user)])
async def import_link(data: LinkImport) -> dict:
    require_feature("link_import")
    url = str(data.url)
    host = (urlsplit(url).hostname or "").removeprefix("www.").lower()
    if host in {"youtube.com", "youtu.be", "m.youtube.com"}:
        source = "youtube"
        endpoint = f"https://www.youtube.com/oembed?format=json&url={quote(url, safe='')}"
    elif host == "spotify.com" or host.endswith(".spotify.com"):
        source = "spotify"
        endpoint = f"https://open.spotify.com/oembed?url={quote(url, safe='')}"
    else:
        raise HTTPException(400, "Paste a YouTube or Spotify link")
    try:
        async with httpx.AsyncClient(timeout=10, headers={"accept": "application/json"}) as client:
            response = await client.get(endpoint)
        response.raise_for_status()
        payload = response.json()
    except (httpx.HTTPError, ValueError) as error:
        raise HTTPException(400, "Could not read that link") from error
    title = str(payload.get("title", "")).strip()
    artist = re.sub(r"\s*-\s*Topic$", "", str(payload.get("author_name", "")), flags=re.IGNORECASE).strip()
    dash = re.match(r"^(.{1,60}?)\s+[-–—]\s+(.+)$", title)
    if dash:
        artist, title = dash.group(1).strip(), dash.group(2).strip()
    title = re.sub(
        r"\s*(?:\(|\[)[^)]*(?:official|video|lyric|audio|hd|4k)[^)]*(?:\)|\])",
        "",
        title,
        flags=re.IGNORECASE,
    ).strip()
    return {"source": source, "title": title, "artist": artist, "thumbnail": payload.get("thumbnail_url", ""), "url": url}


def _parse_lrc(lrc: str) -> list[dict]:
    lines = []
    for raw in lrc.replace("\r", "").split("\n"):
        stamps = list(LRC_STAMP.finditer(raw))
        if not stamps:
            continue
        text = re.sub(r"\[[^\]]*\]", "", raw).strip()
        if not text:
            continue
        for stamp in stamps:
            fraction = float(f"0.{stamp.group(3)}") if stamp.group(3) else 0
            lines.append({"time": int(stamp.group(1)) * 60 + int(stamp.group(2)) + fraction, "text": text})
    return sorted(lines, key=lambda line: line["time"])


@app.post("/api/lyrics", dependencies=[Depends(require_user)])
async def fetch_lyrics(data: LyricsLookup) -> dict:
    require_feature("lyrics_lookup")
    params = {"track_name": data.title.strip()}
    if data.artist and data.artist.strip():
        params["artist_name"] = data.artist.strip()
    try:
        async with httpx.AsyncClient(
            timeout=10,
            headers={"accept": "application/json", "user-agent": "ChordLab (chord sheet app)"},
        ) as client:
            response = await client.get("https://lrclib.net/api/search", params=params)
        hits = response.json() if response.is_success else []
    except (httpx.HTTPError, ValueError):
        hits = []
    if not isinstance(hits, list) or not hits:
        return {"found": False, "plain": "", "synced": []}

    def score(hit: dict) -> float:
        value = 10 if hit.get("syncedLyrics") else 0
        value += 2 if hit.get("plainLyrics") else 0
        if data.duration and hit.get("duration"):
            value += max(0, 6 - abs(data.duration - hit["duration"]) / 2)
        return value

    best = max((hit for hit in hits if isinstance(hit, dict)), key=score, default={})
    synced = _parse_lrc(best["syncedLyrics"]) if best.get("syncedLyrics") else []
    plain = (best.get("plainLyrics") or "\n".join(line["text"] for line in synced)).strip()
    result = {"found": bool(plain or synced), "plain": plain, "synced": synced}
    if best.get("trackName"):
        result["trackName"] = best["trackName"]
    if best.get("artistName"):
        result["artistName"] = best["artistName"]
    return result


def _tanglish_word(word: str) -> str:
    core = re.sub(r"^[^\u0b80-\u0bff]+|[^\u0b80-\u0bff]+$", "", word)
    known = TANGLISH_LEXICON.get(core)
    if known:
        return word.replace(core, known, 1)
    output = ""
    for index, char in enumerate(core):
        if char in VOWELS:
            output += VOWELS[char]
        elif char in CONSONANTS:
            output += CONSONANTS[char]
            next_char = core[index + 1] if index + 1 < len(core) else ""
            if not next_char or (next_char not in SIGNS and next_char != "்"):
                output += "a"
        elif char in SIGNS:
            output += SIGNS[char]
    return word.replace(core, output, 1) if core else word


def _offline_tanglish(lyrics: str) -> str:
    output = []
    for line in lyrics.split("\n"):
        if line.lstrip().startswith("[") or not TAMIL_RE.search(line):
            output.append(line)
        else:
            output.append(re.sub(r"\S+", lambda match: _tanglish_word(match.group()), line))
    return "\n".join(output)


@app.post("/api/romanize", dependencies=[Depends(require_user)])
async def romanize(data: RomanizeRequest) -> dict[str, str]:
    require_feature("lyric_romanization")
    tamil = bool(TAMIL_RE.search(data.lyrics)) and data.style != "english"
    fallback = _offline_tanglish(data.lyrics) if tamil else None
    api_key = os.getenv("AI_API_KEY")
    base_url = os.getenv("AI_API_BASE_URL", "https://api.openai.com/v1").rstrip("/")
    if not api_key:
        if fallback is not None:
            return {"text": fallback}
        raise HTTPException(503, "AI is not configured for this app.")
    style_prompt = {
        "hinglish": "Transliterate Devanagari/Hindi/Urdu text into Hinglish (Roman script Hindi as commonly typed by Indian users).",
        "tanglish": "Transliterate Tamil text into Tanglish (Roman script Tamil as commonly typed by Tamil speakers).",
        "auto": "Detect the script/language of each line and transliterate it into the natural Roman-script form used by native speakers (Hinglish for Hindi/Urdu, Tanglish for Tamil, and similar for other Indic languages). Leave lines that are already in Roman script unchanged.",
        "english": "Provide a plain-English meaning for each line, keeping one output line per input line.",
    }[data.style]
    glossary = []
    if tamil:
        seen = set()
        for raw in data.lyrics.split():
            core = re.sub(r"^[^\u0b80-\u0bff]+|[^\u0b80-\u0bff]+$", "", raw)
            if core and core not in seen:
                seen.add(core)
                if core in TANGLISH_LEXICON:
                    glossary.append(f"{core} = {TANGLISH_LEXICON[core]}")
            if len(glossary) >= 140:
                break
    system = " ".join(filter(None, [
        "You are a transliteration engine for song lyrics that the user already has.",
        style_prompt,
        "Rules: output ONLY the converted text. Preserve the exact number of lines and the line order. Preserve blank lines and section markers such as [Verse] or [Chorus] exactly as given. Do not translate unless asked, do not add commentary, do not add or remove lines.",
        f"Use exactly these Roman spellings for the Tamil words listed: {'; '.join(glossary)}." if glossary else "",
    ]))
    payload = {
        "model": os.getenv("AI_MODEL", "gpt-4o-mini"),
        "messages": [{"role": "system", "content": system}, {"role": "user", "content": data.lyrics}],
    }
    try:
        async with httpx.AsyncClient(timeout=60) as client:
            response = await client.post(
                f"{base_url}/chat/completions",
                json=payload,
                headers={"Authorization": f"Bearer {api_key}"},
            )
        if response.status_code == 429:
            raise HTTPException(429, "Too many requests right now — try again in a moment.")
        if response.status_code == 402:
            raise HTTPException(402, "AI credits are exhausted for this workspace.")
        response.raise_for_status()
        text = response.json()["choices"][0]["message"]["content"].strip()
        if text:
            return {"text": text}
        if fallback is not None:
            return {"text": fallback}
        raise RuntimeError("Empty AI response")
    except HTTPException:
        raise
    except (httpx.HTTPError, KeyError, IndexError, TypeError, ValueError) as error:
        if fallback is not None:
            return {"text": fallback}
        raise HTTPException(502, "Transliteration failed. Please try again.") from error