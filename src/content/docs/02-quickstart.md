# Quickstart

## 1. Provision an institution

```bash
curl -X POST https://api.fablehq.app/admin/provision \
  -H "Content-Type: application/json" \
  -d '{"institution_name":"Zenith Test Bank","admin_email":"risk@zenithtest.ng"}'
```

Returns — and emails — four things:

```json
{
  "institution_id": "zenith_test_bank",
  "api_key": "fbl_live_a87c82a4...",
  "temp_password": "rJXsfSHv*oNk",
  "demo_url": "https://fablehq.vercel.app/demo/zenith_test_bank"
}
```

The tenant is seeded with three customers and 90 days of history, so the console
opens onto real data rather than an empty state.

## 2. Score a transfer

```bash
curl -X POST https://api.fablehq.app/v1/shield/analyze \
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
  "action": "FLAG",
  "signals": [
    "amount_anomaly: 20x above your baseline (+0.28)",
    "new_recipient: first transfer to this account"
  ],
  "explanation": "This is far larger than Chioma's usual transfers...",
  "transaction_id": "txn_a1b2c3d4e5f6"
}
```

## 3. Act on the verdict

| Action | Meaning | What the app should do |
|---|---|---|
| `PASS` | Matches normal behaviour | Complete silently |
| `FLAG` | Unusual — worth a check | Ask the customer to confirm |
| `BLOCK` | Strong fraud signal | Refuse, offer Ghost containment |

## 4. Contain an override

When a customer insists on a blocked transfer, hold it rather than losing it:

```bash
curl -X POST https://api.fablehq.app/v1/ghost/create \
  -H "Content-Type: application/json" \
  -d '{
    "user_id": "zenith_test_bank_chioma",
    "risk_score": 0.88,
    "signals": ["amount_anomaly", "device_anomaly"],
    "transaction": { "amount": 250000, "recipient_account": "0111222333" }
  }'
```

Cancel returns the money. Release requires identity verification — see
[Identity Assurance](#identity-assurance).
