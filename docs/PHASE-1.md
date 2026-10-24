# Phase 1: noted, not built

Items found while running Phase 0 in production. Each needs a decision before
it is built.

## What teaches the baseline

A transfer counts as legitimate, and so feeds the customer's usual amounts,
recipients, devices and places, as soon as it is:

- passed by Shield (`routers/shield.py`, `confirmed_legitimate` on a PASS);
- approved after step-up (PIN, passkey or emailed code);
- released by the customer from a Ghost hold (`agents/ghost/account.py`).

A coached scam victim passes step-up and releases holds, because they believe
the story. And a test-then-escalate pattern (₦300k, then ₦800k, then ₦985k to
the same new account within hours) teaches Shield the pattern as normal while
it happens: in production on 20 October the third transfer passed at 0.374.

Options to weigh:

- a settling period (for example 24 to 72 hours) before a transfer feeds the
  baseline, so a burst cannot train it in real time;
- for step-up approvals and released holds, an analyst label (or no dispute
  within the settling period) before they count;
- an account first paid within the last day stays "new recipient" for scoring.

Changing what feeds the baseline changes whether signals fire, so past
decisions cannot be replayed under it. It would be a detection setting (the
Environment page), not an engine weight, with its own before-and-after report.
