# API Reference

Base URL: your Fable API host (`$FABLE_API_URL` in the examples) · Interactive
OpenAPI spec at `/docs` on that host

## Authentication

Server-to-server calls carry the institution API key in either header:

```http
X-API-Key: fbl_live_...
Authorization: Bearer fbl_live_...
```

The key decides which institution a write belongs to. It outranks any
institution the client claims, because the key is authenticated and the claim
is not.

| Caller | Credential |
|---|---|
| Your backend or app | Institution API key (`X-API-Key`) |
| Console users | Signed session from `POST /auth/login`, sent as the `X-Fable-Session` header |
| Provisioning (Fable operators only) | `X-Fable-Operator-Key` |

Console users have a role: **owner** (everything), **analyst** (review work
and reads) or **viewer** (reads only). The API checks the role on every call, so
a control hidden in the console is also refused by the server. An API key acts
with analyst rights: it can read and report outcomes, but cannot manage people,
keys, webhooks or policy.

An institution in **live** mode refuses, without its key, any request that
names it or concerns one of its customers, holds or transactions: scoring,
balances, verification, Ghost holds, approvals and notifications alike. Sandbox
institutions, including every demo bank, accept these by name.

`/`, `/health`, `/docs` and `/openapi.json` are always public. Requests are rate
limited per client (default 180 per 60 seconds), and exceeding it returns `429`.

## Shield

### `POST /v1/shield/analyze`

| Field | Type | Notes |
|---|---|---|
| `user_id` | string | **Required.** Unique per customer |
| `transaction.amount` | number | **Required.** Greater than 0 |
| `transaction.recipient_account` | string | **Required** |
| `transaction.currency` | enum | `NGN` only today |
| `transaction.recipient_bank_code` | string | NIP bank code, e.g. `058` |
| `transaction.recipient_name` | string | As resolved by NUBAN lookup |
| `transaction.narration` | string | Up to 500 characters |
| `transaction.channel` | enum | `mobile_app`, `ussd`, `pos`, `internet`, `atm`, `qr`, `branch`, `unknown` |
| `device` | object | Fingerprint and traits from the SDK. All optional |
| `context` | object | Location, session and behavioural signals. All optional |
| `client_reference` | string | Stable id. Makes an offline replay idempotent |

Returns:

| Field | Meaning |
|---|---|
| `risk_score` | 0 to 1 |
| `risk_level` | `LOW`, `MEDIUM` or `HIGH`, against the channel's own cutoffs |
| `action` | `PASS`, `FLAG` or `BLOCK` |
| `signals[]` | Plain strings, each with its contribution, e.g. `new_recipient: ... (+0.2)` |
| `explanation` | Plain-language reason |
| `explanation_source` | `cache`, `template`, `llm` or `pending` |
| `decision_ms` | Time to the verdict. What the 200ms budget governs |
| `latency_ms` | Total handler time, explanation bookkeeping included |
| `transaction_id` | Use it for status updates, feedback and explanations |

A transfer above the available balance returns `422` with
`error: "insufficient_funds"` and the shortfall.

### `GET /v1/shield/explanation/{transaction_id}`

Collects the richer write-up when `explanation_source` was `pending`. Returns
`ready: true` once it exists.

### `POST /v1/shield/feedback`

`{ "user_id", "transaction_id", "was_fraud" }`. Reports how a decision turned
out. Needs your API key or a console session, and only touches your own
institution's transactions. It resolves the matching review case.

## Transactions

| Endpoint | Purpose |
|---|---|
| `POST /v1/transactions/{id}/status` | Record a lifecycle outcome (`completed`, `cancelled`, `released`...). Moves no money. Confirming a transfer teaches Copilot |
| `POST /v1/transactions/{id}/approve` | Approve a flagged transfer once its factor is proven |

## Ghost

| Endpoint | Purpose |
|---|---|
| `POST /v1/ghost/create` | Open a cooling window. Its length follows the institution's risk policy (15, 10 or 5 minutes by default) |
| `GET /v1/ghost/{id}` | Container state |
| `POST /v1/ghost/{id}/cancel` | Return the money. No verification needed |
| `POST /v1/ghost/{id}/confirm` | Release. **Requires a step-up token** |

