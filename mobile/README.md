# Mokhotsi mobile

An entirely offline point-of-sale app using Expo SDK 57, Expo Router,
`expo-sqlite`, `expo-camera` (barcodes), and VisionCamera with
`react-native-fast-tflite` (on-device product recognition). A product has a name, category, up to two
photos, and one or more sizes (e.g. Sugar 500 g and Sugar 2 kg). Each size has a grocery
unit (kg, g, mg, L, mL, pcs, pack, box, carton, bottle, can, sachet, bag, tray,
m, cm), an LSL selling price, its own whole-pack stock, and an optional barcode.
The app includes a dashboard, catalogue, registration/editing with barcode
scanning, a Till that scans barcodes straight into the persistent cart, a cash
checkout that works out the change, and sales history with receipts. Items without a barcode are identified with the camera
("Non-barcode" on the Till): YOLOv8n finds the item, MobileNetV2 embeds it, and
the closest matching products are offered for the cashier to pick.

The Android application ID is `com.mokhotsi.app`. No EAS build, Expo account,
API server, or login is needed for this milestone.

## Expo Go is not supported

VisionCamera, its GPU resizer, `react-native-fast-tflite`, and
`react-native-nitro-image` are native modules that Expo Go does not include. Use
the development build below. In PowerShell, the `.cmd` suffix avoids
execution-policy errors from npm/npx `.ps1` wrappers.

## Build locally for Android

Install Android Studio with Android SDK Platform 36, Build Tools, Platform Tools,
and a compatible JDK. `ANDROID_HOME` must point to the SDK and `JAVA_HOME` to the
JDK (Android Studio's bundled `jbr` works with the generated Gradle toolchain).
Enable Developer Options and USB debugging on the phone. Accept the phone's
USB debugging authorization prompt.

```powershell
npm.cmd run android -- --device
```

This compiles locally, installs the app, and starts Metro. Before building, it
runs `scripts/ensure-native.mjs`, which compares Expo's fingerprint of everything
that shapes the native project (`app.json`, its config plugins, and every native
package) with the one `android/` was generated from. If anything changed, it
regenerates `android/` with `expo prebuild --clean`; otherwise the build stays
incremental. This keeps settings such as `minSdkVersion` from going stale when a
plugin or native package is added.

Native modules build their C++ in `android/.cxx/<id>` rather than inside
`node_modules` (`plugins/with-short-native-build-dirs.js`). Windows limits paths
to 260 characters, and deep `node_modules` build folders exceeded it, which made
ninja fail with "build.ninja still dirty after 100 tries". Subsequent JavaScript/TypeScript-only changes
need only:

```powershell
npm.cmd run start:dev
```

To use the Android Studio IDE directly, regenerate the project first (this always
rebuilds `android/` from config):

```powershell
npm.cmd run prebuild:android
```

Open the generated `mobile/android` folder in Android Studio, let Gradle sync,
select the `app` debug configuration and connected phone, then Run. Keep Metro
running with `npm.cmd run start:dev`. Configure native behavior in `app.json` or
config plugins; the `android` folder is generated and ignored by Git, and any
manual edit to it is lost on the next regeneration.

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
4. In the cart, tap "Charge", key in the cash received (or tap a quick amount),
   and check the change. "Complete sale" stays disabled while the cash is short.
   Complete it, then check the receipt (total, cash, change), reduced stock, and
   dashboard totals; restart again and verify all three.
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

11. Register a product with one or two photos (front and another angle). It
    is learnt in the background a few seconds after saving; nothing to do.
12. On the Till, tap "Non-barcode" and hold that item still. "Identifying…"
    shows over the camera, then the item appears in "Is it this product?" within
    about a second. Pick it; a product with several sizes asks for the size. You
    return to the Till with the item in the cart.
13. Remove one of the photos and save: the item is still found from the other.
14. Pick a different product than the best guess (or use "Search instead"): the
    view is kept as a correction, so the same item is recognised better next time.
15. Switch between the Till and "Non-barcode" repeatedly and background the app
    during identify: barcode scanning keeps working and nothing crashes.

In development builds the identify screen shows a debug panel: detector
rate and latency, CPU or GPU, best scores, and the exact crop the embedder saw.
The crop must look upright, correctly coloured, and tight around the item. Use the
scores on real items to tune `matching.accept_threshold` and `matching.margin` in
`assets/models/manifest.json` (the shipped values are starting points).

Native modules require rebuilding the development app
(`npm.cmd run android -- --device`). Android 8.0 (API 26) or newer is required.
Upgrading over an earlier build migrates existing products to a single "Each"
size, and adds the visual-matching, second-photo, and cash columns.

Expo Go and the installed development client have separate storage. Switching
between them does not migrate data. Force-stopping preserves data; uninstalling
the app or clearing its storage removes the local database and product photos.

## Implementation

- `src/domain/`: units registry and size labels, barcode normalisation, cash
  tendering (change, quick amounts, keypad input). Pure.
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
- `src/features/checkout/`: the cash payment sheet and keypad.
- `src/components/`: the design system (`shop-ui.tsx`: light palette, Inter
  type, buttons, fields, cards), sheets, toasts, and loading screens.
- `src/features/products/`: product form logic, search, and editor components.
- `src/app/(tabs)`: dashboard, catalogue, till, cart, and sales history.
- `src/app/register.tsx`: product registration and editing.
- `src/features/photos.ts`: persistent, local photo storage.
- `assets/models/`: `detector.tflite` (YOLOv8n, 320×320, one "item" class),
  `embedder.tflite` (MobileNetV2, 224×224 → 1280-d), and `manifest.json`, the
  contract for shapes, value ranges, thresholds, and model versions. Models are
  stored with Git LFS and validated against the manifest when loaded.
- `src/ml/`: pure, worklet-safe recognition code: manifest validation, YOLO
  decoding, geometry, tensor sampling, vector maths, the vector index, the
  stability tracker, and the match voter.
- `src/features/vision/`: the runtime. `vision-service.ts` loads models lazily
  (GPU, then CPU), owns the index, and keeps background work off the models while
  a camera screen uses them. `use-live-pipeline.ts` runs detection and embedding
  on the camera thread; `still-pipeline.ts` embeds photos with the same
  preprocessing. `reconcile.ts` embeds new or changed product photos and
  re-embeds saved views after a model upgrade, all derived from the database.
- `src/app/identify.tsx`: identify an item without a barcode.
- `tests/`: database, domain, and recognition tests.

Modules under `src/domain`, `src/db`, `src/lib`, and the pure `.ts` files in
`src/features` use relative imports with a `.ts` extension, no `@/` alias, and
erasable TypeScript only, so `node --test` can run them directly.

Barcode selling stays on `expo-camera`. "Non-barcode" opens a separate screen,
so the Till's camera is released first and the two camera libraries never run at
the same time. Phones without the GPU resizer (Vulkan) identify items from a
captured photo instead of the live preview, using the same models.

Products are learnt from their photos, in the background: each photo is
embedded twice (the detected item framed tightly and with more context), and
cashier corrections at the till add more views (capped per product). Views are
stored per embedder version with the image they came from, so changing the
embedder (bump `embedder.model_version`) re-embeds them in the background.

The detector was trained with Ultralytics (AGPL-3.0). Settle its licensing before
a commercial release.

There is no cloud sync, backup/export, login, payment processing, refund flow, or
weighed (fractional) selling in this milestone.
