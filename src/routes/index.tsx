import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { AudioLines, Guitar, Mic, Music2, Search } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { listSongs, type Song } from "@/lib/storage";
import { useAppSettings } from "@/lib/app-settings";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "ChordLab — AI Chord & Lyric Sheets for Any Song" },
      {
        name: "description",
        content:
          "Detect chords, key and tempo from any song on your phone, add Hinglish or Tanglish lyrics, and export an Ultimate-Guitar style chord sheet as PDF or image.",
      },
      { property: "og:title", content: "ChordLab — AI Chord & Lyric Sheets" },
      {
        property: "og:description",
        content:
          "On-device chord detection, live mic mode, tuner, transliterated lyrics and PDF chord sheets.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: LibraryPage,
});

function LibraryPage() {
  const { settings } = useAppSettings();
  const [songs, setSongs] = useState<Song[]>([]);
  const [q, setQ] = useState("");

  useEffect(() => {
    const load = () => setSongs(listSongs());
    load();
    window.addEventListener("chordlab:songs", load);
    return () => window.removeEventListener("chordlab:songs", load);
  }, []);

  const filtered = songs.filter((s) =>
    (s.title + " " + s.artist).toLowerCase().includes(q.toLowerCase()),
  );

  return (
    <div className="mx-auto max-w-lg px-4 pt-6">
      <header>
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-primary">
          {settings.appearance.app_name}
        </p>
        <h1 className="mt-1 text-3xl font-semibold tracking-tight">
          {settings.appearance.home_title}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">{settings.appearance.home_description}</p>
      </header>

      {settings.layout.show_quick_actions && (
        <div className="mt-5 grid grid-cols-4 gap-2">
          <QuickAction to="/analyze" Icon={AudioLines} label="Analyze" />
          <QuickAction to="/create" Icon={Music2} label="Create" />
          <QuickAction to="/live" Icon={Mic} label="Live Mic" />
          <QuickAction to="/tuner" Icon={Guitar} label="Tuner" />
        </div>
      )}

      {settings.layout.show_song_search && <div className="relative mt-5">
        <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search your songs"
          className="pl-9"
        />
      </div>}

      {filtered.length === 0 ? (
        <div className="panel mt-5 flex flex-col items-center gap-3 p-8 text-center">
          <Music2 className="size-8 text-primary" />
          <p className="text-sm font-medium">
            {songs.length === 0 ? settings.appearance.empty_title : "Nothing matches that search"}
          </p>
          <p className="text-xs text-muted-foreground">
            {settings.appearance.empty_description}
          </p>
          <Button asChild className="mt-1">
            <Link to="/analyze">Analyze your first song</Link>
          </Button>
        </div>
      ) : (
        <ul className="mt-5 space-y-2">
          {filtered.map((s) => (
            <li key={s.id}>
              <Link
                to="/song/$id"
                params={{ id: s.id }}
                className="panel flex items-center gap-3 p-3 transition-colors hover:border-primary/50"
              >
                <div className="flex size-11 shrink-0 items-center justify-center rounded-lg bg-surface-2">
                  <span className="chord-token text-sm">{s.analysis.key}</span>
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{s.title}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {s.artist || "Unknown artist"} · {Math.round(s.analysis.bpm)} BPM ·{" "}
                    {s.analysis.chords.length} changes
                  </p>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function QuickAction({
  to,
  Icon,
  label,
}: {
  to: "/analyze" | "/create" | "/live" | "/tuner";
  Icon: typeof AudioLines;
  label: string;
}) {
  return (
    <Link
      to={to}
      className="panel flex flex-col items-center gap-1.5 py-4 transition-colors hover:border-primary/50"
    >
      <Icon className="size-5 text-primary" />
      <span className="text-xs font-medium">{label}</span>
    </Link>
  );
}
