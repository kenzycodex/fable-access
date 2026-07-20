# Implementation plan: money that behaves like money

Four changes, in dependency order. The ledger comes first because Add Money is
meaningless without it and the verification tier gates it.

---

## Why this is needed

Today the demo bank's balance is a display value derived on the client from an
opening figure. Nothing debits it and nothing checks it, so ₦200,000 can leave
a ₦65,000 account. Every downstream claim — "money held safely", "cancel to get
it back" — rests on a number the system does not actually control.

---

## 1. Balance ledger

### Schema

```sql
accounts(
  user_id PRIMARY KEY, institution_id,
  balance REAL,              -- settled funds
  created_at, updated_at
)

ledger_entries(
  id, user_id, institution_id,
  kind,                      -- topup | debit | reversal | reserve | release
  amount REAL,
  balance_after REAL,
  transaction_id,            -- links to transactions.id where applicable
  reference,                 -- idempotency key
  created_at
)
```

`balance` is authoritative and server-side. `ledger_entries` is the audit trail
— every movement is explainable, which is the point of a fraud product.

### Available vs settled

```
available = balance - held
held      = SUM(amount) of ghost_containers WHERE status = 'HELD'
```

Money in a Ghost container has left the customer's spendable balance but has
**not** been debited: it is recoverable. That distinction is the whole
containment story, so the ledger has to model it rather than flatten it.

### Money movement rules

| Event | Effect |
|---|---|
| Transfer scored `PASS` | Debit immediately |
| Transfer `FLAG`/`BLOCK`, user cancels | No movement |
| Transfer routed to Ghost | Reserve (shows as held, not debited) |
| Ghost cancelled | Release reservation — balance unchanged |
| Ghost released | Reservation becomes a debit |
| Top-up | Credit |

### Insufficient funds

Checked **before Shield scores**, and returns `422` with the shortfall. Two
reasons for the ordering: scoring a transfer that cannot execute wastes an LLM
call, and a declined-for-funds transfer is not a fraud signal — recording it as
one would pollute Copilot's baseline.

---

## 2. Add Money, with real guards

`POST /v1/accounts/{user_id}/topup { amount, method }`

Limits are enforced server-side and configurable, because this writes to the
same database the fraud metrics are computed from — an unbounded top-up would
let anyone distort the demo.

| Guard | Env | Default |
|---|---|---|
| Max per top-up | `TOPUP_MAX_AMOUNT` | ₦500,000 |
| Max per day (total) | `TOPUP_DAILY_MAX` | ₦1,000,000 |
| Max per day (count) | `TOPUP_DAILY_COUNT` | 5 |

Rejections state the specific limit hit and when it resets, rather than a
generic failure.

**New customers start at ₦0.** The seeded archetypes keep an opening balance so
their baselines mean something; anyone created after that funds themselves.

---

## 3. Status colours

One `statusTone()` helper, applied everywhere a status renders.

| Status | Tone | Reasoning |
|---|---|---|
| `completed` | emerald | Money moved, nothing wrong |
| `released` | blue | Moved, but only after containment |
| `held` | amber | In a cooling window, recoverable |
| `cancelled` | slate | Customer stopped it |
| `blocked` | red | Shield stopped it |
| `topup` | violet | Money in, not out |

Released is deliberately *not* green: it succeeded, but it is the outcome a
risk team should be able to spot at a glance.

---

## 4. A verification tier that completes

### Transaction PIN

```sql
user_security(
  user_id PRIMARY KEY,
  pin_hash,                  -- PBKDF2, never reversible
  pin_set_at,
  failed_attempts, locked_until,
  two_factor_enabled
)
```

PIN is a real factor: hashed, rate-limited, and locked after repeated failures.
Verifying one issues the same step-up token a passkey does.

### Making `identity_check` completable

A liveness check needs a KYC vendor this deployment has no credentials for.
Rather than fake a face match — which would make the strongest tier the least
trustworthy — the tier resolves as:

- **Vendor configured** → real liveness check (interface already defined)
- **No vendor** → the strongest combination actually available: **passkey + PIN
  + emailed code**, clearly labelled as a substitute

Three independent factors is a defensible stand-in. Silently passing, or
pretending a face was matched, is not.

### Settings

In the demo bank: set/change PIN, enrol or remove a passkey, toggle 2FA, see
which factors are active. This is the customer's own security screen, so it
belongs with the customer, not in the institution console.

---

## Order of work

1. Ledger schema + accounts module + balance endpoints
2. Insufficient-funds rejection ahead of scoring
3. Ghost reserve/release/cancel wired to the ledger
4. Top-up endpoint with guards
5. PIN factor + security settings
6. `identity_check` fallback composition
7. Frontend: real balance, Add Money flow, security screen, status colours
8. End-to-end verification of each rule in the tables above
