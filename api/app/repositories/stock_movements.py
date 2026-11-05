"""The stock ledger: every change to a size's stock, sent by a device (opening, restock,
adjustment) or derived on the server from sales and reversals. `stock_levels` holds the sums."""

from pymongo import ASCENDING, IndexModel

COLLECTION = "stock_movements"
INDEXES = [
    IndexModel(
        [("shop_id", ASCENDING), ("variant_id", ASCENDING), ("created_at", ASCENDING)],
        name="shop_variant_created_at",
    ),
]
