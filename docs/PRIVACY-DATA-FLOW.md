# Privacy data flow

What personal data Fable receives, where it goes, how precisely it is kept, for
how long, and how a customer's request is answered. Written for an
institution's data protection officer and for anyone filling in the DPIA
([DPIA-TEMPLATE.md](DPIA-TEMPLATE.md)).

Fable processes customers' data on the institution's behalf. The institution
is the controller; Fable is its processor.

## 1. What comes in

| From | Data | Why |
|---|---|---|
| The bank's server (API key) | Customer reference, transfer amount, recipient account, bank and name, narration, channel, and optionally a NIP response code | Score the transfer |
| The customer's app or browser (through the bank) | Device fingerprint (platform, OS, browser, screen, GPU, language, timezone, touch), IP address, location (GPS with permission, else IP city), session length, how they signed in, whether account details were pasted, time to first input and to submit, average typing interval | Compare the transfer with how this customer usually banks |
| Imports (CSV or API) | Customer reference, name, phone, email, segment; past transfers | Start customers with history instead of cold |
| The customer, on their security page | PIN (hashed), passkeys (public key only), email and phone for codes | Verify it is them before money moves |

Not collected: keystrokes or what was typed, pointer movements, scroll
behaviour, card numbers, BVN or NIN. Pointer and scroll summaries were once
sent and discarded; the app no longer gathers them.

## 2. How precisely it is kept

| Data | Stored as |
|---|---|
| GPS coordinates | Rounded to 2 decimal places (about 1 km) on every decision and in the location history. Rows stored before this were coarsened once at startup |
| IP address | IPv4 without its last part (a.b.c.0), IPv6 to /48 |
| PIN | One-way hash with a server-side pepper |
| Passkeys | Public key and signature counter only |
| API keys, step-up tokens | Hashes |
| Webhook signing secrets, integration keys | Encrypted (AES-256-GCM, keys in the environment) |
| Narration and recipient name | As sent: the bank's own records hold them too |

Scoring reads city and country, never the coordinates or the IP address.

## 3. Where it goes

| Recipient | What | When |
|---|---|---|
| The institution's own webhook endpoint | Decision and hold events: transaction id, customer id and reference, amount, recipient account and bank, score, signals | Every decision and hold change |
| Email (the institution's SMTP server) | Codes and alerts to the customer's own confirmed address | When a code or alert is sent |
| SMS (Termii or Africa's Talking, when configured) | Codes and alerts to the customer's confirmed phone | As above |
| Anthropic or OpenAI (United States), when configured | Explanations: the action and signal codes only, no amount, no client text. Ask Fable: the institution's aggregate figures, recent decisions as amount, channel, score, signal names and the hour; the analyst's question with names, references, account numbers and contacts replaced by placeholders | When an explanation or an answer is generated |
| Map and IP-location services (Google, LocationIQ, Geoapify, OpenStreetMap Nominatim, BigDataCloud, ipapi.co) | Coordinates (to 4 decimal places for the lookup) or an IP address, to find a place name | When a customer shares location |
| Paystack | Account number and bank code, to resolve the account name | When a transfer is entered in the sandbox app |

Each bank's data is visible only to that bank. There is no cross-institution
sharing.

## 4. How long it is kept

A scheduled job (`services/retention.py`, every 6 hours) deletes or clears:

| Data | After |
|---|---|
| Decisions, imported history, holds, notifications, decision snapshots, analysts' notes on deleted decisions | `FABLE_RETENTION_DAYS` (default 1,825 days, 5 years) |
| Device, location, IP and session detail on decisions; the location history | `FABLE_RETENTION_DETAIL_DAYS` (default 730 days). The decision keeps amount, outcome, recipient and score |
| Uploaded import rows never applied | 7 days (applied rows are deleted as soon as the import finishes) |
| Sandbox inbox | 30 days |
| Spent step-up challenges and tokens | 1 day after expiry |
| Delivered webhook events | 30 days |

Both periods are operator settings with bounds (1 to 10 years; 120 days to 10
years). Every pass is recorded in the audit log. The audit log itself is kept
for the life of the agreement.

## 5. A customer's request

The institution answers it. In the console, on the customer's page, an owner can:

- **Download a copy**: everything held about the customer as JSON (decisions,
  imported history, holds, devices, locations, notifications, security
  settings without the PIN hash, passkey labels, audit events, decision
  snapshots). API: `GET /v1/customers/{id}/export`.
- **Erase them**: after typing the customer's reference. Their personal rows
  are deleted, analysts' notes on their transfers are deleted, delivered
  webhook payloads naming them are deleted, and their decisions and holds are
  kept only as anonymous outcomes under a random id with every identifying
  field cleared. Refused while a hold is in progress. The audit log records the
  erasure with a hash of the reference, so the bank can later prove it, without
  keeping the reference. API: `POST /v1/customers/{id}/erase`.

A customer can also switch location off themselves on their security page.
Turning it off needs a factor they already have, because it removes a check.

## 6. Decisions made by machine

Shield's decision is automated, but it never takes money away: a block can be
overridden into a cooling-window hold the customer can cancel, a flag asks for
a check, and the bank's analysts review flagged and blocked transfers and can
release a hold. Each decision carries a plain-language reason.
