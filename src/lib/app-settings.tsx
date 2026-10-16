import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

import { backendJson } from "./backend";

export interface AppSettings {
  features: {
    song_analysis: boolean;
    tensorflow_analysis: boolean;
    chordmini_analysis: boolean;
    local_analysis: boolean;
    link_import: boolean;
    lyrics_lookup: boolean;
    lyric_romanization: boolean;
    stem_separation: boolean;
    chord_diagrams: boolean;
    live_detection: boolean;
    tuner: boolean;
  };
  navigation: {
    library: boolean;
    analyze: boolean;
    live: boolean;
    chords: boolean;
    tuner: boolean;
  };
  appearance: {
    app_name: string;
    home_title: string;
    home_description: string;
    empty_title: string;
    empty_description: string;
    primary_color: string;
    accent_color: string;
  };
  layout: {
    show_quick_actions: boolean;
    show_song_search: boolean;
  };
}

export const DEFAULT_APP_SETTINGS: AppSettings = {
  features: {
    song_analysis: true,
    tensorflow_analysis: true,
    chordmini_analysis: true,
    local_analysis: true,
    link_import: true,
    lyrics_lookup: true,
    lyric_romanization: true,
    stem_separation: true,
    chord_diagrams: true,
    live_detection: true,
    tuner: true,
  },
  navigation: { library: true, analyze: true, live: true, chords: true, tuner: true },
  appearance: {
    app_name: "ChordLab",
    home_title: "Your song library",
    home_description: "Chords, key, tempo, lyrics and printable sheets — all on your device.",
    empty_title: "No songs analyzed yet",
    empty_description: "Upload an audio file and ChordLab will work out the chords, key and tempo.",
    primary_color: "#eeb64a",
    accent_color: "#4bbdb4",
  },
  layout: { show_quick_actions: true, show_song_search: true },
};

interface AppSettingsContextValue {
  settings: AppSettings;
  ready: boolean;
}

const AppSettingsContext = createContext<AppSettingsContextValue>({
  settings: DEFAULT_APP_SETTINGS,
  ready: false,
});

/**
 * React context provider that fetches server-driven application settings on
 * mount and makes them available to all descendant components.  It also applies
 * CSS custom-property overrides (primary colour, accent colour) whenever the
 * settings change, keeping the theme in sync with the backend configuration.
 *
 * Falls back to `DEFAULT_APP_SETTINGS` while the fetch is pending or if the
 * backend is unavailable.
 *
 * @param children - Child React nodes that will receive the settings context.
 */
export function AppSettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState(DEFAULT_APP_SETTINGS);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let active = true;
    void backendJson<AppSettings>("/api/public-config")
      .then((config) => {
        if (active) setSettings(config);
      })
      .catch((error: unknown) => {
        console.warn("Could not load app settings", error);
      })
      .finally(() => {
        if (active) setReady(true);
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    const root = document.documentElement.style;
    root.setProperty("--primary", settings.appearance.primary_color);
    root.setProperty("--ring", settings.appearance.primary_color);
    root.setProperty("--sidebar-primary", settings.appearance.primary_color);
    root.setProperty("--accent", settings.appearance.accent_color);
    root.setProperty("--beat", settings.appearance.accent_color);
    root.setProperty("--chart-2", settings.appearance.accent_color);
    document.title = settings.appearance.app_name;
  }, [settings]);

  return (
    <AppSettingsContext.Provider value={{ settings, ready }}>
      {children}
    </AppSettingsContext.Provider>
  );
}

/**
 * React hook that returns the current application settings and a `ready` flag
 * indicating whether the settings have been loaded from the server.
 *
 * @returns `{ settings, ready }` from the nearest `<AppSettingsProvider>`.
 */
export function useAppSettings(): AppSettingsContextValue {
  return useContext(AppSettingsContext);
}
