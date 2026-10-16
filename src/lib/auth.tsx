import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

import { backendUrl } from "./backend";

const TOKEN_KEY = "chordlab-user-token";
const ACCOUNT_KEY = "chordlab-user-account";

export interface UserAccount {
  id: string;
  email: string;
  role: "user" | "admin";
}

interface AuthContextValue {
  account: UserAccount | null;
  ready: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

/**
 * Sends a sign-in or register request to the given backend path and stores
 * the returned JWT token and account record in `localStorage`.
 *
 * @param path     - Backend API path (`/api/auth/login` or `/api/auth/register`).
 * @param email    - User's email address.
 * @param password - User's password.
 * @returns The authenticated `UserAccount` on success.
 * @throws {Error} With a human-readable message when the server rejects the credentials.
 */
async function submitCredentials(path: string, email: string, password: string) {
  const response = await fetch(backendUrl(path), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  const payload = (await response.json().catch(() => ({}))) as {
    token?: string;
    account?: UserAccount;
    detail?: string;
  };
  if (!response.ok || !payload.token || !payload.account) {
    throw new Error(payload.detail ?? "Could not sign in.");
  }
  localStorage.setItem(TOKEN_KEY, payload.token);
  localStorage.setItem(ACCOUNT_KEY, JSON.stringify(payload.account));
  return payload.account;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [account, setAccount] = useState<UserAccount | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let active = true;
    const token = localStorage.getItem(TOKEN_KEY);
    if (!token) {
      setReady(true);
      return;
    }

    const cached = localStorage.getItem(ACCOUNT_KEY);
    if (cached) {
      try {
        if (active) setAccount(JSON.parse(cached) as UserAccount);
      } catch {
        localStorage.removeItem(ACCOUNT_KEY);
      }
    }

    void fetch(backendUrl("/api/auth/me"), {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then(async (response) => {
        if (response.status === 401) {
          localStorage.removeItem(TOKEN_KEY);
          localStorage.removeItem(ACCOUNT_KEY);
          if (active) setAccount(null);
          return;
        }
        if (!response.ok) throw new Error("Authentication service is unavailable");
        const profile = (await response.json()) as UserAccount;
        localStorage.setItem(ACCOUNT_KEY, JSON.stringify(profile));
        if (active) setAccount(profile);
      })
      .catch((error: unknown) => {
        console.warn("Could not refresh account session", error);
      })
      .finally(() => {
        if (active) setReady(true);
      });

    return () => {
      active = false;
    };
  }, []);

  /**
   * Signs in with the given credentials.  On success, updates the React state
   * so that all consumers immediately see the authenticated account.
   *
   * @param email    - User's email address.
   * @param password - User's password.
   */
  async function signIn(email: string, password: string) {
    const profile = await submitCredentials("/api/auth/login", email, password);
    setAccount(profile);
  }

  /**
   * Creates a new account with the given credentials and immediately signs in.
   *
   * @param email    - User's desired email address.
   * @param password - User's chosen password.
   */
  async function register(email: string, password: string) {
    const profile = await submitCredentials("/api/auth/register", email, password);
    setAccount(profile);
  }

  /**
   * Revokes the server-side session (best-effort) and clears all local auth
   * state.  The user is signed out even if the revocation request fails.
   */
  async function signOut() {
    const token = localStorage.getItem(TOKEN_KEY);
    try {
      if (token) {
        await fetch(backendUrl("/api/auth/logout"), {
          method: "POST",
          headers: { Authorization: `Bearer ${token}` },
        });
      }
    } catch (error) {
      console.warn("Could not revoke the server session during sign-out", error);
    } finally {
      localStorage.removeItem(TOKEN_KEY);
      localStorage.removeItem(ACCOUNT_KEY);
      setAccount(null);
    }
  }

  return (
    <AuthContext.Provider value={{ account, ready, signIn, register, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

/**
 * React hook that returns the current `AuthContextValue`.
 * Must be called inside an `<AuthProvider>` tree; throws if the context is missing.
 *
 * @returns The auth context containing `account`, `ready`, `signIn`, `register`,
 *          and `signOut`.
 * @throws {Error} When used outside of `<AuthProvider>`.
 */
export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used inside AuthProvider");
  return context;
}
