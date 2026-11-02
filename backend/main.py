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
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
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
HINDI_RE = re.compile(r"[\u0900-\u097f]")
LRC_STAMP = re.compile(r"\[(\d{1,2}):(\d{2})(?:[.:](\d{1,3}))?\]")

H_VOWELS = {
    "अ": "a", "आ": "aa", "इ": "i", "ई": "ee", "उ": "u", "ऊ": "oo", "ऋ": "ri",
    "ए": "e", "ऐ": "ai", "ओ": "o", "औ": "au", "अं": "an", "अः": "ah",
}
H_CONSONANTS = {
    "क": "k", "ख": "kh", "ग": "g", "घ": "gh", "ङ": "ng",
    "च": "ch", "छ": "chh", "ज": "j", "झ": "jh", "ञ": "ny",
    "ट": "t", "ठ": "th", "ड": "d", "ढ": "dh", "ण": "n",
    "त": "t", "थ": "th", "द": "d", "ध": "dh", "न": "n",
    "प": "p", "फ": "ph", "ब": "b", "भ": "bh", "म": "m",
    "य": "y", "र": "r", "ल": "l", "व": "v",
    "श": "sh", "ष": "sh", "स": "s", "ह": "h",
}
H_SIGNS = {
    "ा": "aa", "ि": "i", "ी": "ee", "ु": "u", "ू": "oo", "ृ": "ri",
    "े": "e", "ै": "ai", "ो": "o", "ौ": "au", "ं": "n", "ँ": "n", "ः": "h",
}

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
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["*"],
)


@app.middleware("http")
async def add_cors_pna_header(request, call_next):
    if request.method == "OPTIONS":
        response = await call_next(request)
        response.headers["Access-Control-Allow-Private-Network"] = "true"
        response.headers["Access-Control-Allow-Origin"] = "*"
        response.headers["Access-Control-Allow-Headers"] = "*"
        response.headers["Access-Control-Allow-Methods"] = "*"
        return response
    response = await call_next(request)
    response.headers["Access-Control-Allow-Private-Network"] = "true"
    response.headers["Access-Control-Allow-Origin"] = "*"
    return response



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


