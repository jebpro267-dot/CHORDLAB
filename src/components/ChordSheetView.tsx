import { forwardRef } from "react";

import { transposeChord } from "@/lib/chords";
import type { Sheet } from "@/lib/sheet";

interface Props {
  sheet: Sheet;
  title: string;
  artist: string;
  keyLabel: string;
  bpm: number;
  capo: number;
  transpose: number;
  useFlats: boolean;
  showRoman: boolean;
  fontSize: number;
  activeChordTime?: number | null;
}

/**
 * Renders an Ultimate-Guitar style monospace chord sheet with section headers,
 * transposed chord positions aligned strictly above lyrics, and synchronized playback highlights.
 * Adjusts chord shapes relative to capo fret (capo transposition).
 *
 * @param props - Chord sheet view properties including sheet model, metadata, transposition, and zoom.
 * @param ref - React ref forwarded to the outer container element for printing/exporting.
 * @returns React JSX element rendering the formatted sheet.
 */
export const ChordSheetView = forwardRef<HTMLDivElement, Props>(function ChordSheetView(
  {
    sheet,
    title,
    artist,
    keyLabel,
    bpm,
    capo,
    transpose,
    useFlats,
    showRoman,
    fontSize,
    activeChordTime,
  },
  ref,
) {
  const effectiveTranspose = (transpose || 0) - (capo || 0);
  const playKey = capo ? transposeChord(keyLabel, -capo, useFlats) : "";

  return (
    <div ref={ref} className="w-full max-w-full overflow-hidden rounded-xl bg-sheet p-4 text-sheet-foreground">
      <header className="mb-4 border-b border-border pb-3">
        <h2 className="text-lg font-semibold leading-tight">{title || "Untitled"}</h2>
        {artist && <p className="text-sm text-muted-foreground">{artist}</p>}
        <p className="mt-2 font-mono text-[11px] text-muted-foreground">
          Key {keyLabel}
          {capo ? ` (Play ${playKey} shapes with Capo fret ${capo})` : " · Capo: none"}
          {transpose ? ` · Transposed ${transpose > 0 ? "+" : ""}${transpose}` : ""}
          {` · ${Math.round(bpm)} BPM`}
        </p>
      </header>

      <div className="w-full overflow-x-auto scrollbar-thin">
        <div
          style={{ fontSize: `${fontSize}px`, lineHeight: 1.55 }}
          className="min-w-full font-mono tracking-normal select-text"
        >
          {sheet.sections.map((section, si) => (
            <section key={si} className="mb-5">
              <h3 className="mb-1 font-sans text-xs font-bold uppercase tracking-widest text-accent">
                [{section.name}]
              </h3>
              {section.lines.map((line, li) => (
                <div key={li} className="mb-1.5 font-mono tracking-normal">
                  {line.chords.length > 0 && (
                    <pre className="whitespace-pre font-mono tracking-normal select-text">
                      {renderChordLine(line.chords, effectiveTranspose, useFlats, activeChordTime)}
                    </pre>
                  )}
                  {line.lyric && (
                    <pre className="whitespace-pre font-mono tracking-normal text-sheet-foreground select-text">
                      {line.lyric}
                    </pre>
                  )}
                  {showRoman && line.roman && (
                    <pre className="whitespace-pre font-mono tracking-normal text-muted-foreground select-text">
                      {line.roman}
                    </pre>
                  )}
                </div>
              ))}
            </section>
          ))}
        </div>
      </div>
    </div>
  );
});

/**
 * Formats and spaces chord tokens along a single text line to align with underlying lyrics.
 *
 * @param chords - Array of timestamped and positioned chord entries.
 * @param transpose - Number of semitones to transpose.
 * @param useFlats - Whether to format accidentals with flats rather than sharps.
 * @param activeTime - Current playback timestamp in seconds for highlighting active chord.
 * @returns Array of React nodes containing spaced and styled chord token spans.
 */
function renderChordLine(
  chords: Props["sheet"]["sections"][number]["lines"][number]["chords"],
  transpose: number,
  useFlats: boolean,
  activeTime?: number | null,
) {
  const out: React.ReactNode[] = [];
  let col = 0;
  chords.forEach((c, i) => {
    if (c.pos > col) {
      out.push(" ".repeat(c.pos - col));
      col = c.pos;
    }
    const label = transposeChord(c.label, transpose, useFlats);
    const active = activeTime != null && Math.abs(activeTime - c.time) < 0.001;
    out.push(
      <span
        key={i}
        className={
          active
            ? "chord-token rounded-xs bg-primary/30 ring-1 ring-primary/80 text-primary-foreground font-bold"
            : "chord-token font-bold"
        }
      >
        {label}
      </span>,
    );
    col += label.length;
    // If next chord is placed at or before the end of this label, guarantee at least 1 separator space
    if (chords[i + 1] && chords[i + 1]!.pos <= col) {
      out.push(" ");
      col += 1;
    }
  });
  return out;
}
