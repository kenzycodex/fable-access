# Engine governance

How Shield's signal weights and decision thresholds are changed, and the evidence each change leaves behind for an audit.

These values decide who gets blocked at every bank. One wrong weight silently lets fraud through, or stops honest customers, everywhere at once. So a change is handled like a model change, not a settings change: proposed, measured against real past decisions, approved by a second person, rolled out safely, and reversible.

The decision itself stays deterministic and explainable ([PRODUCT-PRINCIPLES.md](PRODUCT-PRINCIPLES.md), principle 1). The governance only controls which numbers the rules use.

## What is managed here

| Managed on the **Engine** page | Approved on the **Environment** page instead |
|---|---|
| Signal weights: `FABLE_W_*` (amount tiers, new recipient, time, device, location, timezone, session, behaviour, failed verification, velocity) | `FABLE_VELOCITY_WINDOW_MIN`, `FABLE_VELOCITY_FLAG`, `FABLE_VELOCITY_HIGH` |
| Default thresholds: `FABLE_BLOCK_THRESHOLD`, `FABLE_FLAG_THRESHOLD` | `FABLE_TENURE_DISCOUNT_MAX`, `FABLE_TENURE_FULL_AT` |
| Per-channel thresholds: `FABLE_THRESHOLD_<CHANNEL>_BLOCK` and `_FLAG` | `FABLE_RECIPIENT_MEMORY_DAYS` |
| Channel risk weights: `FABLE_CHANNEL_*` (internet, POS, mobile app, USSD, ATM, QR, branch, any other) | |

A channel weight at or below 0.05 adds nothing, which is how an in-person branch transfer carries no channel signal. Every decision records its channel's weight either way, so a backtest shows what raising a quiet channel above that line would do.

The right-hand column changes *whether* a signal fires, not how much it weighs. A past decision cannot be replayed exactly under a different velocity window or tenure curve, so those values cannot be backtested honestly. They are approved settings on the Environment page (second owner, step-up, audit, rollback), shown read-only on the Engine page under **Detection rules**, and every decision's `engine_params_hash` covers them too. A full re-scoring shadow, which would let them be previewed before approval, is a later step. The ML anomaly boost and the NIP response-code boosts are not tunable at all.

The API rate limit and the explanation time limit are ordinary platform settings on the **Environment** page (see [SECRETS.md](SECRETS.md)).

Each bank's own risk policy (its base thresholds and hold windows, set in its console) still sits on top of the platform values, exactly as before.

### Where the values come from

1. The server environment wins. A `FABLE_W_*` or threshold variable still set in `api/.env` is used as is, and the Engine page shows it as set there, read-only.
2. Otherwise, the live version approved on the Engine page.
3. Otherwise, the built-in defaults.

### Weights added after a version was approved

A weight introduced by a release is read, for any version stored before it existed, as the value that reproduces the old behaviour (`LEGACY_FILL` in `core/engine_config.py`), so shipping code never changes a decision. Introducing a weight is exempt from the one-version step limit; moving it afterwards is not. The release offers the new values once as a system draft, for an owner to backtest, propose, shadow and promote:

- **First transfers (no history):** amount tiers from NGN 100k to NGN 20m. Old versions read them as 0.
- **Anomaly model:** `ml_anomaly` (the nearest-neighbour model, 0.10 by default) and `ml_anomaly_previous` (the retiring Isolation Forest). Old versions read them as 0 and 0.10, which is exactly how they scored.

A second release offers its own draft, separate from the first so each can be judged alone. It is based on the active version, never on a version already proposed, approved or in shadow:

- **Balance drain:** `balance_drain_80` (0.10), `balance_drain_all` (0.16) and `balance_drain_combo` (0.10, on top, to a new recipient or from a new device). Old versions read them as 0.
- **Location:** `location_place` and `location_place_large` (0.06 and 0.12) judge a new place by distance from where the customer has been (45 km), falling back to normalised city names; the name-only `location_city` weights are set to 0 in the draft. Old versions read the place weights as 0 and keep their city weights, so they score as approved.

Every decision records the drain and place terms even at weight 0. Decisions before this release recorded neither, and the backtest does not rebuild them, so it under-reports both changes; the shadow run shows them in full.

Decisions made before a release did not record its terms. The backtest rebuilds them for those rows and counts them as "rebuilt": the first-transfer term from the stored amount and the cold-start signal, the previous anomaly model's fixed points as its weighted term, and the current anomaly model from the customer's confirmed history before the decision (as it stands now, so a transfer confirmed later counts as confirmed). Under the live values a rebuilt term adds exactly what the decision had, so replay fidelity is unchanged.

### What each change does

