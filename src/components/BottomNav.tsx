import { Link } from "@tanstack/react-router";
import { Library, AudioLines, Mic, Guitar, LayoutGrid, LogOut } from "lucide-react";
import { useAppSettings } from "../lib/app-settings";
import { useAuth } from "../lib/auth";

const items = [
  { to: "/", label: "Library", Icon: Library, setting: "library" },
  { to: "/analyze", label: "Analyze", Icon: AudioLines, setting: "analyze" },
  { to: "/live", label: "Live", Icon: Mic, setting: "live" },
  { to: "/chords", label: "Chords", Icon: LayoutGrid, setting: "chords" },
  { to: "/tuner", label: "Tuner", Icon: Guitar, setting: "tuner" },
] as const;

export function BottomNav() {
  const { settings } = useAppSettings();
  const { signOut } = useAuth();

  return (
    <nav className="fixed inset-x-0 bottom-0 z-50 border-t border-border bg-background/85 backdrop-blur-xl">
      <ul className="mx-auto flex max-w-lg items-stretch justify-between px-1 pb-[env(safe-area-inset-bottom)]">
        {items
          .filter(
            ({ setting }) =>
              settings.navigation[setting] && isFeatureEnabled(setting, settings.features),
          )
          .map(({ to, label, Icon }) => (
            <li key={to} className="flex-1">
              <Link
                to={to}
                className="flex flex-col items-center gap-1 rounded-xl px-1 py-2.5 text-[11px] font-medium text-muted-foreground transition-colors"
                activeOptions={{ exact: to === "/" }}
                activeProps={{ className: "text-primary" }}
              >
                <Icon className="size-5" strokeWidth={2} />
                {label}
              </Link>
            </li>
          ))}
        <li className="flex-1">
          <button
            type="button"
            onClick={() => void signOut()}
            aria-label="Sign out"
            title="Sign out"
            className="flex w-full flex-col items-center gap-1 rounded-xl px-1 py-2.5 text-[11px] font-medium text-muted-foreground transition-colors hover:text-destructive"
          >
            <LogOut className="size-5" strokeWidth={2} />
            Sign out
          </button>
        </li>
      </ul>
    </nav>
  );
}

function isFeatureEnabled(
  section: (typeof items)[number]["setting"],
  features: ReturnType<typeof useAppSettings>["settings"]["features"],
) {
  if (section === "analyze")
    return features.song_analysis && (features.chordmini_analysis || features.local_analysis);
  if (section === "live") return features.live_detection;
  if (section === "chords") return features.chord_diagrams;
  if (section === "tuner") return features.tuner;
  return true;
}
