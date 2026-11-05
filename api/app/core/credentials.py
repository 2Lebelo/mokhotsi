"""Phone numbers and PINs: the sign-in identity of every user (ADR 0005).

Phone numbers are stored in E.164 (`+26658123456`) so one person can never be registered twice
under different spellings. A PIN is exactly PIN_LENGTH ASCII digits and must not be one of the
patterns people guess first. PINs are only ever stored as Argon2 hashes.
"""

import re
import secrets
from itertools import pairwise

PIN_LENGTH = 5

# Subscriber-number lengths for countries we check strictly; others get the generic E.164 rule.
_NATIONAL_LENGTHS = {"266": 8}  # Lesotho: +266 followed by 8 digits.
_SEPARATORS = re.compile(r"[\s\-().]")
_E164 = re.compile(r"^\+[1-9]\d{7,14}$", re.ASCII)


def normalize_phone(raw: str, default_country_code: str) -> str:
    """Return the number in E.164 form, or raise ValueError with a message for the user.

    Accepts `+266 5812 3456`, `00266 58123456`, or a local number (`58123456`), which gets
    `default_country_code`.
    """
    digits = _SEPARATORS.sub("", raw.strip())
    if digits.startswith("00"):
        digits = "+" + digits[2:]
    if not digits.startswith("+"):
        if not digits.isascii() or not digits.isdigit():
            raise ValueError("Enter the phone number using digits only.")
        digits = f"+{default_country_code}{digits.lstrip('0')}"
    if not _E164.fullmatch(digits):
        raise ValueError("Enter a valid phone number, e.g. +266 5812 3456.")
    for code, length in _NATIONAL_LENGTHS.items():
        if digits.startswith(f"+{code}") and len(digits) != 1 + len(code) + length:
            raise ValueError(f"A +{code} number has {length} digits after the country code.")
    return digits


def check_pin(pin: str) -> None:
    """Raise ValueError (with a message for the user) unless `pin` is an acceptable new PIN."""
    if len(pin) != PIN_LENGTH or not pin.isascii() or not pin.isdigit():
        raise ValueError(f"The PIN must be exactly {PIN_LENGTH} digits.")
    steps = {int(b) - int(a) for a, b in pairwise(pin)}
    if len(set(pin)) == 1 or steps in ({1}, {-1}):
        raise ValueError("Choose a PIN that is harder to guess than repeated or counting digits.")
    if len(set(pin[0::2])) == 1 and len(set(pin[1::2])) == 1:
        raise ValueError("Choose a PIN that is harder to guess than a repeating pair of digits.")


def random_pin() -> str:
    """A temporary PIN that passes check_pin (given out by an admin or owner reset)."""
    while True:
        pin = "".join(secrets.choice("0123456789") for _ in range(PIN_LENGTH))
        try:
            check_pin(pin)
        except ValueError:
            continue
        return pin
