# Mokhotsi

Offline point-of-sale for informal retailers in Lesotho. The current mobile milestone runs entirely on-device: product registration, categories, stock, a persistent cart, checkout, sales history, and a dashboard backed by SQLite. Prices use Lesotho loti (LSL). It requires no API connection or login. On-device CNN recognition is a subsequent integration step.

The current mobile setup and verification instructions are in [mobile/README.md](mobile/README.md). [ADR 0003](docs/adr/0003-entirely-offline-mobile.md) records the fully offline scope and supersedes the earlier online catalogue requirement for this milestone. The backend and historical sync architecture below are separate from the current mobile app.

| Folder        | What                                                                      |
| ------------- | ------------------------------------------------------------------------- |
| `mobile/`     | Expo SDK 57, React Native, TypeScript, Expo Router, expo-sqlite |
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
| An Android phone | USB debugging on | Expo Go supports the current SQLite screens; use the local development client for native integration |

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

## 2. Mobile app (local development build)

The current app runs entirely offline. Follow [mobile/README.md](mobile/README.md)
for setup, device verification, storage behavior, and Android Studio IDE steps.

```powershell
cd mobile
npm.cmd install
npm.cmd run android -- --device
```

This builds locally using Android Studio's SDK and JDK, installs the development
client, and starts Metro. EAS cloud builds are not used.

For subsequent JavaScript changes, run `npm.cmd run start:dev`. For Expo Go,
run `npm.cmd run start:go`; the two apps have separate local databases.

Checks: `npm.cmd run typecheck`, `npm.cmd run lint`, and `npm.cmd test`.

The current mobile app does not read an API URL or load CNN models. Those
integrations are separate future milestones.
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
