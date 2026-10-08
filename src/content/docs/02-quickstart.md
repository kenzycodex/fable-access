# Quickstart

Every example below uses `$FABLE_API_URL`, the API host for your environment.
Nothing in Fable hardcodes a hostname, so use the one you were given when your
institution was provisioned (locally that is `http://127.0.0.1:8010`).

## 1. Get an institution

Provisioning mints live credentials, so it is an operator action, not a public
endpoint. It needs the operator key configured on the server as
`FABLE_OPERATOR_KEY`, and is disabled outright when that key is not set.

```bash
curl -X POST $FABLE_API_URL/admin/provision \
  -H "Content-Type: application/json" \
  -H "X-Fable-Operator-Key: $FABLE_OPERATOR_KEY" \
  -d '{"institution_name":"Zenith Test Bank","admin_email":"risk@zenithtest.ng"}'
```

Returns, and emails to the admin address, four things:

```json
{
  "institution_id": "zenith_test_bank",
  "api_key": "fbl_live_a87c82a4...",
  "temp_password": "rJXsfSHv*oNk",
  "demo_url": "https://fablehq.vercel.app/demo/zenith_test_bank"
}
```

The tenant is seeded with three customers and 90 days of history, so the console
opens onto real data rather than an empty state. A name that collides with an
existing institution returns `409` instead of touching the existing tenant.

## 2. Score a transfer

```bash
curl -X POST $FABLE_API_URL/v1/shield/analyze \
  -H "Content-Type: application/json" \
  -H "X-API-Key: fbl_live_..." \
  -d '{
    "user_id": "zenith_test_bank_chioma",
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
  "explanation": "This is far larger than Chioma's usual transfers...",
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
| `PASS` | Matches normal behaviour | Complete silently. The debit has already been booked |
| `FLAG` | Unusual, worth a check | Ask `/v1/stepup/requirement` which factor to run, then confirm |
| `BLOCK` | Strong fraud signal | Refuse, and offer Ghost containment if the customer insists |

Only a `PASS` moves money at scoring time. A `FLAG` or `BLOCK` never debits.

## 4. Contain an override

When a customer insists on a blocked transfer, hold it rather than losing it:

```bash
curl -X POST $FABLE_API_URL/v1/ghost/create \
  -H "Content-Type: application/json" \
  -H "X-API-Key: fbl_live_..." \
  -d '{
    "user_id": "zenith_test_bank_chioma",
    "risk_score": 0.88,
    "signals": ["amount_anomaly", "device_anomaly"],
    "transaction": { "amount": 250000, "recipient_account": "0111222333" }
  }'
```

The cooling window is 15, 10 or 5 minutes depending on the risk score. The
customer is notified out-of-band, on a channel the session cannot read.

Cancel returns the money and needs no proof. Release requires a step-up token,
see [Identity Assurance](#identity-assurance). A container that outlives its
window can no longer be released (`410`), but can still be cancelled.
