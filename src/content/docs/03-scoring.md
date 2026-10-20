# Scoring

Shield adds up seventeen signals into a score between 0 and 1, then softens it
for customers with a long clean record. The default boundaries
are `FLAG` at ≥ 0.5 and `BLOCK` at ≥ 0.8; riskier channels trip sooner (see
below).

| # | Signal | Fires when | Max (default) |
|---|---|---|---|
| 1 | `amount_anomaly` | Far above the customer's own normal, in tiers from 3x to 50x | 0.40 |
| 2 | `cold_start` | Fewer than three past transfers: judged against the institution's customers as a whole | 0.15 |
| 3 | `first_transfer_amount` | No history to compare: the amount itself, in tiers from NGN 100k to NGN 20m | 0.45 |
| 4 | `new_recipient` | First transfer to this account | 0.20 |
| 5 | `time_anomaly` | Outside typical hours, on the **device clock** | 0.12 |
| 6 | `channel_risk` | Channel risk weights informed by NIBSS fraud data (internet banking highest, branch lowest) | 0.22 |
| 7 | `nip_code` | NIBSS risk codes from the bank's rail; code 34 always blocks | 0.95 |
| 8 | `scam_pattern` | Narration matches a scam script (halved on purpose) | 0.25 |
| 9 | `ml_anomaly` | The amount and hour together sit far from the customer's own past transfers | 0.10 |
| 10 | `device_anomaly` | Unrecognised device fingerprint, more for a large transfer | 0.18 |
| 11 | `balance_drain` | Takes 80% or more of the available balance (NGN 20,000 and up); more for all of it, more again to a new recipient or from a new device | 0.26 |
| 12 | `location_anomaly` | Outside the home country, or more than 45 km from every place the customer has transacted from (normalised city names when there are no coordinates, so Bariga and Lagos are one place) | 0.22 |
| 13 | `session_freshness` | Large transfer seconds after sign-in | 0.12 |
| 14 | `behavioral_anomaly` | Pasted account number and near-zero hesitation on a large amount | 0.15 |
| 15 | `timezone_mismatch` | Device timezone differs from usual | 0.08 |
| 16 | `failed_verification` | Recent failed PIN, passkey or code attempts | 0.25 |
| 17 | `velocity` | Several live transfers in a few minutes | 0.20 |

A long, confirmed-clean record then subtracts a small `tenure` discount (at most
0.08 by default).

`balance_drain` and the place-based `location_anomaly` arrive in a prepared
engine draft. A version approved before them scores exactly as approved: no
balance drain, and location judged by city name. They take effect when an owner
backtests, shadows and promotes the draft.

Weights live in governed engine versions, changed on the operator platform's
Engine page: every scoring change goes through approval with a cooling-off period, a backtest and a shadow run (two-person approval when there are two owners), and is then promoted. Every
decision records the version that made it. A value set in the server
environment (`FABLE_W_*`) still overrides the version, and the Engine page says
so.

## Thresholds by channel

The same score means more on a riskier rail, so each channel has its own
cutoffs. Unknown channels fall back to the default.

| Channel | `FLAG` at | `BLOCK` at |
|---|---|---|
| `internet` | 0.45 | 0.75 |
| `pos`, `atm`, `mobile_app` | 0.48 | 0.78 |
| `qr`, and any unknown channel (the default) | 0.50 | 0.80 |
| `ussd` | 0.52 | 0.82 |
| `branch` | 0.55 | 0.85 |

`ussd` gets more room than the default on purpose. It carries little reported
fraud, and a customer on a feature phone is the least able to complete a
verification step, so friction is not concentrated on them.

### Your own thresholds

An institution can move these lines. In the console, **Settings, Risk policy**
sets a base flag and block cutoff (and the Ghost hold windows), and shows how
many of your recent transfers would change before you save. Each channel keeps
its offset from the default, so a bank that loosens its flag line still has USSD
treated more gently than internet banking. An institution that never opens the
page scores exactly as above. Changes are owner-only and recorded in the audit
trail.

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

With no personal history the amount itself is also priced, in tiers from
NGN 100k (+0.10) to NGN 20m (+0.45), at full weight when the institution has no
population norm yet and half weight when it does. Before this, a brand-new
customer on the mobile app scored a flat 0.47 whatever the amount, so a first
transfer of NGN 900m passed.

These weights ship as a draft engine version. A deployment upgraded from an
earlier version keeps scoring as approved until an owner backtests, proposes
and promotes the draft; the Engine page shows a banner until then.

## The same amount, three customers

An example from sandbox test customers, identical transfer of ₦250,000. The
exact scores depend on each customer's history:

| Customer | Baseline | Result |
|---|---|---|
| Tunde, trader | ₦80k–400k | **PASS** 0.24 |
| Ada, salaried | ₦8k–55k | **FLAG** 0.564 |
| Chioma, student | ₦1.5k–9k | **FLAG** 0.552 |

Same recipient, same device, same moment. Three verdicts. That difference is
the entire argument for per-customer baselines.

## The anomaly model

`ml_anomaly` compares the transfer with the customer's own confirmed history:
each past transfer is a point (log amount, hour of day), with the clock read
as a circle so 23:00 and 01:00 are two hours apart. A transfer within the
customer's usual spread scores 0; one three times further away than usual
scores the full weight. It catches an amount the customer sends at one time of
day sent at another, which the amount and time rules each miss on their own.

It replaced an Isolation Forest that added points to typical transfers. A
version approved under the old model keeps it until a new version is promoted.

## Explanations

Every `FLAG` and `BLOCK` carries a plain-language reason. It is produced in
three tiers, fastest first: a cache of identical decision shapes, a
deterministic template, and an AI-written version generated in the background.
The AI tier sees only the action, the amount and the signal descriptions. It
never receives names or account numbers.
