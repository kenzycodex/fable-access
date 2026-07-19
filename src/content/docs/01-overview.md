# Overview

Fable is fraud infrastructure African banks plug into. It does not replace a
bank's existing controls — it decides *when* those controls should fire.

## The problem

Nigerian fraud is not primarily a technical break-in. It is social engineering:
the customer is talked into authorising the transfer themselves. Every
credential checks out, every rule passes, and the money is gone in the ten
seconds NIP takes to clear.

Static rules ("OTP above ₦100,000") fail because they are predictable. A
scammer who knows the threshold coaches the victim through it.

## The approach

Fable scores a transfer against **that specific customer's** behaviour, not a
global threshold. The same ₦250,000 that is routine for a trader is a hard
flag for a student.

| Agent | Responsibility |
|---|---|
| **Copilot** | Learns each customer's genuine habits |
| **Shield** | Scores every transfer through 12 signal layers |
| **Ghost** | Holds risky transfers in a recoverable cooling window |
| **Watch** | Continuous monitoring between transactions *(not built)* |

## Architecture

```
Bank's app ──► Fable SDK ──► POST /v1/shield/analyze
                                    │
                          ┌─────────┴─────────┐
                     Copilot baseline    12 signal layers
                                    │
                     PASS ──── FLAG ──── BLOCK
                                          │
                                    Ghost containment
                                          │
                              Institution console
```

Two runtimes: a Next.js frontend and a FastAPI intelligence layer. The frontend
degrades to a local scoring engine when the API is unreachable, and queues those
transfers for sync — so a network failure never stops a bank working.

## What is real, and what is not

Being precise about this matters more than a longer feature list.

**Real:** device fingerprinting, GPS/IP geolocation, behavioural biometrics,
Paystack NUBAN resolution, WebAuthn passkeys with verified signatures, the
12-layer scoring pipeline, multi-tenant isolation, offline sync.

**Not built:** Watch (marked "coming soon" rather than faked), and the
liveness/face-check tier, which returns `501` with its provider contract rather
than a fake pass. Making the strongest tier the least trustworthy would defeat
its purpose.
