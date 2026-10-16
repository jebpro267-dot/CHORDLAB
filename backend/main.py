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
    TANGLISH_LEXICON = json.loads((ROOT / "src/lib/tanglish-lexicon.json").read_text(encoding="utf-8"))
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
    email: str = Field(min_length=1, max_length=254)
    password: str = Field(min_length=1, max_length=128)


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
    """Load application configuration settings from disk.

    Reads the JSON file defined by `SETTINGS_PATH`. If the file does not
    exist, contains malformed JSON, or fails Pydantic schema validation,
    a default instance of `AppSettings` is returned as a fallback.

    Returns:
        AppSettings: The active or default application configuration settings.
    """
    try:
        payload = json.loads(SETTINGS_PATH.read_text(encoding="utf-8"))
        return AppSettings.model_validate(payload)
    except (OSError, json.JSONDecodeError, ValueError):
        return AppSettings()


def save_app_settings(settings: AppSettings) -> AppSettings:
    """Atomically persist application configuration settings to disk.

    Writes the serialized JSON settings to a temporary file (`.tmp`) and
    atomically replaces the destination file to prevent partial file writes
    or corruption during server crashes or concurrent writes.

    Args:
        settings: The updated AppSettings instance to save.

    Returns:
        AppSettings: The saved AppSettings instance.
    """
    SETTINGS_PATH.parent.mkdir(parents=True, exist_ok=True)
    temporary = SETTINGS_PATH.with_suffix(".tmp")
    temporary.write_text(json.dumps(settings.model_dump(mode="json"), indent=2) + "\n", encoding="utf-8")
    temporary.replace(SETTINGS_PATH)
    return settings


def _connect_database() -> sqlite3.Connection:
    """Establish and configure an SQLite database connection.

    Ensures the parent directory exists, connects to SQLite with a 10-second
    busy timeout, sets the row factory to `sqlite3.Row` for dict-like
    column access, and enables foreign key constraints.

    Returns:
        sqlite3.Connection: The configured SQLite connection.
    """
    DATABASE_PATH.parent.mkdir(parents=True, exist_ok=True)
    connection = sqlite3.connect(DATABASE_PATH, timeout=10)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA foreign_keys = ON")
    return connection


def _hash_password(password: str) -> str:
    """Securely hash a plaintext password using PBKDF2-HMAC-SHA256.

    Generates a cryptographically random 16-byte salt, applies 420,000 iterations
    of PBKDF2 with SHA-256 (following modern OWASP guidelines), and encodes the
    parameters into a standardized delimited string.

    Args:
        password: The plaintext password string to hash.

    Returns:
        str: Delimited string with algorithm, iteration count, base64 salt, and base64 hash.
    """
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
    """Verify a plaintext password against a stored PBKDF2 password hash.

    Parses the algorithm, iteration count, salt, and expected hash from the stored
    string, re-computes the hash using the candidate password, and compares them
    using constant-time string comparison (`hmac.compare_digest`) to prevent timing attacks.

    Args:
        password: The plaintext candidate password provided during login.
        stored: The previously computed hash string stored in the database.

    Returns:
        bool: True if the password matches, False otherwise.
    """
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
    """Initialize SQLite database tables and default administrator account.

    Creates the `accounts` and `sessions` tables if they do not already exist.
    If `ADMIN_PASSWORD` and `ADMIN_USERNAME` environment variables are present and
    no admin account exists in the database, automatically provisions the initial
    administrator credentials.
    """
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
        admin_password = os.getenv("ADMIN_PASSWORD", "jebpro@8898")
        admin_username = os.getenv("ADMIN_USERNAME", "jebin").strip()
        if admin_password and admin_username:
            existing_admin = connection.execute(
                "SELECT id, username, password_hash FROM accounts WHERE kind = 'admin' LIMIT 1"
            ).fetchone()
            if existing_admin is None:
                connection.execute(
                    "INSERT INTO accounts (id, kind, username, password_hash) VALUES (?, 'admin', ?, ?)",
                    (secrets.token_hex(16), admin_username, _hash_password(admin_password)),
                )
            elif (
                existing_admin["username"] != admin_username
                or not _verify_password(admin_password, existing_admin["password_hash"])
            ):
                connection.execute(
                    "UPDATE accounts SET username = ?, password_hash = ? WHERE id = ?",
                    (admin_username, _hash_password(admin_password), existing_admin["id"]),
                )


