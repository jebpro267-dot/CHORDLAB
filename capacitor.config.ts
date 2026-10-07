import type { CapacitorConfig } from "@capacitor/cli";

const liveAppUrl = process.env["CAPACITOR_SERVER_URL"];

const config: CapacitorConfig = {
  appId: "app.chordlab.mobile",
  appName: "ChordLab",
  webDir: "dist/client",
  ...(liveAppUrl ? { server: { url: liveAppUrl, cleartext: false } } : {}),
  android: {
    allowMixedContent: false,
  },
  ios: {
    contentInset: "always",
  },
  plugins: {
    SplashScreen: {
      backgroundColor: "#1b1e26",
      showSpinner: false,
    },
  },
};

export default config;
