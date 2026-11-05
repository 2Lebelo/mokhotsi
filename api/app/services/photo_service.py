"""Product photos and correction crops (see core/cloudinary.py for the signing).

A phone asks for upload tickets in batches, uploads each image straight to Cloudinary, then
confirms the uploads; other phones of the shop ask for delivery URLs by content hash.
Everything is keyed by (shop, sha256), so a retried step is harmless.
"""

from datetime import timedelta

from app.core import cloudinary
from app.core.clock import utcnow
from app.core.config import Settings
from app.core.db import Database
from app.core.deps import DeviceShopAccess
from app.repositories import photos
from app.schemas.sync import (
    PhotoConfirmRequest,
    PhotoConfirmResponse,
    PhotoRejection,
    PhotoTicket,
    PhotoUploadsRequest,
    PhotoUploadsResponse,
    PhotoUrlsRequest,
    PhotoUrlsResponse,
)


async def tickets(
    db: Database, settings: Settings, access: DeviceShopAccess, body: PhotoUploadsRequest
) -> PhotoUploadsResponse:
    cloudinary.ensure_configured(settings)
    url = cloudinary.upload_url(settings)
    stored = await photos.find(db, access.shop_id, [item.sha256 for item in body.items])
    now = utcnow()
    expires_at = now + timedelta(seconds=cloudinary.TICKET_SECONDS)
    out = []
    for item in body.items:
        if item.sha256 in stored:
            out.append(PhotoTicket(sha256=item.sha256, existing=True))
        elif item.bytes > settings.photo_max_bytes:
            out.append(PhotoTicket(sha256=item.sha256, existing=False, problem="too_large"))
        else:
            out.append(
                PhotoTicket(
                    sha256=item.sha256,
                    existing=False,
                    upload_url=url,
                    fields=cloudinary.upload_fields(
                        settings, access.shop_id, item.sha256, now.timestamp()
                    ),
                    expires_at=expires_at,
                )
            )
    return PhotoUploadsResponse(tickets=out)


async def confirm(
    db: Database, settings: Settings, access: DeviceShopAccess, body: PhotoConfirmRequest
) -> PhotoConfirmResponse:
    cloudinary.ensure_configured(settings)
    confirmed: list[str] = []
    rejected: list[PhotoRejection] = []
    for item in body.items:
        expected = cloudinary.public_id(access.shop_id, item.sha256)
        if item.public_id != expected:
            rejected.append(
                PhotoRejection(
                    sha256=item.sha256, code="wrong_public_id", message=f"Expected {expected}"
                )
            )
            continue
        if not cloudinary.upload_is_genuine(settings, item.public_id, item.version, item.signature):
            rejected.append(
                PhotoRejection(
                    sha256=item.sha256,
                    code="bad_signature",
                    message="This is not Cloudinary's answer to the upload",
                )
            )
            continue
        await photos.save(
            db,
            {
                "shop_id": access.shop_id,
                "sha256": item.sha256,
                "kind": item.kind,
                "public_id": item.public_id,
                "version": item.version,
                "format": item.format,
                "bytes": item.bytes,
                "width": item.width,
                "height": item.height,
                "uploaded_by_device": access.device_id,
                "created_at": utcnow(),
            },
        )
        confirmed.append(item.sha256)
    return PhotoConfirmResponse(confirmed=confirmed, rejected=rejected)


async def urls(
    db: Database, settings: Settings, access: DeviceShopAccess, body: PhotoUrlsRequest
) -> PhotoUrlsResponse:
    cloudinary.ensure_configured(settings)
    stored = await photos.find(db, access.shop_id, body.sha256s)
    return PhotoUrlsResponse(
        urls={
            sha: (
                cloudinary.delivery_url(settings, doc["public_id"], doc["version"], doc["format"])
                if (doc := stored.get(sha))
                else None
            )
            for sha in body.sha256s
        }
    )
