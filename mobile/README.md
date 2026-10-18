# Mokhotsi mobile

An entirely offline point-of-sale app using Expo SDK 57, Expo Router, and
`expo-sqlite`. Products include a name, category, LSL selling price, whole-unit
stock, optional barcode, and optional photo. The app includes a dashboard,
catalogue, registration/editing, persistent cart, and sales history.

The Android application ID is `com.mokhotsi.app`. No EAS build, Expo account,
API server, or login is needed for this milestone.

## Run in Expo Go

From `mobile` in PowerShell:

```powershell
npm.cmd install
npm.cmd run start:go
```

Scan the QR code using Expo Go. SQLite is included in Expo Go. The `.cmd` suffix
avoids PowerShell execution-policy errors from npm/npx `.ps1` wrappers.

## Build locally for Android

Install Android Studio with Android SDK Platform 36, Build Tools, Platform Tools,
and a compatible JDK. `ANDROID_HOME` must point to the SDK and `JAVA_HOME` to the
JDK (Android Studio's bundled `jbr` works with the generated Gradle toolchain).
Enable Developer Options and USB debugging on the phone. Accept the phone's
USB debugging authorization prompt.

```powershell
npm.cmd run android -- --device
```

This compiles locally, installs the app, and starts Metro. It generates the Android
project if missing. Native dependencies are already listed in package.json.
Subsequent JavaScript/TypeScript-only changes need only:

```powershell
npm.cmd run start:dev
```

To use the Android Studio IDE directly:

```powershell
npm.cmd run prebuild:android
```

Open the generated `mobile/android` folder in Android Studio, let Gradle sync,
select the `app` debug configuration and connected phone, then Run. Keep Metro
running with `npm.cmd run start:dev`. Configure native behavior in `app.json` or
config plugins; the `android` folder is generated and ignored by Git.

For an APK without automatically installing it:

```powershell
cd android
.\gradlew.bat :app:assembleDebug --no-daemon --console=plain
```

The APK is `android/app/build/outputs/apk/debug/app-debug.apk`. Gradle may download
dependencies on the first build, but compilation happens on this computer.

For a USB-connected development session, forward Metro if needed:

```powershell
& "$env:ANDROID_HOME\platform-tools\adb.exe" reverse tcp:8081 tcp:8081
```

The business features have no network dependency. A development build still uses
Metro to load its development JavaScript. A standalone release build bundles that
JavaScript and is the later step for deployment without a development computer.

## Verification

```powershell
npm.cmd run typecheck
npm.cmd run lint
npm.cmd test
```

Tests use Node 24's real SQLite implementation with the production migrations
and repository SQL. They cover file reopen persistence, cart durability, atomic
checkout rollback, idempotent checkout, stock validation, immutable receipt
snapshots, barcode uniqueness, amount parsing, and integer overflow. These tests
supplement device tests; they do not replace testing Expo's native SQLite driver.

On the phone:

1. Register a clearly labelled test product with category, price, stock, and an
   optional barcode/photo. Confirm it appears in the catalogue.
2. Fully close the app (force-stop it for a stronger check), reopen the same app,
   and verify all saved product values and the photo.
3. Add it to the cart, restart again, and verify the cart quantity.
4. Complete a sale. Check its receipt, reduced stock, and dashboard totals, then
   restart again and verify all three.
5. Put a product in the cart, edit its stock below the cart quantity, and verify
   checkout is blocked until the cart or stock is corrected.
6. Edit the product name and price and verify the earlier receipt is unchanged.

Expo Go and the installed development client have separate storage. Switching
between them does not migrate data. Force-stopping preserves data; uninstalling
the app or clearing its storage removes the local database and product photos.

## Implementation

- `src/db/schema.ts`: versioned schema, WAL, foreign keys, and migrations.
- `src/db/store.ts`: parameterized queries and atomic checkout.
- `src/db/ShopProvider.tsx`: startup, error recovery, and screen refresh.
- `src/app/(tabs)`: dashboard, catalogue, cart, and sales history.
- `src/app/register.tsx`: product registration and editing.
- `src/features/photos.ts`: persistent, local photo storage.
- `tests/store.test.mjs`: database behavior tests.

There is no cloud sync, backup/export, login, payment processing, refund flow,
barcode scanning, or CNN inference in this milestone. Barcodes can be entered
manually. CNN model/runtime selection and backup/recovery require a later decision.
