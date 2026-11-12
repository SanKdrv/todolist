"""Cryptographic primitives for sessions and CSRF protection."""

import secrets

CSRF_TOKEN_BYTES = 32


def generate_csrf_token() -> str:
    """Return a URL-safe random CSRF token (43 chars for 32 bytes)."""
    return secrets.token_urlsafe(CSRF_TOKEN_BYTES)


def verify_csrf_token(expected: str, provided: str | None) -> bool:
    """Compare tokens in constant time; a missing header never matches."""
    if not provided:
        return False
    return secrets.compare_digest(expected, provided)
