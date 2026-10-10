from typing import Literal

from pydantic import BaseModel


class HealthResponse(BaseModel):
    # "degraded" (503) only when MongoDB is down: Redis failures fail open (see core/ratelimit.py).
    status: Literal["ok", "degraded"]
    mongo: Literal["ok", "unreachable"]
    redis: Literal["ok", "unreachable", "disabled"]