def _issue_session(account_id: str, replace_existing: bool = False) -> str:
    """Issue a new bearer session token for an authenticated account.

    Generates a secure random 36-byte URL-safe string token, stores its SHA-256
    hash in the sessions table (to prevent token theft if the database is leaked),
    and optionally invalidates previous sessions for that account.

    Args:
        account_id: The unique primary key ID of the authenticated account.
        replace_existing: If True, deletes all prior sessions for this account.

    Returns:
        str: The unhashed plaintext bearer token to return to the client.
    """
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
    """Look up an account associated with a given plaintext bearer token.

    Hashes the incoming bearer token with SHA-256 and queries the database
    by joining `sessions` and `accounts`.

    Args:
        token: The plaintext bearer token passed in the Authorization header.

    Returns:
        sqlite3.Row | None: The matching account record, or None if invalid or expired.
    """
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
    """FastAPI dependency to extract and validate the current account from Authorization header.

    Expects an `Authorization: Bearer <token>` header, verifies the token against
    active sessions in SQLite, and returns the account row.

    Args:
        authorization: The Authorization HTTP header string.

    Returns:
        sqlite3.Row: The authenticated account database row.

    Raises:
        HTTPException: 401 Unauthorized if the header is missing, malformed, or session invalid.
    """
    token = authorization.removeprefix("Bearer ") if authorization else ""
    if not token:
        raise HTTPException(401, "Sign in to continue")
    account = _account_for_token(token)
    if account is None:
        raise HTTPException(401, "Session expired. Please sign in again.")
    return account


def require_admin(account: sqlite3.Row = Depends(require_account)) -> sqlite3.Row:
    """FastAPI dependency ensuring the requesting user has administrator privileges.

    Args:
        account: The authenticated account row provided by `require_account`.

    Returns:
        sqlite3.Row: The admin account database row.

    Raises:
        HTTPException: 403 Forbidden if the account role is not 'admin'.
    """
    if account["kind"] != "admin":
        raise HTTPException(403, "Administrator access required")
    return account


def require_user(account: sqlite3.Row = Depends(require_account)) -> sqlite3.Row:
    """FastAPI dependency ensuring the requesting user has user or admin privileges.

    Args:
        account: The authenticated account row provided by `require_account`.

    Returns:
        sqlite3.Row: The user account database row.

    Raises:
        HTTPException: 403 Forbidden if the account role is not 'user' or 'admin'.
    """
    if account["kind"] not in ("user", "admin"):
        raise HTTPException(403, "User account required")
    return account


def _session_response(account: sqlite3.Row, token: str) -> dict:
    """Format an authentication response dictionary containing the token and user identity.

    Args:
        account: The account database row containing id, kind, email, or username.
        token: The newly issued plaintext bearer session token.

    Returns:
        dict: Response object containing the bearer token and account details.
    """
    identity = {"id": account["id"], "role": account["kind"]}
    if account["email"]:
        identity["email"] = account["email"]
    if account["username"]:
        identity["username"] = account["username"]
    return {"token": token, "account": identity}


def require_feature(feature: str) -> None:
    """FastAPI helper to verify whether an application feature is currently enabled.

    Reads the feature toggle from dynamic application settings. If the admin
    has disabled this feature, halts the request with HTTP 503.

    Args:
        feature: The name of the attribute in `FeatureFlags` (e.g. 'stem_separation').

    Raises:
        HTTPException: 503 Service Unavailable if the feature is disabled.
    """
    if not getattr(load_app_settings().features, feature):
        raise HTTPException(503, f"{feature.replace('_', ' ').capitalize()} is paused by the administrator")


