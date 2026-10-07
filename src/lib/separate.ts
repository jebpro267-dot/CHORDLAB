import { unzipSync } from "fflate";
import { backendUrl } from "./backend";
import { STEMS, type StemName } from "./studio";

export async function startSeparation(
  file: File | Blob,
): Promise<{ name: StemName; blob: Blob }[]> {
  const form = new FormData();
  form.append("file", file, "audio");
  const res = await fetch(backendUrl("/api/separate"), { method: "POST", body: form });
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
            type: path.toLowerCase().endsWith(".wav") ? "audio/wav" : "audio/mpeg",
          }),
        }]
      : [];
  });
}
