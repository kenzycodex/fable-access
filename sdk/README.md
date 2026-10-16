# Fable reference clients

Small, dependency-free clients for calling Fable from a bank's own servers.

| Language | File | Needs |
|---|---|---|
| Node.js / TypeScript | [`node/fable.ts`](node/fable.ts) | Node 18+ (built-in `fetch` and `node:crypto`) |
| Python | [`python/fable.py`](python/fable.py) | Python 3.9+, standard library only |

They are not published to npm or PyPI yet. Copy the file into your service.

Each client covers the full loop:

| | Node | Python |
|---|---|---|
| Score a transfer | `analyze()` | `analyze()` |
| Score, treating an outage as a FLAG | `analyzeOrFlag()` | `analyze_or_flag()` |
| Which factor a flag needs | `stepUpRequirement()` | `step_up_requirement()` |
| Approve after the factor | `approve()` | `approve()` |
| Hold, cancel or release in Ghost | `hold()`, `cancelHold()`, `releaseHold()` | `hold()`, `cancel_hold()`, `release_hold()` |
| Ask the bank to release a hold | `requestRelease()` | `request_release()` |
| Report the outcome | `feedback()` | `feedback()` |
| Verify a webhook | `verifyWebhook()` | `verify_webhook()` |

## Node

```ts
import { Fable, verifyWebhook } from "./fable";

const fable = new Fable({ baseUrl: process.env.FABLE_API_URL!, apiKey: process.env.FABLE_API_KEY! });

const verdict = await fable.analyzeOrFlag({
  userId: "cust_10293",
  clientReference: transfer.id,
  transaction: { amount: 250000, recipientAccount: "0111222333", recipientBankCode: "058", channel: "mobile_app" },
});

if (verdict.action === "PASS") await completeTransfer(transfer);
else if (verdict.action === "FLAG") await askForStepUp(transfer, verdict);
else await refuse(transfer);

// Webhooks: use the raw body.
app.post("/fable", express.raw({ type: "application/json" }), (req, res) => {
  const event = verifyWebhook(req.body, req.get("Fable-Signature"), process.env.FABLE_WEBHOOK_SECRET!);
  if (!event) return res.sendStatus(400);
  queue.push(event);
  res.sendStatus(200);
});
```

## Python

```python
from fable import Fable, verify_webhook

fable = Fable(base_url=os.environ["FABLE_API_URL"], api_key=os.environ["FABLE_API_KEY"])

verdict = fable.analyze_or_flag(
    "cust_10293",
    amount=250000,
    recipient_account="0111222333",
    recipient_bank_code="058",
    client_reference=transfer_id,
)

event = verify_webhook(request.body, request.headers.get("Fable-Signature"), os.environ["FABLE_WEBHOOK_SECRET"])
if event is None:
    return 400
```

See the Integration section of the API docs for the full guide.
