/**
 * Resilient microphone acquisition utility for Web and Android Capacitor WebView.
 * Attempts high-fidelity audio capture constraints first, then falls back to standard
 * generic audio capture if the device/browser driver rejects overconstrained options.
 */
export async function getMicrophoneStream(preferredConstraints?: MediaTrackConstraints): Promise<MediaStream> {
  if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
    throw new Error("Microphone access is not supported in this browser or context.");
  }

  // Attempt 1: Try requested or balanced constraints
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: preferredConstraints ?? {
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
      },
    });
    return stream;
  } catch (err) {
    console.warn("High-fidelity audio constraints failed, trying basic audio: true...", err);
  }

  // Attempt 2: Fallback to basic audio
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: true,
    });
    return stream;
  } catch (finalErr) {
    console.error("All microphone capture attempts failed:", finalErr);
    if (finalErr instanceof Error) {
      if (finalErr.name === "NotAllowedError" || finalErr.name === "PermissionDeniedError") {
        throw new Error("Microphone access was denied. Please allow microphone permissions in your browser or device settings.");
      }
      if (finalErr.name === "NotFoundError" || finalErr.name === "DevicesNotFoundError") {
        throw new Error("No microphone device was found on this system.");
      }
      throw finalErr;
    }
    throw new Error("Microphone access failed.");
  }
}
