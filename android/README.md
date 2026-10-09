# Android App
The Android companion app is planned under the public name **Sheepfold**.

- Android package: `app.sheepfold.android`
- Minimum Android version: Android 9.0 Pie
- Minimum SDK: API 28
- Target SDK: latest stable Android SDK
- Suggested stack: Kotlin, Jetpack Compose, Android Keystore for token storage
- Planned widgets:
  - Internet enabled
  - Internet disabled
  - Combined internet state switch

The app should mirror the core LuCI workflows and include the parent AI assistant tab.

## Connectivity

The Android app is for parent/admin devices only.

Default connection model:

- local network connection to the router when the parent is at home;
- Telegram or VK bot for remote short commands and notifications when the parent is away; VK is the default first-run messenger choice, and MAX may appear later as an experimental adapter.

Full Android management should be local-network only. Do not design full remote management through WireGuard, VPN tunnels, or any other tunnel to the router. Outside the home network, use the configured messenger bot for short confirmed commands and notifications.

During first setup, Android should try to detect Sheepfold automatically on the currently connected Wi-Fi network before asking the parent to confirm that this is the home network. Detection must verify a Sheepfold-specific endpoint on the router, not just any HTTP/LuCI response. Suggested endpoints:

- `/.well-known/sheepfold.json`
- `https://<router-host>:5201/cgi-bin/sheepfold-api`
- `https://<router-host>:5201/api/v1/ping`

The response should contain a Sheepfold marker, package version, router name, and API base URL. If detection succeeds, continue to the MAC-check step without asking “are you connected to home Wi-Fi?”. If detection fails, show the manual Wi-Fi confirmation flow.

## Pairing

First pairing should be started locally from LuCI.

Android first setup screen order:

1. User agreement and data-processing consent.
2. Connect the phone to the home local network through Wi-Fi or wired Ethernet. Do not allow first setup to continue over cellular/mobile data.
3. Check/guide the parent to use the real device MAC for the current Wi-Fi network. If the active network is wired Ethernet, skip Wi-Fi-specific MAC instructions and warn that the router sees the Ethernet adapter MAC instead.
4. Choose router connection setup: QR scan/image import or manual setup.
5. Set the local app password/PIN.

Flow:

- parent opens Sheepfold in LuCI;
- parent marks the phone as an administrator device and selects which administrator owns it;
- LuCI shows `Pairing` / `Сопряжение` for that device;
- the pairing dialog shows a QR code plus the same values for manual setup;
- Android scans the QR code or lets the parent enter the router address/API URL, administrator login or ID, pairing code, and token lifetime manually.
- Android can scan the QR code through the camera or load a QR image from local files/downloads.

The QR payload must use a short-lived one-time token scoped to one administrator and one device. It must not contain router root passwords, LuCI session cookies, bot tokens, AI keys, or unrelated secrets.

After successful pairing, the router backend must mark the one-time token as consumed and reject every later reuse of the same QR/manual code.

## Wi-Fi MAC Check

During first pairing, after the phone is connected to home Wi-Fi, the app should check whether the phone is visible to the router under the MAC address Sheepfold will manage.

If the home Wi-Fi network uses randomized/private MAC:

- explain that Sheepfold needs a stable device identifier for reliable rules;
- guide the parent to Android Wi-Fi network settings;
- recommend switching this home Wi-Fi network to the real device MAC, but allow the parent to continue after the warning;
- verify the selected admin device from router-side data after the parent returns to the app.

Do not promise automatic switching from randomized/private MAC to device MAC. Android permissions and manufacturer builds may prevent reliable automatic changes.

## First-Run Agreement

Before the first setup continues, the Android app must show a link to the full user agreement and require this checkbox:

```text
Я принимаю пользовательское соглашение и даю согласие на обработку персональных и технических данных, необходимых для работы Sheepfold.
```

Full agreement:

```text
https://github.com/hayOfLife/luci-app-sheepfold-family-internet-control/blob/main/docs/user-agreement.ru.md
```

## App Lock

On first setup, the Android app should ask how to protect access to the app.

Recommended default: password or PIN.

The main application screen must not open until the app-protection step is completed. After successful router pairing, always show the app-protection screen first; only its final confirmation may switch the app into the main UI.

Biometric unlock by fingerprint or face can be offered, but should not be recommended as the safest option. Short warning text:

```text
Password or PIN is recommended. Fingerprint or face unlock can be less safe for parental-control apps: a child may try to unlock the app while the parent is asleep.
```

Do not request biometric permissions during the first-run permission step. Ask for biometric access only later, after the parent explicitly enables fingerprint or face unlock in app-lock settings.

Android versions older than 9.0 are intentionally out of scope.

## Current Scaffold

The repository has one Android build root: `android/`.

Inside it, `android/app/` is the application module, not a second separate project. Run Gradle from `android/` so the build always uses `android/settings.gradle.kts`.

The application uses Kotlin and Jetpack Compose. It includes the first-run agreement and permission flow, network discovery, Wi-Fi/MAC guidance, camera and file QR scanning, manual pairing, one-time router pairing, TLS pinning, encrypted connection storage, password/PIN/biometric app protection, router-backed device actions, notifications, widgets, an HPKE-encrypted support-report form, and the parent AI assistant routed through OpenWRT. Support reports use Google Tink and are encrypted on the phone before the home router; the evolving API contract is documented in `docs/android-openwrt-api.ru.md` and `docs/support-report-transport.ru.md`.

## Build

Prerequisites:

- JDK 17 or newer;
- Android SDK;
- Android SDK Platform 35;
- Android SDK Build-Tools;
- Android SDK Platform-Tools.

If Android Studio installed the SDK into the default Windows location, create `android/local.properties` locally:

```properties
sdk.dir=C\:\\Users\\User\\AppData\\Local\\Android\\Sdk
```

Do not commit `android/local.properties`.

Build with the checked-in Gradle Wrapper from the repository root:

```powershell
android\gradlew.bat -p android :app:assembleDebug --stacktrace
```

Debug APK output:

```text
android/app/build/outputs/apk/debug/app-debug.apk
```

The explicit `exportDebugApk` task copies the APK to `SHEEPFOLD_APK_OUTPUT_DIR`.
On the owner's current Windows computer use:

```text
C:\Users\User\Documents\pesochnica\sheepfold-parent-v<current-version>.apk
```

Set `SHEEPFOLD_APK_OUTPUT_DIR` before the export task; an ordinary
`assembleDebug` keeps its artifact inside the Android project.

## Release signing and local protection

The parent app locks again after the selected background delay (one minute by default), rate-limits wrong password/PIN attempts after the fifth failure, and uses one Android biometric option. Widget shutdown is protected by unlock and confirmation unless the owner explicitly enables the warned instant mode.

Production signing is configured only from the external environment described in [`RELEASE_SIGNING.md`](RELEASE_SIGNING.md). Release packaging fails when the secrets or keystore are absent; debug builds do not use the production key.
