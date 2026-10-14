# Fable | Q&A

26 questions and answers, checked against [the research brief](fraud-market-regulation-brief.md). The *italic notes* are guidance for whoever answers, not text to say aloud.

## 1. The Problem and Market

### 1. What research did you do, and why did you start Fable?
We looked at Nigerian fraud reports, social-engineering scams, and how banks currently detect suspicious transfers. NIBSS reported ₦25.85 billion in digital payment fraud losses in 2025. Social engineering accounted for ₦17.84 billion of that. What stood out was that people often send the money themselves after being manipulated. Fable is built to spot risky behaviour before the transfer goes through, not just confirm that the person sending it is the account owner.

*Note: don't say "₦25.85B in Q1" or "up 600%". It's the full-year 2025 figure, and it fell 51% from 2024. If you need a second statistic, use INTERPOL's 2026 Africa assessment: AI was involved in 55% of reported cybercrime, and losses rose from $192M to $484M. Don't use the old "$2.9B, fintechs as the entry point" line; it wasn't found in any INTERPOL report.*

### 2. Don't banks already have fraud detection systems?
Yes, and we shouldn't pretend otherwise. Large banks and wallets already use sophisticated fraud tools, including behavioural analytics. But there's still room to improve how suspicious transfers are handled, especially when a genuine customer is being scammed. Fable adds transaction-level risk scoring and a proposed intervention layer alongside the bank's existing controls.

*Note: Access, GTCO and UBA were targeted with ₦10.29B in 2025 and stopped about 80% of it. They still lost ₦2.13B, and the average loss per incident rose to about ₦44,454. Most customer-facing protection is identity checks plus fixed limits: they prove it's you, not that you meant it.*

### 3. If fraud losses fell in 2025, why is Fable still needed?
The reported total fell from ₦52.26 billion in 2024 to ₦25.85 billion in 2025, although a single unusually large incident inflated the 2024 figure. The bigger concern is that social engineering still accounted for nearly 70% of 2025 losses. Falling headline losses don't mean that people are safe from being tricked into sending money.

*Note: cases are falling, but the cost per incident is rising. Fewer attacks, more money from each one.*

### 4. Who is Fable built for first?
We're starting with microfinance banks, smaller payment providers, and digital wallets. They need strong fraud controls, but many don't have the same budgets, data teams, or engineering capacity as the biggest institutions. Larger banks are a possible market later, once we've proved the product in pilots.

## 2. Product and Technology

### 5. How does Fable work?
Copilot builds a picture of a customer's usual transaction behaviour. Shield checks a new transfer against that picture and other risk signals. If the risk is high enough, Ghost is designed to pause the transfer inside the institution's own payment flow so the customer can review it before the money is sent. Ghost's hold is simulated in our current prototype; live payment intervention still needs integration and approval.

*Note: don't imply Fable holds customer money. In production the bank holds the transfer in its own flow, before it is submitted to the payment rail.*

### 6. Do Copilot, Shield, and Ghost work together?
Yes. Copilot maintains the behavioural baseline in the background. Shield uses that baseline when a transfer is initiated. Ghost only steps in when Shield's decision crosses the institution's configured threshold. It's one connected flow, with a clear role for each agent. They run in sequence rather than in parallel, because each needs the output of the one before it, which is also what makes every decision traceable.

### 7. Does Copilot need 90 days before it can protect a customer?
No. Ninety days is a useful target for building a richer personal history, not a waiting period. For a new customer, we can start with broader customer-segment patterns, basic transaction rules, and recipient risk signals. As more history becomes available, the assessment becomes more personalized. A bank can also import its customers' past transactions when it joins, so most customers don't start cold. That cold-start approach still needs validation with real institutional data.

### 8. Is this real AI or just a collection of rules?
It's a combination. Our prototype uses Isolation Forest for anomaly detection, alongside clear rules for signals such as unusually large transfers or unfamiliar recipients. Isolation Forest spots unusual patterns; it doesn't prove that fraud happened. The final action comes from a rule-based decision layer, so we can explain why something was flagged. An LLM only turns the reasons into plain language; it never decides to block or hold anything.

*Note: if a technical reviewer pushes, the honest limits are cold start (we fall back to segment baselines), drift (we monitor and retrain), and "unusual" isn't always "fraud", which is why Ghost pauses rather than blocks.*

### 9. Where did the model's data come from?
Our prototype risk indicators and initial thresholds were informed by public NIBSS and CBN research and simulated transaction scenarios. We haven't trained on a live Nigerian bank's private customer data, and we shouldn't claim that we have. The next step is to test and calibrate the system with an institution's historical transactions and confirmed fraud outcomes.

*Note: calibration on published aggregates is not training on labels. Each institution's model would be retrained on its own confirmed outcomes and kept isolated.*

