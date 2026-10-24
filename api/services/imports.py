"""Bringing a bank's customers and past transfers into Fable.

A bank that joins already has years of history. Without it every customer
starts cold, and the first weeks flag ordinary transfers as unusual. This
module validates and applies that data, from a CSV upload in the console or a
JSON batch from the bank's own servers. Both paths share one validator, so a
row means the same thing whichever way it arrives.

Imports are idempotent: a customer or transfer whose reference the bank has
already sent is reported as skipped and never counted twice. Imported
transfers go to transaction_history, not transactions. They were never scored,
raise no alerts or webhooks, and do not count as Shield decisions; they only
teach each customer's baseline.

Only what scoring uses is kept. Narrations are not imported at all.
"""
from __future__ import annotations

import csv
import io
import logging
import re
import secrets
import threading
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone

from core import customers
from core.db import cursor, dumps, loads, row_to_dict
from core.utils import utcnow

logger = logging.getLogger("fable.imports")

KINDS = ("customers", "transactions")
MAX_ROWS_PER_FILE = 50_000
MAX_ROWS_PER_BATCH = 1_000
MAX_FILE_BYTES = 10 * 1024 * 1024
MAX_ERRORS_KEPT = 200
APPLY_BATCH = 500
OLDEST_HISTORY_DAYS = 3 * 365
MAX_AMOUNT = 1_000_000_000
MAX_OPENING_BALANCE = 50_000_000

CHANNELS = ("mobile_app", "ussd", "pos", "internet", "atm", "qr", "branch", "unknown")
OUTCOMES = ("completed", "reversed", "fraud")
LAGOS = timezone(timedelta(hours=1))

CUSTOMER_COLUMNS = ("reference", "name", "phone", "email", "segment", "kind", "opening_balance")
TRANSACTION_COLUMNS = (
    "customer_reference", "reference", "amount", "occurred_at", "recipient_account",
    "recipient_bank", "recipient_name", "channel", "outcome", "device_id", "city", "country",
)
REQUIRED = {
    "customers": ("reference",),
    "transactions": ("customer_reference", "reference", "amount", "occurred_at", "recipient_account"),
}
TEMPLATES = {
    "customers": (
        CUSTOMER_COLUMNS,
        [("CIF-000123", "Ada Obi", "+2348030000000", "ada@example.com", "Salaried", "real", ""),
         ("TEST-001", "Test Customer", "", "", "", "test", "250000")],
    ),
    "transactions": (
        TRANSACTION_COLUMNS,
        [("CIF-000123", "TRF-2026-0001", "45000", "2026-08-14T09:32:00+01:00", "0123456789",
          "058", "MUSA ADEOLA", "mobile_app", "completed", "", "Lagos", "Nigeria")],
    ),
}

PHONE = re.compile(r"^\+?[0-9]{7,16}$")
EMAIL = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
ACCOUNT = re.compile(r"^[A-Za-z0-9]{6,20}$")
TXN_REF = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_.:/\-]{0,79}$")

_pool = ThreadPoolExecutor(max_workers=2, thread_name_prefix="import")
_lock = threading.Lock()


class ImportError_(ValueError):
    """An import request that cannot be accepted at all (not a row error)."""


# ── Validation ───────────────────────────────────────────────────────────────

def _text(value, limit: int) -> str | None:
    if value is None:
        return None
    text = "".join(ch for ch in str(value) if ch.isprintable()).strip()
    return text[:limit] or None


def _number(value) -> float | None:
    if value is None or str(value).strip() == "":
        return None
    try:
        return float(str(value).replace(",", "").replace("₦", "").strip())
    except ValueError:
        return None


def _when(value) -> tuple[str, int] | None:
    """(UTC timestamp as stored, the customer's local hour) from ISO 8601.

    A timestamp with an offset is the customer's local time; one in UTC (or with
    no offset at all) is read as Lagos time, where the bank is."""
    raw = str(value or "").strip()
    if not raw:
        return None
    try:
        parsed = datetime.fromisoformat(raw.replace("Z", "+00:00"))
    except ValueError:
        return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=LAGOS)
    local = parsed if parsed.utcoffset() not in (None, timedelta(0)) else parsed.astimezone(LAGOS)
    utc = parsed.astimezone(timezone.utc).replace(tzinfo=None)
    return utc.isoformat(), local.hour


