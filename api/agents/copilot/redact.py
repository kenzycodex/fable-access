"""What leaves Fable for an AI provider, with customers taken out of it.

Ask Fable's grounding is aggregate figures only: no names, references or
account numbers (see assistant_facts). The analyst's own words are another
matter: a question can name a customer, paste an account number, a phone
number or an email. Sending that to a provider abroad is a cross-border
transfer of personal data under the NDPA, and nothing in the answer needs it,
because the model has no per-customer data to look it up in.

So before a question (and the conversation sent with it) leaves the server:

  * this institution's customers named in it, by name or by the bank's own
    reference, become "Customer A", "Customer B"... consistently across the
    whole conversation, so the question still reads sensibly;
  * account numbers (NUBAN), BVN/NIN-length numbers, card numbers, phone
    numbers and email addresses become placeholders.

Amounts are left alone: "₦500,000" and "500k" are what the analyst is asking
about, and identify nobody.
"""
from __future__ import annotations

import re

from core.db import cursor

EMAIL = re.compile(r"[\w.+-]+@[\w-]+(?:\.[\w-]+)+")
PHONE = re.compile(r"(?<!\d)(?:\+?234|0)[789][01]\d{8}(?!\d)")
# A run of digits on its own: not part of a longer number, not a naira amount
# ("₦1500000000"), and not followed by more digits after a separator
# ("1,234"). Ordinary punctuation after it ("... 0123456789, then") is fine.
_ALONE = r"(?<![\d₦]){}(?!\d|[.,]\d)"
CARD = re.compile(_ALONE.format(r"\d{13,19}"))
ID_NUMBER = re.compile(_ALONE.format(r"\d{11}"))
NUBAN = re.compile(_ALONE.format(r"\d{10}"))
_WORD = re.compile(r"[A-Za-z][A-Za-z\-]{3,}")


def _customers_named(institution_id: str, text: str) -> dict[str, str]:
    """This bank's customer names and references that appear in the text, each
    mapped to the customer it belongs to, so every way of naming one customer
    gets the same pseudonym."""
    low = text.lower()
    found: dict[str, str] = {}
    with cursor() as cur:
        cur.execute(
            """SELECT display_name, external_ref FROM customers
               WHERE institution_id = ?
                 AND ((display_name IS NOT NULL AND length(display_name) >= 3 AND instr(?, lower(display_name)) > 0)
                      OR (length(external_ref) >= 3 AND instr(?, lower(external_ref)) > 0))
               LIMIT 50""",
            (institution_id, low, low),
        )
        for r in cur.fetchall():
            who = r["external_ref"]
            for v in (r["display_name"], r["external_ref"]):
                if v and len(v) >= 3 and v.lower() in low:
                    found[v] = who
        # A first or last name on its own ("why was Tunde blocked?").
        words = {w for w in _WORD.findall(text) if w[0].isupper()}
        for w in list(words)[:20]:
            cur.execute(
                """SELECT external_ref FROM customers WHERE institution_id = ? AND display_name IS NOT NULL
                     AND (' ' || lower(display_name) || ' ') LIKE ? LIMIT 1""",
                (institution_id, f"% {w.lower()} %"),
            )
            row = cur.fetchone()
            if row and w not in found:
                found[w] = row["external_ref"]
    return found


def scrubber(institution_id: str | None, texts: list[str]):
    """A function that removes customers and identifiers from a text, with one
    pseudonym per customer across every text it is applied to."""
    names = _customers_named(institution_id, " \n ".join(texts)) if institution_id else {}
    aliases: dict[str, str] = {}

    def alias_for(customer: str) -> str:
        if customer not in aliases:
            aliases[customer] = f"Customer {chr(ord('A') + len(aliases) % 26)}"
        return aliases[customer]

    # Longest first, so "Ada Obi" is replaced before "Ada".
    patterns = [(re.compile(rf"(?<![\w]){re.escape(n)}(?![\w])", re.I), who)
                for n, who in sorted(names.items(), key=lambda kv: len(kv[0]), reverse=True)]

    def scrub(text: str) -> str:
        out = EMAIL.sub("[email]", text)
        out = PHONE.sub("[phone]", out)
        out = CARD.sub("[card number]", out)
        out = ID_NUMBER.sub("[ID number]", out)
        out = NUBAN.sub("[account number]", out)
        for pattern, who in patterns:
            out = pattern.sub(lambda _m, who=who: alias_for(who), out)
        return out

    return scrub