| Status | Meaning |
|---|---|
| `401` | `step_up_required`, naming the level needed |
| `403` | The caller is not the container's owner |
| `409` | Already resolved, or Ghost is switched off for this institution |
| `410` | The window expired. Cancel is still available |

```json
{ "detail": { "error": "step_up_required", "level": "passkey" } }
```

## Step-up

| Endpoint | Purpose |
|---|---|
| `POST /v1/stepup/requirement` | Which level does this decision need? Body: `user_id`, `risk_score`, `signals`, `action`, `purpose` (`transfer` or `ghost_release`) |
| `POST /v1/stepup/pin/verify` | Verify the transaction PIN |
| `POST /v1/stepup/passkey/register/begin` | Start passkey enrolment |
| `POST /v1/stepup/passkey/register/complete` | Finish enrolment |
| `GET /v1/stepup/passkey/{user_id}` | Registered passkeys |
| `POST /v1/stepup/passkey/auth/begin` | Start verification |
| `POST /v1/stepup/passkey/auth/complete` | Finish verification, returns a token |
| `POST /v1/stepup/otp/send` | Send an out-of-band code by email |
| `POST /v1/stepup/otp/verify` | Verify a code, returns a token |
| `POST /v1/stepup/identity-check` | Composed tier. Liveness itself returns `501`, a provider contract |

Tokens last 10 minutes, are single-use, and are bound to one user, purpose and
reference.

## Accounts and security

| Endpoint | Purpose |
|---|---|
| `GET /v1/accounts/{user_id}` | Balance |
| `GET /v1/accounts/{user_id}/statement` | Ledger entries |
| `POST /v1/accounts/{user_id}/topup` | Sandbox top-up, with per-transfer and daily limits |
| `GET /v1/accounts/{user_id}/security` | PIN, 2FA preference and contact status |
| `POST /v1/accounts/{user_id}/security/pin` | Set or change the PIN. Its length is `FABLE_PIN_LENGTH` (4 by default); changing it needs the current one |
| `POST /v1/accounts/{user_id}/security/two-factor` | Toggle "always ask" |
| `POST /v1/accounts/{user_id}/security/contact` | Where the customer's own codes are sent |

## Notifications and Copilot

| Endpoint | Purpose |
|---|---|
| `GET /v1/notifications/{user_id}` | Customer alerts (containment, blocked, flagged) and whether they were delivered |
| `POST /v1/notifications/{user_id}/read` | Mark read |
| `GET /v1/copilot/transparency/{user_id}` | Everything Fable has learned about this customer's baseline |
| `POST /v1/assistant/chat` | Analyst assistant for the console. Answers only from the institution's own numbers |

## Institutions

| Endpoint | Purpose |
|---|---|
| `POST /admin/provision` | Create a tenant, seed it, email credentials. Operator key required. Optional `institution_type` (a commercial bank, a fintech, a payment gateway...) |
| `GET /v1/institutions/{id}` | Detail and customer roster. Never returns credentials |
| `PATCH /v1/institutions/{id}` | Edit the institution's name, type and contact email. Owner only. The id, sign-in email and demo URL do not change |
| `GET /v1/institutions/{id}/credentials` | The institution's API key, masked. The full key is never returned: only a hash is stored |
| `POST /v1/institutions/{id}/keys/rotate` | Issue a new key and retire the old one immediately. Owner only. The new key is returned once |
| `GET` / `PUT /v1/institutions/{id}/settings` | Risk policy: flag and block thresholds and Ghost hold windows. Writing is owner only and audited |
| `PUT /v1/institutions/{id}/mode` | `sandbox` or `live`. Owner only |
| `POST /v1/institutions/{id}/customers/{user_id}/pin/reset` | Clear a customer's PIN so they choose a new one. Analyst or owner. Audited |
| `POST /v1/institutions/resolve-key` | API key to institution |
| `GET /v1/branding/{id}` | Logo, palette, vanity URL |
| `GET /v1/branding/resolve/{slug}` | Vanity slug to institution |
| `PATCH /v1/branding/{id}` | Update branding. Owner only. A slug change locks for a cooling period |
| `POST` / `DELETE /v1/branding/{id}/logo` | Upload or remove the logo. Owner only |

## Console auth

