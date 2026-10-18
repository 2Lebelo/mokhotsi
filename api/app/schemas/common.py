"""Shared Pydantic building blocks."""

from typing import Annotated

from pydantic import BaseModel, ConfigDict, EmailStr, Field, StringConstraints

# Money is integer cents. strict=True rejects "45.99", 45.99 and "4599".
Cents = Annotated[int, Field(ge=0, strict=True)]
Seq = Annotated[int, Field(ge=1, strict=True, description="Server-assigned per-shop sequence")]

Name = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=120)]
Email = Annotated[EmailStr, Field(max_length=254)]
# New passwords. Login accepts any non-empty string so policy changes never lock people out.
Password = Annotated[str, Field(min_length=8, max_length=128)]


class StrictModel(BaseModel):
    """Request and contract models reject unknown fields (`additionalProperties: false`)."""

    model_config = ConfigDict(extra="forbid")