def validate_customer(row: dict, *, sandbox: bool) -> tuple[dict | None, list[tuple[str, str]]]:
    errors: list[tuple[str, str]] = []
    ref = _text(row.get("reference"), 64)
    if not ref:
        errors.append(("reference", "Required."))
    elif not customers.valid_ref(ref):
        errors.append(("reference", "Use 1-64 letters, digits, or . _ : - characters."))
    phone = _text(row.get("phone"), 32)
    if phone and not PHONE.match(phone.replace(" ", "")):
        errors.append(("phone", "Not a phone number."))
    email = _text(row.get("email"), 254)
    if email and not EMAIL.match(email):
        errors.append(("email", "Not an email address."))
    kind = (_text(row.get("kind"), 10) or "real").lower()
    if kind not in customers.KINDS:
        errors.append(("kind", "Must be test or real."))
    opening = _number(row.get("opening_balance"))
    if row.get("opening_balance") not in (None, "") and opening is None:
        errors.append(("opening_balance", "Not a number."))
    elif opening:
        if opening < 0 or opening > MAX_OPENING_BALANCE:
            errors.append(("opening_balance", f"Must be between 0 and {MAX_OPENING_BALANCE:,}."))
        elif kind != "test" or not sandbox:
            errors.append(("opening_balance", "Only test customers in the sandbox have a balance in Fable."))
    if errors:
        return None, errors
    return {
        "reference": ref,
        "name": _text(row.get("name"), 120),
        "phone": phone.replace(" ", "") if phone else None,
        "email": email.lower() if email else None,
        "segment": _text(row.get("segment"), 60),
        "kind": kind,
        "opening_balance": opening or 0,
    }, []


def validate_transaction(row: dict) -> tuple[dict | None, list[tuple[str, str]]]:
    errors: list[tuple[str, str]] = []
    cust = _text(row.get("customer_reference"), 64)
    if not cust:
        errors.append(("customer_reference", "Required."))
    ref = _text(row.get("reference"), 80)
    if not ref:
        errors.append(("reference", "Required."))
    elif not TXN_REF.match(ref):
        errors.append(("reference", "Use letters, digits, or . _ : / - characters."))
    amount = _number(row.get("amount"))
    if amount is None:
        errors.append(("amount", "Required, as a number."))
    elif not 0 < amount <= MAX_AMOUNT:
        errors.append(("amount", f"Must be above 0 and at most {MAX_AMOUNT:,}."))
    when = _when(row.get("occurred_at"))
    if not when:
        errors.append(("occurred_at", "Required, as an ISO 8601 date and time."))
    else:
        stamp = datetime.fromisoformat(when[0])
        now = utcnow()
        if stamp > now + timedelta(minutes=5):
            errors.append(("occurred_at", "Is in the future."))
        elif stamp < now - timedelta(days=OLDEST_HISTORY_DAYS):
            errors.append(("occurred_at", "Is more than three years ago."))
    account = _text(row.get("recipient_account"), 20)
    if not account:
        errors.append(("recipient_account", "Required."))
    elif not ACCOUNT.match(account):
        errors.append(("recipient_account", "Use 6-20 letters or digits."))
    channel = (_text(row.get("channel"), 20) or "mobile_app").lower()
    if channel not in CHANNELS:
        errors.append(("channel", f"Must be one of {', '.join(CHANNELS)}."))
    outcome = (_text(row.get("outcome"), 20) or "completed").lower()
    if outcome not in OUTCOMES:
        errors.append(("outcome", f"Must be one of {', '.join(OUTCOMES)}."))
    if errors:
        return None, errors
    return {
        "customer_reference": cust,
        "reference": ref,
        "amount": round(amount, 2),
        "created_at": when[0],
        "hour_of_day": when[1],
        "recipient_account": account,
        "recipient_bank": _text(row.get("recipient_bank"), 80),
        "recipient_name": _text(row.get("recipient_name"), 120),
        "channel": channel,
        "outcome": outcome,
        "device_fingerprint": _text(row.get("device_id"), 128),
        "city": _text(row.get("city"), 80),
        "country": _text(row.get("country"), 60),
    }, []


