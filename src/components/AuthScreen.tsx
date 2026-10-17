import { useState, type FormEvent } from "react";
import { LoaderCircle, Music2, UserRoundPlus } from "lucide-react";

import { useAuth } from "@/lib/auth";
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
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not authenticate.");
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
        </form>
      </section>
    </main>
  );
}
