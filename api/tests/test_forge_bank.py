"""The Xtradot Bank client: the key stays out of errors, charges come from the
bank, and a transfer is never sent twice, whatever goes wrong."""
import socket

import pytest

from services import forge_bank
from services.forge_bank import BankError, OutcomeUnknown, Reply

KEY = "test-team-key-do-not-use"


@pytest.fixture(autouse=True)
def _env(monkeypatch):
    monkeypatch.setenv("GATEWAY_KEY", KEY)
    monkeypatch.setattr(forge_bank.time, "sleep", lambda _s: None)


class Wire:
    """Stands in for the network: records every call, answers from a script."""

    def __init__(self, *replies):
        self.replies = list(replies)
        self.calls = []

    def __call__(self, method, url, payload, headers, timeout):
        self.calls.append({"method": method, "url": url, "payload": payload, "headers": headers})
        reply = self.replies.pop(0)
        if isinstance(reply, Exception):
            raise reply
        return reply


def ok(data, status=200):
    return Reply(status, {"status": "success", "data": data, "request_id": "req_1"})


def err(status, code, message="x", field=None):
    e = {"code": code, "message": message}
    if field:
        e["field"] = field
    return Reply(status, {"status": "error", "error": e, "request_id": "req_2"})


TRANSFER = dict(source_account="0123456790", destination_account="0123987001", name_enquiry_ref="ne_1",
                amount=75000, narration="Generator repairs", reference="TRF-0002",
                destination_bank_code="000013")


def test_every_call_carries_the_team_key_and_a_request_id(monkeypatch):
    wire = Wire(ok({"fee": 25}))
    monkeypatch.setattr(forge_bank, "_send", wire)
    forge_bank.tariff()
    assert wire.calls[0]["headers"]["x-api-key"] == KEY
    assert wire.calls[0]["headers"]["x-request-id"].startswith("fable_")


def test_a_missing_key_is_reported_without_calling_the_bank(monkeypatch):
    monkeypatch.delenv("GATEWAY_KEY")
    wire = Wire()
    monkeypatch.setattr(forge_bank, "_send", wire)
    with pytest.raises(BankError) as exc:
        forge_bank.tariff()
    assert exc.value.code == "NOT_CONFIGURED" and wire.calls == []


def test_the_key_never_appears_in_an_error(monkeypatch):
    monkeypatch.setattr(forge_bank, "_send", Wire(err(401, "UNAUTHORIZED", "bad key")))
    with pytest.raises(BankError) as exc:
        forge_bank.tariff()
    assert KEY not in str(exc.value) and KEY not in repr(exc.value.__dict__)


def test_interbank_name_enquiry_sends_bank_and_account(monkeypatch):
    wire = Wire(ok({"account_name": "Chukwuemeka Ifeanyi Nwosu", "name_enquiry_ref": "ne_1"}))
    monkeypatch.setattr(forge_bank, "_send", wire)
    out = forge_bank.name_enquiry("0123987001", "000013")
    assert out["account_name"] == "Chukwuemeka Ifeanyi Nwosu"
    assert wire.calls[0]["url"].endswith("/transfers/interbank/name-enquiry")
    assert wire.calls[0]["payload"] == {"destination_bank_code": "000013", "account_number": "0123987001"}


def test_a_dormant_beneficiary_surfaces_its_code(monkeypatch):
    monkeypatch.setattr(forge_bank, "_send", Wire(err(422, "ACCOUNT_DORMANT", "dormant")))
    with pytest.raises(BankError) as exc:
        forge_bank.name_enquiry("0987654399", intra=True)
    assert exc.value.code == "ACCOUNT_DORMANT" and exc.value.status == 422


def test_a_transfer_returns_the_banks_charges_untouched(monkeypatch):
    sent = {"status": "successful", "fee": 50.0, "vat": 3.75, "stamp_duty": 50.0, "total_debit": 75103.75}
    wire = Wire(ok(sent, 201))
    monkeypatch.setattr(forge_bank, "_send", wire)
    out = forge_bank.send_transfer(**TRANSFER)
    assert out == sent
    assert wire.calls[0]["url"].endswith("/transfers/interbank")
    assert wire.calls[0]["payload"]["destination_bank_code"] == "000013"