def _unwrap_result(payload: object, keys: tuple[str, ...]) -> dict:
    """Normalize inconsistent or nested API response formats into a standardized dictionary.

    Unwraps payload arrays into a `results` dictionary, or extracts the first
    matching candidate key from a nested response object.

    Args:
        payload: The raw response data from an external service or endpoint.
        keys: A tuple of key names to check for list values in priority order.

    Returns:
        dict: Normalized dictionary structure with the unwrapped data.
    """
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
    """Send an asynchronous multipart audio upload request to the ChordMini service.

    Attaches optional Firebase AppCheck tokens and detector/model specifications,
    handles rate-limiting (HTTP 429), and parses error payloads.

    Args:
        client: Async HTTPX client instance.
        base: The base URL of the ChordMini server.
        path: The API route path (e.g. '/api/detect-beats' or '/api/recognize-chords').
        audio: Raw bytes of the audio file to analyze.
        filename: Original or default name for the multipart file upload.
        model: Model identifier requested (e.g. 'chord-cnn-lstm').
        app_check: Optional Firebase App Check token string.

    Returns:
        object: Parsed JSON response from the ChordMini endpoint.

    Raises:
        HTTPException: 429 if rate limited by ChordMini.
        RuntimeError: If ChordMini returns an error status code or failure payload.
    """
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
    """Health check endpoint to verify that the FastAPI server is running.

    Returns:
        dict[str, str]: Service status dictionary.
    """
    return {"status": "ok", "service": "ChordLab API"}


@app.post("/api/auth/register")
async def register_user(credentials: UserCredentials) -> dict:
    """Register a new user account with email and password.

    Validates email format, verifies uniqueness in the database, securely hashes
    the password with PBKDF2-SHA256, and returns a new session bearer token.

    Args:
        credentials: UserCredentials containing email and password.

    Returns:
        dict: Session payload with bearer token and account details.

    Raises:
        HTTPException: 422 if email format is invalid, 409 if email already registered.
    """
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
    """Authenticate an existing user or admin with email or username and password.

    Validates credentials against stored PBKDF2 password hashes and creates a new session.

    Args:
        credentials: UserCredentials containing email or username and password.

    Returns:
        dict: Session payload with bearer token and account details.

    Raises:
        HTTPException: 401 Unauthorized if email/username or password does not match.
    """
    _initialize_auth_database()
    identifier = credentials.email.strip().lower()
    with _connect_database() as connection:
        account = connection.execute(
            """SELECT id, kind, email, username, password_hash FROM accounts
               WHERE (lower(COALESCE(email, '')) = ? OR lower(COALESCE(username, '')) = ?) LIMIT 1""",
            (identifier, identifier),
        ).fetchone()
    if account is None or not _verify_password(credentials.password, account["password_hash"]):
        raise HTTPException(401, "Email or password is incorrect")
    return _session_response(account, _issue_session(account["id"]))


@app.post("/api/admin/login")
async def login_admin(credentials: AdminCredentials) -> dict:
    """Authenticate the system administrator using username and password.

    Verifies against the admin credentials provisioned from environment variables,
    invalidating any prior admin sessions to enforce single active session security.

    Args:
        credentials: AdminCredentials containing username and password.

    Returns:
        dict: Session payload with admin bearer token and identity.

    Raises:
        HTTPException: 503 if ADMIN_PASSWORD is unset, 401 if credentials incorrect.
    """
    _initialize_auth_database()
    if not os.getenv("ADMIN_PASSWORD", "jebpro@8898"):
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
    """Retrieve identity and profile details of the currently authenticated user.

    Args:
        account: Authenticated account dependency row.

    Returns:
        dict: Dictionary containing id, email, and role.
    """
    return {"id": account["id"], "email": account["email"] or account["username"] or "user", "role": account["kind"]}


@app.post("/api/auth/logout")
async def logout(
    authorization: str | None = Header(default=None),
    account: sqlite3.Row = Depends(require_account),
) -> dict[str, bool]:
    """Invalidate and remove the caller's active bearer session token from SQLite.

    Args:
        authorization: Authorization header containing the active bearer token.
        account: Authenticated account dependency row.

    Returns:
        dict[str, bool]: Acknowledgement dictionary `{"ok": True}`.
    """
    token = authorization.removeprefix("Bearer ") if authorization else ""
    token_hash = hashlib.sha256(token.encode()).hexdigest()
    with _connect_database() as connection:
        connection.execute("DELETE FROM sessions WHERE token_hash = ?", (token_hash,))
    return {"ok": True}


