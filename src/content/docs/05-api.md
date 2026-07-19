# API Reference

Base URL: `https://api.fablehq.app` · Interactive OpenAPI spec at `/docs`

## Authentication

```
X-API-Key: fbl_live_...
```

The key decides which institution a write belongs to. It outranks any
institution the client claims — the key is authenticated, the claim is not.

## Shield

### `POST /v1/shield/analyze`

| Field | Type | Notes |
|---|---|---|
| `user_id` | string | **Required.** Unique per customer |
| `transaction.amount` | number | **Required** |
| `transaction.recipient_account` | string | **Required** |
| `transaction.recipient_name` | string | As resolved by NUBAN lookup |
| `transaction.channel` | enum | `mobile_app`, `ussd`, `pos`, `internet`, `atm` |
| `device` | object | Fingerprint from the SDK |
| `context` | object | Location, session, behavioural signals |
| `client_reference` | string | Stable id; makes replay idempotent |

Returns `risk_score`, `action`, `signals[]`, `explanation`, `transaction_id`.

### `POST /v1/shield/feedback`

Confirm whether a decision was correct. Feeds the baseline.

## Ghost

| Endpoint | Purpose |
|---|---|
| `POST /v1/ghost/create` | Open a cooling window |
| `GET /v1/ghost/{id}` | Container state |
| `POST /v1/ghost/{id}/cancel` | Return the money — no verification needed |
| `POST /v1/ghost/{id}/confirm` | Release — **requires a step-up token** |

A release without sufficient proof returns `401` naming the level required:

```json
{ "detail": { "error": "step_up_required", "level": "passkey" } }
```

## Step-up

| Endpoint | Purpose |
|---|---|
| `POST /v1/stepup/requirement` | Which factor does this decision need? |
| `POST /v1/stepup/passkey/register/begin` | Start passkey enrolment |
| `POST /v1/stepup/passkey/register/complete` | Finish enrolment |
| `POST /v1/stepup/passkey/auth/begin` | Start verification |
| `POST /v1/stepup/passkey/auth/complete` | Finish verification |
| `POST /v1/stepup/otp/send` | Send an out-of-band code |
| `POST /v1/stepup/otp/verify` | Verify a code |
| `POST /v1/stepup/identity-check` | Liveness — `501`, provider contract |

## Institutions

| Endpoint | Purpose |
|---|---|
| `POST /admin/provision` | Create a tenant, seed it, email credentials |
| `GET /v1/institutions/{id}` | Detail and customer roster |
| `POST /v1/institutions/resolve-key` | API key to institution |
| `GET /v1/branding/{id}` | Logo, palette, vanity URL |
| `PATCH /v1/branding/{id}` | Update branding |

## Dashboard

All reads take `?institution=` and are strictly tenant-scoped.

| Endpoint | Returns |
|---|---|
| `GET /v1/dashboard/stats` | Headline metrics |
| `GET /v1/dashboard/transactions` | Log; `?user=` filters to one customer |
| `GET /v1/dashboard/alerts` | Flagged and blocked |
| `GET /v1/dashboard/intelligence` | Scam patterns, channel risk, signals |
| `GET /v1/agents/overview` | Per-agent stats |

## Errors

| Code | Meaning |
|---|---|
| `400` | Invalid input |
| `401` | Bad API key, or step-up required |
| `404` | Unknown institution or container |
| `409` | Container already resolved |
| `429` | Rate limited |
| `501` | Needs a provider not configured |

Shield never fails open: if scoring throws, it returns a conservative `FLAG`
rather than passing the transfer.
