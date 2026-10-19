import { Link } from "@tanstack/react-router";
import { Library, LayoutGrid, Disc3, Settings } from "lucide-react";

const navItems = [
  { to: "/", label: "Library", Icon: Library },
  { to: "/chords", label: "Chords", Icon: LayoutGrid },
  { to: "/create", label: "Create Music", Icon: Disc3 },
  { to: "/settings", label: "Settings", Icon: Settings },
] as const;

/**
 * Clean, modern bottom navigation bar following the 4 core sections:
 * 1. Library (Home)
 * 2. Chords (Fretboard & diagrams)
 * 3. Create Music (Multi-track GarageBand-style creation studio)
 * 4. Settings (Full configuration & live diagnostic suite)
 */
export function BottomNav() {
  return (
    <nav className="fixed inset-x-0 bottom-0 z-50 border-t border-white/10 bg-background/90 shadow-2xl backdrop-blur-2xl">
      <ul className="mx-auto flex max-w-lg items-stretch justify-around px-2 py-1.5 pb-[calc(0.5rem+env(safe-area-inset-bottom))]">
        {navItems.map(({ to, label, Icon }) => (
          <li key={to} className="flex-1 text-center">
            <Link
              to={to}
              className="flex flex-col items-center justify-center gap-1 rounded-xl px-1 py-1.5 text-[11px] font-medium text-muted-foreground transition-all duration-200 hover:text-foreground active:scale-95"
              activeOptions={{ exact: to === "/" }}
              activeProps={{ className: "text-primary font-semibold" }}
            >
              <div className="flex size-7 items-center justify-center rounded-lg transition-colors">
                <Icon className="size-5" strokeWidth={2.2} />
              </div>
              <span className="leading-tight tracking-tight">{label}</span>
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
