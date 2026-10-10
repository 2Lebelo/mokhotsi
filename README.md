# Mokhotsi

Offline-first point-of-sale for informal retailers in Lesotho. The phone recognises products with its camera, entirely on-device: YOLOv8n finds the product, then MobileNetV2 embeds it and the embedding is matched against the shop's enrolled products. Every sale is written to on-device SQLite first and synced to a FastAPI + MongoDB backend when the phone is online. The server is a sync and backup target. Checkout never waits for it.

| Folder        | What                                                                      |
| ------------- | ------------------------------------------------------------------------- |
| `mobile/`     | Expo (SDK 57) + React Native app, TypeScript strict, expo-router, Drizzle |
| `api/`        | FastAPI + PyMongo Async API, managed with `uv`                            |
| `ml/`         | Model export / parity / evaluation scripts (`uv`)                         |
| `contracts/`  | JSON Schema for the sync API + examples both test suites validate         |
| `docs/`       | Architecture and ADRs                                                     |

Roles: **system admin** (users, shops, every audit log), **shop-keeper** (owns one or more shops: catalogue, stock, sales, reports, sitters) and **shop-sitter** (sells in one shop, with extra privileges only if the keeper grants them).

Status: built in phases.

| Phase | Scope | State |
| --- | --- | --- |
| 1 | Backend: identity, sessions, RBAC, shops, members, audit log, `/api/v1` conventions | **done** |
| 2 | Backend: categories, products, stock, sales, refunds, profit & loss, sync v1 | next |
| 3–5 | Mobile: design system, auth and roles, catalogue and barcode scanning, selling, admin | planned |
| 6 | On-device recognition (models plug into the existing `Recognizer` slot) | when models are exported |

Remaining stubs are marked `TODO(feature)`.

## Prerequisites

| Tool | Version | Notes |
| --- | --- | --- |
| Git + **Git LFS** | any | `git lfs install` once; `.tflite` models are LFS objects |
| Node.js | 24 LTS | npm comes with it |
| uv | 0.12+ | Windows: `powershell -ExecutionPolicy ByPass -c "irm https://astral.sh/uv/install.ps1 \| iex"` · macOS/Linux: `curl -LsSf https://astral.sh/uv/install.sh \| sh` |
| Docker Desktop | with Compose v2 | for MongoDB + the API |
| Android build tools | JDK 17 + Android Studio (SDK, platform tools) | only for local `expo run:android`; or use EAS Build |
| An Android phone | USB debugging on | Expo Go **cannot** run this app (custom native code) |

## 1. Backend: `docker compose up`

```bash
cp api/.env.example api/.env          # then set JWT_SECRET to a random 32+ char string
docker compose up --build
# There is no public sign-up. Create the first system admin once:
docker compose exec api python -m app.cli create-admin --email you@example.com --name "Your Name"
```

- API: <http://localhost:8000/docs> (OpenAPI). Health: <http://localhost:8000/health> → `{"status":"ok","mongo":"ok","redis":"ok"}`.
- MongoDB 8 runs as a **single-node replica set** (the API uses transactions), and its data is kept in the `mongo-data` volume. Redis holds rate-limit counters only. `docker compose down -v` wipes everything.
- If a MongoDB is already installed locally on port 27017, publish the container on another port with `MONGO_HOST_PORT=27018 docker compose up`, and point host tools at `mongodb://localhost:27018`.
- API rules (versioning, pagination, idempotency, rate limits, error codes): [docs/api-conventions.md](docs/api-conventions.md).

### API without Docker (for development)

```bash
docker compose up -d mongo redis      # replica-set MongoDB + Redis
cd api
uv sync
cp .env.example .env                  # MONGO_URI must point at a replica set
uv run python -m app.cli create-admin --email you@example.com --name "Your Name"
uv run uvicorn app.main:create_app --factory --reload --host 0.0.0.0 --port 8000
uv run ruff check . && uv run ruff format --check . && uv run pytest
```

Tests do not read `api/.env`. They use a throwaway `mokhotsi_test` database (reset for each test client) and only the environment, so set `MONGO_URI` if Mongo isn't on `localhost:27017`. Tests that need MongoDB or Redis are skipped locally when those aren't reachable, but they fail in CI.

## 2. Mobile app (development build)

```bash
cd mobile
npm install                           # postinstall runs `models:sync`
cp .env.example .env                  # set API_URL (see "Phone ↔ laptop" below)
```

Build and install the dev client. Pick **one** of:

```bash
# A) Local build (needs JDK 17 + Android SDK; phone connected by USB or emulator running)
npx expo prebuild --clean
npx expo run:android

# B) Cloud build with EAS, then install the APK on the phone
npx eas-cli@latest build --profile development --platform android
```

Then start Metro and open the installed **Mokhotsi** dev client: `npm start`.
After adding or upgrading a native package, rebuild the dev client (repeat A or B).

Checks (also run in CI):

```bash
npx tsc --noEmit && npx expo lint && npm run format:check && npx jest
```

### Phone ↔ laptop: use the LAN IP, never `localhost`

On the phone, `localhost` is the phone itself. Set `API_URL` in `mobile/.env` to your laptop's LAN address, e.g. `http://192.168.1.20:8000`. Find it with `ipconfig` on Windows (IPv4 Address) or `ipconfig getifaddr en0` on macOS. The phone and laptop must be on the same Wi-Fi, and the firewall must allow inbound TCP 8000. The Android emulator can use `http://10.0.2.2:8000`. EAS builds take `API_URL` from the profile's `env` in `mobile/eas.json`. The preview and production URLs there are placeholders.

`API_URL` is read when the app config is evaluated, so restart Metro (or rebuild) after changing it.

### Models

The app looks for `detector.tflite` and `embedder.tflite` in `mobile/assets/models/` (see `manifest.json` there). If they're missing, the app still runs and the Sell and Debug screens say which file is missing. See [mobile/assets/models/README.md](mobile/assets/models/README.md).

## 3. ML scripts

```bash
cd ml
uv sync                               # full deps: TensorFlow + Ultralytics (large download)
uv run python scripts/export_detector.py --check-only --model-version dev
uv run ruff check . && uv run ruff format --check .
```

Colab notebooks go in `ml/notebooks/`. Export outputs go to `ml/artifacts/` (git-ignored).

## Repository rules

- Layering, sync contract and data flow are in [docs/architecture.md](docs/architecture.md). Why SQLite + outbox: [ADR 0001](docs/adr/0001-offline-first-sqlite-outbox.md). Roles, tenancy and online management with offline selling: [ADR 0002](docs/adr/0002-roles-tenancy-hybrid-connectivity.md).
- Every API mutation writes its audit-log entry in the same transaction (`in_transaction`), and authorization is checked by permission, never by role name.
- Changing the wire format means changing `contracts/sync.schema.json`, `api/app/schemas/sync.py` and `mobile/src/contracts/sync.ts` together. The contract tests on both sides fail otherwise.
- No secrets in Git. Only `*.env.example` files are committed.
