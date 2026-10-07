# Building ChordLab as a native mobile app

ChordLab is packaged with [Capacitor](https://capacitorjs.com), so the same
code ships as a real Android (`.apk` / `.aab`) and iOS app. Everything the app
stores — songs, chord sheets, settings and the recorded/imported audio — lives
in on-device storage, so the app works without an account and without a server.

## One-time setup on your computer

Requirements: Node 20+, Android Studio (for Android), Xcode 15+ on a Mac (for iOS).

```bash
git clone <your repo>
cd <project>
npm install

# add the native projects
npx cap add android
npx cap add ios
```

## Build and run

```bash
npm run build          # builds the web assets
npx cap sync           # copies them + plugins into the native projects
npx cap open android   # opens Android Studio  -> Run / Build APK
npx cap open ios       # opens Xcode           -> Run / Archive
```

## Permissions

The microphone is used by live chord detection, the tuner and "record what's
playing". Capacitor adds the Android permission automatically; on iOS add this
to `ios/App/App/Info.plist`:

```xml
<key>NSMicrophoneUsageDescription</key>
<string>ChordLab listens to music and your instrument to detect chords and tune.</string>
```

## Updating the app

By default, Capacitor uses the bundled web assets. To load a hosted web app
inside the native shell, set `CAPACITOR_SERVER_URL` to its URL before running
`npx cap sync`. Re-run `npm run build && npx cap sync` after changing the app.

## About YouTube and Spotify

Neither platform permits downloading their audio, so a pasted link imports the
track's title, artist and artwork only. Analyze the song from an audio file you
own, or use "Record what's playing" to capture it through the microphone while
it plays.
