import { useEffect, useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  Link,
  createRootRouteWithContext,
  useRouter,
  useRouterState,
} from "@tanstack/react-router";

import { BottomNav } from "../components/BottomNav";
import { Toaster } from "../components/ui/sonner";
import { useAppSettings, AppSettingsProvider } from "../lib/app-settings";
import { AuthProvider, useAuth } from "../lib/auth";
import { AuthScreen } from "../components/AuthScreen";
import { WelcomeScreen } from "../components/WelcomeScreen";
import { LogOut, Music2 } from "lucide-react";

function NotFoundComponent() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-7xl font-bold text-foreground">404</h1>
        <h2 className="mt-4 text-xl font-semibold text-foreground">Page not found</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          The page you're looking for doesn't exist or has been moved.
        </p>
        <div className="mt-6">
          <Link
            to="/"
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Go home
          </Link>
        </div>
      </div>
    </div>
  );
}

function ErrorComponent({ error, reset }: { error: Error; reset: () => void }) {
  console.error(error);
  const router = useRouter();
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-xl font-semibold tracking-tight text-foreground">
          This page didn't load
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Something went wrong on our end. You can try refreshing or head back home.
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <button
            onClick={() => {
              router.invalidate();
              reset();
            }}
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Try again
          </button>
          <a
            href="/"
            className="inline-flex items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent"
          >
            Go home
          </a>
        </div>
      </div>
    </div>
  );
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      {
        name: "viewport",
        content: "width=device-width, initial-scale=1, viewport-fit=cover, maximum-scale=1",
      },
      { title: "ChordLab — AI Chord & Lyric Sheets" },
      {
        name: "description",
        content:
          "Detect chords, key and tempo from any song, add Hinglish or Tanglish lyrics and export chord sheets.",
      },
      { name: "theme-color", content: "#1b1e26" },
      { property: "og:title", content: "ChordLab — AI Chord & Lyric Sheets" },
      {
        property: "og:description",
        content: "On-device chord detection with printable chord sheets.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
    links: [
      { rel: "preconnect", href: "https://fonts.googleapis.com" },
      { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" },
      {
        rel: "stylesheet",
        href: "https://fonts.googleapis.com/css2?family=Outfit:wght@400;500;600;700&family=JetBrains+Mono:wght@400;700&display=swap",
      },
      { rel: "icon", href: "/favicon.ico", type: "image/x-icon" },
    ],
  }),
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

function RootComponent() {
  const { queryClient } = Route.useRouteContext();

  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <AppSettingsProvider>
          <AppFrame />
          <Toaster position="top-center" richColors />
        </AppSettingsProvider>
      </AuthProvider>
    </QueryClientProvider>
  );
}

function AppFrame() {
  const { settings, ready } = useAppSettings();
  const auth = useAuth();
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const [showWelcome, setShowWelcome] = useState(() => {
    try {
      return !sessionStorage.getItem("chordlab-welcome-shown");
    } catch {
      return true;
    }
  });
  const [welcomeMessage, setWelcomeMessage] = useState("Welcome to ChordLab Studio");

  useEffect(() => {
    const handleTriggerWelcome = (e: Event) => {
      const custom = e as CustomEvent<{ message?: string }>;
      setWelcomeMessage(custom.detail?.message || "Welcome to ChordLab");
      setShowWelcome(true);
    };
    window.addEventListener("chordlab:show-welcome", handleTriggerWelcome);
    return () => window.removeEventListener("chordlab:show-welcome", handleTriggerWelcome);
  }, []);

  const flags = settings.features;
  const unavailable =
    (pathname === "/analyze" &&
      (!flags.song_analysis ||
        (!flags.tensorflow_analysis && !flags.chordmini_analysis && !flags.local_analysis))) ||
    (pathname === "/live" && !flags.live_detection) ||
    (pathname === "/tuner" && !flags.tuner) ||
    (pathname === "/chords" && !flags.chord_diagrams) ||
    (pathname === "/" && !settings.navigation.library);

  return (
    <>
      {showWelcome && (
        <WelcomeScreen
          message={welcomeMessage}
          onComplete={() => {
            try {
              sessionStorage.setItem("chordlab-welcome-shown", "true");
            } catch {
              // ignore
            }
            setShowWelcome(false);
          }}
        />
      )}

      {auth.ready && auth.account ? (
        <>
          {/* Top Application Bar with Brand and Top-Right Sign Out Button */}
          <header className="sticky top-0 z-40 flex items-center justify-between border-b border-white/5 bg-background/85 px-4 py-2.5 backdrop-blur-xl">
            <Link to="/" className="flex items-center gap-2 transition hover:opacity-85">
              <div className="flex size-7 items-center justify-center rounded-lg bg-primary/20 text-primary shadow-sm shadow-primary/20">
                <Music2 className="size-4" strokeWidth={2.5} />
              </div>
              <span className="font-semibold tracking-tight text-foreground">
                {settings.appearance.app_name || "ChordLab"}
              </span>
              {auth.account?.role === "admin" && (
                <span className="rounded bg-primary/20 px-1.5 py-0.5 text-[10px] font-bold tracking-wider text-primary">
                  ADMIN
                </span>
              )}
            </Link>

            <div className="flex items-center gap-2">
              <span className="hidden text-xs text-muted-foreground sm:inline-block max-w-[150px] truncate">
                {auth.account?.email}
              </span>
              <button
                type="button"
                onClick={() => {
                  if (window.confirm("Are you sure you want to sign out?")) {
                    void auth.signOut();
                  }
                }}
                title="Sign out of ChordLab"
                aria-label="Sign out"
                className="group flex size-8 items-center justify-center rounded-lg border border-white/10 bg-card/60 text-muted-foreground transition-all duration-200 hover:border-red-500/40 hover:bg-red-500/10 hover:text-red-400 active:scale-95"
              >
                <LogOut className="size-4 transition-transform group-hover:translate-x-0.5" strokeWidth={2} />
              </button>
            </div>
          </header>

          <div className="min-h-screen pb-24">
            {ready && unavailable ? (
              <div className="mx-auto mt-20 max-w-md px-5 text-center">
                <h1 className="text-xl font-semibold">This feature is temporarily unavailable</h1>
                <p className="mt-2 text-sm text-muted-foreground">
                  An administrator has paused this part of the app.
                </p>
              </div>
            ) : (
              <Outlet />
            )}
          </div>
          <BottomNav />
        </>
      ) : auth.ready ? (
        <AuthScreen />
      ) : (
        <div className="flex min-h-screen items-center justify-center text-muted-foreground">
          <span className="size-5 animate-spin rounded-full border-2 border-current border-r-transparent" />
        </div>
      )}
    </>
  );
}
