"""Contract drift guard (the mobile side is checked by mobile/tests/store.test.mjs).

1. every example in contracts/examples validates against contracts/sync.v2.schema.json;
2. the same examples validate against the Pydantic models;
3. the Pydantic models have exactly the schema's fields, required fields and enums.
"""

import json
import typing
from pathlib import Path
from typing import Any

import pytest
from jsonschema import Draft202012Validator
from pydantic import ValidationError

from app.schemas import sync as contract

CONTRACTS = Path(__file__).resolve().parents[2] / "contracts"
SCHEMA: dict[str, Any] = json.loads((CONTRACTS / "sync.v2.schema.json").read_text(encoding="utf-8"))
DEFS: dict[str, Any] = SCHEMA["$defs"]
EXAMPLES = {
    "PushRequest": "push-request.json",
    "PushResponse": "push-response.json",
    "PullResponse": "pull-response.json",
    "SnapshotResponse": "snapshot-response.json",
}


def _example(filename: str) -> str:
    return (CONTRACTS / "examples" / filename).read_text(encoding="utf-8")


def _validator(def_name: str) -> Draft202012Validator:
    return Draft202012Validator(
        {**SCHEMA, "$ref": f"#/$defs/{def_name}"},
        format_checker=Draft202012Validator.FORMAT_CHECKER,
    )


@pytest.mark.parametrize(("def_name", "filename"), EXAMPLES.items())
def test_example_matches_json_schema(def_name: str, filename: str) -> None:
    errors = [e.message for e in _validator(def_name).iter_errors(json.loads(_example(filename)))]
    assert errors == []


@pytest.mark.parametrize(("def_name", "filename"), EXAMPLES.items())
def test_example_matches_pydantic_model(def_name: str, filename: str) -> None:
    contract.CONTRACT_MODELS[def_name].model_validate_json(_example(filename))


def test_every_example_payload_matches_its_model() -> None:
    for op in json.loads(_example("push-request.json"))["ops"]:
        model = contract.EmbeddingDelete if op["op"] == "delete" else None
        model = model or contract.PAYLOAD_MODELS[op["entity"]]
        model.model_validate(op["payload"])


def test_every_def_has_a_model() -> None:
    plain = {"Uuid", "Sha256", "Actor", "Timestamp", "Cents", "Quantity", "Seq", "Entity"}
    assert set(DEFS) - plain == set(contract.CONTRACT_MODELS)


@pytest.mark.parametrize("def_name", contract.CONTRACT_MODELS)
def test_model_fields_match_schema(def_name: str) -> None:
    model = contract.CONTRACT_MODELS[def_name]
    schema_def = DEFS[def_name]
    assert set(model.model_fields) == set(schema_def["properties"])
    required = {name for name, field in model.model_fields.items() if field.is_required()}
    assert required == set(schema_def["required"])


def _enum(def_name: str, field: str) -> list[Any]:
    return DEFS[def_name]["properties"][field]["enum"]


def test_enums_match_schema() -> None:
    assert list(typing.get_args(contract.Entity)) == DEFS["Entity"]["enum"]
    assert list(typing.get_args(contract.OpKind)) == _enum("Op", "op")
    assert list(typing.get_args(contract.MovementKind)) == _enum("StockMovement", "kind")
    assert list(typing.get_args(contract.EmbeddingSource)) == _enum("Embedding", "source")
    assert list(typing.get_args(contract.ChangeEntity)) == _enum("Change", "entity")
    assert list(typing.get_args(contract.SnapshotEntity)) == _enum("SnapshotResponse", "entity")


def test_push_batch_limit() -> None:
    assert DEFS["PushRequest"]["properties"]["ops"]["maxItems"] == contract.PUSH_MAX_OPS
    request = json.loads(_example("push-request.json"))
    request["ops"] = request["ops"][:1] * (contract.PUSH_MAX_OPS + 1)
    with pytest.raises(ValidationError):
        contract.PushRequest.model_validate(request)


def test_money_must_be_integer_cents() -> None:
    sale = json.loads(_example("push-request.json"))["ops"][2]["payload"]
    sale["total_cents"] = 91.98
    with pytest.raises(ValidationError):
        contract.Sale.model_validate(sale)
    assert list(_validator("Sale").iter_errors(sale))


def test_a_movement_must_change_the_stock() -> None:
    movement = json.loads(_example("push-request.json"))["ops"][1]["payload"]
    movement["delta"] = 0
    with pytest.raises(ValidationError):
        contract.StockMovement.model_validate(movement)
    assert list(_validator("StockMovement").iter_errors(movement))


def test_the_openapi_contract_is_current() -> None:
    """The app's API types are generated from contracts/openapi.json; it must match the code.

    Regenerate with `uv run python -m app.cli export-openapi`, then `npm run api:types` in mobile/.
    """
    from app.cli import OPENAPI_CONTRACT, render_openapi

    assert OPENAPI_CONTRACT.read_text(encoding="utf-8") == render_openapi(), (
        "contracts/openapi.json is stale: run `uv run python -m app.cli export-openapi`"
    )
