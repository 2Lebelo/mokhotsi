"""Keyset (cursor) pagination, allowlisted sorting and the list envelope.

Request:  ?sort=-created_at,name&limit=50&cursor=<opaque>
Response: {"data": [...], "page": {"next_cursor": "<opaque>" | null, "limit": 50}}

Keyset pagination stays fast at any depth (no skip) and is stable while rows are inserted.
`_id` is always appended as the final tiebreaker, so the order is total. The cursor encodes the
sort it was issued for; reusing it with a different sort is a 400.
"""

import base64
import binascii
from dataclasses import dataclass
from typing import Annotated, Any

from bson import json_util
from bson.binary import UuidRepresentation
from bson.json_util import CANONICAL_JSON_OPTIONS
from fastapi import Query
from pydantic import BaseModel
from pymongo import ASCENDING, DESCENDING

from app.core.db import Document
from app.core.errors import AppError

DEFAULT_LIMIT = 50
MAX_LIMIT = 100

_JSON_OPTIONS = CANONICAL_JSON_OPTIONS.with_options(
    uuid_representation=UuidRepresentation.STANDARD, tz_aware=True
)

SortSpec = list[tuple[str, int]]


class PageInfo(BaseModel):
    next_cursor: str | None
    limit: int


class Page[T](BaseModel):
    data: list[T]
    page: PageInfo


def make_page[T](data: list[T], next_cursor: str | None, limit: int) -> Page[T]:
    return Page[T](data=data, page=PageInfo(next_cursor=next_cursor, limit=limit))


class InvalidQuery(AppError):
    code = "invalid_query"


@dataclass(frozen=True, slots=True)
class PageParams:
    limit: int
    cursor: str | None
    sort: str | None


def page_params(
    limit: Annotated[int, Query(ge=1, le=MAX_LIMIT, description="Page size")] = DEFAULT_LIMIT,
    cursor: Annotated[
        str | None, Query(description="`page.next_cursor` from the last page")
    ] = None,
    sort: Annotated[
        str | None,
        Query(description="Comma-separated fields; prefix `-` for descending, e.g. `-created_at`"),
    ] = None,
) -> PageParams:
    return PageParams(limit=limit, cursor=cursor, sort=sort)


def parse_sort(sort: str | None, allowed: dict[str, str], default: str) -> tuple[str, SortSpec]:
    """Map public sort names to Mongo fields. Returns (normalised sort string, spec)."""
    raw = (sort or default).strip()
    spec: SortSpec = []
    names: list[str] = []
    seen: set[str] = set()
    for part in filter(None, (p.strip() for p in raw.split(","))):
        direction = DESCENDING if part.startswith("-") else ASCENDING
        name = part.lstrip("-+")
        if name not in allowed:
            raise InvalidQuery(
                f"Cannot sort by '{name}'", {"allowed": sorted(allowed)}, code="invalid_sort"
            )
        if name in seen:
            continue
        seen.add(name)
        names.append(("-" if direction == DESCENDING else "") + name)
        spec.append((allowed[name], direction))
    if not spec:
        raise InvalidQuery("Empty sort", code="invalid_sort")
    normalised = ",".join(names)
    if all(field != "_id" for field, _ in spec):
        spec.append(("_id", spec[-1][1]))
    return normalised, spec


def _encode_cursor(sort_key: str, values: list[Any]) -> str:
    raw = json_util.dumps({"s": sort_key, "v": values}, json_options=_JSON_OPTIONS)
    return base64.urlsafe_b64encode(raw.encode()).decode().rstrip("=")


def _decode_cursor(cursor: str, sort_key: str, size: int) -> list[Any]:
    try:
        padded = cursor + "=" * (-len(cursor) % 4)
        payload = json_util.loads(base64.urlsafe_b64decode(padded), json_options=_JSON_OPTIONS)
        values = payload["v"]
        if payload["s"] != sort_key or not isinstance(values, list) or len(values) != size:
            raise ValueError("cursor does not match this query")
    except (ValueError, KeyError, TypeError, binascii.Error) as exc:
        raise InvalidQuery("Invalid cursor for this query", code="invalid_cursor") from exc
    return values


def _after(spec: SortSpec, values: list[Any]) -> Document:
    """Documents strictly after `values` in `spec` order (an $or over the sort prefix)."""
    branches: list[Document] = []
    for i, (field, direction) in enumerate(spec):
        branch: Document = {spec[j][0]: values[j] for j in range(i)}
        branch[field] = {"$gt" if direction == ASCENDING else "$lt": values[i]}
        branches.append(branch)
    return {"$or": branches}


def _get_path(doc: Document, dotted: str) -> Any:
    value: Any = doc
    for part in dotted.split("."):
        value = value.get(part) if isinstance(value, dict) else None
    return value


@dataclass(frozen=True, slots=True)
class PageQuery:
    """A resolved list query: Mongo filter, sort and limit, plus how to build the next cursor."""

    filter: Document
    sort: SortSpec
    limit: int
    sort_key: str

    def finish(self, docs: list[Document]) -> tuple[list[Document], str | None]:
        """`docs` must be fetched with limit + 1; returns (page, next_cursor)."""
        if len(docs) <= self.limit:
            return docs, None
        page = docs[: self.limit]
        last = page[-1]
        return page, _encode_cursor(self.sort_key, [_get_path(last, f) for f, _ in self.sort])


def build_page_query(
    params: PageParams, base_filter: Document, allowed_sort: dict[str, str], default_sort: str
) -> PageQuery:
    sort_key, spec = parse_sort(params.sort, allowed_sort, default_sort)
    query_filter = dict(base_filter)
    if params.cursor:
        values = _decode_cursor(params.cursor, sort_key, len(spec))
        query_filter = (
            {"$and": [base_filter, _after(spec, values)]} if base_filter else _after(spec, values)
        )
    return PageQuery(filter=query_filter, sort=spec, limit=params.limit, sort_key=sort_key)
