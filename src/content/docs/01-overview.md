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
| **Shield** | Scores every transfer against the customer's own history |
| **Ghost** | Holds risky transfers in a recoverable cooling window |
| **Watch** | Continuous monitoring between transactions *(not built)* |

## Architecture

```text
Bank's server ──► POST /v1/shield/analyze
                                    │
                          ┌─────────┴─────────┐
                     Copilot baseline    Shield signals
                                    │
                     PASS ──── FLAG ──── BLOCK
                                          │
                                    Ghost containment
                                          │
                    Institution console + webhooks
```

Two runtimes: a Next.js frontend and a FastAPI scoring service. Every decision
is made on the server. If the service cannot be reached, the sandbox app says
so and sends nothing; it never invents a verdict on the device.

## What is real, and what is not

Being precise about this matters more than a longer feature list.

**Live:** device fingerprinting, location (GPS with permission, or IP),
typing and paste signals, Paystack NUBAN resolution, WebAuthn passkeys with
verified signatures, the scoring pipeline with governed engine versions,
multi-tenant isolation, Ghost holds with durable webhooks, one-time codes by
email or SMS (Termii or Africa's Talking), an analyst review queue, console
roles (owner, analyst, viewer), and risk thresholds and hold windows each
institution can set for itself.

**Planned, not built:** cross-institution intelligence sharing (each
institution's data is strictly its own today), Watch (monitoring between
transfers), and a face or liveness check, which returns `501` with its provider
contract rather than a fake pass. Making the strongest tier the least
trustworthy would defeat its purpose.