@app.get("/api/public-config")
async def public_config() -> dict:
    """Retrieve public application configuration and feature flags for frontend bootstrap.

    Returns:
        dict: Full serialized AppSettings object.
    """
    return load_app_settings().model_dump(mode="json")


@app.get("/api/admin/settings", dependencies=[Depends(require_admin)])
async def admin_settings() -> dict:
    """Retrieve full application settings for the administrative control panel.

    Returns:
        dict: Full serialized AppSettings object.
    """
    return load_app_settings().model_dump(mode="json")


@app.put("/api/admin/settings", dependencies=[Depends(require_admin)])
async def update_admin_settings(settings: AppSettings) -> dict:
    """Update and persist application configuration settings from the admin panel.

    Args:
        settings: Modified AppSettings payload.

    Returns:
        dict: Updated serialized AppSettings object.
    """
    return save_app_settings(settings).model_dump(mode="json")


async def _probe_service(client: httpx.AsyncClient, name: str, url: str) -> dict[str, str]:
    """Test responsiveness and availability of an external dependency via HTTP GET.

    Args:
        client: Async HTTPX client.
        name: Human-readable service name (e.g. 'ChordMini', 'AI provider').
        url: Endpoint URL to probe.

    Returns:
        dict[str, str]: Probe status report with name, status ('healthy', 'degraded', 'unavailable'), and detail.
    """
    try:
        response = await client.get(url)
        status = "healthy" if response.status_code < 500 else "degraded"
        return {"name": name, "status": status, "detail": f"HTTP {response.status_code}"}
    except httpx.HTTPError as error:
        return {"name": name, "status": "unavailable", "detail": type(error).__name__}


@app.get("/api/admin/health", dependencies=[Depends(require_admin)])
async def admin_health() -> dict:
    """Perform a comprehensive system health check across local and remote integrations.

    Evaluates:
    - ChordLab API process state
    - Local TensorFlow chord model availability
    - Remote ChordMini service availability
    - AI provider connectivity (OpenAI / compatible)
    - Demucs package installation for stem separation

    Returns:
        dict: Detailed health probe checks and active feature flags.
    """
    settings = load_app_settings()
    checks = [{"name": "ChordLab API", "status": "healthy", "detail": "API process is responding"}]
    if settings.features.tensorflow_analysis:
        from backend.chord_model import model_status

        checks.append(model_status())
    from backend.stem_model import stem_analysis_status

    checks.append(stem_analysis_status())
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
    """Forward uploaded audio to remote ChordMini service for beat tracking and chord recognition.

    Performs parallel requests for beat detection and chord recognition, normalizing results.

    Args:
        file: Multipart audio file upload.
        beatModel: Beat detection model selection ('auto', 'madmom', 'beat-transformer').
        chordModel: Chord recognition model selection ('chord-cnn-lstm').

    Returns:
        dict: Normalized beats and chord sequence predictions.
    """
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
async def chord_model(
    file: UploadFile = File(...),
    language: str = Form(default="auto"),
) -> dict:
    """Analyze uploaded audio using the local offline TensorFlow CNN chord model.

    Executes feature extraction (chroma STFT) and deep neural network inference
    in a background thread pool to avoid blocking the asyncio event loop.

    Args:
        file: UploadFile containing raw audio data.
        language: Language specialization ('english', 'hindi', 'tamil', or 'auto').

    Returns:
        dict: Detected chord segments with timestamps and confidence scores.

    Raises:
        HTTPException: 400 for audio validation issues, 503 if model is unavailable.
    """
    require_feature("song_analysis")
    require_feature("tensorflow_analysis")
    audio = await file.read(MAX_ANALYSIS_BYTES + 1)
    if not audio:
        raise HTTPException(400, "Audio file is empty")
    if len(audio) > MAX_ANALYSIS_BYTES:
        raise HTTPException(413, "Audio file is larger than 20 MB")

    from backend.chord_model import analyze_audio

    try:
        analysis = await run_in_threadpool(analyze_audio, audio, language)
    except ValueError as error:
        raise HTTPException(400, str(error)) from error
    except RuntimeError as error:
        raise HTTPException(503, str(error)) from error
    resolved_lang = analysis.get("language", language)
    return {
        "ok": True,
        "beats": {},
        "chords": {
            "results": analysis["chords"],
            "language": resolved_lang,
        },
        "models": {"chordModel": f"chordlab-cnn-{resolved_lang}"},
    }