### 10. What if Fable flags a genuine transfer?
That's a major risk, because a false alarm could delay someone's rent or emergency payment. Our proposed approach is a short, explained pause rather than an automatic permanent block. The institution controls the thresholds, and we'd measure false positives in read-only and shadow-mode pilots before enabling any live intervention. Regular payees, such as family or a salary account, build trust over time so they stop triggering checks.

*Note: research found that about a third of customers who were wrongly declined stopped using that merchant (Javelin, 2015, US card data: say "research found", not "Nigerian data shows"). The UK lets banks delay suspicious payments up to four business days if they tell the customer why. That's a precedent, not Nigerian law.*

### 11. What if Fable misses a scam?
Fable is an extra layer, not a guarantee or a replacement for the bank's existing controls. Every assessment should have a recorded score and reason codes, so analysts can review what the system saw and improve it. We'd track missed fraud as carefully as false alarms.

*Note: on liability, say: "We're decision support. Liability is set in the contract, and our audit logs make disputes straightforward."*

### 12. How can you detect a scam if the customer is using their normal phone?
That's exactly why device checks alone aren't enough. Shield can also consider the amount, new beneficiary, transfer timing, recent transaction pattern, and any recipient-risk information the institution has. Still, some coached scams will look normal. We won't claim to catch every case; pilots will show which signals actually help.

## 3. Competition and Differentiation

### 13. Who are your competitors?
YouVerify is one of the closest local competitors because it already offers real-time transaction monitoring. Globally, Feedzai, BioCatch, and NICE Actimize have strong fraud and behavioural analytics products. OPay and PalmPay also operate their own customer-protection systems. Our opportunity isn't that nobody does this; it's to offer a focused, accessible product for institutions that need it.

*Note: don't call Feedzai "card fraud and Western e-commerce"; it covers transfers, scams and AML. Expect YouVerify to come up in Lagos: respect it, then explain the difference (they're compliance-first, we're scam-intervention-first).*

### 14. What actually makes Fable different?
We're focusing on three things together: customer-specific behaviour, an explainable transaction risk decision, and a proposed customer-releasable pause before a suspicious transfer is submitted. We're also designing the integration and pricing around smaller Nigerian institutions. Those are our intended differentiators, not proven advantages over every competitor yet.

### 15. Why wouldn't banks just build Fable internally instead of paying you?
Some can, and some already have similar systems. But the real decision is whether building and maintaining another fraud engine is worth the cost. It takes specialist engineers, reliable data, ongoing model tuning, security reviews, and compliance work. Even major banks buy technology: our research found that licensing makes up around 80% of Access Holdings' operational IT costs. For smaller institutions, Fable could be faster and more economical to integrate than building everything from scratch. And we're not asking them to replace what they already use; we're offering an additional layer. We'd still need to prove that cost and performance advantage in pilots.

### 16. Don't OPay, PalmPay, and Moniepoint already do this?
They have serious security systems. OPay describes machine-learning and behavioural scam detection; PalmPay offers in-flow fraud alerts; and Moniepoint has strong authentication and account-protection measures. We give them credit for that. But their internal tools aren't generally available for another small bank to plug into. Fable is intended to serve institutions that need a similar capability without building their own full stack.

*Note: the specifics, if asked: OPay says it processes 100M+ transactions a day (company claim) and asks for face verification on risky transfers. PalmPay's Security Centre flags suspected fraud recipients mid-transfer. Moniepoint requires biometrics or a one-time code above ₦500,000. Don't quote OPay's "$1B upgrade" (unconfirmed), and don't say Moniepoint has no ML; its internals just aren't public.*

### 17. What stops competitors from copying you?
The Isolation Forest algorithm isn't proprietary, and neither is the idea of scoring transfers. A defensible advantage would come from reliable local fraud-pattern tuning, integrations, measured results, and improvements based on each institution's confirmed outcomes. We have to earn that advantage through real deployments; it isn't something we can claim just because we've built an MVP.

### 18. Why hasn't anyone built this already?
Three reasons. Nigerian regulation focused on identity first (BVN, NIN, the 2023 KYC rules), so that's where local vendors built. The institutions that could build behavioural scoring did, but only for themselves: OPay's system protects OPay customers. And it's hard to do explainably: you can't just plug in an LLM, because it isn't reproducible, it can invent a reason for freezing someone's salary, and the transfer narration is text a scammer controls. What changed is the CBN: its March 2026 automated AML standards require monitoring against the full customer profile, in real time.

## 4. Business Model and Regulation

### 19. How will Fable make money?
We're proposing a B2B subscription with usage-based pricing. The entry plan is ₦100,000 a month for up to 50,000 scored transactions, which works out to ₦2 per transaction at full usage. Copilot's baseline capability is included, while Shield scoring and Ghost interventions can support higher-volume or premium pricing. These are proposed prices, not revenue from existing customers.