def validate(kind: str, rows: list[dict], *, sandbox: bool) -> tuple[list[tuple[int, dict]], list[dict]]:
    """Valid rows with their line numbers, and errors as {line, field, message}.

    Line numbers count the header as line 1, as a spreadsheet shows them. A
    reference that appears twice in one upload is an error on the second line.
    """
    valid: list[tuple[int, dict]] = []
    errors: list[dict] = []
    seen: set[str] = set()
    for i, row in enumerate(rows):
        line = i + 2
        clean = {str(k).strip().lower(): v for k, v in (row or {}).items() if k is not None}
        data, problems = (
            validate_customer(clean, sandbox=sandbox) if kind == "customers" else validate_transaction(clean)
        )
        if data and data["reference"] in seen:
            problems, data = [("reference", "Appears earlier in this file.")], None
        if problems:
            errors += [{"line": line, "field": f, "message": m} for f, m in problems]
            continue
        seen.add(data["reference"])
        valid.append((line, data))
    return valid, errors


def parse_csv(raw: bytes, kind: str) -> list[dict]:
    if len(raw) > MAX_FILE_BYTES:
        raise ImportError_(f"The file is larger than {MAX_FILE_BYTES // (1024 * 1024)} MB. Split it and upload the parts.")
    try:
        text = raw.decode("utf-8-sig")
    except UnicodeDecodeError as exc:
        raise ImportError_("Save the file as UTF-8 CSV and upload it again.") from exc
    reader = csv.DictReader(io.StringIO(text))
    header = {(h or "").strip().lower() for h in (reader.fieldnames or [])}
    missing = [c for c in REQUIRED[kind] if c not in header]
    if missing:
        raise ImportError_(f"Missing column{'s' if len(missing) > 1 else ''}: {', '.join(missing)}. Start from the template.")
    rows = []
    for row in reader:
        rows.append(row)
        if len(rows) > MAX_ROWS_PER_FILE:
            raise ImportError_(f"More than {MAX_ROWS_PER_FILE:,} rows. Split the file and upload the parts.")
    if not rows:
        raise ImportError_("The file has a header but no rows.")
    return rows


def template_csv(kind: str) -> str:
    columns, examples = TEMPLATES[kind]
    out = io.StringIO()
    writer = csv.writer(out)
    writer.writerow(columns)
    writer.writerows(examples)
    return out.getvalue()


# ── Applying ─────────────────────────────────────────────────────────────────

def _apply_customers(institution_id: str, rows: list[dict], source: str) -> tuple[int, int, list[dict]]:
    from services import accounts as ledger

    inserted = skipped = 0
    errors: list[dict] = []
    for row in rows:
        if customers.get(institution_id, row["reference"]):
            skipped += 1
            continue
        try:
            created = customers.create(
                institution_id, row["reference"], kind=row["kind"], source=source,
                display_name=row["name"], phone=row["phone"], email=row["email"], segment=row["segment"],
            )
        except customers.CustomerError as exc:
            errors.append({"line": row.get("_line"), "field": "reference", "message": str(exc)})
            continue
        if row["kind"] == "test" and row["opening_balance"]:
            ledger.ensure_account(created["id"], institution_id, opening_balance=row["opening_balance"])
        inserted += 1
    return inserted, skipped, errors


