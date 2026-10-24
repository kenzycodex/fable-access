# Quickstart

Every example below uses `$FABLE_API_URL`, the API host for your environment.
Nothing in Fable hardcodes a hostname, so use the one you were given when your
institution was provisioned (locally that is `http://127.0.0.1:8010`).

## 1. Get an institution

Fable staff create your institution from the operator platform. It starts
**empty and in sandbox mode**: no customers, no history, no API key. Your first
owner receives a one-time link (valid 7 days) to choose a password. No password
or key is ever emailed.

Then, in your console:

1. **Settings > Go live** lists everything left to do. The Overview shows the same progress.
2. **Settings > API & webhooks**: create an API key (shown once) and add a webhook.
3. **Settings > Data**: import your customers and their past transfers (below).
4. Try it end to end in the **sandbox app** with test customers you add. Set
   up a test customer's PIN and trusted device on their security page before
   you try a risky transfer: a check added after a transfer is stopped cannot
   approve it, exactly as it will be live.

## 1b. Bring your customers and history

Customers are identified by **your own reference** (account or CIF number).
Import them as CSV in **Settings > Data** (templates provided), or by API:

```bash
curl -X POST $FABLE_API_URL/v1/imports/customers \
  -H "Content-Type: application/json" \
  -H "X-API-Key: fbl_live_..." \
  -d '{"rows":[{"reference":"CIF-000123","name":"Ada Obi","segment":"Salaried","kind":"real"}]}'
```

```bash
curl -X POST $FABLE_API_URL/v1/imports/transactions \
  -H "Content-Type: application/json" \
  -H "X-API-Key: fbl_live_..." \
  -d '{"rows":[{"customer_reference":"CIF-000123","reference":"TRF-88231","amount":42000,
        "occurred_at":"2026-09-02T19:14:00+01:00","recipient_account":"0123456789",
        "recipient_bank":"Access Bank","channel":"mobile_app"}]}'
```

Up to 1,000 rows per call. Both are idempotent on your references, so a retry
never doubles anything. Imported history is not scored and triggers no webhooks;
it gives each customer a baseline from day one.

## 2. Score a transfer

```bash
curl -X POST $FABLE_API_URL/v1/shield/analyze \
  -H "Content-Type: application/json" \
  -H "X-API-Key: fbl_live_..." \
  -d '{
    "user_id": "CIF-000123",
    "transaction": {
      "amount": 250000,
      "recipient_account": "0111222333",
      "recipient_name": "ADEOLA MUSA",
      "channel": "mobile_app"
    }
  }'
```

```json
{
  "risk_score": 0.552,
  "risk_level": "MEDIUM",
  "action": "FLAG",
  "signals": [
    "amount_anomaly: 20x above your baseline (+0.28)",
    "new_recipient: first transfer to this account (+0.2)"
  ],
  "explanation": "This is far larger than this customer's usual transfers...",
  "agent": "fable-shield-v1",
  "decision_ms": 46.1,
  "latency_ms": 49.8,
  "explanation_source": "template",
  "transaction_id": "txn_a1b2c3d4e5f6"
}
```

`decision_ms` is the figure the 200ms budget governs: time to the verdict. The
explanation prose is not part of it. When `explanation_source` is `pending`, a
richer write-up is being generated off the request path; collect it from
`GET /v1/shield/explanation/{transaction_id}`.

A transfer larger than the customer's available balance is refused with `422`
(`insufficient_funds`) before it is scored, because a declined-for-funds
transfer is not a fraud signal and must not teach the baseline.

## 3. Act on the verdict

| Action | Meaning | What the app should do |
|---|---|---|
| `PASS` | Matches normal behaviour | Complete silently. In sandbox the sandbox ledger has booked the debit; live, your core moves the money |
| `FLAG` | Unusual, worth a check | Ask `/v1/stepup/requirement` which factor to run, then confirm |
| `BLOCK` | Strong fraud signal | Refuse, and offer Ghost containment if the customer insists |

In sandbox, only a `PASS` debits the sandbox ledger. Live, Fable never moves money: your system acts on the verdict.

## 4. Contain an override

When a customer insists on a blocked transfer, hold it rather than losing it:

```bash
curl -X POST $FABLE_API_URL/v1/ghost/create \
  -H "Content-Type: application/json" \
  -H "X-API-Key: fbl_live_..." \
  -d '{ "user_id": "CIF-000123", "transaction_id": "txn_a1b2c3d4e5f6" }'
```

Send the `transaction_id` Shield returned. The hold is opened from the stored
decision, so its amount, recipient and risk come from what Fable scored, not
from the request. The cooling window depends on the risk score; each
institution sets its three windows under **Settings > Risk policy**. The
customer is told on a channel the session cannot read (email, or SMS where set
up).

Cancel needs no proof and the money stays with the customer. Release needs a
step-up token, see [Identity Assurance](#identity-assurance). A customer who
cannot produce it can ask the bank to release instead
(`POST /v1/ghost/{id}/request-release`). A hold nobody releases in its window
expires: the money stays with the customer and a release returns `410`.

Live, Fable holds no money: your system keeps the funds while the hold lasts
and acts on the `containment.*` webhooks (see [Integration](#integration)).
