# Ren mobile

## App identity and push prerequisites

These are the stable identifiers for internal builds and future store releases. Register push credentials against these values; do not create a separate package ID for APK sharing.

| Setting               | Value                                  |
| --------------------- | -------------------------------------- |
| iOS bundle identifier | `ai.ren.app`                           |
| Android package name  | `ai.ren.app`                           |
| Expo owner / slug     | `renagent/ren`                         |
| EAS project ID        | `aa48fd7d-fca0-463d-94b9-0ed19d91d3d6` |

Push implementation must pass this EAS project ID to `getExpoPushTokenAsync`. The ID is already configured in `app.json` under `extra.eas.projectId`.

The Android Firebase client configuration (`google-services.json`) belongs to Firebase project `renai-95a76` (project number `1056392781930`) and is registered for `ai.ren.app`. It carries an API key, so it never goes in Git: `.gitignore` excludes it, and builds will take it from an EAS file environment variable once push is implemented.

### External setup still required for push

- Android: configure FCM v1 service-account credentials from Firebase project `renai-95a76` for this Android app in EAS; `google-services.json` alone does not authorize Expo to send notifications. Keep the service-account private key outside Git.
- iOS: activate Apple Developer Program membership, register `ai.ren.app`, enable Push Notifications and configure an APNs authentication key in EAS. This is blocked while paid Apple enrollment is deferred.
- Both platforms: include the push implementation's native notification dependencies and configuration before building. Install new native builds and verify registration and delivery on physical devices. The Android APK does not require Google Play distribution. A physical iPhone push test requires a provisioned iPhone build; a simulator or free-signing setup is not a substitute for this release check.

The identifiers and Android Firebase client configuration above are configured locally. Remote credential access, Apple registration and physical-device delivery have not yet been verified. Coordinate these prerequisites with the push implementation before the first team build.

### Firebase setup for Android

1. In the Firebase Console, create a project for Ren on the free Spark plan. Analytics is optional for push and can be disabled.
2. Add an Android app with package name `ai.ren.app` and nickname `Ren Android`. A SHA-1 fingerprint is not required for basic FCM setup.
3. Download `google-services.json` to `packages/mobile/google-services.json` for local builds; Git ignores it. This is the client configuration, not a service-account private key, but its API key must stay out of Git. Upload it to EAS as a file environment variable for cloud builds. Expo prebuild handles the native Firebase configuration; do not manually edit the generated Gradle files.
4. In Firebase project settings, open **Service accounts** and generate a private key. Store the downloaded JSON outside the repository.
5. Open the existing `renagent/ren` project in the EAS dashboard, then **Project settings → Credentials → Android → ai.ren.app → FCM V1 service account key**. Upload the private-key JSON there. Alternatively, use `bunx eas-cli credentials --platform android`, select the internal profile, and choose **Google Service Account → Manage your Google Service Account Key for Push Notifications (FCM V1)**.
6. Confirm the service account belongs to the same Firebase project as `google-services.json` and has the Firebase Cloud Messaging API Admin role. Confirm the Firebase Cloud Messaging API (V1) is enabled in Firebase's Cloud Messaging settings.

FCM and direct APK installation do not require a paid Google Play account. iOS push is explicitly deferred until Apple enrollment is active. Android push still needs the notification implementation and a new physical-device build before it can be marked verified.

## Android team builds

The `internal` EAS profile produces a signed, standalone APK with production Ren URLs and bundled JavaScript. Phones need internet access to Ren, but no Metro server, laptop or USB connection. Direct APK distribution needs no Google Play account. OTA updates are disabled; share a new APK for each update.

### Build locally when ready

Prerequisites: Bun, Node, a compatible JDK, Android SDK/NDK and accepted Android SDK licenses. Android Studio can install the SDK and required native tools. Local EAS builds use the tools installed on your Mac, not the Node/Bun versions configured for cloud builds.

From `packages/mobile`:

```sh
export ANDROID_HOME="$HOME/Library/Android/sdk"
bunx eas-cli login
bun run build:android:internal
```

Use an Expo account with access to the existing `renagent/ren` project. The build runs on your Mac without consuming EAS cloud build credits. EAS still needs network access for project configuration, credentials and remote build numbers.

On the first build, let EAS create an Android signing keystore if the project does not already have one. Reuse that keystore for every team build. Back it up using `bunx eas-cli credentials --platform android` and store its passwords securely outside Git. Build numbers auto-increment remotely.

EAS builds from an archive of the repository. Keep `android/` ignored so it regenerates the native project from app configuration rather than using the local development project. Run from the completed source you intend to share, after checks pass.

The result is `packages/mobile/ren-internal.apk`. The profile sets production API and web URLs explicitly; verify any EAS production environment variables before the first build.

### Share and install

1. Upload the APK to a team-accessible file service and share its download link.
2. On Android, download and open the APK. Allow installation from that browser or file manager when prompted.
3. Open Ren and sign in with an existing Ren account.

This uses the package ID `ai.ren.app`. A locally signed development app with the same ID may need to be uninstalled first because its signing key differs. Uninstalling clears that app's local data and sign-in. Subsequent internal APKs signed with the same keystore install as updates and retain app data.

For each update, build again and share the new APK. There is no automatic updater or Play Store listing.

### First-build device check

- Install and cold-launch with Metro stopped and USB disconnected.
- Check the launcher icon and splash screen.
- Sign in, open a session, send a message and receive the streamed response.
- Check keyboard behavior, background/resume and network reconnection.
- Sign out and back in.
- For the next build, install over the previous APK and confirm local data is retained.

### Branding

The Android icons reuse `packages/site/public/ren_logo_dark.svg`. `assets/android-icon.png` is a square black launcher icon; `assets/android-foreground.png` contains the white mark on a transparent canvas with padding for Android adaptive masks. The splash uses the same mark on black.