def _apply_transactions(institution_id: str, rows: list[dict], job_id: str | None) -> tuple[int, int, list[dict]]:
    inserted = skipped = 0
    errors: list[dict] = []
    owners: dict[str, str | None] = {}
    with cursor() as cur:
        for row in rows:
            ref = row["customer_reference"]
            if ref not in owners:
                found = customers.get(institution_id, ref)
                owners[ref] = found["id"] if found else None
            user_id = owners[ref]
            if not user_id:
                errors.append({"line": row.get("_line"), "field": "customer_reference",
                               "message": "No customer with this reference. Import customers first."})
                continue
            cur.execute(
                """INSERT OR IGNORE INTO transaction_history
                       (id, institution_id, user_id, reference, amount, recipient_account, recipient_bank,
                        recipient_name, channel, device_fingerprint, city, country, hour_of_day, outcome,
                        confirmed_legitimate, import_job_id, created_at)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                (f"hist_{secrets.token_hex(8)}", institution_id, user_id, row["reference"], row["amount"],
                 row["recipient_account"], row["recipient_bank"], row["recipient_name"], row["channel"],
                 row["device_fingerprint"], row["city"], row["country"], row["hour_of_day"], row["outcome"],
                 1 if row["outcome"] == "completed" else 0, job_id, row["created_at"]),
            )
            if cur.rowcount:
                inserted += 1
            else:
                skipped += 1
    return inserted, skipped, errors


def apply_rows(institution_id: str, kind: str, rows: list[dict], *, source: str, job_id: str | None = None):
    """Apply validated rows. Returns (inserted, skipped, errors)."""
    if kind == "customers":
        return _apply_customers(institution_id, rows, source)
    return _apply_transactions(institution_id, rows, job_id)


def import_batch(institution_id: str, kind: str, rows: list[dict], *, sandbox: bool, actor: str) -> dict:
    """The JSON API path: validate and apply in one call."""
    if kind not in KINDS:
        raise ImportError_("Unknown import kind.")
    if not rows:
        raise ImportError_("No rows.")
    if len(rows) > MAX_ROWS_PER_BATCH:
        raise ImportError_(f"Send at most {MAX_ROWS_PER_BATCH:,} rows per request.")
    valid, errors = validate(kind, rows, sandbox=sandbox)
    for line, data in valid:
        data["_line"] = line
    inserted, skipped, apply_errors = apply_rows(institution_id, kind, [d for _, d in valid], source="api")
    errors += apply_errors
    _audit(institution_id, kind, inserted, skipped, len(errors), actor, via="api")
    return {"kind": kind, "received": len(rows), "inserted": inserted, "skipped": skipped,
            "errors": errors[:MAX_ERRORS_KEPT], "error_count": len(errors)}


# ── Jobs (the console's CSV path) ────────────────────────────────────────────

def create_job(institution_id: str, kind: str, filename: str, raw: bytes, *, sandbox: bool, actor: str) -> dict:
    """Validate an uploaded CSV and stage its valid rows. Nothing is applied yet."""
    if kind not in KINDS:
        raise ImportError_("Unknown import kind.")
    rows = parse_csv(raw, kind)
    valid, errors = validate(kind, rows, sandbox=sandbox)
    job_id = f"imp_{secrets.token_hex(8)}"
    with cursor() as cur:
        cur.execute(
            """INSERT INTO import_jobs (id, institution_id, kind, filename, status, total, valid, invalid,
                                        errors, created_by)
               VALUES (?, ?, ?, ?, 'validated', ?, ?, ?, ?, ?)""",
            (job_id, institution_id, kind, (filename or "upload.csv")[:120], len(rows), len(valid),
             len({e["line"] for e in errors}), dumps(errors[:MAX_ERRORS_KEPT]), actor),
        )
        cur.executemany(
            "INSERT INTO import_rows (job_id, line, data) VALUES (?, ?, ?)",
            [(job_id, line, dumps(data)) for line, data in valid],
        )
    return get_job(institution_id, job_id)


def get_job(institution_id: str, job_id: str) -> dict | None:
    with cursor() as cur:
        cur.execute("SELECT * FROM import_jobs WHERE id = ? AND institution_id = ?", (job_id, institution_id))
        job = row_to_dict(cur.fetchone())
    if job:
        job["errors"] = loads(job.get("errors"), []) or []
    return job


def list_jobs(institution_id: str, limit: int = 20) -> list[dict]:
    with cursor() as cur:
        cur.execute(
            """SELECT id, kind, filename, status, total, valid, invalid, inserted, skipped, created_by,
                      created_at, finished_at
               FROM import_jobs WHERE institution_id = ? ORDER BY created_at DESC, id DESC LIMIT ?""",
            (institution_id, limit),
        )
        return [row_to_dict(r) for r in cur.fetchall()]


def discard_job(institution_id: str, job_id: str) -> bool:
    job = get_job(institution_id, job_id)
    if not job or job["status"] != "validated":
        return False
    with cursor() as cur:
        cur.execute("DELETE FROM import_rows WHERE job_id = ?", (job_id,))
        cur.execute("UPDATE import_jobs SET status = 'discarded', finished_at = datetime('now') WHERE id = ?", (job_id,))
    return True


def start_apply(institution_id: str, job_id: str, actor: str) -> dict | None:
    """Mark a validated job as applying and run it in the background."""
    with _lock, cursor() as cur:
        cur.execute(
            "UPDATE import_jobs SET status = 'applying' WHERE id = ? AND institution_id = ? AND status = 'validated'",
            (job_id, institution_id),
        )
        claimed = cur.rowcount == 1
    if not claimed:
        return None
    _pool.submit(_run_job, institution_id, job_id, actor)
    return get_job(institution_id, job_id)


def _run_job(institution_id: str, job_id: str, actor: str) -> None:
    job = get_job(institution_id, job_id)
    kind = job["kind"]
    inserted = skipped = 0
    errors = list(job["errors"])
    try:
        offset = 0
        while True:
            with cursor() as cur:
                cur.execute(
                    "SELECT line, data FROM import_rows WHERE job_id = ? ORDER BY line LIMIT ? OFFSET ?",
                    (job_id, APPLY_BATCH, offset),
                )
                batch = cur.fetchall()
            if not batch:
                break
            rows = []
            for r in batch:
                data = loads(r["data"], {})
                data["_line"] = r["line"]
                rows.append(data)
            i, s, e = apply_rows(institution_id, kind, rows, source="csv", job_id=job_id)
            inserted, skipped, errors = inserted + i, skipped + s, errors + e
            offset += APPLY_BATCH
            with cursor() as cur:
                cur.execute("UPDATE import_jobs SET inserted = ?, skipped = ? WHERE id = ?", (inserted, skipped, job_id))
        status = "completed"
    except Exception:  # noqa: BLE001 - the job records the failure; nothing else may break
        logger.exception("Import %s failed", job_id)
        status = "failed"
    with cursor() as cur:
        cur.execute("DELETE FROM import_rows WHERE job_id = ?", (job_id,))
        cur.execute(
            """UPDATE import_jobs SET status = ?, inserted = ?, skipped = ?, errors = ?,
                                      finished_at = datetime('now') WHERE id = ?""",
            (status, inserted, skipped, dumps(errors[:MAX_ERRORS_KEPT]), job_id),
        )
    _audit(institution_id, kind, inserted, skipped, len(errors), actor, via="csv", job_id=job_id)


def _audit(institution_id, kind, inserted, skipped, errored, actor, **extra) -> None:
    from services import audit

    audit.record(audit.IMPORT_APPLIED, None, institution_id=institution_id, kind=kind,
                 inserted=inserted, skipped=skipped, errors=errored, admin=actor, **extra)


def summary(institution_id: str) -> dict:
    """How much of the bank's data is in Fable: for the onboarding checklist."""
    with cursor() as cur:
        cur.execute(
            """SELECT SUM(kind = 'real') AS real, SUM(kind = 'test') AS test, COUNT(*) AS total
               FROM customers WHERE institution_id = ?""",
            (institution_id,),
        )
        c = cur.fetchone()
        cur.execute("SELECT COUNT(*), MIN(created_at), MAX(created_at) FROM transaction_history WHERE institution_id = ?",
                    (institution_id,))
        h = cur.fetchone()
    return {
        "customers": {"total": c["total"] or 0, "real": c["real"] or 0, "test": c["test"] or 0},
        "history": {"transfers": h[0] or 0, "from": h[1], "to": h[2]},
    }