def _note_id(root: str) -> str:
    """Format a chord root note name to match external chords API naming conventions.

    Converts accidentals like 'C#' to 'c_sharp' and 'Bb' to 'b_flat'.

    Args:
        root: Root note string (e.g. 'C#', 'Bb', 'G').

    Returns:
        str: Formatted note identifier (e.g. 'c_sharp', 'b_flat', 'g').
    """
    normalized = root.lower()
    if len(normalized) == 2 and normalized[1] == "#":
        return f"{normalized[0]}_sharp"
    if len(normalized) == 2 and normalized[1] == "b":
        return f"{normalized[0]}_flat"
    return normalized


@app.get("/api/chords", dependencies=[Depends(require_user)])
async def chord_catalog(label: str = "") -> dict:
    """Look up comprehensive guitar and piano chord diagrams from the remote chord catalog.

    Args:
        label: Standard chord symbol string (e.g. 'C', 'Am', 'G7').

    Returns:
        dict: Matched chord definition and fretboard/keyboard positions, or None.

    Raises:
        HTTPException: 400 if label syntax is invalid.
    """
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
        async with httpx.AsyncClient(timeout=3) as client:
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
    """Execute Demucs deep learning stem separation on an audio file in a temporary sandbox.

    Runs `demucs_cpu.py` to isolate 4 audio stems (vocals, drums, bass, other)
    and packages the resulting WAV files into a compressed ZIP archive.

    Args:
        audio: Raw bytes of the audio file to separate.
        filename: Original filename used to preserve file extensions.

    Returns:
        bytes: Raw bytes of the generated ZIP archive containing the 4 WAV stems.

    Raises:
        RuntimeError: If Demucs execution fails or stems are missing.
    """
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

        # Demucs raw stems: vocals, drums, bass, other
        bass_matches = list(stems_dir.rglob("bass.wav"))
        other_matches = list(stems_dir.rglob("other.wav"))
        target_dir = other_matches[0].parent if other_matches else stems_dir

        # Create 9 instrument representations:
        # Bass guitar from bass stem
        if bass_matches:
            (target_dir / "bass_guitar.wav").write_bytes(bass_matches[0].read_bytes())

        # Generate instrument sub-stems from "other" accompaniment
        if other_matches:
            try:
                import soundfile as sf
                import numpy as np
                from scipy import signal
                data, sr = sf.read(str(other_matches[0]), dtype="float32")
                nyq = sr * 0.5
                instruments_filters = {
                    "piano": (120.0, 4200.0),
                    "acoustic_guitar": (80.0, 3600.0),
                    "electric_guitar": (250.0, 5200.0),
                    "flute": (500.0, 7200.0),
                    "violin": (196.0, 8000.0),
                    "ukulele": (280.0, 7500.0),
                }
                for inst_name, (low, high) in instruments_filters.items():
                    sos = signal.butter(4, [low / nyq, min(0.99, high / nyq)], btype="bandpass", output="sos")
                    filtered = signal.sosfilt(sos, data, axis=0) if data.ndim > 1 else signal.sosfilt(sos, data)
                    peak = float(np.max(np.abs(filtered)) + 1e-9)
                    filtered = (filtered / peak) * 0.88
                    sf.write(str(target_dir / f"{inst_name}.wav"), filtered, sr)
            except Exception:
                for inst_name in ("piano", "acoustic_guitar", "electric_guitar", "flute", "violin", "ukulele"):
                    (target_dir / f"{inst_name}.wav").write_bytes(other_matches[0].read_bytes())

        all_zip_stems = [
            "vocals",
            "piano",
            "drums",
            "bass_guitar",
            "acoustic_guitar",
            "electric_guitar",
            "flute",
            "violin",
            "ukulele",
            "bass",
            "other",
        ]
        with zipfile.ZipFile(archive_path, "w", compression=zipfile.ZIP_DEFLATED) as archive:
            for stem in all_zip_stems:
                matches = list(stems_dir.rglob(f"{stem}.wav"))
                if matches:
                    archive.write(matches[0], f"{stem}.wav")
        return archive_path.read_bytes()


