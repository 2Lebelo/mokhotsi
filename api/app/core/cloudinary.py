"""Cloudinary signing for product photos and correction crops (ADR 0005 amendment 2).

Phones upload straight to Cloudinary; the API never carries image bytes. The API's part:

1. Ticket: a signed set of upload fields, valid for TICKET_SECONDS. The signature fixes
   `public_id = shops/<shop_id>/<sha256>`, `type=authenticated` (private: delivered only through
   signed URLs), `overwrite=false` and the image formats, so a phone can only write images into
   its own shop's folder and never replace a stored one.
2. Confirm: Cloudinary's upload response carries a signature over `public_id` and `version`
   made with the account secret. Checking it here proves the upload really happened, with no
   call to Cloudinary's Admin API (which is rate limited).
3. Delivery: signed URLs (`/image/authenticated/s--<sig>--/v<version>/<public_id>.<format>`).
   They do not expire but cannot be guessed or altered (strict transformations).

Only the official SDK's signing helpers are used; nothing here makes a network call.
"""

import hmac
import time
from dataclasses import dataclass
from uuid import UUID

from cloudinary import utils

from app.core.config import Settings
from app.core.errors import ServiceUnavailable

UPLOAD_TYPE = "authenticated"
# Cloudinary refuses a signed upload whose timestamp is over an hour old; leave a margin.
TICKET_SECONDS = 55 * 60


@dataclass(frozen=True, slots=True)
class _Account:
    cloud_name: str
    api_key: str
    api_secret: str


def _account(settings: Settings) -> _Account:
    if not settings.cloudinary_configured:
        raise ServiceUnavailable(
            "Photo storage is not set up on the server.",
            code="photos_unavailable",
            headers={"Retry-After": "3600"},
        )
    assert settings.cloudinary_api_secret is not None  # noqa: S101 — checked just above
    return _Account(
        cloud_name=settings.cloudinary_cloud_name or "",
        api_key=settings.cloudinary_api_key or "",
        api_secret=settings.cloudinary_api_secret.get_secret_value(),
    )


def ensure_configured(settings: Settings) -> None:
    """503 `photos_unavailable` when the server has no Cloudinary account."""
    _account(settings)


def public_id(shop_id: UUID, sha256: str) -> str:
    return f"shops/{shop_id}/{sha256}"


def upload_url(settings: Settings) -> str:
    return f"https://api.cloudinary.com/v1_1/{_account(settings).cloud_name}/image/upload"


def upload_fields(settings: Settings, shop_id: UUID, sha256: str, now: float | None = None) -> dict:
    """Form fields for a signed upload (the phone adds `file`). Values are strings: they are
    signed exactly as sent, and Cloudinary rejects the upload if any of them is changed."""
    account = _account(settings)
    fields = {
        "public_id": public_id(shop_id, sha256),
        "type": UPLOAD_TYPE,
        "overwrite": "false",
        "allowed_formats": "jpg,png,webp",
        "timestamp": str(int(now if now is not None else time.time())),
    }
    fields["signature"] = utils.api_sign_request(fields, account.api_secret)
    return {**fields, "api_key": account.api_key}


def upload_is_genuine(settings: Settings, asset_id: str, version: int, signature: str) -> bool:
    """Whether `signature` is Cloudinary's own over this upload's `public_id` and `version`."""
    expected = utils.api_sign_request(
        {"public_id": asset_id, "version": version},
        _account(settings).api_secret,
        signature_version=1,
    )
    return hmac.compare_digest(expected, signature)


def delivery_url(settings: Settings, asset_id: str, version: int, image_format: str) -> str:
    account = _account(settings)
    url, _ = utils.cloudinary_url(
        asset_id,
        type=UPLOAD_TYPE,
        sign_url=True,
        secure=True,
        version=version,
        format=image_format,
        cloud_name=account.cloud_name,
        api_key=account.api_key,
        api_secret=account.api_secret,
    )
    return url