A draft can carry several changes, like the release draft's first-transfer weights and anomaly model. The backtest and the shadow comparison both replay each group of changes (as the Engine page groups weights; all thresholds are one group) on its own against the live values, and show how many decisions it moves, in which direction, with up to five examples. Changes can interact, so the groups need not add up to the draft's total.

On first boot, version 1 is seeded from the values in force at that moment (the environment over the code defaults), so shipping the Engine page changed no decision. Backtests, shadow and live scoring all use the effective values: the environment first, then the version. Every backtest report lists which keys came from the environment.

## The procedure

1. **Draft.** A platform admin or owner edits weights and thresholds. The bounds are enforced when the draft is saved:
   - weights between 0 and 0.5;
   - floors on signals that must never be tuned away: failed verification at least 0.05, 0.10 and 0.15 for its three tiers, device anomaly at least 0.04 (0.08 on a large transfer), new recipient at least 0.10;
   - thresholds between 0.20 and 0.95, with the flag at least 0.10 below the block;
   - no value moves by more than 0.15 from the live version in one step.
2. **Backtest.** Required before proposing. The draft is replayed against the last 30, 60 or 90 days of real decisions across every bank (see *The backtest*, below).
3. **Propose.** A platform owner proposes, with a passkey or authenticator step-up. The backtest must be of these exact parameters and less than 24 hours old.
   - **Drift cap.** No weight may sit more than 0.30 from its value in the version that was live 30 days ago (or version 1, if none was) unless a written reason is given. Without one, the proposal is refused.
   - **Frozen.** From this point the parameters cannot change. The proposal records their SHA-256. Any edit means a new draft, a new backtest and a new approval.
4. **Approve.** A *different* platform owner approves within 24 hours, with a step-up. With only one owner, the proposal instead waits a 12-hour cooling-off period, every owner is emailed, and it can be cancelled until then. These are the same rules as the Environment page (`services/approvals.py`).
   - **Impact acknowledgement.** If the backtest raised any impact warning, the approver must tick "I've reviewed the impact" (the proposer does, when there is only one owner). The approval records it.
   - Approval records the parameters' SHA-256 again.
5. **Shadow.** By default, an approved version first runs in shadow for a chosen number of days (3 by default, up to 30). Live decisions are unchanged. Each new transfer is also re-scored under the shadow version and the disagreements are shown on the page. Shadow scoring runs after the live decision is committed, re-adds the decision's stored score parts, and any error in it is logged and ignored: it can never change or delay a live decision.
6. **Promote.** An owner promotes with a step-up. Every process picks the new version up within 30 seconds, with no restart. Promotion without shadow is possible but is shown as a warning.
7. **Roll back.**
   - *Emergency:* back to the version that was live just before the current one. One owner and a step-up; it applies at once and every owner is alerted.
   - *Any other earlier version:* a new version with the same parameters, through normal maker-checker. It goes live as soon as it is approved.
8. **Audit.** Every step is written to the hash-chained secret audit (`secret_audit`, name `engine`) and the main audit log, mirrored to the log stream, and emailed to the owners.

Shadow and promotion refuse any version whose stored parameters no longer match the approved hash.

## The backtest

Shield's score is additive. Since the Engine page shipped, every decision stores *how* its score was built (`transactions.score_parts`): which weight each signal used and by what coefficient, plus the fixed contributions (cold start, channel risk, scam pattern, NIP code), the tenure discount and the NIP-34 override. The anomaly signal is stored as each model's 0..1 value against its weight (`ml_anomaly`, `ml_anomaly_previous`), so either model replays; decisions made before that stored it as a fixed contribution. The live engine and the backtest add those parts with the same function (`agents/shield/weights.py`), so re-scoring a stored decision under other weights is exact by construction.

Each report compares two replays of the same rows: under the live parameters ("now") and under the draft. That isolates the draft's own effect: an unchanged draft reports zero changed decisions. How faithfully "now" reproduces what was actually decided is reported separately.

Older decisions, from before score parts were recorded, are rebuilt from their signal text against version 1's weights and counted as *approximate*. A row whose signals cannot be read is *skipped*, never guessed.

The report gives:

- the before and after PASS, FLAG and BLOCK matrix;
- outcomes, with the labels kept apart:
  - fraud confirmed by an analyst (`review_outcome`);
  - transfers an analyst confirmed legitimate;
  - Ghost holds the customer cancelled, a weaker signal, since customers cancel for other reasons too;
- precision, recall and false-positive rate on analyst labels, using the same definitions as `eval/harness.py`;
- breakdowns by channel and by bank;
- exact, approximate and skipped row counts.

The rules that keep it honest:

