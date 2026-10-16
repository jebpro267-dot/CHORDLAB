import { useState, type FormEvent } from "react";
import { createRoot } from "react-dom/client";
import {
  Activity,
  Check,
  KeyRound,
  LogOut,
  RefreshCw,
  Save,
  ShieldCheck,
  SlidersHorizontal,
} from "lucide-react";

import { DEFAULT_APP_SETTINGS, type AppSettings } from "./lib/app-settings";
import "./styles.css";
import "./admin.css";

interface HealthCheck {
  name: string;
  status: string;
  detail: string;
}

interface HealthReport {
  checks: HealthCheck[];
  features: AppSettings["features"];
}

const featureLabels: { key: keyof AppSettings["features"]; label: string; detail: string }[] = [
  {
    key: "song_analysis",
    label: "Song analysis",
    detail: "Allow users to open the song analysis workflow.",
  },
  {
    key: "tensorflow_analysis",
    label: "TensorFlow chord model",
    detail: "Run the trained ChordLab model in the Python API.",
  },
  {
    key: "chordmini_analysis",
    label: "ChordMini analysis",
    detail: "Optional remote beat tracking and chord recognition.",
  },
  {
    key: "local_analysis",
    label: "On-device analysis",
    detail: "Browser-based fallback chord analysis.",
  },
  {
    key: "link_import",
    label: "Track link import",
    detail: "YouTube and Spotify metadata lookup.",
  },
  { key: "lyrics_lookup", label: "Lyrics lookup", detail: "LRCLIB lyrics search." },
  {
    key: "lyric_romanization",
    label: "Lyric romanization",
    detail: "Hinglish, Tanglish, auto, and English conversion.",
  },
  {
    key: "stem_separation",
    label: "Stem separation",
    detail: "Demucs vocals, drums, bass, and other stems.",
  },
  {
    key: "chord_diagrams",
    label: "Chord diagrams",
    detail: "External chord-shape catalog lookup.",
  },
  {
    key: "live_detection",
    label: "Live detection",
    detail: "Microphone-based live chord detection.",
  },
  { key: "tuner", label: "Instrument tuner", detail: "Microphone-based tuning tools." },
];

const navLabels: { key: keyof AppSettings["navigation"]; label: string }[] = [
  { key: "library", label: "Library" },
  { key: "analyze", label: "Analyze" },
  { key: "live", label: "Live" },
  { key: "chords", label: "Chords" },
  { key: "tuner", label: "Tuner" },
];

const apiBase = (import.meta.env["VITE_BACKEND_URL"] || "").replace(/\/+$/, "");

/**
 * Dispatches an authenticated HTTP fetch request to the administrative API endpoint.
 * Automatically serializes JSON bodies, injects bearer authentication headers,
 * and parses JSON error messages on failures.
 *
 * @template T - Expected JSON response payload type.
 * @param path - API URL path (relative to `apiBase`).
 * @param token - Bearer session token.
 * @param init - Optional RequestInit configuration options.
 * @returns Promise resolving to the typed JSON response.
 * @throws Error with descriptive error detail if the HTTP request returns an error code.
 */
