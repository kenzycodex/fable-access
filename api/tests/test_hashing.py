"""Passwords and PINs: Argon2id, a versioned pepper for PINs, upgrades without
lockouts, and the PIN attempt limit (which the pepper does not replace)."""
import hashlib
import os
import secrets
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
os.environ.setdefault("FABLE_SESSION_SECRET", "test-secret")


def _pbkdf2(password: str) -> str:
    salt = secrets.token_hex(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode(), salt.encode(), 200_000).hex()
    return f"pbkdf2_sha256$200000${salt}${digest}"


def test_new_passwords_are_argon2id_and_old_ones_still_verify():
    from core.utils import hash_password, needs_rehash, verify_password

    h = hash_password("correct horse")
    assert h.startswith("$argon2id$") and not needs_rehash(h)
    assert verify_password("correct horse", h) and not verify_password("wrong", h)

    old = _pbkdf2("correct horse")
    assert verify_password("correct horse", old) and needs_rehash(old)
    salt = "abc"
    legacy = f"{salt}:{hashlib.sha256(('correct horse' + salt).encode()).hexdigest()}"
    assert verify_password("correct horse", legacy) and needs_rehash(legacy)
    assert not verify_password("x", "garbage") and not verify_password("x", "")


def test_a_console_sign_in_upgrades_an_old_password_hash():
    from fastapi.testclient import TestClient

    from core.db import cursor
    from core.tenancy import register_institution
    from main import app

    register_institution("hashbank", "Hash Bank", "risk@hashbank.ng")
    with cursor() as cur:
        cur.execute("INSERT OR REPLACE INTO admins (email, institution_id, hashed_password, role, active) "
                    "VALUES ('old@hashbank.ng', 'hashbank', ?, 'owner', 1)", (_pbkdf2("old-password-1"),))
    r = TestClient(app).post("/auth/login", json={"email": "old@hashbank.ng", "password": "old-password-1"})
    assert r.status_code == 200, r.text
    with cursor() as cur:
        cur.execute("SELECT hashed_password FROM admins WHERE email = 'old@hashbank.ng'")
        assert cur.fetchone()[0].startswith("$argon2id$")


@pytest.fixture
def pepper(monkeypatch):
    from core import config

    monkeypatch.setattr(config, "PIN_PEPPER", "pepper-one")
    monkeypatch.setattr(config, "PIN_PEPPER_ID", "1")
    monkeypatch.setattr(config, "PIN_PEPPERS", {"0": "", "1": "pepper-one"})
    return config


def _stored(user_id: str) -> str:
    from core.db import cursor

    with cursor() as cur:
        cur.execute("SELECT pin_hash FROM user_security WHERE user_id = ?", (user_id,))
        return cur.fetchone()[0]


def test_a_pin_is_argon2id_over_a_peppered_hmac(pepper):
    from core import security
    from core.utils import verify_password

    security.set_pin("pin_user_1", "4821")
    stored = _stored("pin_user_1")
    assert stored.startswith("a2$1$$argon2id$")
    # Without the pepper, the hash is useless: the bare PIN does not verify.
    assert not verify_password("4821", stored.split("$", 2)[2])
    assert security.check_pin("pin_user_1", "4821") and not security.check_pin("pin_user_1", "0000")


def test_old_pbkdf2_pins_verify_and_are_upgraded(pepper):
    from core import security
    from core.db import cursor

    salt = secrets.token_hex(16)
    with cursor() as cur:
        cur.execute("INSERT OR REPLACE INTO user_security (user_id, pin_hash, pin_length, failed_attempts) VALUES (?, ?, 4, 0)",
                    ("pin_user_2", f"{salt}${security._hash_pin('1357', salt)}"))
    assert security.check_pin("pin_user_2", "1357")
    assert _stored("pin_user_2").startswith("a2$1$")


def test_a_rotated_pepper_keeps_old_pins_working_and_moves_them_on(pepper, monkeypatch):
    from core import security

    security.set_pin("pin_user_3", "2468")
    monkeypatch.setattr(pepper, "PIN_PEPPER", "pepper-two")
    monkeypatch.setattr(pepper, "PIN_PEPPER_ID", "2")
    monkeypatch.setattr(pepper, "PIN_PEPPERS", {"0": "", "1": "pepper-one", "2": "pepper-two"})
    assert security.check_pin("pin_user_3", "2468")
    assert _stored("pin_user_3").startswith("a2$2$")


def test_a_pin_whose_pepper_is_missing_cannot_be_verified(pepper, monkeypatch):
    from core import security

    security.set_pin("pin_user_4", "9753")
    monkeypatch.setattr(pepper, "PIN_PEPPERS", {"0": ""})
    assert not security._verify_hash({"user_id": "pin_user_4", "pin_hash": _stored("pin_user_4")}, "9753")


def test_wrong_pins_still_lock_the_account(pepper):
    from core import config, security

    security.set_pin("pin_user_5", "1122")
    for _ in range(config.PIN_MAX_ATTEMPTS - 1):
        assert security.check_pin("pin_user_5", "0000") is False
    with pytest.raises(security.SecurityError, match="Locked"):
        security.check_pin("pin_user_5", "0000")
    with pytest.raises(security.SecurityError, match="Try again"):
        security.check_pin("pin_user_5", "1122")  # even the right PIN waits out the lock