- **No outcome is not caught fraud.** A blocked transfer that nobody labelled never completed, so nobody knows whether it was fraud. Such rows are reported as "no outcome" and never counted as caught.
- **Sample sizes are shown.** Every metric carries the number of labelled rows behind it, with a warning below 30.
- **Each bank's current risk policy applies** in the replay (`thresholds_for(channel, institution)`). There is no policy history, so the report says so.

### Impact warnings

A proposal needs the impact acknowledged when any of these happens:

- the overall block rate moves by more than 25%;
- any single bank or channel's block rate moves by more than 25%, or by more than 2 percentage points, on at least 5 decisions;
- confirmed-fraud misses rise.

## Evidence for an audit

| Question | Where the answer is |
|---|---|
| Which weights and thresholds scored this transfer? | `transactions.engine_version` and `engine_params_hash`, shown on the case and in the transactions CSV. The version's parameters are on the Engine page. |
| Why was this version introduced? | The version's note, its backtest report and, for a large drift, its written reason. |
| Who proposed, approved, shadowed, promoted or rolled it back, and when? | The Engine page history, `engine_versions` and `engine_activations`, and the `engine.*` events in `secret_audit` (`scripts/verify_secret_audit.py` checks the chain). |
| Did anyone review the impact? | `impact_ack` on the version, and the approval event. |
| Has anything been altered since approval? | The parameters' SHA-256 against `approved_hash`. Shadow and promotion refuse a mismatch. |

## After deploy

1. Confirm new decisions are written with a version (read-only):

   ```bash
   docker compose exec -T api python -c "from core.db import cursor
   with cursor() as c:
       c.execute('SELECT id, created_at, engine_version, substr(engine_params_hash,1,12) h FROM transactions ORDER BY created_at DESC LIMIT 5')
       [print(dict(r)) for r in c.fetchall()]"
   ```

2. On the Engine page, check that version 1 matches today's values, then make a draft with no changes, backtest it, and check it reports 0 changed decisions. Discard the draft.
3. Move the weights and thresholds out of `.env`:

   ```bash
   cd /var/www/fable/api
   docker compose exec -T api python scripts/import_env_engine.py           # what is stored, what differs
   docker compose exec -T api python scripts/import_env_engine.py --apply   # only if anything differs
   cp .env /root/env-backup-before-engine && chmod 600 /root/env-backup-before-engine
   NAMES=$(docker compose exec -T api python scripts/import_env_engine.py --stored | tr -d '\r')
   echo "$NAMES"
   sed -i -E "/^($NAMES)=/d" .env
   docker compose up -d --force-recreate
   docker compose exec -T api python scripts/verify_secret_audit.py
   rm /root/env-backup-before-engine
   ```

   Then move `FABLE_RATE_LIMIT_MAX`, `FABLE_RATE_LIMIT_WINDOW` and `FABLE_EXPLAINER_TIMEOUT` with `scripts/import_env_secrets.py`, as for the other platform settings.

## Standards this follows

The mapping is to frameworks, not quoted clauses.

* **CBN Risk-Based Cybersecurity Framework 2024 and CBN guidance on governance and change control.** Separation of duties, change approval, audit trail.
* **ISO/IEC 27001:2022.** A.8.32 (change management), A.5.3 (segregation of duties), A.8.15 (logging).
* **Model risk management practice** (for example, the SR 11-7 principles): evidence before a change, independent review, monitoring in parallel before use, and the ability to revert.

## What every decision records

| Recorded | Where | What for |
|---|---|---|
| Engine version and a hash of its parameters plus the detection settings | `transactions.engine_version`, `engine_params_hash` | Which rules decided, exactly |
| How the score was built, term by term | `transactions.score_parts` | Exact replay under any other weights (backtest, shadow) |
| The shadow version's verdict, when one runs | `transactions.shadow_version`, `shadow_action`, `shadow_score` | The shadow comparison |
| The feature snapshot | `decision_features` (`agents/shield/features.py`) | Training and backtesting a later per-customer model on what was known at the time |

The snapshot also records the Copilot and Ghost code versions and the
institution's hold windows in force. Ghost's hold windows and the flag and
block lines per institution are the bank's risk policy (owner-only, audited);
detection settings such as the velocity window and recipient memory are
operator settings changed through approval with a cooling-off period, two-person when there are two owners (docs/SECRETS.md).

Labels are kept apart and never mixed: an analyst's outcome
(`review_outcome`: fraud or legitimate), a customer cancelling a hold
(`status = cancelled`, a weaker signal), and no outcome. The
`decision_dataset` view joins each snapshot to its decision and current label
for training; the label is never copied into the snapshot because it changes
afterwards.