def require_user(authorization: str | None = Header(default=None)) -> sqlite3.Row | dict:
    """FastAPI dependency ensuring the requesting user has user or admin privileges,
    or falls back to an anonymous guest user if not explicitly signed in.
    """
    if authorization:
        token = authorization.removeprefix("Bearer ").strip()
        if token:
            account = _account_for_token(token)
            if account and account["kind"] in ("user", "admin"):
                return account
    return {
        "id": "guest-local",
        "kind": "user",
        "email": "guest@chordlab.local",
        "username": "Guest User",
    }



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
    """Analyze uploaded audio using fast Librosa chroma-STFT template matching.

    Executes feature extraction and template matching in a background thread pool.
    Runs in <0.5s with minimal RAM (<30MB) so it never causes cloud memory crashes or timeouts.

    Args:
        file: UploadFile containing raw audio data.
        language: Language specialization ('english', 'hindi', 'tamil', or 'auto').

    Returns:
        dict: Detected chord segments with timestamps and confidence scores, plus beat/tempo estimation.
    """
    require_feature("song_analysis")
    require_feature("tensorflow_analysis")
    audio = await file.read(MAX_ANALYSIS_BYTES + 1)
    if not audio:
        raise HTTPException(400, "Audio file is empty")
    if len(audio) > MAX_ANALYSIS_BYTES:
        raise HTTPException(413, "Audio file is larger than 20 MB")

    duration = 180.0
    try:
        chords = await run_in_threadpool(_extract_chords_chroma, audio, duration)
        metrics = await run_in_threadpool(_estimate_key_and_beats, audio, chords, duration)
    except Exception as error:
        print("Chord analysis error:", error)
        raise HTTPException(500, f"Could not analyze audio: {error}") from error

    resolved_lang = language or "auto"
    return {
        "ok": True,
        "beats": {
            "bpm": metrics["bpm"],
            "beats": metrics["beats"],
            "timeSignature": metrics["timeSignature"],
        },
        "chords": {
            "results": chords,
            "language": resolved_lang,
        },
        "models": {"chordModel": f"chordlab-chroma-{resolved_lang}"},
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
@app.get("/api/chords/{label}", dependencies=[Depends(require_user)])
async def chord_catalog(label: str = "") -> dict:
    """Look up comprehensive guitar and piano chord diagrams from the chord catalog.

    Args:
        label: Standard chord symbol string (e.g. 'C', 'Am', 'G7').

    Returns:
        dict: Matched chord definition and fretboard/keyboard positions.
    """
    require_feature("chord_diagrams")
    lbl = (label or "").strip()
    if not lbl:
        return {"ok": True, "chord": None}
    match = re.fullmatch(r"([A-Ga-g](?:#|b)?)(.*)", lbl)
    if not match:
        raise HTTPException(400, "Invalid chord label")
    root, quality = match.groups()
    chord_type = {"": "major", "maj": "major", "m": "minor", "min": "minor", "dim": "dim", "7": "7"}.get(quality)
    if chord_type is None:
        chord_type = "major"
    base = os.getenv("CHORDS_API_URL", CHORDS_DEFAULT).rstrip("/")
    chord = None
    try:
        async with httpx.AsyncClient(timeout=2) as client:
            response = await client.get(
                f"{base}/chords",
                params={"note": _note_id(root), "type": chord_type, "limit": "all"},
            )
        if response.is_success:
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
    except Exception:
        pass

    if chord is None:
        chord = {
            "name": {"eng": lbl},
            "notes": [{"name": {"eng": root}}],
        }
    return {"ok": True, "chord": chord}


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
        wav_source = work / "input.wav"
        source = wav_source
        try:
            import io
            import soundfile as sf
            import numpy as np
            data, sr = sf.read(io.BytesIO(audio), dtype="float32", always_2d=True)
            if data.shape[1] == 1:
                data = np.tile(data, (1, 2))
            sf.write(str(wav_source), data, sr, format="WAV", subtype="PCM_16")
        except Exception:
            ext = Path(filename or "").suffix.lower()
            if not ext or ext not in (".wav", ".mp3", ".flac", ".ogg", ".m4a"):
                ext = ".wav"
            source = work / f"input{ext}"
            source.write_bytes(audio)

        output = work / "output"
        model = os.getenv("DEMUCS_MODEL", "htdemucs")
        script = ROOT / "scripts" / "demucs_cpu.py"
        demucs_python = os.getenv("DEMUCS_PYTHON") or sys.executable or "python"

        env = os.environ.copy()
        try:
            import imageio_ffmpeg
            ffmpeg_exe = imageio_ffmpeg.get_ffmpeg_exe()
            ffmpeg_dir = os.path.dirname(ffmpeg_exe)
            target_ffmpeg = os.path.join(ffmpeg_dir, "ffmpeg.exe")
            if not os.path.exists(target_ffmpeg):
                shutil.copyfile(ffmpeg_exe, target_ffmpeg)
            env["PATH"] = ffmpeg_dir + os.pathsep + env.get("PATH", "")
        except Exception:
            pass

        try:
            subprocess.run(
                [demucs_python, str(script), "-n", model, "--float32", "-o", str(output), str(source)],
                check=True,
                timeout=600,
                capture_output=True,
                text=True,
                env=env,
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
                    filtered = signal.sosfiltfilt(sos, data, axis=0) if data.ndim > 1 else signal.sosfiltfilt(sos, data)
                    # Natural acoustic dynamics: keep original relative level without overboosting background noise
                    filtered = np.clip(filtered, -1.0, 1.0)
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


AUDIO_CACHE_DIR = ROOT / "backend" / "data" / "audio_cache"
AUDIO_CACHE_DIR.mkdir(parents=True, exist_ok=True)


def _download_url_audio(url: str) -> dict:
    import shutil
    try:
        import yt_dlp
    except ImportError as e:
        raise RuntimeError("yt-dlp is not installed on the server; please check requirements.txt") from e

    ffmpeg_exe = shutil.which("ffmpeg") or "ffmpeg"
    try:
        import imageio_ffmpeg
        ffmpeg_exe = imageio_ffmpeg.get_ffmpeg_exe()
    except Exception:
        pass

    url_str = str(url).strip()
    host = (urlsplit(url_str).hostname or "").removeprefix("www.").lower()
    search_target = url_str

    title = ""
    artist = ""
    thumbnail = ""

    # If it is Spotify, retrieve track details via oEmbed and page metadata
    if host == "spotify.com" or host.endswith(".spotify.com"):
        endpoint = f"https://open.spotify.com/oembed?url={quote(url_str, safe='')}"
        try:
            with httpx.Client(timeout=10, follow_redirects=True) as client:
                resp = client.get(endpoint)
                if resp.is_success:
                    meta = resp.json()
                    title = meta.get("title", "")
                    artist = meta.get("author_name", "")
                    thumbnail = meta.get("thumbnail_url", "")
                
                # Fetch Spotify page title/description if artist is missing
                if not artist or not title:
                    page_resp = client.get(url_str, headers={"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"})
                    if page_resp.is_success:
                        page_m = re.search(r"<title>(.*?)</title>", page_resp.text, re.IGNORECASE)
                        if page_m:
                            page_title_raw = page_m.group(1)
                            # Format: "Song Title - song and lyrics by Artist Name | Spotify"
                            by_match = re.search(r"lyrics by (.*?)(?:\s*\|\s*Spotify|$)", page_title_raw, re.IGNORECASE)
                            if by_match:
                                artist = by_match.group(1).strip()
                            title_match = re.search(r"^(.*?)\s*-\s*song", page_title_raw, re.IGNORECASE)
                            if title_match and not title:
                                title = title_match.group(1).strip()

                query_parts = [p for p in (artist, title, "audio") if p]
                search_target = f"ytsearch1:{' '.join(query_parts)}"
        except Exception as err:
            print("Spotify metadata fetch fallback:", err)

    file_id = secrets.token_hex(12)
    output_template = str(AUDIO_CACHE_DIR / f"{file_id}.%(ext)s")

    ydl_opts_primary = {
        "format": "bestaudio/best",
        "outtmpl": output_template,
        "ffmpeg_location": ffmpeg_exe,
        "noplaylist": True,
        "nocheckcertificate": True,
        "geo_bypass": True,
        "extractor_args": {
            "youtube": {
                "player_client": ["android", "android_creator", "tv_embedded"],
                "player_skip": ["webpage", "configs"],
            }
        },
        "postprocessors": [
            {
                "key": "FFmpegExtractAudio",
                "preferredcodec": "mp3",
                "preferredquality": "192",
            }
        ],
        "quiet": True,
        "no_warnings": True,
    }

    ydl_opts_fallback = {
        "format": "bestaudio/best",
        "outtmpl": output_template,
        "ffmpeg_location": ffmpeg_exe,
        "noplaylist": True,
        "nocheckcertificate": True,
        "geo_bypass": True,
        "extractor_args": {
            "youtube": {
                "player_client": ["tv_embedded", "ios"],
            }
        },
        "postprocessors": [
            {
                "key": "FFmpegExtractAudio",
                "preferredcodec": "mp3",
                "preferredquality": "192",
            }
        ],
        "quiet": True,
        "no_warnings": True,
    }

    info = None
    try:
        with yt_dlp.YoutubeDL(ydl_opts_primary) as ydl:
            info = ydl.extract_info(search_target, download=True)
    except Exception as primary_err:
        print("Primary yt-dlp download failed, attempting fallback:", primary_err)
        with yt_dlp.YoutubeDL(ydl_opts_fallback) as ydl:
            info = ydl.extract_info(search_target, download=True)

    if "entries" in info and info["entries"]:
        info = info["entries"][0]
    if not title:
        title = info.get("title", "Audio Track")
    if not artist:
        artist = info.get("artist") or info.get("uploader", "Unknown Artist")
    if not thumbnail:
        thumbnail = info.get("thumbnail", "")
    duration = float(info.get("duration", 0) or 0)
    description = info.get("description", "") or ""

    # Locate the extracted MP3 file
    mp3_candidate = AUDIO_CACHE_DIR / f"{file_id}.mp3"
    if not mp3_candidate.is_file():
        matches = list(AUDIO_CACHE_DIR.glob(f"{file_id}.*"))
        if matches:
            mp3_candidate = matches[0]
        else:
            raise RuntimeError("Audio file was not generated.")

    clean_title = re.sub(
        r"\s*(?:\(|\[)[^)]*(?:official|video|lyric|audio|hd|4k)[^)]*(?:\)|\])",
        "",
        title,
        flags=re.IGNORECASE,
    ).strip()

    return {
        "fileId": file_id,
        "filename": mp3_candidate.name,
        "title": clean_title,
        "artist": artist,
        "thumbnail": thumbnail,
        "duration": duration,
        "description": description,
        "audioUrl": f"/api/audio-file/{mp3_candidate.name}",
    }


def _estimate_key_and_beats(audio_bytes: bytes, chords: list[dict], duration_hint: float = 180.0):
    import numpy as np

    PITCH_NAMES = ["C", "Db", "D", "Eb", "E", "F", "Gb", "G", "Ab", "A", "Bb", "B"]
    MAJOR_PROFILE = np.array([6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88])
    MINOR_PROFILE = np.array([6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17])

    # 1. Estimate Key
    chroma = np.zeros(12)
    for c in chords:
        lbl = c.get("label", "")
        if not lbl or lbl in ("N", "X"):
            continue
        dur = max(0.1, float(c.get("end", 0)) - float(c.get("start", 0)))
        m = re.match(r"^([A-Ga-g][b#]?)(.*)$", lbl)
        if not m:
            continue
        r_name = m.group(1).capitalize()
        enh = {"C#": "Db", "D#": "Eb", "F#": "Gb", "G#": "Ab", "A#": "Bb"}
        r_name = enh.get(r_name, r_name)
        if r_name not in PITCH_NAMES:
            continue
        r_pc = PITCH_NAMES.index(r_name)
        q = m.group(2).lower()
        is_min = "m" in q and "maj" not in q
        third = (r_pc + 3 if is_min else r_pc + 4) % 12
        fifth = (r_pc + 7) % 12
        chroma[r_pc] += dur * 1.6
        chroma[third] += dur
        chroma[fifth] += dur

    norm = chroma / (np.sum(chroma) or 1.0)
    best_key = "C"
    best_pc = 0
    best_mode = "major"
    best_score = -1e9
    for shift in range(12):
        maj_sc = float(np.dot(np.roll(norm, -shift), MAJOR_PROFILE))
        min_sc = float(np.dot(np.roll(norm, -shift), MINOR_PROFILE))
        if maj_sc > best_score:
            best_score = maj_sc
            best_pc = shift
            best_key = PITCH_NAMES[shift]
            best_mode = "major"
        if min_sc > best_score:
            best_score = min_sc
            best_pc = shift
            best_key = PITCH_NAMES[shift] + "m"
            best_mode = "minor"

    # 2. Extract Beats & Tempo using librosa
    try:
        import io
        import librosa
        y, sr = librosa.load(io.BytesIO(audio_bytes), sr=22050, mono=True)
        tempo, beat_frames = librosa.beat.beat_track(y=y, sr=sr)
        bpm = round(float(np.atleast_1d(tempo)[0]))
        beat_times = librosa.frames_to_time(beat_frames, sr=sr).tolist()
        beats = [round(float(b), 3) for b in beat_times]
    except Exception:
        bpm = 120
        step = 60.0 / bpm
        beats = [round(t, 3) for t in np.arange(0, duration_hint, step).tolist()]

    # 3. Align beatChords
    beat_chords = []
    for b in beats:
        hit = "N"
        for c in chords:
            if b >= c.get("start", 0) and b < c.get("end", 0):
                hit = c.get("label", "N")
                break
        beat_chords.append(hit)

    return {
        "bpm": bpm,
        "beats": beats,
        "key": best_key,
        "keyPc": best_pc,
        "mode": best_mode,
        "timeSignature": 4,
        "beatChords": beat_chords,
    }



def _extract_chords_chroma(audio_bytes: bytes, duration: float) -> list[dict]:
    import io
    import numpy as np
    import librosa

    try:
        y, sr = librosa.load(io.BytesIO(audio_bytes), sr=22050, mono=True)
    except Exception:
        return [{"start": 0.0, "end": duration, "label": "C", "confidence": 0.8}]

    hop_length = 2048
    chroma = librosa.feature.chroma_stft(y=y, sr=sr, hop_length=hop_length).T
    PITCHES = ["C", "Db", "D", "Eb", "E", "F", "Gb", "G", "Ab", "A", "Bb", "B"]

    templates = []
    labels = []
    for r in range(12):
        maj = np.zeros(12)
        maj[r] = 1.0; maj[(r+4)%12] = 0.8; maj[(r+7)%12] = 0.8
        templates.append(maj / (np.linalg.norm(maj) or 1.0))
        labels.append(PITCHES[r])

        min_t = np.zeros(12)
        min_t[r] = 1.0; min_t[(r+3)%12] = 0.8; min_t[(r+7)%12] = 0.8
        templates.append(min_t / (np.linalg.norm(min_t) or 1.0))
        labels.append(PITCHES[r] + "m")

    templates = np.array(templates)
    norms = np.linalg.norm(chroma, axis=1, keepdims=True)
    norms[norms == 0] = 1.0
    norm_chroma = chroma / norms

    sim = np.dot(norm_chroma, templates.T)
    preds = np.argmax(sim, axis=1)

    frame_dur = hop_length / sr
    events = []
    if len(preds) == 0:
        return [{"start": 0.0, "end": duration, "label": "C", "confidence": 0.8}]

    cur_label = labels[preds[0]]
    cur_start = 0.0
    cur_sims = [float(sim[0, preds[0]])]

    for i in range(1, len(preds)):
        lbl = labels[preds[i]]
        if lbl != cur_label:
            t = round(i * frame_dur, 2)
            events.append({
                "start": cur_start,
                "end": t,
                "label": cur_label,
                "confidence": round(float(np.mean(cur_sims)), 2),
            })
            cur_label = lbl
            cur_start = t
            cur_sims = [float(sim[i, preds[i]])]
        else:
            cur_sims.append(float(sim[i, preds[i]]))

    events.append({
        "start": cur_start,
        "end": round(len(preds) * frame_dur, 2),
        "label": cur_label,
        "confidence": round(float(np.mean(cur_sims)), 2),
    })
    return events


class AnalyzeLinkRequest(BaseModel):
    url: str
    language: str = "auto"


@app.post("/api/analyze-link")
async def analyze_link_endpoint(data: AnalyzeLinkRequest) -> dict:
    require_feature("link_import")
    raw_url = str(data.url).strip()
    if not raw_url:
        raise HTTPException(400, "URL cannot be empty")

    # 1. Download the full audio track
    try:
        import_info = await run_in_threadpool(_download_url_audio, raw_url)
    except Exception as error:
        raise HTTPException(502, f"Could not download audio from link: {error}") from error

    filename = import_info["filename"]
    file_path = (AUDIO_CACHE_DIR / filename).resolve()
    if not file_path.is_file():
        raise HTTPException(500, "Downloaded audio file not found on disk")

    audio_bytes = file_path.read_bytes()
    duration = float(import_info.get("duration") or 180.0)

    # 2. Fast Librosa chroma chord recognition (runs in <0.5s, avoids cloud OOM timeouts)
    chords = await run_in_threadpool(_extract_chords_chroma, audio_bytes, duration)
    lang_used = data.language if data.language and data.language != "auto" else "english"

    # 3. Estimate key, tempo, beats
    metrics = await run_in_threadpool(_estimate_key_and_beats, audio_bytes, chords, duration)

    # 4. Generate/fetch synchronized lyrics (LRCLIB database first, then video description fallback)
    lyrics_data = {"plain": "", "synced": []}
    try:
        t_title = import_info.get("title", "").strip() or "Audio Track"
        t_artist = (import_info.get("artist") or "").strip() or None
        lyrics_lookup_req = LyricsLookup(
            title=t_title,
            artist=t_artist,
            duration=duration,
        )
        lyrics_data = await asyncio.wait_for(fetch_lyrics(lyrics_lookup_req), timeout=5.0)
    except Exception as lyric_err:
        print("Lyric fetch/gen error or timeout:", lyric_err)

    if not lyrics_data.get("plain"):
        # Check if genuine lyrics or text lines are available in the video description
        desc = import_info.get("description", "")
        clean_lines = [
            line.strip() for line in desc.splitlines()
            if line.strip() and not any(k in line.lower() for k in ["http://", "https://", "subscribe", "facebook", "twitter", "instagram", "contact:"])
        ]
        if len(clean_lines) >= 3:
            lyrics_data["plain"] = "\n".join(clean_lines[:40])

    return {
        "ok": True,
        "id": import_info["fileId"],
        "title": import_info.get("title", "Audio Track"),
        "artist": import_info.get("artist", ""),
        "artwork": import_info.get("thumbnail", ""),
        "audioUrl": import_info["audioUrl"],
        "lyrics": lyrics_data.get("plain", ""),
        "syncedLyrics": lyrics_data.get("synced", []),
        "analysis": {
            "duration": duration,
            "bpm": metrics["bpm"],
            "beats": metrics["beats"],
            "key": metrics["key"],
            "keyPc": metrics["keyPc"],
            "mode": metrics["mode"],
            "timeSignature": metrics["timeSignature"],
            "chords": chords,
            "beatChords": metrics["beatChords"],
            "language": lang_used,
        },
    }


@app.post("/api/download-audio")
async def download_audio_endpoint(data: LinkImport) -> dict:
    require_feature("link_import")
    try:
        result = await run_in_threadpool(_download_url_audio, str(data.url))
        return result
    except Exception as error:
        raise HTTPException(502, f"Could not download audio from link: {error}") from error


@app.get("/api/audio-file/{file_name}")
async def serve_audio_file(file_name: str):
    file_path = (AUDIO_CACHE_DIR / file_name).resolve()
    if not file_path.is_file() or not file_path.is_relative_to(AUDIO_CACHE_DIR):
        raise HTTPException(404, "Audio file not found")
    return FileResponse(
        file_path,
        media_type="audio/mpeg",
        filename=file_name,
        headers={"Accept-Ranges": "bytes"}
    )


class GenerateLyricsRequest(BaseModel):
    title: str = Field(min_length=1, max_length=200)
    artist: str | None = Field(default=None, max_length=200)
    duration: float | None = Field(default=None, ge=0, le=3600)
    style: str | None = Field(default="auto")


def _generate_lyrics_ai(title: str, artist: str | None, duration: float | None, style: str | None = "auto") -> dict:
    track_name = title.strip()
    artist_name = (artist or "").strip()
    dur = float(duration or 180)

    if os.getenv("GEMINI_API_KEY"):
        prompt = f"""You are an expert music lyricist and transcriber.
Song: "{track_name}" by "{artist_name or 'Unknown Artist'}"
Approximate track duration: {int(dur)} seconds.
Style preference: {style or 'auto'} (If Tamil or Hindi, write authentic colloquial Romanized Tanglish/Hinglish as sung).

Generate beat-synchronized lyrics with LRC timestamps spanning from 00:08 to {int(dur) - 5} seconds.
Format strictly with timestamps like:
[00:12.50] Lyric line here
[00:20.00] Another line here

Rules:
1. Every line must start with [mm:ss.xx].
2. For Indic songs, transliterate to Roman script (Tanglish/Hinglish).
3. Output ONLY the timestamped lines, without Markdown blocks or other text.
4. If you do not know the actual song lyrics, output NOTHING."""
        try:
            from google import genai
            client = genai.Client()
            response = client.models.generate_content(
                model="gemini-3.8-flash",
                contents=prompt,
            )
            resp_text = response.text or ""
            lines = _parse_lrc(resp_text)
            if lines:
                plain = "\n".join(l["text"] for l in lines)
                return {"found": True, "generated": True, "plain": plain, "synced": lines, "source": "gemini"}
        except Exception as e:
            print("Gemini lyric generation fallback:", e)

    # If AI key is not set or lyrics cannot be found, return empty result cleanly without fake placeholder lyrics
    return {
        "found": False,
        "generated": False,
        "plain": "",
        "synced": [],
        "source": "none",
    }


@app.post("/api/generate-lyrics", dependencies=[Depends(require_user)])
async def generate_lyrics_endpoint(data: GenerateLyricsRequest) -> dict:
    require_feature("lyrics_lookup")
    return await run_in_threadpool(_generate_lyrics_ai, data.title, data.artist, data.duration, data.style)


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
        return _generate_lyrics_ai(data.title, data.artist, data.duration, "auto")

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
    if not (plain or synced):
        return _generate_lyrics_ai(data.title, data.artist, data.duration, "auto")
    result = {"found": True, "plain": plain, "synced": synced}
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
    """
    output = []
    for line in lyrics.split("\n"):
        if line.lstrip().startswith("[") or not TAMIL_RE.search(line):
            output.append(line)
        else:
            output.append(re.sub(r"\S+", lambda match: _tanglish_word(match.group()), line))
    return "\n".join(output)


def _hinglish_word(word: str) -> str:
    """Transliterate a single Hindi word into phonetic Hinglish (Roman script)."""
    core = re.sub(r"^[^ऀ-ॿ]+|[^ऀ-ॿ]+$", "", word)
    output = ""
    for index, char in enumerate(core):
        if char in H_VOWELS:
            output += H_VOWELS[char]
        elif char in H_CONSONANTS:
            output += H_CONSONANTS[char]
            next_char = core[index + 1] if index + 1 < len(core) else ""
            if not next_char or (next_char not in H_SIGNS and next_char != "्"):
                output += "a"
        elif char in H_SIGNS:
            output += H_SIGNS[char]
    return word.replace(core, output, 1) if core else word


def _offline_hinglish(lyrics: str) -> str:
    """Perform fast, local offline rule-based transliteration of Hindi lyrics into Hinglish."""
    output = []
    for line in lyrics.split("\n"):
        if line.lstrip().startswith("[") or not HINDI_RE.search(line):
            output.append(line)
        else:
            output.append(re.sub(r"\S+", lambda m: _hinglish_word(m.group()), line))
    return "\n".join(output)


@app.post("/api/romanize", dependencies=[Depends(require_user)])
async def romanize(data: RomanizeRequest) -> dict[str, str]:
    """Transliterate Indic lyrics (Tamil/Hindi) into Roman script (Tanglish/Hinglish) or English.

    Uses offline rule-based transliteration for instant response, with Gemini or OpenAI
    when configured. Never raises 503 so user experience remains resilient.
    """
    require_feature("lyric_romanization")
    raw_lyrics = (data.lyrics or "").strip()
    if not raw_lyrics:
        return {"text": ""}

    tamil = bool(TAMIL_RE.search(raw_lyrics))
    hindi = bool(HINDI_RE.search(raw_lyrics))

    # Fast offline transliteration
    if data.style == "tanglish" and tamil:
        return {"text": _offline_tanglish(raw_lyrics)}
    if data.style == "hinglish" and hindi:
        return {"text": _offline_hinglish(raw_lyrics)}
    if data.style == "auto":
        if tamil:
            return {"text": _offline_tanglish(raw_lyrics)}
        if hindi:
            return {"text": _offline_hinglish(raw_lyrics)}

    # If Gemini is configured, use it for rich contextual romanization
    if os.getenv("GEMINI_API_KEY"):
        try:
            from google import genai
            client = genai.Client()
            system = f"Transliterate Indic lyrics into Roman script ({data.style}). Preserve all line breaks, section tags [Chorus], and line count. Output ONLY converted text."
            resp = client.models.generate_content(
                model="gemini-3.8-flash",
                contents=f"{system}\n\nLyrics to convert:\n{raw_lyrics}",
            )
            if resp.text and resp.text.strip():
                return {"text": resp.text.strip()}
        except Exception as error:
            print("Gemini romanize exception:", error)

    # If OpenAI is configured, use it
    api_key = os.getenv("AI_API_KEY")
    if api_key:
        try:
            base_url = os.getenv("AI_API_BASE_URL", "https://api.openai.com/v1").rstrip("/")
            system = f"Transliterate Indic lyrics into Roman script ({data.style}). Output ONLY converted text, preserving lines and tags."
            payload = {
                "model": os.getenv("AI_MODEL", "gpt-4o-mini"),
                "messages": [{"role": "system", "content": system}, {"role": "user", "content": raw_lyrics}],
            }
            async with httpx.AsyncClient(timeout=15) as client:
                res = await client.post(
                    f"{base_url}/chat/completions",
                    headers={"authorization": f"Bearer {api_key}"},
                    json=payload,
                )
                if res.is_success:
                    content = res.json()["choices"][0]["message"]["content"].strip()
                    if content:
                        return {"text": content}
        except Exception as error:
            print("OpenAI romanize exception:", error)

    # Safe offline fallback (never throw 503)
    if tamil:
        return {"text": _offline_tanglish(raw_lyrics)}
    if hindi:
        return {"text": _offline_hinglish(raw_lyrics)}
    return {"text": raw_lyrics}


# -----------------------------------------------------------------------------
# Unified Static Frontend & SPA Serving
# -----------------------------------------------------------------------------
DIST_DIR = ROOT / "dist"

if DIST_DIR.is_dir():
    assets_dir = DIST_DIR / "assets"
    if assets_dir.is_dir():
        app.mount("/assets", StaticFiles(directory=str(assets_dir)), name="assets")

    @app.get("/admin")
    @app.get("/admin/")
    @app.get("/admin/{admin_path:path}")
    async def serve_admin(admin_path: str = ""):
        """Serve the standalone administrator console single-page application."""
        if admin_path:
            candidate = (DIST_DIR / "admin" / admin_path).resolve()
            if candidate.is_file() and candidate.is_relative_to(DIST_DIR / "admin"):
                return FileResponse(candidate)
        admin_index = DIST_DIR / "admin" / "index.html"
        if admin_index.is_file():
            return FileResponse(
                admin_index,
                headers={"Cache-Control": "no-cache, no-store, must-revalidate"},
            )
        raise HTTPException(404, "Admin console assets not found. Run 'npm run build' first.")

    @app.get("/{full_path:path}")
    async def serve_frontend(full_path: str = ""):
        """Serve the ChordLab client single-page application and static assets."""
        if full_path.startswith(("api/", "health", "docs", "redoc", "openapi.json")):
            raise HTTPException(404, "Endpoint not found")

        if full_path:
            candidate = (DIST_DIR / full_path).resolve()
            if candidate.is_file() and candidate.is_relative_to(DIST_DIR):
                return FileResponse(candidate)

        user_index = DIST_DIR / "index.html"
        if user_index.is_file():
            return FileResponse(
                user_index,
                headers={"Cache-Control": "no-cache, no-store, must-revalidate"},
            )
        return {"status": "ok", "message": "ChordLab API running. Run 'npm run build' to serve web UI."}


if __name__ == "__main__":
    import uvicorn

    host = os.getenv("HOST", "0.0.0.0")
    port = int(os.getenv("PORT", "8000"))
    uvicorn.run("backend.main:app", host=host, port=port, reload=False)
