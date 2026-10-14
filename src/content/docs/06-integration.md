# Integration

Everything a bank's engineering team needs to take Fable from the sandbox to
production. The [Quickstart](#quickstart) shows single calls; this is the whole
loop, in the order you build it.

## The loop

```text
Customer submits a transfer
        │
        ▼
Your server ──► POST /v1/shield/analyze  (with your API key)
        │
        ├─ PASS  ─► complete the transfer
        ├─ FLAG  ─► ask for the factor Fable names, then approve
        └─ BLOCK ─► refuse, or hold in Ghost if the customer insists
        │
        ▼
Fable ──► your webhook endpoint  (blocked, flagged, held, case resolved)
        │
        ▼
Your analysts work the case in the console, or your system posts feedback
```

Your servers call Fable. Fable never calls your core banking system directly; it
tells you what happened through signed webhooks, and you decide what to do.

## 1. Get your key

Every institution has one API key. It is shown in full exactly once: in the
welcome email when the institution is provisioned, and on screen when an owner
rotates it under **Settings → API & webhooks**. Fable stores only a hash, so it
cannot show the key again; a lost key is replaced by rotating it. Rotating
retires the old key immediately, so update your secrets manager straight away.

Keep the key on your servers. Never put it in a mobile app, a web page or a
repository: anyone holding it can score transactions as your bank.

```bash
export FABLE_API_URL="https://api.your-fable-host"
export FABLE_API_KEY="fbl_live_..."
```

## 2. Score every transfer

Call Shield before the money moves, from the same service that will move it.

```bash
curl -X POST $FABLE_API_URL/v1/shield/analyze \
  -H "Content-Type: application/json" \
  -H "X-API-Key: $FABLE_API_KEY" \
  -d '{
    "user_id": "cust_10293",
    "client_reference": "your-transfer-id-8812",
    "transaction": {
      "amount": 250000,
      "recipient_account": "0111222333",
      "recipient_bank_code": "058",
      "recipient_name": "ADEOLA MUSA",
      "narration": "rent",
      "channel": "mobile_app"
    }
  }'
```

Send `client_reference` with your own transfer id. A retry with the same
reference returns the original decision instead of scoring the transfer twice,
so a network timeout can be retried safely.

Use the same `user_id` for a customer every time. It is how Copilot builds that
customer's baseline, and a changing id means every transfer looks like a
stranger's.

## 3. Act on the verdict

| `action` | Do this |
|---|---|
| `PASS` | Complete the transfer. No extra step for the customer |
| `FLAG` | Call `POST /v1/stepup/requirement`, run the factor it names (PIN, passkey or code), then `POST /v1/transactions/{id}/approve` with the step-up token |
| `BLOCK` | Refuse. If the customer insists, open a Ghost hold with `POST /v1/ghost/create` so the money stays recoverable |

Shield never fails open. If anything goes wrong while scoring, it returns a
conservative `FLAG`, never a `PASS`.

Plan for the 200ms budget: `decision_ms` in the response is the time to the
verdict. Give the HTTP call a timeout of around 1.5 seconds and treat a timeout
as a `FLAG` in your own code, so an outage never waves a transfer through.

## 4. Receive webhooks

An owner adds an endpoint under **Settings → API & webhooks** and chooses the
events. The signing secret is shown once, at creation.

| Event | When |
|---|---|
| `transaction.flagged` | Shield asked a customer to verify |
| `transaction.blocked` | Shield stopped a transfer |
| `containment.created` | Ghost is holding a transfer |
| `containment.resolved` | A hold was released or cancelled |
| `case.resolved` | An analyst closed a case as fraud or legitimate |

Every delivery is a JSON `POST`:

```json
{
  "id": "evt_4f1c9a0b2e7d3c6a8b1f",
  "type": "transaction.blocked",
  "created_at": "2026-10-08T14:03:11Z",
  "institution_id": "zenith_test_bank",
  "data": { "id": "txn_a1b2c3d4e5f6", "amount": 250000, "risk_score": 0.91, "action_taken": "BLOCK" }
}
```

With these headers:

```http
Fable-Event: transaction.blocked
Fable-Signature: t=1791468191,v1=5f2b0c...e9
```

Verify every delivery before acting on it. The signature is an HMAC-SHA256 of
`<t>.<raw body>` with your endpoint's secret. Reject a timestamp more than five
minutes old, so a captured request cannot be replayed.

```js
// Node.js (Express). Use the raw body, not the parsed JSON.
import crypto from "node:crypto";

function verifyFable(rawBody, header, secret, toleranceSeconds = 300) {
  const parts = Object.fromEntries(header.split(",").map((p) => p.split("=")));
  const t = Number(parts.t);
  if (!t || Math.abs(Date.now() / 1000 - t) > toleranceSeconds) return false;
  const expected = crypto.createHmac("sha256", secret).update(`${t}.${rawBody}`).digest("hex");
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(parts.v1 ?? ""));
}

app.post("/fable", express.raw({ type: "application/json" }), (req, res) => {
  if (!verifyFable(req.body.toString(), req.get("Fable-Signature"), process.env.FABLE_WEBHOOK_SECRET)) {
    return res.sendStatus(400);
  }
  const event = JSON.parse(req.body);
  // queue event.type / event.data for your own processing, then:
  res.sendStatus(200);
});
```

```python
# Python (any framework). Use the raw request body.
import hashlib, hmac, time

def verify_fable(raw_body: bytes, header: str, secret: str, tolerance: int = 300) -> bool:
    parts = dict(p.split("=", 1) for p in header.split(","))
    t = int(parts.get("t", 0))
    if not t or abs(time.time() - t) > tolerance:
        return False
    expected = hmac.new(secret.encode(), f"{t}.".encode() + raw_body, hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, parts.get("v1", ""))
```

Respond with any `2xx` within five seconds. A timeout or a `5xx` is retried up to
three times with backoff; a `4xx` is not retried. Deliveries can arrive more than
once, so de-duplicate on the event `id`. The console shows a log of every
attempt, and an owner can send a signed test event at any time.

## 5. Close the loop

Tell Fable how a flag or block turned out. It is what separates real fraud from
false alarms in your reporting, and it keeps confirmed fraud out of the
customer's "normal" behaviour.

Either your analysts resolve the case in the console's **Review queue**, or your
own system reports it:

```bash
curl -X POST $FABLE_API_URL/v1/shield/feedback \
  -H "Content-Type: application/json" \
  -H "X-API-Key: $FABLE_API_KEY" \
  -d '{ "user_id": "cust_10293", "transaction_id": "txn_a1b2c3d4e5f6", "was_fraud": true }'
```

Feedback is accepted only for your own institution's transactions.

## 6. Go live

Every institution starts in **sandbox** mode, where your team can also try
transfers as test customers in the sandbox app, signed in to the console.
Before real customers use it:

1. Make sure every call from your servers sends `X-API-Key`.
2. Add and test at least one webhook endpoint.
3. Invite your analysts under **Settings → Team**, as analysts rather than owners.
4. Review your thresholds under **Settings → Risk policy**.
5. An owner switches the environment to **Live** under **Settings → API & webhooks**.

In live mode, every request about one of your customers must carry your key:
without it the answer is `401`, and with only a console session it is `403`.
That includes verification, Ghost holds and approvals, so your app reaches Fable
through your own servers, never directly from a phone or browser. Fable keeps no
balances for a live institution: your core banking system checks funds and
moves the money, and Fable returns the decision. Nothing else changes: existing
data, keys and webhooks carry over.

## SDKs

Small reference clients live in the repository under `sdk/node` and
`sdk/python`. They wrap scoring, feedback, Ghost and webhook verification with
no third-party dependencies. They are not yet published to npm or PyPI, so copy
the file into your service or install from the repository.