| Endpoint | Purpose |
|---|---|
| `POST /auth/login` | Email and password, returns the signed session, role and name |
| `GET /auth/me` | The signed-in user and their current role |
| `POST /auth/forgot-password` | Email a reset link |
| `POST /auth/reset-password` | Complete a reset, or accept a team invite |
| `POST /auth/change-password` | Change the signed-in user's own password |

## Team

| Endpoint | Purpose |
|---|---|
| `GET /v1/team` | Members, roles and pending invites |
| `POST /v1/team/invite` | `{ email, role, name? }`. Emails a set-password link valid for 7 days. Owner only |
| `PATCH /v1/team/{email}` | Change a role. Owner only. The last owner cannot be demoted |
| `DELETE /v1/team/{email}` | Remove access, effective on their next request. Owner only |

## Review queue

Every flagged or blocked transfer is a case. Analyst actions label and route a
case; they never move money.

| Endpoint | Purpose |
|---|---|
| `GET /v1/review/queue` | Cases. Filters: `state` (`open`, `in_review`, `escalated`, `resolved`, `active`), `action`, `assignee` (`me` or an email), `from`, `to` |
| `GET /v1/review/counts` | Cases by state, plus confirmed fraud and legitimate |
| `GET /v1/review/{id}` | The case, notes, customer history, any Ghost hold, and its activity |
| `POST /v1/review/{id}/assign` | `{ assignee }`: an email, `"me"`, or `null` |
| `POST /v1/review/{id}/escalate` | `{ reason? }` |
| `POST /v1/review/{id}/notes` | `{ body }` |
| `POST /v1/review/{id}/resolve` | `{ outcome: "fraud" \| "legitimate", note? }`. Sends `case.resolved` to webhooks |
| `POST /v1/review/{id}/reopen` | Withdraw a resolution |

## Webhooks

See [Integration](#integration) for payloads and signature verification.

| Endpoint | Purpose |
|---|---|
| `GET /v1/webhooks` | Endpoints and their last delivery |
| `POST /v1/webhooks` | `{ url, events[] }`. Public https only. Returns the signing secret once. Owner only |
| `DELETE /v1/webhooks/{id}` | Remove an endpoint. Owner only |
| `POST /v1/webhooks/{id}/test` | Send a signed test event now. Owner only |
| `GET /v1/webhooks/{id}/deliveries` | Every attempt, with status code or error |

## Dashboard

Reads are scoped to the institution on the caller's session, never to a value
the client supplies.

| Endpoint | Returns |
|---|---|
| `GET /v1/dashboard/stats` | Headline metrics |
| `GET /v1/dashboard/transactions` | Log. Filters: `user`, `action`, `from`, `to` (YYYY-MM-DD, inclusive) |
| `GET /v1/dashboard/report` | A board summary for `from`/`to`: volume, money kept from fraud, review outcomes, latency, channels, top signals and controls |
| `GET /v1/dashboard/export/transactions.csv` | Every transaction in a range, as CSV. Same filters |
| `GET /v1/dashboard/export/audit.csv` | The audit trail in a range, as CSV |
| `GET /v1/dashboard/alerts` | Flagged and blocked |
| `GET /v1/dashboard/intelligence` | Scam patterns, channel risk, signals |
| `GET /v1/dashboard/compliance` | Audit counts, incidents and the recorded audit events: containment, step-up passes and failures, PIN changes and resets, top-ups |
| `GET /v1/agents/overview` | Per-agent stats |
| `GET /v1/agents/copilot/customers` | Customer baselines, plus balance and verification status (PIN set or locked, passkeys, code contact) |
| `GET /v1/agents/shield/decisions` | Recent decisions |
| `GET /v1/agents/ghost/containers` | Containment activity |

## Errors

| Code | Meaning |
|---|---|
| `400` | Invalid input, or a wrong PIN or code |
| `401` | Bad or missing credential, or step-up required |
| `403` | Not the owner of the resource |
| `404` | Unknown institution, transaction or container |
| `409` | Already resolved, name collision, or agent switched off |
| `410` | Ghost container expired |
| `422` | Failed validation, or insufficient funds |
| `429` | Rate limited |
| `501` | Needs a provider that is not configured |
| `503` | Provisioning disabled: no operator key set |

Shield never fails open: if scoring throws, it returns a conservative `FLAG`
rather than passing the transfer.