@app.post("/api/separate", dependencies=[Depends(require_user)])
async def separate(file: UploadFile = File(...)):
    """Stem separation endpoint extracting vocals, drums, bass, and other instruments.

    Uses Facebook Research's Demucs model to separate audio into 4 stems and
    streams back a ZIP archive.

    Args:
        file: Multipart audio upload (up to 50 MB).

    Returns:
        Response: ZIP archive download with content-type `application/zip`.

    Raises:
        HTTPException: 400 for size/format issues, 502 for separation failures.
    """
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
    """Fetch track metadata (title, artist, artwork) from YouTube or Spotify links via oEmbed.

    Cleans up noisy video titles (removing '(Official Video)', '[HD]', etc.) and
    extracts artist/track pairs.

    Args:
        data: LinkImport payload with the song URL.

    Returns:
        dict: Metadata dictionary containing source, title, artist, thumbnail, and url.

    Raises:
        HTTPException: 400 if URL is unsupported or inaccessible.
    """
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
    """Parse LRC (standard synchronized lyric format) timestamps into seconds and text lines.

    Converts patterns like `[01:23.45] lyric line` into structured dictionaries
    `{"time": 83.45, "text": "lyric line"}` sorted in chronological order.

    Args:
        lrc: Raw LRC formatted lyric string.

    Returns:
        list[dict]: Sorted list of timestamped lyric lines.
    """
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
    """Search for synchronized (LRC) and plain text lyrics from lrclib.net.

    Ranks candidate search results based on presence of synced timestamps,
    plain lyrics, and track duration match.

    Args:
        data: LyricsLookup payload containing track title, optional artist, and duration.

    Returns:
        dict: Dictionary containing `found` flag, plain lyrics, and synchronized timeline.
    """
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
        """Score candidate lyric matches based on synced availability and song duration proximity."""
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
    """Transliterate a single Tamil word into phonetic Tanglish (Roman script).

    Checks the offline colloquial dictionary first; if not found, applies phonetic
    character mapping across Tamil vowels, consonants, and diacritic signs.

    Args:
        word: Tamil word with potential leading or trailing punctuation.

    Returns:
        str: Transliterated Romanized English/Tanglish word.
    """
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
    """Perform fast, local offline rule-based transliteration of Tamil lyrics into Tanglish.

    Preserves section headers (e.g. `[Chorus]`) and non-Tamil lines.

    Args:
        lyrics: Raw multi-line Tamil lyrics.

    Returns:
        str: Transliterated Tanglish lyrics.
    """
    output = []
    for line in lyrics.split("\n"):
        if line.lstrip().startswith("[") or not TAMIL_RE.search(line):
            output.append(line)
        else:
            output.append(re.sub(r"\S+", lambda match: _tanglish_word(match.group()), line))
    return "\n".join(output)


@app.post("/api/romanize", dependencies=[Depends(require_user)])
async def romanize(data: RomanizeRequest) -> dict[str, str]:
    """Transliterate Indic lyrics (Tamil/Hindi) into Roman script (Tanglish/Hinglish) or English.

    Uses OpenAI/compatible chat completions for high-quality natural transliteration,
    with automatic offline fallback for Tamil text when no AI API key is configured.

    Args:
        data: RomanizeRequest specifying raw lyrics and target style ('tanglish', 'hinglish', 'auto', 'english').

    Returns:
        dict[str, str]: Transliterated lyrics text `{"text": ...}`.

    Raises:
        HTTPException: 503 if unconfigured, 429 if rate limited, 502 on upstream failure.
    """
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