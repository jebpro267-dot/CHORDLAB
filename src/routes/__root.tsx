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
      {auth.ready && auth.account ? (
        <>
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
