# Mokhotsi mobile

An entirely offline point-of-sale app using Expo SDK 57, Expo Router,
`expo-sqlite`, and `expo-camera`. A product has a name, category, optional photo,
and one or more sizes (e.g. Sugar 500 g and Sugar 2 kg). Each size has a grocery
unit (kg, g, mg, L, mL, pcs, pack, box, carton, bottle, can, sachet, bag, tray,
m, cm), an LSL selling price, its own whole-pack stock, and an optional barcode.
The app includes a dashboard, catalogue, registration/editing with barcode
scanning, a Till that scans barcodes straight into the persistent cart, and
sales history.

The Android application ID is `com.mokhotsi.app`. No EAS build, Expo account,
API server, or login is needed for this milestone.

## Run in Expo Go

From `mobile` in PowerShell:

```powershell
npm.cmd install
npm.cmd run start:go
```

Scan the QR code using Expo Go. SQLite and the camera are included in Expo Go;
barcode scanning needs a physical device. The `.cmd` suffix
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
and repository SQL. They cover the v1 → v2 upgrade of a real database file, file
reopen persistence, per-size stock, cart durability, atomic checkout rollback,
idempotent checkout, archived sizes, immutable receipt snapshots, barcode
uniqueness and UPC/EAN equivalence, amount and size parsing, and integer overflow.
`tests/domain.test.mjs` covers units, barcode normalisation, the scan gate, the
till state machine, recognition resolution, and product form validation. These
tests supplement device tests; they do not replace testing Expo's native SQLite
driver or the camera.

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
7. Register "Sugar" with two sizes (500 g and 2 kg), scanning a different barcode
   for each. Open the Till and scan each pack: each is added once with a
   vibration, and holding a pack in view does not add it again.
8. Scan an unregistered barcode at the Till, choose "Register product", save, and
   confirm you return to the Till and the next scan adds it.
9. Remove one size of a product that has been sold. The old receipt still shows
   it; it disappears from the catalogue and the cart.
10. Switch tabs and background the app while on the Till; the camera stops and
    resumes. Deny camera access once and confirm the screen offers settings.

Adding `expo-camera` requires rebuilding the development app
(`npm.cmd run android -- --device`). Upgrading over an earlier build migrates
existing products to a single "Each" size with their price, stock, and barcode.

Expo Go and the installed development client have separate storage. Switching
between them does not migrate data. Force-stopping preserves data; uninstalling
the app or clearing its storage removes the local database and product photos.

## Implementation

- `src/domain/`: units registry and size labels, barcode normalisation. Pure.
- `src/db/schema.ts` + `src/db/migrations/`: append-only, versioned migrations
  run per step in a transaction with a foreign-key check; WAL and foreign keys.
- `src/db/store.ts`: the `ShopStore` facade over `repositories/` (catalogue,
  cart, sales) with parameterized queries and atomic checkout. Sizes are
  archived, never deleted, so receipts keep referring to them.
- `src/db/ShopProvider.tsx`: startup, error recovery, and screen refresh.
- `src/features/scanner/`: `ScannerCamera`, the only component that owns a
  camera, plus the scan gate and the registration capture modal.
- `src/features/recognition/`: `Recognition` events and their resolution to a
  size, a size choice, or unknown.
- `src/features/till/`: the till state machine, hook, and sheets.
- `src/features/products/`: product form logic, search, and editor components.
- `src/app/(tabs)`: dashboard, catalogue, till, cart, and sales history.
- `src/app/register.tsx`: product registration and editing.
- `src/features/photos.ts`: persistent, local photo storage.
- `tests/`: database and domain tests.

Modules under `src/domain`, `src/db`, `src/lib`, and the pure `.ts` files in
`src/features` use relative imports with a `.ts` extension, no `@/` alias, and
erasable TypeScript only, so `node --test` can run them directly.

On-device recognition plugs into the Till without changing it: a recognizer
emits `{ kind: "visual", productId, score }` from `ScannerCamera`, and the till
already asks the cashier to pick a size when a product has several. `expo-camera`
has no frame processors, so that recognizer would either run periodic still
captures or replace the camera inside `ScannerCamera` with VisionCamera.

There is no cloud sync, backup/export, login, payment processing, refund flow,
weighed (fractional) selling, or CNN inference in this milestone. CNN
model/runtime selection and backup/recovery require a later decision.
