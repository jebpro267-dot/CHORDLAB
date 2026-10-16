import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/**
 * Merges Tailwind CSS class names, resolving conflicts with `tailwind-merge`
 * and supporting conditional classes via `clsx`.
 *
 * @param inputs - Any number of class values (strings, arrays, objects).
 * @returns A single merged class-name string with conflicts resolved.
 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
