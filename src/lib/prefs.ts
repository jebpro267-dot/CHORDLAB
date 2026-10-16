import { useCallback, useEffect, useState } from "react";

const KEY = "chordlab.instrument";
const EVENT = "chordlab:instrument";

/**
 * Reads the persisted instrument preference from `localStorage`.
 * Returns `"guitar"` when running in a non-browser context or when no
 * preference has been saved yet.
 *
 * @returns Instrument ID string (e.g. `"guitar"`, `"ukulele"`).
 */
export function getInstrumentPref(): string {
  if (typeof window === "undefined") return "guitar";
  return window.localStorage.getItem(KEY) ?? "guitar";
}

/**
 * Saves the selected instrument ID to `localStorage` and dispatches a
 * `chordlab:instrument` event so that all pages stay in sync.
 *
 * @param id - Instrument ID to persist (e.g. `"ukulele"`).
 */
export function setInstrumentPref(id: string) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(KEY, id);
  window.dispatchEvent(new CustomEvent(EVENT));
}

/** Instrument preference shared across pages (read after hydration). */
/**
 * React hook that reads the instrument preference after hydration and keeps it
 * synchronised across browser tabs via the `chordlab:instrument` storage event.
 *
 * @returns A `[id, setId]` tuple where `setId` persists the new instrument and
 *          notifies other pages.
 */
export function useInstrument(): [string, (id: string) => void] {
  const [id, setId] = useState("guitar");

  useEffect(() => {
    const sync = () => setId(getInstrumentPref());
    sync();
    window.addEventListener(EVENT, sync);
    return () => window.removeEventListener(EVENT, sync);
  }, []);

  const set = useCallback((next: string) => {
    setId(next);
    setInstrumentPref(next);
  }, []);

  return [id, set];
}
