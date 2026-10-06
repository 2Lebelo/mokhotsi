"""Push (apply client ops) and pull (serve changes after a cursor).

Ordering: every accepted upsert/delete gets the next per-shop `seq` from `counters`; pull
returns documents with `seq > cursor` in seq order. Device clocks are never used to order.
Idempotency: an op_id already in `applied_ops` is acked again without re-applying.
"""

from app.core.db import Database
from app.core.deps import CurrentShop
from app.core.errors import NotImplementedFeature
from app.schemas.sync import PullResponse, PushRequest, PushResponse


async def push(db: Database, shop: CurrentShop, body: PushRequest) -> PushResponse:
    # TODO(feature): 1) applied_ops.already_applied(op_ids) → ack those;
    # 2) validate each payload against its entity model (reject with a reason, never 500);
    # 3) counters.reserve(shop, n) → write each entity with its seq via its repository;
    # 4) applied_ops.record(applied op_ids) → return acked/rejected.
    raise NotImplementedFeature("POST /sync/push")


async def pull(db: Database, shop: CurrentShop, cursor: str | None, limit: int) -> PullResponse:
    # TODO(feature): after = int(cursor or 0); read up to `limit` docs with seq > after across
    # products/embeddings/sales (merge by seq); next_cursor = last seq; has_more if limit reached.
    raise NotImplementedFeature("GET /sync/pull")
