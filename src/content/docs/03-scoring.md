# Scoring

Shield combines fourteen additive signal layers into a score between 0 and 1,
then softens it for customers with a long clean record. The default boundaries
are `FLAG` at ≥ 0.5 and `BLOCK` at ≥ 0.8; riskier channels trip sooner (see
below).

| # | Signal | Fires when | Max |
|---|---|---|---|
| 1 | `amount_anomaly` | Far above the customer's own average | 0.40 |
| 2 | `new_recipient` | First transfer to this account | 0.20 |
| 3 | `time_anomaly` | Outside typical hours, on the **device clock** | 0.12 |
| 4 | `channel_risk` | NIBSS channel weights (USSD highest) | 0.25 |
| 5 | `nip_code` | NIBSS risk codes; code 34 auto-blocks | 0.95 |
| 6 | `scam_pattern` | Narration matches a scam script | 0.25 |
| 7 | `ml_anomaly` | Isolation Forest deviation from own history | 0.15 |
| 8 | `device_anomaly` | Unrecognised device fingerprint | 0.18 |
| 9 | `location_anomaly` | New city, or outside home country | 0.22 |
| 10 | `session_freshness` | Large transfer within 30s of login | 0.12 |
| 11 | `behavioral_anomaly` | Pasted account + near-zero hesitation | 0.15 |
| 12 | `timezone_mismatch` | Device timezone differs from usual | 0.08 |
| 13 | `failed_verification` | Recent failed identity checks | 0.25 |
| 14 | `velocity` | A burst of transfers in a short window | 0.20 |

Weights are the shipped defaults. Every one is tunable per deployment through
`FABLE_W_*` environment variables, so a bank can adjust the engine without a
code change.

## Thresholds by channel

The same score means more on a riskier rail, so each channel has its own
cutoffs. Unknown channels fall back to the default.

| Channel | `FLAG` at | `BLOCK` at |
|---|---|---|
| `mobile_app`, `qr` (default) | 0.50 | 0.80 |
| `ussd`, `internet` | 0.45 | 0.75 |
| `pos`, `atm` | 0.48 | 0.78 |
| `branch` | 0.55 | 0.85 |

`risk_level` follows the same cutoffs: `LOW` below `FLAG`, `MEDIUM` from `FLAG`,
`HIGH` from `BLOCK`.

## Design decisions worth knowing

**Narration is deliberately weak.** Most customers leave it blank, so building
fraud detection on it would be theatre. Its weight is halved. The device,
location, session and behaviour layers carry the load because a customer cannot
opt out of them.

**The amount scale runs past 10x.** It used to cap there, which meant a student
sending 45x her baseline scored *lower* than someone at 8x who also tripped a
time anomaly, and passed. It now escalates through 25x and 50x tiers.

**Time uses the device clock.** Server UTC misplaces a Lagos evening by an hour,
which is enough to fire a false time anomaly every night.

**History earns a small discount.** A long, confirmed-clean record is evidence,
so a `tenure` line subtracts a capped amount at the very end. At its maximum it
is worth less than a single new-recipient signal, so it softens friction for
established customers without ever rescuing a genuinely anomalous transfer.

**Shield never fails open.** If scoring throws, it returns a conservative
`FLAG` rather than passing the transfer. A missing or slow AI provider changes
only the wording of the explanation, never the decision.

## Cold start

A customer with fewer than three transactions has no personal baseline. Six
layers need something to compare against, so they used to skip silently: a
brand-new account could move almost any sum and score around 0.20.

That is exactly the mule and takeover shape, so Shield now falls back to how
that **institution's** customers behave in aggregate and prices the newness
itself (+0.15). The population baseline uses the median rather than the mean:
a few large business transfers otherwise drag "normal" upward and hide real
anomalies.

A new account sending ₦450,000 scores **0.69 → FLAG**, where it previously
passed.

## The same amount, three customers

Verified against live data, identical transfer of ₦250,000:

| Customer | Baseline | Result |
|---|---|---|
| Tunde, trader | ₦80k–400k | **PASS** 0.24 |
| Ada, salaried | ₦8k–55k | **FLAG** 0.564 |
| Chioma, student | ₦1.5k–9k | **FLAG** 0.552 |

Same recipient, same device, same moment. Three verdicts. That difference is
the entire argument for per-customer baselines.

## Explanations

Every `FLAG` and `BLOCK` carries a plain-language reason. It is produced in
three tiers, fastest first: a cache of identical decision shapes, a
deterministic template, and an AI-written version generated in the background.
The AI tier sees only the action, the amount and the signal descriptions. It
never receives names or account numbers.