def test_the_idempotency_key_follows_the_reference(monkeypatch):
    first, second = Wire(ok({"status": "pending"}, 202)), Wire(ok({"status": "pending"}, 202))
    monkeypatch.setattr(forge_bank, "_send", first)
    forge_bank.send_transfer(**TRANSFER)
    monkeypatch.setattr(forge_bank, "_send", second)
    forge_bank.send_transfer(**TRANSFER)
    assert first.calls[0]["headers"]["Idempotency-Key"] == second.calls[0]["headers"]["Idempotency-Key"]


def test_a_socket_timeout_is_unknown_and_is_sent_exactly_once(monkeypatch):
    wire = Wire(socket.timeout("timed out"))
    monkeypatch.setattr(forge_bank, "_send", wire)
    with pytest.raises(OutcomeUnknown) as exc:
        forge_bank.send_transfer(**TRANSFER)
    assert exc.value.reference == "TRF-0002"
    assert len(wire.calls) == 1


def test_a_504_timeout_from_the_bank_is_unknown_and_is_sent_exactly_once(monkeypatch):
    wire = Wire(err(504, "TIMEOUT", "no answer"))
    monkeypatch.setattr(forge_bank, "_send", wire)
    with pytest.raises(OutcomeUnknown):
        forge_bank.send_transfer(**TRANSFER)
    assert len(wire.calls) == 1


def test_a_refused_transfer_is_not_retried(monkeypatch):
    wire = Wire(err(402, "INSUFFICIENT_FUNDS", "low"))
    monkeypatch.setattr(forge_bank, "_send", wire)
    with pytest.raises(BankError) as exc:
        forge_bank.send_transfer(**TRANSFER)
    assert exc.value.code == "INSUFFICIENT_FUNDS" and len(wire.calls) == 1


def test_recovery_after_a_timeout_only_queries_and_never_posts_a_transfer(monkeypatch):
    wire = Wire(socket.timeout("timed out"),
                ok({"status": "pending"}), ok({"status": "pending"}),
                ok({"status": "successful", "total_debit": 75103.75}))
    monkeypatch.setattr(forge_bank, "_send", wire)
    with pytest.raises(OutcomeUnknown) as exc:
        forge_bank.send_transfer(**TRANSFER)
    final = forge_bank.settle(exc.value.reference)
    assert final["status"] == "successful"
    transfer_posts = [c for c in wire.calls if c["url"].endswith("/transfers/interbank")]
    assert len(transfer_posts) == 1
    assert [c["url"].rsplit("/", 1)[-1] for c in wire.calls[1:]] == ["requery"] * 3


def test_settle_stops_polling_after_its_attempts_and_reports_pending(monkeypatch):
    wire = Wire(*[ok({"status": "pending"}) for _ in range(3)])
    monkeypatch.setattr(forge_bank, "_send", wire)
    assert forge_bank.settle("TRF-1", attempts=3)["status"] == "pending"
    assert len(wire.calls) == 3


def test_a_late_reversal_is_a_final_state(monkeypatch):
    monkeypatch.setattr(forge_bank, "_send", Wire(ok({"status": "reversed"})))
    assert forge_bank.settle("TRF-1")["status"] == "reversed"


def test_reads_wait_and_retry_on_a_rate_limit_but_do_not_give_up_early(monkeypatch):
    wire = Wire(err(429, "RATE_LIMITED"), err(429, "RATE_LIMITED"), ok({"fee": 25}))
    monkeypatch.setattr(forge_bank, "_send", wire)
    assert forge_bank.tariff() == {"fee": 25}
    assert len(wire.calls) == 3


def test_an_interbank_transfer_needs_a_bank_code(monkeypatch):
    wire = Wire()
    monkeypatch.setattr(forge_bank, "_send", wire)
    args = {k: v for k, v in TRANSFER.items() if k != "destination_bank_code"}
    with pytest.raises(BankError) as exc:
        forge_bank.send_transfer(**args)
    assert exc.value.field == "destination_bank_code" and wire.calls == []
