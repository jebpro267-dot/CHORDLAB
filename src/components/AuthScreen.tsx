import { useState, type FormEvent } from "react";
import { Check, Globe, LoaderCircle, Music2, RefreshCw, Server, UserRoundPlus } from "lucide-react";

import { useAuth } from "@/lib/auth";
import { getBackendBaseUrl, setBackendBaseUrl } from "@/lib/backend";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/**
 * Authentication screen component offering user login and account registration forms.
 * Manages form state, validation error display, and session initialization.
 *
 * @returns React JSX element rendering the authentication portal.
 */
export function AuthScreen() {
  const { signIn, register } = useAuth();
  const [mode, setMode] = useState<"signin" | "register">("signin");
  const [showServerConfig, setShowServerConfig] = useState(false);
  const [serverUrlInput, setServerUrlInput] = useState(() => getBackendBaseUrl());
  const [serverStatus, setServerStatus] = useState<string | null>(null);
  const [email, setEmail] = useState(() => {
    try {
      return localStorage.getItem("chordlab-saved-email") || "jebin";
    } catch {
      return "jebin";
    }
  });
  const [password, setPassword] = useState(() => {
    try {
      return localStorage.getItem("chordlab-saved-password") || "jebpro@8898";
    } catch {
      return "jebpro@8898";
    }
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  /**
   * Handles submission of login or registration credentials to the backend API.
   *
   * @param event - Form submission event.
   */
  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      if (mode === "register") {
        await register(email, password);
      } else {
        await signIn(email, password);
      }
      try {
        localStorage.setItem("chordlab-saved-email", email);
        localStorage.setItem("chordlab-saved-password", password);
      } catch {
        // ignore
      }
      window.dispatchEvent(
        new CustomEvent("chordlab:show-welcome", {
          detail: {
            message:
              mode === "register"
                ? "Welcome to ChordLab Studio!"
                : `Welcome back, ${email.split("@")[0]}!`,
          },
        }),
      );
      setError("");
    } catch (reason) {
      const msg = reason instanceof Error ? reason.message : "Could not authenticate.";
      if (
        msg.toLowerCase().includes("failed to fetch") ||
        msg.toLowerCase().includes("networkerror") ||
        msg.toLowerCase().includes("network request failed")
      ) {
        setError(
          `Cannot reach backend server (${getBackendBaseUrl() || "relative / same-origin"}). Please check your internet or update the Server URL below.`
        );
        setShowServerConfig(true);
      } else {
        setError(msg);
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="flex min-h-[calc(100dvh-1rem)] items-center justify-center px-5 py-8">
      <section className="panel w-full max-w-md p-6 sm:p-8">
        <div className="mb-6 flex size-12 items-center justify-center rounded-xl bg-primary text-primary-foreground">
          <Music2 className="size-6" />
        </div>
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary">ChordLab</p>
        <h1 className="mt-2 text-2xl font-semibold">
          {mode === "register" ? "Create your account" : "Sign in to your library"}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Your song library stays on this device. Your account keeps your sign-in active.
        </p>

        <div className="mt-6 grid grid-cols-2 gap-1 rounded-lg bg-surface-2 p-1">
          <button
            type="button"
            onClick={() => {
              setMode("signin");
              setError("");
            }}
            aria-pressed={mode === "signin"}
            className={`rounded-md px-3 py-2 text-sm font-medium ${mode === "signin" ? "bg-background text-foreground shadow" : "text-muted-foreground"}`}
          >
            Sign in
          </button>
          <button
            type="button"
            onClick={() => {
              setMode("register");
              setError("");
            }}
            aria-pressed={mode === "register"}
            className={`rounded-md px-3 py-2 text-sm font-medium ${mode === "register" ? "bg-background text-foreground shadow" : "text-muted-foreground"}`}
          >
            Register
          </button>
        </div>

        <form onSubmit={(event) => void submit(event)} className="mt-5 space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="account-email">{mode === "register" ? "Email" : "Email or Username"}</Label>
            <Input
              id="account-email"
              type={mode === "register" ? "email" : "text"}
              autoComplete={mode === "register" ? "email" : "username"}
              placeholder={mode === "register" ? "you@example.com" : "e.g. jebin or you@example.com"}
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              required
              maxLength={254}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="account-password">Password</Label>
            <Input
              id="account-password"
              type="password"
              autoComplete={mode === "register" ? "new-password" : "current-password"}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
              minLength={mode === "register" ? 8 : 1}
              maxLength={128}
            />
            {mode === "register" && (
              <p className="text-xs text-muted-foreground">Use at least 8 characters.</p>
            )}
          </div>
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <Button type="submit" className="w-full" disabled={busy}>
            {busy ? (
              <LoaderCircle className="size-4 animate-spin" />
            ) : mode === "register" ? (
              <UserRoundPlus className="size-4" />
            ) : null}
            {busy ? "Please wait…" : mode === "register" ? "Create account" : "Sign in"}
          </Button>

          {/* Server Connection Configuration */}
          <div className="pt-2">
            <button
              type="button"
              onClick={() => setShowServerConfig(!showServerConfig)}
              className="flex w-full items-center justify-between rounded-lg border border-border/40 bg-surface-2/60 px-3 py-2 text-xs text-muted-foreground transition-colors hover:text-foreground"
            >
              <span className="flex items-center gap-1.5 truncate">
                <Server className="size-3.5 text-primary" />
                <span className="truncate">
                  Server: <span className="font-mono text-[11px] text-foreground">{getBackendBaseUrl() || "Default (Same-Origin)"}</span>
                </span>
              </span>
              <span className="text-[11px] font-medium text-primary">
                {showServerConfig ? "Close" : "Change"}
              </span>
            </button>

            {showServerConfig && (
              <div className="mt-2 space-y-2 rounded-lg border border-border/60 bg-surface-2 p-3 text-xs">
                <Label htmlFor="custom-server-url" className="text-[11px] text-muted-foreground">
                  Backend API URL (Cloudflare Tunnel, LAN IP, or Remote Domain)
                </Label>
                <div className="flex gap-2">
                  <Input
                    id="custom-server-url"
                    type="url"
                    placeholder="https://...trycloudflare.com or http://192.168.x.x:8000"
                    value={serverUrlInput}
                    onChange={(e) => {
                      setServerUrlInput(e.target.value);
                      setServerStatus(null);
                    }}
                    className="h-8 text-xs font-mono"
                  />
                  <Button
                    type="button"
                    size="sm"
                    className="h-8 text-xs"
                    onClick={async () => {
                      const url = serverUrlInput.trim().replace(/\/+$/, "");
                      setBackendBaseUrl(url);
                      setServerStatus("Testing connection...");
                      try {
                        const target = url ? `${url}/health` : "/health";
                        const res = await fetch(target, { signal: AbortSignal.timeout(6000) });
                        if (res.ok) {
                          setServerStatus("Connected (HTTP 200 OK)");
                          setError("");
                        } else {
                          setServerStatus(`Error: HTTP ${res.status}`);
                        }
                      } catch {
                        setServerStatus("Unreachable (Check URL / internet)");
                      }
                    }}
                  >
                    Save
                  </Button>
                </div>
                {serverStatus && (
                  <p
                    className={`text-[11px] font-medium ${
                      serverStatus.includes("Connected")
                        ? "text-emerald-400"
                        : "text-amber-400"
                    }`}
                  >
                    {serverStatus}
                  </p>
                )}
                <div className="flex justify-between pt-1 text-[11px] text-muted-foreground">
                  <button
                    type="button"
                    className="hover:underline"
                    onClick={() => {
                      const tunnel = "https://poker-stephen-rapids-stack.trycloudflare.com";
                      setServerUrlInput(tunnel);
                      setBackendBaseUrl(tunnel);
                      setServerStatus("Set to active Cloudflare tunnel");
                    }}
                  >
                    Use active tunnel
                  </button>
                  <button
                    type="button"
                    className="hover:underline"
                    onClick={() => {
                      setServerUrlInput("");
                      setBackendBaseUrl("");
                      setServerStatus("Reset to default");
                    }}
                  >
                    Reset default
                  </button>
                </div>
              </div>
            )}
          </div>
        </form>
      </section>
    </main>
  );
}
