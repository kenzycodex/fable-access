# Product principles

The rules Fable's code follows, and why. Each one comes from the research in [research/](research/README.md) or from the standards named here. The status column records where the code stands today. When a rule changes, change it here first.

| # | Principle | Why | Status |
|---|---|---|---|
| 1 | **The decision is deterministic.** A score and a PASS, FLAG or BLOCK come from rules and an anomaly model, never from an LLM. The same input always gets the same decision. | A bank must be able to show a regulator why a transfer was stopped, months later. | Done. `agents/shield/analyzer.py`. Every decision records the engine version and parameter hash that scored it, and how its score was built, so it can be traced and replayed exactly |
| 2 | **The LLM is off the critical path.** It only rewrites the engine's reason codes into plain language, after the decision. A slow or failed model leaves the template explanation in place. | LLMs are non-deterministic, can invent reasons, and can be steered by text an attacker controls. | Done. `agents/shield/explainer.py` |
| 3 | **Nothing the customer typed reaches the LLM as instructions.** Narration and recipient names are not sent. Signal text that carries client data (a city, for example) is sanitised and quoted as data. | Narrations and beneficiary names are written by whoever is running the scam. | Done. The explanation model gets signal codes only (`model_facts`); Ask Fable pseudonymises customers and strips account, phone, ID, card and email values before any provider call (`agents/copilot/redact.py`). Tested in `test_prompt_privacy.py` |
| 4 | **Ghost pauses; it never holds money.** A held transfer is a short, customer-releasable pause inside the bank's own flow, before submission to the payment rail. In the sandbox it runs on a simulated ledger. | There is no Nigerian equivalent of the UK's legal right to delay a payment. Fable is decision support, not a payment processor. | Done in design and wording. Production holds are the bank's integration |
| 5 | **Fable is the fraud-scoring component, not "AML in a box".** It supplies real-time, customer-profile-based scoring alongside a bank's AML stack. No sanctions screening, STR filing or AML case management. | CBN's March 2026 automated AML standards require monitoring against the full customer profile. Fable covers that part, not the rest. | Done |
| 6 | **Every row belongs to one bank, and only that bank can reach it.** Banks are identified by credential (API key or console session), never by a name in the request. Customer identity is the bank plus the bank's own customer reference. Another bank's customer is "not found". | A shared pool or a guessable id is a data leak between banks. CBN cybersecurity framework: least privilege, access enforcement. | Done. `core/tenancy.py` guards; `test_tenant_isolation.py` |
| 7 | **No demo data or default tenant.** A provisioned bank starts empty. Customers and history arrive by import, the API or manual entry in the console. | Synthetic data in a production system misleads analysts and contaminates baselines. | Done. Operator provisioning creates an empty sandbox; imports in `services/imports.py` |
| 8 | **Collect only what scoring needs.** Behavioural signals are stored as derived features (average typing interval, paste flag, time to submit), never raw keystrokes. No card numbers or banking passwords. | NDPA 2023 data minimisation. Typing rhythm may count as biometric data under GAID 2025. | Done. The API accepts derived measures only and drops anything else (`test_prompt_privacy.py`) |
| 9 | **Credentials are hashed to current OWASP guidance.** Argon2id first. PINs also get a server-side pepper, because a 4 to 6 digit PIN can be brute-forced offline from any hash. The goal in production is that the bank verifies PINs and Fable only receives pass or fail. | OWASP Password Storage Cheat Sheet. 200,000 PBKDF2 rounds is below its 600,000 floor. | Done. Argon2id for passwords; PINs are Argon2id over an HMAC with a versioned pepper. Older hashes upgrade at next correct entry. Attempt limits and lockout unchanged |
| 10 | **Privileged access is individual, strong and audited.** Console members and Fable operators sign in as themselves. Operators use MFA. Role changes, key rotation, imports, provisioning and suspensions are written to the audit log. | CBN cybersecurity framework: MFA for privileged access, separation of duties, audit logging. | Done. Operators sign in with a password and an authenticator; integration-key changes need a passkey or fresh code, a second owner, and are hash-chained in their own audit (see SECRETS.md) |
| 11 | **Explained pauses beat silent blocks.** A customer can release a flagged or held transfer after verifying, and trusted payees stop triggering checks. | Research found about a third of wrongly declined customers stop using that provider (Javelin, 2015, US card data). | Done |
| 12 | **Say NDPA, not NDPR.** Fable is a data processor for each bank, under the Nigeria Data Protection Act 2023 and the NDPC's GAID 2025. A DPIA and a data processing agreement come before any live pilot. | The NDPR stopped applying on 19 September 2025. | Docs and legal pages aligned |
| 13 | **Weights and thresholds change like a model, not like a setting.** A change is drafted, backtested on real past decisions, approved by a second owner, run in shadow and then promoted, and can be rolled back. Nothing about a change is applied silently. | One wrong weight lets fraud through, or blocks honest customers, at every bank at once. Model change management: CBN governance and change control; ISO 27001 A.8.32. | Done. The **Engine** page; `services/engine_admin.py`, `services/backtest.py`. See [ENGINE-GOVERNANCE.md](ENGINE-GOVERNANCE.md) |

## Claims to avoid

These were wrong or unsupported in earlier material. Don't put them in the product, the docs or the site.

- "₦25.85B lost in Q1 2025, up 600%". It is the full-year 2025 figure, and it fell 51%.
- "INTERPOL: Sub-Saharan losses exceeded $2.9B, fintechs the primary entry point". Not found in any INTERPOL report.
- "Feedzai and Sift are built for card fraud and Western e-commerce". Feedzai covers transfers, scams and AML.
- "Calibrated on NIBSS data" as if it were training. Thresholds were informed by published aggregates. Training on labels happens per bank, on its own confirmed outcomes.
- OPay's "$1B tech upgrade", bank–vendor pairings, and the "110th of 112" or "90% workforce gap" figures. Unverified.
- Anything implying Fable holds, freezes or moves customer funds.

## Standards referenced

- CBN Risk-Based Cybersecurity Framework for DMBs and PSBs (2024), and the CBN cybersecurity guidelines for other financial institutions (2022). The exact clause text is to be verified against the CBN PDFs before quoting.
- CBN baseline standards for automated AML solutions (10 March 2026).
- CBN operational guidelines for open banking (consent, strong customer authentication).
- Nigeria Data Protection Act 2023 and the NDPC General Application and Implementation Directive (GAID) 2025.
- OWASP Password Storage Cheat Sheet.
