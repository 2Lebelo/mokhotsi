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

The Android application ID is `com.mokhotsi.app`. No EAS build or Expo account
is needed. A phone is set up once, online, by its shop's owner; after that it
opens on a PIN pad and sells fully offline, with cashier accounts, several shops
and permissions (see "Accounts, shops and cashiers").

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
   for each. Open the Till and scan each pack: each is added once with a short
   scanner beep and a vibration, and holding a pack in view does not add it
   again. With the phone on silent only the vibration plays; music playing in
   another app keeps playing under the beep.
8. Scan an unregistered barcode at the Till: it vibrates without a beep. Choose
   "Register product", save, and confirm you return to the Till and the next
   scan adds it.
9. Remove one size of a product that has been sold. The old receipt still shows
   it; it disappears from the catalogue and the cart.
10. Switch tabs and background the app while on the Till; the camera stops and
    resumes. Deny camera access once and confirm the screen offers settings.

11. Register a product with one or two photos (front and another angle). It
    is learnt in the background a few seconds after saving; nothing to do.
12. On the Till, tap "Non-barcode" and hold that item still. "Identifying…"
    shows over the camera, then the item appears in "Is it this product?" with a
    beep within about a second. Pick it; a product with several sizes asks for the size. You
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

Native modules (such as `expo-audio`, which plays the scan beep) require
rebuilding the development app (`npm.cmd run android -- --device`). The beep is
generated by `node scripts/generate-beep.mjs` into `assets/sounds/scan-beep.wav`. Android 8.0 (API 26) or newer is required.
Upgrading over an earlier build migrates existing products to a single "Each"
size, and adds the visual-matching, second-photo, and cash columns. Version 7
adds the sync outbox and the stock ledger, and records earlier sales as made by
"local". Stock figures, carts and receipts are unchanged.

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
  archived, never deleted, so receipts keep referring to them. It is built with
  a `StoreContext` (id factory, clock, and the acting user and phone).
- `src/db/repositories/stock.ts`: the stock ledger. Every stock change is a row
  in `stock_movements`. A stock edit is saved as the difference from what the
  editor showed, so a sale made meanwhile is never overwritten.
- `src/db/repositories/outbox.ts`: changes queued for the server, written in the
  same transaction as the change. Nothing is queued until the shop is registered
  (`sync_state.mode`), so the app behaves as before. See
  `docs/adr/0005-users-tenancy-offline-sync.md` and
  `src/contracts/sync.ts` (mirror of `contracts/sync.v2.schema.json`).
- `src/db/ShopProvider.tsx`: opens one shop's file as the person at the till,
  error recovery, and screen refresh.
- `src/db/device/`: `device.db`, the phone's own data (roster, which file holds
  each shop, PIN lockout), apart from any shop.
- `src/api/`: the only network code. `client.ts` (errors, token refresh shared
  by concurrent requests, idempotency keys kept across retries, backoff),
  `endpoints.ts`, and `schema.d.ts`, generated from `contracts/openapi.json`
  with `npm run api:types` (a test fails if it is stale).
- `src/auth/`: who the phone is and who is at the till. `device-provider.tsx`
  (device.db, keystore secrets via `secure.ts`, roster refresh) and
  `session-provider.tsx` (offline PIN check with `pin-match.ts`, idle lock,
  `can(permission)`). `src/lib/hmac.ts` is HMAC-SHA256 over expo-crypto.
- `src/sync/roster.ts`: keeps the roster in step with the server (ETag, 304).
- `src/auth/phase.ts`: which screens may show (signed out, setup, admin, locked,
  open), tested in node. `src/app/_layout.tsx` guards each route group by it.
- `src/features/auth/`, `onboarding/`, `shops/`, `staff/`, `admin/`: sign-in and
  registration (PIN cells, phone field), approval and first shop, the lock screen,
  the owner's shops, staff and phones, and admin mode.
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

## Accounts, shops and cashiers

Set `EXPO_PUBLIC_API_URL` in `.env.local` (see `.env.example`) to the API's base URL and
rebuild or restart Metro. Nobody reaches the till without signing in, so a build without
it only shows "Not connected".

1. **A phone that isn't set up for a shop** opens on **Sign in** (phone number + PIN).
   "Create an account" registers an owner (name, phone number, PIN).
2. **A registered owner** sees "We're reviewing your registration" until the system admin
   approves them. The screen checks by itself, backing off from 15 seconds to 5 minutes.
3. **The system admin** signs in the same way and lands in Admin (no till). Seed the first
   admin with `uv run python -m app.cli seed-admin` in `api/`.
4. **Once approved**, the owner names their shop (confirmed with their PIN) and lands in
   the till. Items and sales already on the phone become that shop's. An owner who already
   has shops picks one for this phone instead.
5. **From then on the phone opens on the PIN pad**, for owners and cashiers, offline too.
   Cashiers are added under Menu → Users with a name, a PIN unique in the shop, and what
   they may do beyond selling. Menu → Shops opens more shops; Menu → Lock hands the phone
   over.

Routes are guarded by one phase (`src/auth/phase.ts`, used with `Stack.Protected` in
`src/app/_layout.tsx`): `sign-in`/`sign-up`, `setup`, `admin/*`, `unlock`, and the
till under `src/app/(app)/`, which only exists once someone has unlocked.

PINs are checked on the phone against the roster (each member's
`HMAC(shop key, PIN)`, with the key in the Android Keystore). Five wrong PINs
lock the pad for 30 seconds, doubling each time. After five idle minutes the
phone locks.

Sync of products, stock and sales to the server is Release B of ADR 0005: the
outbox and stock ledger are in place, but nothing is queued or sent yet. There
is no payment processing or weighed (fractional) selling in this milestone.
