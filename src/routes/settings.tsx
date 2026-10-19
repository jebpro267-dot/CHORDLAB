import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import {
  Activity,
  Check,
  Cpu,
  Download,
  Globe,
  HardDrive,
  Info,
  Layers,
  LogOut,
  Music,
  Radio,
  RotateCcw,
  Save,
  Server,
  Settings as SettingsIcon,
  Shield,
  Trash2,
  Upload,
  User,
  Volume2,
  Wifi,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useAuth } from "@/lib/auth";
import { backendFetch, getBackendBaseUrl, setBackendBaseUrl } from "@/lib/backend";
import { clearAudioStore } from "@/lib/audio-store";
import { listSongs, saveSong, type Song } from "@/lib/storage";

export const Route = createFileRoute("/settings")({
  head: () => ({
    meta: [
      { title: "Settings & System Diagnostics — ChordLab" },
      {
        name: "description",
        content: "Configure your ChordLab AI audio models, connection endpoints, audio fidelity and account.",
      },
    ],
  }),
  component: SettingsPage,
});

export function SettingsPage() {
  const auth = useAuth();
  const [serverUrl, setServerUrl] = useState(() => getBackendBaseUrl());
  const [pingStatus, setPingStatus] = useState<"idle" | "testing" | "online" | "offline">("idle");
  const [pingLatency, setPingLatency] = useState<number | null>(null);

  // Audio & Engine preferences (stored in localStorage)
  const [defaultEngine, setDefaultEngine] = useState(() => {
    return localStorage.getItem("chordlab_pref_engine") || "tensorflow";
  });
  const [defaultLanguage, setDefaultLanguage] = useState(() => {
    return localStorage.getItem("chordlab_pref_language") || "auto";
  });
  const [romanizeStyle, setRomanizeStyle] = useState(() => {
    return localStorage.getItem("chordlab_pref_romanize") || "tanglish";
  });
  const [sampleRate, setSampleRate] = useState(() => {
    return localStorage.getItem("chordlab_pref_samplerate") || "44100";
  });
  const [chimeEnabled, setChimeEnabled] = useState(() => {
    return localStorage.getItem("chordlab_pref_chime") !== "false";
  });

  // Storage Stats
  const [songCount, setSongCount] = useState(0);

  useEffect(() => {
    setSongCount(listSongs().length);
    // Auto-ping active server on mount
    void testServerPing(serverUrl);
  }, []);

  async function testServerPing(urlToTest?: string) {
    const target = (urlToTest ?? serverUrl).trim().replace(/\/+$/, "");
    setPingStatus("testing");
    const start = performance.now();
    try {
      const pingUrl = target ? `${target}/health` : "/health";
      const res = await fetch(pingUrl, { method: "GET", cache: "no-store" });
      const duration = Math.round(performance.now() - start);
      if (res.ok) {
        setPingStatus("online");
        setPingLatency(duration);
        toast.success(`Server online (${duration}ms ping)`);
      } else {
        setPingStatus("offline");
        setPingLatency(null);
        toast.error(`Server returned HTTP ${res.status}`);
      }
    } catch {
      setPingStatus("offline");
      setPingLatency(null);
      toast.error("Could not reach backend server.");
    }
  }

  function handleSaveServer() {
    setBackendBaseUrl(serverUrl);
    toast.success("Backend server URL updated & saved!");
    void testServerPing(serverUrl);
  }

  function handlePresetSelect(preset: string) {
    setServerUrl(preset);
    setBackendBaseUrl(preset);
    toast.success(`Switched to preset: ${preset || "Vite Dev Proxy"}`);
    void testServerPing(preset);
  }

  function handleSavePreference(key: string, value: string) {
    localStorage.setItem(key, value);
    toast.success("Preference updated");
  }

  function handleExportBackup() {
    const songs = listSongs();
    if (!songs.length) {
      toast.error("No songs in library to export");
      return;
    }
    const blob = new Blob([JSON.stringify(songs, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `chordlab-library-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success(`Exported ${songs.length} song(s) successfully!`);
  }

  function handleImportBackup(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const parsed = JSON.parse(event.target?.result as string) as Song[];
        if (Array.isArray(parsed)) {
          let imported = 0;
          parsed.forEach((s) => {
            if (s.id && s.title) {
              saveSong(s);
              imported++;
            }
          });
          setSongCount(listSongs().length);
          toast.success(`Imported ${imported} song(s) into your library!`);
        } else {
          toast.error("Invalid backup format");
        }
      } catch {
        toast.error("Failed to parse JSON file");
      }
    };
    reader.readAsText(file);
  }

  async function handleClearCache() {
    if (confirm("Clear local cached song audio? Your chords and sheets will remain safe.")) {
      try {
        await clearAudioStore();
        toast.success("Local audio cache cleared successfully!");
      } catch (err) {
        toast.error("Failed to clear audio cache");
      }
    }
  }

  return (
    <div className="mx-auto max-w-lg px-4 pt-6 pb-20">
      {/* Header */}
      <header className="mb-6">
        <div className="flex items-center gap-2">
          <div className="flex size-9 items-center justify-center rounded-xl bg-primary/20 text-primary shadow-sm shadow-primary/20">
            <SettingsIcon className="size-5" />
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Settings</h1>
            <p className="text-xs text-muted-foreground">Manage AI models, server routes & audio preferences</p>
          </div>
        </div>
      </header>

      <div className="space-y-6">
        {/* Account & Profile */}
        <section className="rounded-2xl border border-white/10 bg-card/60 p-4 shadow-sm backdrop-blur-md">
          <div className="flex items-center gap-2.5 pb-3 text-sm font-semibold text-foreground">
            <User className="size-4 text-primary" />
            <span>Account & Access</span>
          </div>
          <div className="flex items-center justify-between rounded-xl bg-background/50 p-3">
            <div>
              <p className="text-sm font-medium">{auth.account?.email || "Guest User"}</p>
              <div className="mt-0.5 flex items-center gap-2">
                <span className="inline-flex items-center rounded-md bg-primary/20 px-1.5 py-0.5 text-[10px] font-semibold text-primary">
                  {auth.account?.role?.toUpperCase() || "USER"}
                </span>
                <span className="text-[11px] text-muted-foreground">Session active</span>
              </div>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                if (confirm("Do you want to sign out?")) {
                  void auth.signOut();
                }
              }}
              className="gap-1.5 border-red-500/30 text-red-400 hover:bg-red-500/10 hover:text-red-300"
            >
              <LogOut className="size-3.5" />
              Sign out
            </Button>
          </div>
        </section>

        {/* Backend Server Connection */}
        <section className="rounded-2xl border border-white/10 bg-card/60 p-4 shadow-sm backdrop-blur-md">
          <div className="flex items-center justify-between pb-3">
            <div className="flex items-center gap-2.5 text-sm font-semibold text-foreground">
              <Server className="size-4 text-primary" />
              <span>Backend Server Connection</span>
            </div>
            {/* Status Badge */}
            <div
              className={`flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold ${
                pingStatus === "online"
                  ? "bg-emerald-500/20 text-emerald-400"
                  : pingStatus === "testing"
                    ? "bg-amber-500/20 text-amber-400 animate-pulse"
                    : pingStatus === "offline"
                      ? "bg-red-500/20 text-red-400"
                      : "bg-muted text-muted-foreground"
              }`}
            >
              <span className={`size-2 rounded-full ${
                pingStatus === "online"
                  ? "bg-emerald-400 shadow-[0_0_8px_#34d399]"
                  : pingStatus === "testing"
                    ? "bg-amber-400"
                    : pingStatus === "offline"
                      ? "bg-red-400"
                      : "bg-muted-foreground"
              }`} />
              {pingStatus === "online"
                ? `Online (${pingLatency}ms)`
                : pingStatus === "testing"
                  ? "Pinging..."
                  : pingStatus === "offline"
                    ? "Unreachable"
                    : "Idle"}
            </div>
          </div>

          <div className="space-y-3">
            <div>
              <Label className="text-xs text-muted-foreground">Active Server URL</Label>
              <div className="mt-1 flex gap-2">
                <Input
                  value={serverUrl}
                  onChange={(e) => setServerUrl(e.target.value)}
                  placeholder="e.g. http://192.168.0.111:8000"
                  className="font-mono text-xs"
                />
                <Button size="sm" onClick={handleSaveServer} className="gap-1.5">
                  <Save className="size-3.5" />
                  Save
                </Button>
              </div>
            </div>

            {/* Quick Presets */}
            <div>
              <Label className="text-[11px] uppercase tracking-wider text-muted-foreground">Connection Presets</Label>
              <div className="mt-1.5 grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => handlePresetSelect("http://192.168.0.111:8000")}
                  className="flex flex-col items-start rounded-xl border border-white/10 bg-background/50 p-2.5 text-left transition hover:border-primary/50"
                >
                  <span className="text-xs font-semibold text-foreground">Wi-Fi Network (Phone)</span>
                  <span className="font-mono text-[10px] text-muted-foreground">192.168.0.111:8000</span>
                </button>
                <button
                  type="button"
                  onClick={() => handlePresetSelect("http://localhost:8000")}
                  className="flex flex-col items-start rounded-xl border border-white/10 bg-background/50 p-2.5 text-left transition hover:border-primary/50"
                >
                  <span className="text-xs font-semibold text-foreground">Localhost / PC</span>
                  <span className="font-mono text-[10px] text-muted-foreground">localhost:8000</span>
                </button>
                <button
                  type="button"
                  onClick={() => handlePresetSelect("http://10.0.2.2:8000")}
                  className="flex flex-col items-start rounded-xl border border-white/10 bg-background/50 p-2.5 text-left transition hover:border-primary/50"
                >
                  <span className="text-xs font-semibold text-foreground">Android Emulator</span>
                  <span className="font-mono text-[10px] text-muted-foreground">10.0.2.2:8000</span>
                </button>
                <button
                  type="button"
                  onClick={() => handlePresetSelect("")}
                  className="flex flex-col items-start rounded-xl border border-white/10 bg-background/50 p-2.5 text-left transition hover:border-primary/50"
                >
                  <span className="text-xs font-semibold text-foreground">Same-Origin (Proxy)</span>
                  <span className="font-mono text-[10px] text-muted-foreground">Default dev port</span>
                </button>
              </div>
            </div>

            <Button
              variant="outline"
              size="sm"
              onClick={() => void testServerPing(serverUrl)}
              disabled={pingStatus === "testing"}
              className="w-full gap-2 text-xs"
            >
              <Activity className="size-3.5" />
              Test Connection / Ping Health Endpoint
            </Button>
          </div>
        </section>

        {/* AI Model & Recognition Engine */}
        <section className="rounded-2xl border border-white/10 bg-card/60 p-4 shadow-sm backdrop-blur-md">
          <div className="flex items-center gap-2.5 pb-3 text-sm font-semibold text-foreground">
            <Cpu className="size-4 text-primary" />
            <span>Chord Recognition Engine</span>
          </div>

          <div className="space-y-4">
            <div>
              <Label className="text-xs text-muted-foreground">Default ACR Engine</Label>
              <Select
                value={defaultEngine}
                onValueChange={(val) => {
                  setDefaultEngine(val);
                  handleSavePreference("chordlab_pref_engine", val);
                }}
              >
                <SelectTrigger className="mt-1">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="tensorflow">TensorFlow Deep Learning ACR (Full Accuracy)</SelectItem>
                  <SelectItem value="chordmini-auto">ChordMini Server Engine (Fast Dual-Layer)</SelectItem>
                  <SelectItem value="local">In-Browser Harmonic Chroma (Offline / Device)</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label className="text-xs text-muted-foreground">Target Language / Model</Label>
              <Select
                value={defaultLanguage}
                onValueChange={(val) => {
                  setDefaultLanguage(val);
                  handleSavePreference("chordlab_pref_language", val);
                }}
              >
                <SelectTrigger className="mt-1">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="auto">Auto-Detect Musical Style</SelectItem>
                  <SelectItem value="english">Western / International (Pop, Rock, Jazz)</SelectItem>
                  <SelectItem value="tamil">Tamil / South Asian (Karnatik, Kollywood)</SelectItem>
                  <SelectItem value="hindi">Hindi / Bollywood (Filmi, Classical, Sufi)</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label className="text-xs text-muted-foreground">Lyrics Transliteration Target</Label>
              <Select
                value={romanizeStyle}
                onValueChange={(val) => {
                  setRomanizeStyle(val);
                  handleSavePreference("chordlab_pref_romanize", val);
                }}
              >
                <SelectTrigger className="mt-1">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="tanglish">Tanglish (Tamil in Roman Script)</SelectItem>
                  <SelectItem value="hinglish">Hinglish (Hindi in Roman Script)</SelectItem>
                  <SelectItem value="english">English (Full Translation)</SelectItem>
                  <SelectItem value="none">Original Script (No Conversion)</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </section>

        {/* Audio & App Preferences */}
        <section className="rounded-2xl border border-white/10 bg-card/60 p-4 shadow-sm backdrop-blur-md">
          <div className="flex items-center gap-2.5 pb-3 text-sm font-semibold text-foreground">
            <Volume2 className="size-4 text-primary" />
            <span>Audio & Playback</span>
          </div>

          <div className="space-y-3">
            <div className="flex items-center justify-between rounded-xl bg-background/50 p-3">
              <div>
                <p className="text-xs font-semibold text-foreground">Welcome Audio Chime</p>
                <p className="text-[11px] text-muted-foreground">Play Cmaj7 harmonic chord on startup</p>
              </div>
              <input
                type="checkbox"
                checked={chimeEnabled}
                onChange={(e) => {
                  setChimeEnabled(e.target.checked);
                  handleSavePreference("chordlab_pref_chime", e.target.checked ? "true" : "false");
                }}
                className="size-4 accent-primary"
              />
            </div>

            <div>
              <Label className="text-xs text-muted-foreground">Processing Sample Rate</Label>
              <Select
                value={sampleRate}
                onValueChange={(val) => {
                  setSampleRate(val);
                  handleSavePreference("chordlab_pref_samplerate", val);
                }}
              >
                <SelectTrigger className="mt-1">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="44100">44,100 Hz (Standard Fidelity)</SelectItem>
                  <SelectItem value="48000">48,000 Hz (Professional Studio)</SelectItem>
                  <SelectItem value="22050">22,050 Hz (High-Speed Analysis)</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </section>

        {/* Storage, Backup & Cache */}
        <section className="rounded-2xl border border-white/10 bg-card/60 p-4 shadow-sm backdrop-blur-md">
          <div className="flex items-center gap-2.5 pb-3 text-sm font-semibold text-foreground">
            <HardDrive className="size-4 text-primary" />
            <span>Library & Storage ({songCount} Saved Songs)</span>
          </div>

          <div className="space-y-2.5">
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={handleExportBackup}
                className="flex-1 gap-1.5 text-xs"
              >
                <Download className="size-3.5" />
                Export Library (JSON)
              </Button>

              <label className="flex-1">
                <input
                  type="file"
                  accept=".json"
                  onChange={handleImportBackup}
                  className="hidden"
                />
                <Button
                  variant="outline"
                  size="sm"
                  asChild
                  className="w-full cursor-pointer gap-1.5 text-xs"
                >
                  <span>
                    <Upload className="size-3.5" />
                    Import Backup
                  </span>
                </Button>
              </label>
            </div>

            <Button
              variant="outline"
              size="sm"
              onClick={handleClearCache}
              className="w-full gap-2 border-red-500/20 text-xs text-red-400 hover:bg-red-500/10"
            >
              <Trash2 className="size-3.5" />
              Clear Local Audio Cache
            </Button>
          </div>
        </section>

        {/* System & Device Diagnostics */}
        <section className="rounded-2xl border border-white/10 bg-card/60 p-4 shadow-sm backdrop-blur-md">
          <div className="flex items-center gap-2.5 pb-3 text-sm font-semibold text-foreground">
            <Info className="size-4 text-primary" />
            <span>System Information</span>
          </div>

          <div className="space-y-1.5 font-mono text-[11px] text-muted-foreground">
            <div className="flex justify-between">
              <span>ChordLab Core:</span>
              <span className="font-semibold text-foreground">v2.5.0 Pro</span>
            </div>
            <div className="flex justify-between">
              <span>WebAudio API:</span>
              <span className="text-emerald-400">Supported (Low Latency)</span>
            </div>
            <div className="flex justify-between">
              <span>Demucs Separation:</span>
              <span className="text-emerald-400">Active (4-Stem Studio)</span>
            </div>
            <div className="flex justify-between">
              <span>Gemini AI Engine:</span>
              <span className="text-emerald-400">gemini-3.8-flash</span>
            </div>
            <div className="flex justify-between">
              <span>Microphone Driver:</span>
              <span className="text-emerald-400">Auto-Fallback Enabled</span>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
