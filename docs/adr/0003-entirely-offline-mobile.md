# ADR 0003: Entirely offline mobile milestone

- Status: Accepted by the product owner
- Date: 2026-10-18
- Supersedes: ADR 0002's online catalogue requirement for the current mobile app

The mobile app is rebuilt from the Expo SDK 57 starter. Product registration,
catalogue management, the cart, checkout, history, and dashboard all work without
authentication, a server, or internet access. The API project is independent of
this milestone; the mobile app does not call it.

SQLite is the source of truth, using versioned migrations, foreign keys, WAL,
bound parameters, and integer minor currency units. Products contain a name,
category, selling price in LSL, whole-unit stock, optional barcode, and optional
local photo. Categories are entered by the shop owner and suggested from existing
products. Photos are copied into the app's documents directory.

The cart is durable. Checkout checks stock again, then saves the sale and its
item snapshots, reduces stock, and clears the cart in one transaction. Insufficient
stock blocks checkout. Reusing a sale reference is idempotent. Checkout records
the total only; cash received, change, refunds, and payment integrations are not
part of this milestone. Receipts retain product names, categories, and prices as
they were at sale time.

The Android app is Mokhotsi, application ID `com.mokhotsi.app`. Development builds
are compiled locally with the Android Studio toolchain and `expo-dev-client`.
EAS cloud builds are not used. On-device CNN recognition remains a separate
integration step after the manual selling flow is verified.

There is no sync or backup service in this milestone. App restarts preserve data;
clearing app storage or uninstalling the app removes its local database and photos.
Expo Go and the installed development app have separate storage. Data export and
recovery need a separate product decision before production deployment.