async function adminRequest<T>(path: string, token: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${apiBase}${path}`, {
    ...init,
    headers: {
      ...(init?.body ? { "content-type": "application/json" } : {}),
      Authorization: `Bearer ${token}`,
      ...init?.headers,
    },
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { detail?: string };
    throw new Error(body.detail ?? `Request failed (${response.status})`);
  }
  return (await response.json()) as T;
}

const DEFAULT_ADMIN_USERNAME = "jebin";
const DEFAULT_ADMIN_PASSWORD = "jebpro@8898";

/**
 * Root component for the standalone administrative control dashboard.
 * Manages admin authentication, global feature toggles, navigation visibility,
 * theme appearance, and live backend health diagnostic monitoring.
 *
 * @returns React JSX element rendering the administrative portal.
 */
function AdminApp() {
  const [token, setToken] = useState("");
  const [username, setUsername] = useState(() => {
    try {
      return localStorage.getItem("chordlab_admin_username") || DEFAULT_ADMIN_USERNAME;
    } catch {
      return DEFAULT_ADMIN_USERNAME;
    }
  });
  const [password, setPassword] = useState(() => {
    try {
      return localStorage.getItem("chordlab_admin_password") || DEFAULT_ADMIN_PASSWORD;
    } catch {
      return DEFAULT_ADMIN_PASSWORD;
    }
  });
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_APP_SETTINGS);
  const [health, setHealth] = useState<HealthReport | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  function handleUsernameChange(val: string) {
    setUsername(val);
    try {
      localStorage.setItem("chordlab_admin_username", val);
    } catch {
      // Ignore storage errors
    }
  }

  function handlePasswordChange(val: string) {
    setPassword(val);
    try {
      localStorage.setItem("chordlab_admin_password", val);
    } catch {
      // Ignore storage errors
    }
  }

  /**
   * Fetches latest application configuration settings and system health checks in parallel.
   *
   * @param tokenToUse - Valid admin session bearer token.
   */
  async function load(tokenToUse: string) {
    setBusy(true);
    setError("");
    try {
      const [config, report] = await Promise.all([
        adminRequest<AppSettings>("/api/admin/settings", tokenToUse),
        adminRequest<HealthReport>("/api/admin/health", tokenToUse),
      ]);
      setSettings(config);
      setHealth(report);
      setToken(tokenToUse);
      setMessage("");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not connect to the admin API.");
      if (tokenToUse === token) void signOut();
    } finally {
      setBusy(false);
    }
  }

  /**
   * Submits administrator credentials to `/api/admin/login` and initializes the dashboard.
   *
   * @param event - Form submit event.
   */
  async function signIn(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`${apiBase}/api/admin/login`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ username, password }),
      });
      const result = (await response.json().catch(() => ({}))) as {
        token?: string;
        detail?: string;
      };
      if (!response.ok || !result.token) {
        throw new Error(result.detail ?? "Username or password is incorrect.");
      }
      try {
        localStorage.setItem("chordlab_admin_username", username);
        localStorage.setItem("chordlab_admin_password", password);
      } catch {
        // Ignore storage errors
      }
      await load(result.token);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not sign in.");
    } finally {
      setBusy(false);
    }
  }

  /**
   * Saves updated configuration settings to `/api/admin/settings` and refreshes health status.
   *
   * @param event - Form submit event.
   */
  async function save(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const result = await adminRequest<AppSettings>("/api/admin/settings", token, {
        method: "PUT",
        body: JSON.stringify(settings),
      });
      setSettings(result);
      setMessage("Settings saved and active for the mobile app.");
      await refreshHealth();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not save settings.");
    } finally {
      setBusy(false);
    }
  }

  /** Refreshes health probe status checks from `/api/admin/health`. */
  async function refreshHealth() {
    if (!token) return;
    try {
      setHealth(await adminRequest<HealthReport>("/api/admin/health", token));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not load service health.");
    }
  }

  /** Terminates the active administrator session and returns to the sign-in form. */
  async function signOut() {
    if (token) {
      try {
        await adminRequest("/api/auth/logout", token, { method: "POST" });
      } catch {
        // The browser session is discarded even if the API session is already invalid.
      }
    }
    setToken("");
    setPassword(() => {
      try {
        return localStorage.getItem("chordlab_admin_password") || DEFAULT_ADMIN_PASSWORD;
      } catch {
        return DEFAULT_ADMIN_PASSWORD;
      }
    });
    setHealth(null);
  }

  if (!token) {
    return (
      <main className="admin-login min-h-screen px-5 py-10">
        <form onSubmit={signIn} className="admin-login-panel mx-auto mt-[10vh] max-w-md p-7 sm:p-9">
          <div className="admin-mark mb-8 flex size-12 items-center justify-center rounded-xl">
            <ShieldCheck className="size-6" />
          </div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-primary">
            ChordLab control
          </p>
          <h1 className="mt-2 text-3xl font-semibold">Administrator sign in</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Sign in with the administrator username and password.
          </p>
          <label htmlFor="admin-username" className="mt-7 block text-sm font-medium">
            Username
          </label>
          <div className="relative mt-2">
            <KeyRound className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <input
              id="admin-username"
              type="text"
              autoComplete="username"
              value={username}
              onChange={(event) => handleUsernameChange(event.target.value)}
              className="admin-input w-full pl-10"
              required
            />
          </div>
          <label htmlFor="admin-password" className="mt-4 block text-sm font-medium">
            Password
          </label>
          <input
            id="admin-password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(event) => handlePasswordChange(event.target.value)}
            className="admin-input mt-2 w-full"
            required
          />
          {error && <p className="mt-3 text-sm text-destructive">{error}</p>}
          <button type="submit" disabled={busy} className="admin-primary mt-5 w-full">
            {busy ? "Checking…" : "Sign in"}
          </button>
        </form>
      </main>
    );
  }

  return (
    <main className="admin-shell min-h-screen px-4 py-5 sm:px-8 sm:py-8">
      <div className="mx-auto max-w-6xl">
        <header className="admin-header flex flex-wrap items-center justify-between gap-4 pb-6">
          <div className="flex items-center gap-3">
            <div className="admin-mark flex size-10 items-center justify-center rounded-lg">
              <SlidersHorizontal className="size-5" />
            </div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-primary">
                ChordLab
              </p>
              <h1 className="text-xl font-semibold">Application control</h1>
            </div>
          </div>
          <div className="flex gap-2">
            <button
              className="admin-quiet"
              type="button"
              onClick={() => void load(token)}
              disabled={busy}
            >
              <RefreshCw className="size-4" />
              Refresh
            </button>
            <button className="admin-quiet" type="button" onClick={signOut}>
              <LogOut className="size-4" />
              Sign out
            </button>
          </div>
        </header>

        <section className="admin-health-band mb-6 p-4 sm:p-5" aria-labelledby="health-title">
          <div className="mb-4 flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <Activity className="size-4 text-primary" />
              <h2 id="health-title" className="text-base font-semibold">
                Service health
              </h2>
            </div>
            <button className="admin-quiet" type="button" onClick={() => void refreshHealth()}>
              <RefreshCw className="size-4" />
              Check now
            </button>
          </div>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            {(health?.checks ?? []).map((check) => (
              <HealthItem key={check.name} check={check} />
            ))}
          </div>
          {!health && <p className="text-sm text-muted-foreground">Loading service status…</p>}
        </section>

        <form onSubmit={save} className="grid items-start gap-6 lg:grid-cols-[1fr_320px]">
          <div className="space-y-6">
            <section className="admin-section p-4 sm:p-6">
              <SectionHeading
                title="Feature controls"
                detail="Pause or resume capabilities for all users."
              />
              <div className="mt-5 divide-y divide-border">
                {featureLabels.map(({ key, label, detail }) => (
                  <ToggleRow
                    key={key}
                    label={label}
                    detail={detail}
                    checked={settings.features[key]}
                    onChange={(checked) =>
                      setSettings((current) => ({
                        ...current,
                        features: { ...current.features, [key]: checked },
                      }))
                    }
                  />
                ))}
              </div>
            </section>

            <section className="admin-section p-4 sm:p-6">
              <SectionHeading
                title="App text and identity"
                detail="Changes appear on the user-facing app after saving."
              />
              <div className="mt-5 grid gap-4 sm:grid-cols-2">
                <TextField
                  label="App name"
                  value={settings.appearance.app_name}
                  maxLength={40}
                  onChange={(value) => setAppearance("app_name", value)}
                />
                <TextField
                  label="Library heading"
                  value={settings.appearance.home_title}
                  maxLength={80}
                  onChange={(value) => setAppearance("home_title", value)}
                />
                <TextField
                  label="Library description"
                  value={settings.appearance.home_description}
                  maxLength={240}
                  onChange={(value) => setAppearance("home_description", value)}
                />
                <TextField
                  label="Empty library heading"
                  value={settings.appearance.empty_title}
                  maxLength={80}
                  onChange={(value) => setAppearance("empty_title", value)}
                />
                <TextField
                  label="Empty library description"
                  value={settings.appearance.empty_description}
                  maxLength={240}
                  onChange={(value) => setAppearance("empty_description", value)}
                />
              </div>
            </section>
          </div>

          <aside className="space-y-6 lg:sticky lg:top-5">
            <section className="admin-section p-4 sm:p-5">
              <SectionHeading
                title="Navigation"
                detail="Choose which sections are shown in the app."
              />
              <div className="mt-3">
                {navLabels.map(({ key, label }) => (
                  <ToggleRow
                    key={key}
                    label={label}
                    checked={settings.navigation[key]}
                    onChange={(checked) =>
                      setSettings((current) => ({
                        ...current,
                        navigation: { ...current.navigation, [key]: checked },
                      }))
                    }
                  />
                ))}
              </div>
            </section>

            <section className="admin-section p-4 sm:p-5">
              <SectionHeading title="Home layout" detail="Control the mobile library layout." />
              <ToggleRow
                label="Quick action buttons"
                checked={settings.layout.show_quick_actions}
                onChange={(checked) =>
                  setSettings((current) => ({
                    ...current,
                    layout: { ...current.layout, show_quick_actions: checked },
                  }))
                }
              />
              <ToggleRow
                label="Song search field"
                checked={settings.layout.show_song_search}
                onChange={(checked) =>
                  setSettings((current) => ({
                    ...current,
                    layout: { ...current.layout, show_song_search: checked },
                  }))
                }
              />
            </section>

            <section className="admin-section p-4 sm:p-5">
              <SectionHeading title="Appearance" detail="Brand color controls." />
              <ColorField
                label="Primary"
                value={settings.appearance.primary_color}
                onChange={(value) => setAppearance("primary_color", value)}
              />
              <ColorField
                label="Secondary accent"
                value={settings.appearance.accent_color}
                onChange={(value) => setAppearance("accent_color", value)}
              />
            </section>

            <div className="admin-save-panel p-4">
              {error && (
                <p role="alert" className="mb-3 text-sm text-destructive">
                  {error}
                </p>
              )}
              {message && (
                <p role="status" className="mb-3 flex items-center gap-2 text-sm text-emerald-300">
                  <Check className="size-4" />
                  {message}
                </p>
              )}
              <button type="submit" className="admin-primary w-full" disabled={busy}>
                <Save className="size-4" />
                {busy ? "Saving…" : "Save changes"}
              </button>
            </div>
          </aside>
        </form>
      </div>
    </main>
  );

  function setAppearance<K extends keyof AppSettings["appearance"]>(
    key: K,
    value: AppSettings["appearance"][K],
  ) {
    setSettings((current) => ({ ...current, appearance: { ...current.appearance, [key]: value } }));
  }
}

/**
 * Displays a styled section title and descriptive subtitle in the admin panel.
 *
 * @param props - Section heading properties.
 * @returns React JSX element rendering section header.
 */
function SectionHeading({ title, detail }: { title: string; detail: string }) {
  return (
    <div>
      <h2 className="text-base font-semibold">{title}</h2>
      <p className="mt-1 text-xs text-muted-foreground">{detail}</p>
    </div>
  );
}

/**
 * Toggle switch row for enabling or disabling individual application features and navigation links.
 *
 * @param props - Switch row properties.
 * @returns React JSX element rendering interactive checkbox toggle.
 */
function ToggleRow({
  label,
  detail,
  checked,
  onChange,
}: {
  label: string;
  detail?: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="admin-toggle-row flex cursor-pointer items-center justify-between gap-4 py-3">
      <span className="min-w-0">
        <span className="block text-sm font-medium">{label}</span>
        {detail && <span className="mt-0.5 block text-xs text-muted-foreground">{detail}</span>}
      </span>
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        className="admin-switch shrink-0"
      />
    </label>
  );
}

/**
 * Text input field with label and character length constraint.
 *
 * @param props - Text field properties.
 * @returns React JSX element rendering text input.
 */
function TextField({
  label,
  value,
  maxLength,
  onChange,
}: {
  label: string;
  value: string;
  maxLength: number;
  onChange: (value: string) => void;
}) {
  return (
    <label className="block text-sm font-medium">
      {label}
      <input
        value={value}
        maxLength={maxLength}
        onChange={(event) => onChange(event.target.value)}
        className="admin-input mt-1.5 w-full"
      />
    </label>
  );
}

/**
 * Color picker input field with hex preview badge for branding customization.
 *
 * @param props - Color field properties.
 * @returns React JSX element rendering color selector.
 */
function ColorField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="mt-4 flex items-center justify-between gap-4 text-sm font-medium">
      {label}
      <span className="flex items-center gap-2">
        <input
          type="color"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          className="admin-color"
        />
        <span className="font-mono text-xs text-muted-foreground">{value}</span>
      </span>
    </label>
  );
}

/**
 * Diagnostic health status card showing connectivity indicators for backend and third-party integrations.
 *
 * @param props - Health check item properties.
 * @returns React JSX element rendering health report badge.
 */
function HealthItem({ check }: { check: HealthCheck }) {
  const healthy = check.status === "healthy";
  return (
    <div className="admin-health-item flex min-w-0 items-start gap-2 p-3">
      <span
        className={`mt-1 size-2 shrink-0 rounded-full ${healthy ? "bg-emerald-400" : "bg-amber-400"}`}
      />
      <span className="min-w-0">
        <span className="block truncate text-sm font-medium">{check.name}</span>
        <span className="block truncate text-xs text-muted-foreground">{check.detail}</span>
      </span>
    </div>
  );
}

const adminRoot = document.getElementById("admin-root");
if (!adminRoot) throw new Error("Missing admin root element");
createRoot(adminRoot).render(<AdminApp />);
