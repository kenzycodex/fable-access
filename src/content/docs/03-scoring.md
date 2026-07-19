# Scoring

Shield combines twelve additive signal layers. `FLAG` at ≥ 0.5, `BLOCK` at ≥ 0.8.

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

## Design decisions worth knowing

**Narration is deliberately weak.** Most customers leave it blank, so building
fraud detection on it would be theatre. Its weight is halved. Layers 8–12 carry
the load because a customer cannot opt out of them.

**The amount scale runs past 10x.** It used to cap there, which meant a student
sending 45x her baseline scored *lower* than someone at 8x who also tripped a
time anomaly — and passed. It now escalates through 25x and 50x tiers.

**Time uses the device clock.** Server UTC misplaces a Lagos evening by an hour,
which is enough to fire a false time anomaly every night.

## Cold start

A customer with fewer than three transactions has no personal baseline. Six
layers need something to compare against, so they used to skip silently — a
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
| Tunde — trader | ₦80k–400k | **PASS** 0.24 |
| Ada — salaried | ₦8k–55k | **FLAG** 0.564 |
| Chioma — student | ₦1.5k–9k | **FLAG** 0.552 |

Same recipient, same device, same moment. Three verdicts. That difference is
the entire argument for per-customer baselines.
