"""The one place server time comes from (easy to reason about, easy to fake in tests)."""

from datetime import UTC, datetime


def utcnow() -> datetime:
    # Mongo stores milliseconds; truncate so values round-trip exactly (cursors compare them).
    now = datetime.now(UTC)
    return now.replace(microsecond=now.microsecond // 1000 * 1000)
