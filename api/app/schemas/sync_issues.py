"""What phones could not sync as asked, reported for the system admin."""

from datetime import datetime
from typing import Annotated, Literal
from uuid import UUID

from pydantic import AwareDatetime, BaseModel, Field, StringConstraints

from app.schemas.common import StrictModel

MAX_REPORTED = 100

SyncIssueKind = Literal["rejected", "flagged", "conflict"]
Short = Annotated[str, StringConstraints(max_length=64)]


class SyncIssueIn(StrictModel):
    id: UUID = Field(description="The phone's id for the issue: a report sent twice is kept once")
    kind: SyncIssueKind = Field(
        description=(
            "rejected: the server refused a change; flagged: it was kept but needs a look; "
            "conflict: a change from another phone did not fit this phone's data"
        )
    )
    entity: Short
    entity_id: Short
    op_id: UUID | None
    code: Short
    message: Annotated[str, StringConstraints(max_length=1000)]
    created_at: AwareDatetime


class SyncIssuesReport(StrictModel):
    issues: list[SyncIssueIn] = Field(min_length=1, max_length=MAX_REPORTED)


class SyncIssuesReported(BaseModel):
    accepted: list[UUID] = Field(description="Stored, or already stored: the phone may forget them")


class SyncIssueOut(BaseModel):
    id: UUID
    kind: SyncIssueKind
    entity: str
    entity_id: str
    op_id: UUID | None
    code: str
    message: str
    created_at: datetime = Field(description="When the phone noticed it")
    received_at: datetime
    resolved_at: datetime | None
    resolved_by: UUID | None
    shop_id: UUID
    shop_name: str | None
    owner_id: UUID | None
    owner_name: str | None
    owner_phone: str | None
    device_id: UUID
    device_name: str | None


class SyncIssueCount(BaseModel):
    open: int
