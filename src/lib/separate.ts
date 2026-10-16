import { unzipSync } from "fflate";
import { backendFetch } from "./backend";
import { STEMS, type StemName } from "./studio";

/**
 * Uploads an audio file to the backend stem-separation endpoint and returns
 * the individual stems as typed Blobs.  The server responds with a ZIP archive
 * containing one audio file per stem (vocals, drums, bass, other).
 *
 * @param file - Audio `File` or `Blob` to separate.
 * @returns Array of `{ name, blob }` objects, one per detected stem.
 * @throws {Error} When the server returns an error or the response body is invalid.
 */
export async function startSeparation(
  file: File | Blob,
): Promise<{ name: StemName; blob: Blob }[]> {
  const form = new FormData();
  form.append("file", file, "audio");
  const res = await backendFetch("/api/separate", { method: "POST", body: form });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { detail?: string; error?: string };
    throw new Error(body.detail ?? body.error ?? "Could not separate stems.");
  }
  const archive = unzipSync(new Uint8Array(await res.arrayBuffer()));
  return STEMS.flatMap((name) => {
    const entry = Object.entries(archive).find(([path]) =>
      new RegExp(`(?:^|/)${name}\\.(?:mp3|wav|m4a)$`, "i").test(path),
    );
    return entry
      ? [{
          name,
          blob: new Blob([entry[1]], {
            type: entry[0].toLowerCase().endsWith(".wav") ? "audio/wav" : "audio/mpeg",
          }),
        }]
      : [];
  });
}
