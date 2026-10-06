"""Contract drift guard (mirrors mobile/__tests__/contracts.test.ts).

1. every example in contracts/examples validates against contracts/sync.schema.json;
2. the same examples validate against the Pydantic models;
3. the Pydantic models have exactly the schema's fields, required fields, enums and limits.
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
SCHEMA: dict[str, Any] = json.loads((CONTRACTS / "sync.schema.json").read_text(encoding="utf-8"))
DEFS: dict[str, Any] = SCHEMA["$defs"]
EXAMPLES = {
    "PushRequest": "push-request.json",
    "PushResponse": "push-response.json",
    "PullResponse": "pull-response.json",
}


def _example(filename: str) -> str:
    return (CONTRACTS / "examples" / filename).read_text(encoding="utf-8")


@pytest.mark.parametrize(("def_name", "filename"), EXAMPLES.items())
def test_example_matches_json_schema(def_name: str, filename: str) -> None:
    validator = Draft202012Validator(
        {**SCHEMA, "$ref": f"#/$defs/{def_name}"},
        format_checker=Draft202012Validator.FORMAT_CHECKER,
    )
    errors = [e.message for e in validator.iter_errors(json.loads(_example(filename)))]
    assert errors == []


@pytest.mark.parametrize(("def_name", "filename"), EXAMPLES.items())
def test_example_matches_pydantic_model(def_name: str, filename: str) -> None:
    contract.CONTRACT_MODELS[def_name].model_validate_json(_example(filename))


@pytest.mark.parametrize("def_name", contract.CONTRACT_MODELS)
def test_model_fields_match_schema(def_name: str) -> None:
    model = contract.CONTRACT_MODELS[def_name]
    schema_def = DEFS[def_name]
    assert set(model.model_fields) == set(schema_def["properties"])
    required = {name for name, field in model.model_fields.items() if field.is_required()}
    assert required == set(schema_def["required"])


def test_enums_match_schema() -> None:
    assert list(typing.get_args(contract.Entity)) == DEFS["Entity"]["enum"]
    assert list(typing.get_args(contract.OpKind)) == DEFS["OpKind"]["enum"]
    assert list(typing.get_args(contract.MatchMethod)) == DEFS["MatchMethod"]["enum"]


def test_push_batch_limit() -> None:
    assert DEFS["PushRequest"]["properties"]["ops"]["maxItems"] == contract.PUSH_MAX_OPS
    request = json.loads(_example("push-request.json"))
    request["ops"] = request["ops"][:1] * (contract.PUSH_MAX_OPS + 1)
    with pytest.raises(ValidationError):
        contract.PushRequest.model_validate(request)


def test_money_must_be_integer_cents() -> None:
    pull = json.loads(_example("pull-response.json"))
    pull["changes"]["products"][0]["price_cents"] = 45.99
    with pytest.raises(ValidationError):
        contract.PullResponse.model_validate(pull)
