# Data protection impact assessment: template for an institution using Fable

The NDPA 2023 and the GAID 2025 expect a DPIA before processing that is
likely to result in high risk, which includes behavioural profiling,
location tracking and automated decisions with significant effect. Using
Fable involves all three. The go-live checklist asks an owner to confirm a
DPIA is done.

This template is pre-filled with what Fable does. Facts about Fable are in
[PRIVACY-DATA-FLOW.md](PRIVACY-DATA-FLOW.md). Replace every _[bracketed]_ part
with your institution's own answer. It is a starting point, not legal advice.

---

## 1. The processing

| | |
|---|---|
| Controller | _[Institution name, address, DPO contact]_ |
| Processor | Fable. Data processing agreement signed on _[date]_ |
| Purpose | Detect social engineering fraud and account takeover before a transfer is sent, and hold risky transfers where the customer can still cancel them |
| Data subjects | _[Retail customers / business customers / both]_ using _[channels: mobile app, internet banking, USSD]_ |
| Volume | _[Customers]_, _[transfers per month]_ |
| Lawful basis | _[Legal obligation (CBN fraud-prevention requirements) and/or legitimate interest; record your reasoning]_ |

## 2. Data used

Copy section 1 of PRIVACY-DATA-FLOW.md, then record your choices:

- [ ] Location: _[collected from the app with permission / not collected]_. Customers can switch it off themselves.
- [ ] Device fingerprint and IP: _[collected / not collected]_
- [ ] Behavioural signals (paste, time to submit, typing interval): _[collected / not collected]_
- [ ] Narration and recipient name sent to Fable: _[yes / no]_
- [ ] AI explanations (Anthropic or OpenAI, United States): _[on / off]_. Ask Fable: _[on / off]_
- [ ] SMS provider: _[none / Termii / Africa's Talking]_

## 3. Necessity and proportionality

| Question | Answer |
|---|---|
| Could the purpose be met with less data? | Fable scores with city and country, not coordinates; stores coordinates to about 1 km and IP addresses without the host part; does not collect keystrokes, pointer movements or card data. _[Add anything you switch off.]_ |
| How long is data kept? | Decisions 5 years; device, location, IP and session detail 2 years (section 4 of the data flow). _[Confirm these match your record-keeping policy or ask Fable to change them.]_ |
| How are customers told? | _[Where your privacy notice describes fraud screening, location and device checks]_ |
| How do customers exercise rights? | Your owners export or erase one customer from the console. _[Your process and response time.]_ |
| Who decides an erasure is allowed? | Your institution, as controller. Check record-keeping duties first: transaction records must be kept at least 5 years under Nigeria's money laundering rules. Fable keeps erased customers' decisions only as anonymous outcomes. _[Who approves erasures, and how you check.]_ |
| Is there human review of automated decisions? | Flagged and blocked transfers go to your review queue; holds can be released by your staff; every decision has a written reason. _[Who reviews, and how fast.]_ |

## 4. Risks and measures

| Risk to customers | Likelihood / severity _[rate]_ | Measures in Fable | Your measures |
|---|---|---|---|
| A genuine transfer is blocked or delayed | | Block becomes a cancellable hold, not a refusal; staff can release; reasons shown | _[Service levels for review]_ |
| Profiling feels intrusive | | Data minimised and coarsened; transparency view of what was learned; location can be switched off | _[Notice wording]_ |
| Data leaves Nigeria | | AI providers only when configured, with codes and figures, not customer text; map lookups only when location is shared | _[Transfer mechanism you rely on]_ |
| A breach exposes data | | Hashed PINs and keys, encrypted secrets, tenant isolation, audit log; the database itself is not encrypted at rest | _[Disk encryption, backups, access control on the server]_ |
| Data kept too long | | Scheduled retention job, per-customer erasure | _[Retention policy alignment]_ |
| Bias against customers with little history | | New customers are judged against your customer base, not a global rule; first-transfer pricing is a governed engine change | _[Monitoring of false positives by segment]_ |

## 5. Outcome

| | |
|---|---|
| Residual risk | _[Low / medium / high]_ |
| Consulted the NDPC? | _[Needed only if residual risk stays high]_ |
| Approved by | _[Name, role, date]_ |
| Review date | _[At least yearly, and when Fable's processing changes]_ |
