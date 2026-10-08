# Identity Assurance

Shield answers *how risky is this?*. Assurance answers the question that makes
containment actually hold: *who must prove they are here, and with what?*

## The hole this closes

Ghost's release path originally checked only that the caller claimed to be the
account holder, and the client supplies that id about itself. Containment was
therefore defeated by the exact session compromise that triggered it: an
attacker holding the tab could press "release" and the money left, with all
fourteen scoring layers having correctly fired.

**Releasing costs proof. Cancelling stays free**, because returning money is
always safe.

## Why the factor's location matters more than its type

A PIN prompt inside a compromised session is theatre, because the attacker has
that prompt too. Only two kinds of factor cost an attacker anything:

| Kind | Example | Why it holds |
|---|---|---|
| **Device-bound** | Passkey / platform biometric | Private key never leaves the secure element |
| **Out-of-band** | Code to the registered address | Arrives on a channel the session doesn't control |

## Tiers

`POST /v1/stepup/requirement` returns the level a decision needs. There are
five, from lightest to heaviest:

| Level | Factors | When |
|---|---|---|
| `none` | n/a | A `PASS`: cleared on the existing session |
| `pin` | Transaction PIN | A `FLAG` with no identity signal (unfamiliar device, new location, timezone shift) |
| `passkey` | Device biometric | A `FLAG` with an identity signal, or the customer asked to always be challenged |
| `passkey_and_otp` | Biometric and an emailed code | A `BLOCK`, or a `FLAG` with several identity signals |
| `identity_check` | Liveness check | A `BLOCK` driven by identity signals (the mule and takeover shape) |

Releasing a Ghost container is **always at least one tier above the transfer
itself**. Ghost exists because the transfer was already judged dangerous, so
release is the single most attacker-valuable action in the product, and asking
again for what the attacker already used to get in would defeat it.

Risk arising from *identity* signals implies the session may not belong to the
customer, so those cases escalate to a factor the session cannot satisfy rather
than asking for one more thing the attacker already has.

A customer's own "always ask" preference can only ever raise the requirement.

## Guarantees

Challenges and tokens are single-use, expiring (10 minutes), and bound to a
user, a purpose and a reference. Proof minted to confirm a small transfer cannot
be replayed to release a large one. Wrong reference, wrong purpose, wrong user
and replayed tokens are all refused.

The PIN is hashed, rate-limited and locked after repeated failures. A factor
enrolled *after* a container was created does not count towards releasing it,
so an attacker cannot add their own device mid-incident.

Failed attempts are recorded and fed back as scoring signal 13: three failed
biometrics before a large transfer is about the clearest evidence available.

## What is real

- **Passkeys**: genuine WebAuthn, signatures verified with `py_webauthn`. Real
  Face ID, Touch ID, Windows Hello. Only the public key and a signature counter
  are stored.
- **Email OTP**: real, over configured SMTP. Codes are stored hashed and
  compared in constant time. There is no SMS provider wired yet.
- **PIN**: real, hashed, rate-limited.
- **Liveness / face check**: deliberately **not** implemented. Returns `501`
  with the provider contract (Smile ID, Dojah, Prembly). Faking it would make
  the strongest tier the least trustworthy.

## Why this improves rather than replaces

Banks already own PIN, biometric, OTP and BVN-linked face data. What nobody
does well is decide *when* to demand which. Today it is a static rule, which is
exactly why scammers coach victims through OTPs: the threshold is predictable.

Fable makes the demand behaviourally driven and unpredictable to the attacker:
the same ₦50,000 that clears silently for one customer forces a stronger factor
for another on a new device in a new city. The bank keeps its auth stack; Fable
decides the moment.
