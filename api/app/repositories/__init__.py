"""Data access. Only modules in this package may touch MongoDB collections.

Conventions: `_id` is the client-generated UUID (BSON UUID, uuidRepresentation="standard");
every synced document carries `shop_id` and a server-assigned per-shop `seq`.
"""
