"""Phone normalisation, PIN rules and PIN hashing (pure; no database)."""

import asyncio

import pytest
from pwdlib import PasswordHash
from pwdlib.hashers.argon2 import Argon2Hasher

from app.core.credentials import check_pin, normalize_phone
from app.core.security import verify_pin, verify_pin_and_update

# 58123456 in Arabic-Indic digits, which str.isdigit() and a plain \d accept.
ARABIC_DIGITS = "٥٨١٢٣٤٥٦"


@pytest.mark.parametrize(
    "raw",
    ["+266 5812 3456", "+266-5812-3456", "00266 58123456", "58123456", " (+266) 5812.3456 "],
)
def test_lesotho_numbers_in_any_common_spelling_become_e164(raw: str) -> None:
    assert normalize_phone(raw, "266") == "+26658123456"


def test_other_countries_keep_their_code() -> None:
    assert normalize_phone("+27 82 123 4567", "266") == "+27821234567"
    assert normalize_phone("0821234567", "27") == "+27821234567"


@pytest.mark.parametrize(
    ("raw", "message"),
    [
        ("+266 5812 345", "8 digits after the country code"),
        ("+266 5812 34567", "8 digits after the country code"),
        ("5812-ABCD", "digits only"),
        ("+0123456789", "valid phone number"),
        ("+12", "valid phone number"),
        # Arabic-Indic digits are refused, not silently accepted.
        (ARABIC_DIGITS, "digits only"),
        ("+266" + ARABIC_DIGITS, "valid phone number"),
    ],
)
def test_invalid_numbers_are_refused_with_a_reason(raw: str, message: str) -> None:
    with pytest.raises(ValueError, match=message):
        normalize_phone(raw, "266")


@pytest.mark.parametrize("pin", ["48613", "90210", "13579", "02468", "11112", "73019"])
def test_acceptable_pins(pin: str) -> None:
    check_pin(pin)


@pytest.mark.parametrize(
    ("pin", "message"),
    [
        ("1234", "exactly 5 digits"),
        ("123456", "exactly 5 digits"),
        ("12a45", "exactly 5 digits"),
        (ARABIC_DIGITS[:5], "exactly 5 digits"),
        ("00000", "repeated or counting"),
        ("77777", "repeated or counting"),
        ("12345", "repeated or counting"),
        ("01234", "repeated or counting"),
        ("56789", "repeated or counting"),
        ("54321", "repeated or counting"),
        ("98765", "repeated or counting"),
        ("12121", "repeating pair"),
        ("90909", "repeating pair"),
    ],
)
def test_easy_pins_are_refused(pin: str, message: str) -> None:
    with pytest.raises(ValueError, match=message) as excinfo:
        check_pin(pin)
    assert pin not in str(excinfo.value), "a PIN must never appear in an error message"


def test_pins_hashed_with_old_parameters_verify_and_are_upgraded() -> None:
    old = PasswordHash((Argon2Hasher(),)).hash("58231")  # argon2-cffi defaults: 64 MiB, t=3.
    assert asyncio.run(verify_pin("58231", old))
    ok, upgraded = asyncio.run(verify_pin_and_update("58231", old))
    assert ok and upgraded is not None
    assert "m=19456,t=2,p=1" in upgraded
    assert asyncio.run(verify_pin_and_update("58231", upgraded)) == (True, None)
    assert asyncio.run(verify_pin_and_update("00000", old)) == (False, None)
