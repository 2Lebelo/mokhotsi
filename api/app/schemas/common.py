"""Shared Pydantic building blocks."""

from typing import Annotated

from pydantic import BaseModel, ConfigDict, Field

# Money is integer cents. strict=True rejects "45.99", 45.99 and "4599".
Cents = Annotated[int, Field(ge=0, strict=True)]
Seq = Annotated[int, Field(ge=1, strict=True, description="Server-assigned per-shop sequence")]


class StrictModel(BaseModel):
    """Contract models reject unknown fields, like `additionalProperties: false` in the schema."""

    model_config = ConfigDict(extra="forbid")