### 20. Why would a financial institution pay for it?
They'd pay if we can show that Fable reduces losses or improves fraud operations enough to justify the fee. For context, the three major banks in our research averaged roughly ₦44,000 lost per reported fraud incident in 2025. Preventing three incidents of that size could cover a ₦100,000 subscription, but that's only an illustration. The real business case has to come from each pilot's detection results, false-positive rate, and operating costs.

### 21. How do you handle regulation? Do you need a banking licence?
Fable is designed as fraud decision-support software, not a bank or payment processor. We don't intend to hold deposits or customer funds. We still need legal review of the exact operating model, contracts, outsourcing requirements, and Ghost's payment-flow design before production. The CBN's March 2026 automated AML standards create demand for customer-profile-based monitoring, but Fable isn't a complete AML compliance solution.

*Note: the CBN standard gives deposit money banks 18 months and other institutions (MFBs, PSPs, MMOs) 24 months, so roughly March 2028. PSV 2028 sets a goal, not a rule, of fraud losses below 0.001% of transactions. Fable doesn't do sanctions screening or suspicious-transaction filing.*

### 22. How will you protect customers' data?
We aim to collect only the signals needed for scoring, keep each institution's data separate, and avoid storing bank PINs or passwords. Any behavioural profiling, especially typing patterns, needs careful privacy review. Before a live pilot, we'd complete a Data Protection Impact Assessment, agree on data-processing terms, and test the security controls under Nigeria's Data Protection Act 2023 and GAID 2025.

*Note: say "NDPA", not "NDPR"; the NDPR stopped applying on 19 September 2025. If asked about PINs: they're hashed with Argon2id and a server-side secret, and in production PIN checks should stay with the bank so Fable doesn't hold PINs at all. Typing rhythm is stored only as derived timing features, never raw keystrokes.*

### 23. Can Ghost legally hold a customer's transfer?
We can't assume Nigerian law gives us a blanket right to freeze payments. Ghost is designed to request a short, customer-releasable pause **before** the bank submits the transfer to the payment rail. The bank remains in control of the payment flow. We would need the institution's legal and compliance approval before activating that feature. The UK has a suspicious-payment delay rule, but that isn't Nigerian legal authority.

## 5. Execution, Validation, and Growth

### 24. How do you plan to get your first banking customers?
We'd approach smaller institutions with a read-only pilot first. They can let us score historical transactions without giving Fable control over live payments, then compare our flags against known cases. If the results are promising, we'd move through vendor due diligence, a security review, shadow mode, and finally a controlled live rollout. We don't have a confirmed production bank deployment yet.

*Note: if asked for a timeline, say "we estimate three to six months from pilot to production", and make clear it's an estimate. The security and compliance review, not the engineering, is usually the longest step.*

### 25. Why should a bank trust an early-stage team with something this sensitive?
They shouldn't trust us just because we've built a working product. A working build shows we can deliver the idea, but it isn't a banking contract or security certification. Trust has to come from a safe pilot, reproducible decisions, independent security testing, proper privacy work, and measurable performance. We'd earn production access step by step.

### 26. What's next after Copilot, Shield, and Ghost?
First, we need to validate the core system with real institutional data and make it production-ready. After that, Fable Watch could monitor patterns that develop across multiple transfers or sessions, such as sudden bursts of activity. Longer term, we're exploring investigation tools, identity protection, and carefully governed fraud-intelligence sharing. Those are roadmap ideas, not features we're claiming are live today.

*Note: be honest about insider fraud. NIBSS names insider abuse as a leading technique, and customer baselines don't target it.*

---

## Quick reference: verified figures

| Fact | Figure | Source |
|---|---|---|
| Nigerian digital payment fraud losses, 2025 | ₦25.85B (down 51% from ₦52.26B in 2024) | NIBSS, Jan 2026 |
| Fraud cases, 2025 | 67,518 | NIBSS |
| Social engineering share, 2025 | 47% of cases, ₦17.84B of losses | NIBSS |
| Lagos share of fraud | 63.43% | NIBSS |
| AI involvement in African cybercrime | 55% of reported cases | INTERPOL, Aug 2026 |
| African cybercrime losses | $192M (2024) to $484M (2025) | INTERPOL, Aug 2026 |
| Access + GTCO + UBA fraud loss, 2025 | ₦2.13B lost of ₦10.29B attempted | TechCabal, May 2026 |
| Average loss per incident at those three banks | ~₦44,454 | TechCabal |
| CBN automated AML standards | Issued 10 March 2026; banks 18 months, others 24 months | CBN circular |
| PSV 2028 fraud target | Below 0.001% of transactions | CBN, June 2026 |
| OPay daily transactions | 100M+ (company claim) | TheCable |
| Moniepoint MFA threshold | ₦500,000 personal, ₦5M business | Moniepoint, Sept 2024 |
