"""Products with every size they ever had (sync v2). The last write to reach the server wins."""

from uuid import UUID

from pymongo import ASCENDING, IndexModel, ReplaceOne

from app.core.db import Database, Document, Session

COLLECTION = "products"
INDEXES = [
    IndexModel([("shop_id", ASCENDING), ("_id", ASCENDING)], name="shop_id_id"),
    # Sales, movements and stock levels refer to sizes, not products.
    IndexModel([("shop_id", ASCENDING), ("variants.id", ASCENDING)], name="shop_variant"),
]


async def replace_many(db: Database, docs: list[Document], session: Session | None = None) -> None:
    """Replace whole products (each doc carries its `shop_id`)."""
    if docs:
        await db[COLLECTION].bulk_write(
            [ReplaceOne({"_id": d["_id"], "shop_id": d["shop_id"]}, d, upsert=True) for d in docs],
            session=session,
        )


async def variant_products(
    db: Database, shop_id: UUID, variant_ids: list[UUID], session: Session | None = None
) -> dict[UUID, UUID]:
    """{variant_id: product_id} for the sizes this shop has."""
    if not variant_ids:
        return {}
    wanted = set(variant_ids)
    cursor = db[COLLECTION].find(
        {"shop_id": shop_id, "variants.id": {"$in": variant_ids}},
        projection={"variants.id": 1},
        session=session,
    )
    found: dict[UUID, UUID] = {}
    async for doc in cursor:
        for variant in doc["variants"]:
            if variant["id"] in wanted:
                found[variant["id"]] = doc["_id"]
    return found
