# Fable Pitch Q&A Research Brief: Competitors, Regulation, Fraud Data and Claim Verification (October 2026)

Fable's core thesis holds up on the data: social engineering is the biggest category of Nigerian payment fraud (47% of 2025 fraud volume and ₦17.84B of the ₦25.85B lost, per NIBSS). [allafrica](https://allafrica.com/stories/202601230595.html) But several current pitch lines are wrong or overstated and should be fixed before the next judging round. The big wallets (OPay, PalmPay, Moniepoint) do have serious in-house fraud stacks. The honest wedge is that those tools are proprietary to each wallet's own users. The long tail of microfinance banks, smaller PSPs and wallets now has a hard regulatory clock (CBN's March 10, 2026 automated AML baseline standards, with full compliance due within 24 months for non-bank institutions), and Fable can fit that window if it presents itself as a decision-support layer rather than a finished compliance system. [acelera](https://www.acelera.law/publications/cbn-issues-baseline-standards-for-automated-aml-solutions-a-new-compliance-paradigm-for-financial-institutions)

## TL;DR

- **Fix three claims now:** "₦25.85B in Q1 2025, up 600%" is wrong. ₦25.85B is the full-year 2025 loss and it fell 51% from ₦52.26B in 2024. The "INTERPOL $2.9B, fintechs as primary entry point" line is unsupported. Use INTERPOL's 2026 figures instead (AI involved in 55% of reported cases; losses up from $192M to $484M). "Sift and Feedzai are built for card fraud and Western e-commerce" is unfair to Feedzai, which covers account-to-account payments, scams and AML.
- **Credit competitors, then name the gap:** OPay (Anti-Scam Shield using ML and behavioural analytics, Night Guard, Large Transaction Shield, more than 100M transactions a day) and PalmPay (Transaction Guard and an upgraded Security Centre endorsed by NIBSS's fraud desk head in October 2026) have real stacks. Their headline customer controls, though, are thresholds plus face verification. That proves the person is the account holder, not that a coached victim intends the payment. That is exactly Fable's thesis. YouVerify is the closest local vendor (real-time transaction monitoring with device and behaviour signals), so the pitch must address it directly.
- **Be careful on security and legal claims:** 200,000 PBKDF2 rounds is below OWASP's current 600,000 for PBKDF2-HMAC-SHA256. Hashing a 4–6 digit PIN gives weak protection however many rounds you use. Ghost holds have no explicit Nigerian legal safe harbour like the UK's 4-business-day delay rule, so they must sit before submission to the payment rail and be framed as customer-controlled. Typing-rhythm data almost certainly triggers a mandatory DPIA under GAID 2025.

## Key Findings

1. **Fraud data (NIBSS, presented January 2026 at the Nigeria Electronic Fraud Forum):**
   - Losses were ₦17.67B in 2023, [nibss-plc](https://nibss-plc.com.ng/nibss-digital-payment-fraud-drops-51-to-%E2%82%A625-85b-in-2025/) ₦52.26B in 2024 (driven by a single ₦31.1B incident at one entity) and ₦25.85B in 2025. [nibss-plc](https://nibss-plc.com.ng/nibss-digital-payment-fraud-drops-51-to-%E2%82%A625-85b-in-2025/) [nibss-plc](https://nibss-plc.com.ng/digital-payment-fraud-drops-51-to-n25-85b-lagos-accounts-for-63/)
   - Cases fell from 123,918 in 2021 to 67,518 in 2025 (down 4% on 2024's 70,111). [businessday](https://businessday.ng/pro/article/bank-fraud-slumps-first-time-since-2021-as-bvn-nin-pay-off/) [allafrica](https://allafrica.com/stories/202601230595.html)
   - Lagos accounted for 63.43% of fraud. [nibss-plc](https://nibss-plc.com.ng/digital-payment-fraud-drops-51-to-n25-85b-lagos-accounts-for-63/)
   - Social engineering was 47% of volume and ₦17.84B (about 69%) of losses. [allafrica](https://allafrica.com/stories/202601230595.html)
   - Internet banking was the costliest channel: ₦13.37B lost from just 4,507 cases. [allafrica](https://allafrica.com/stories/202601230595.html)
   - Reporting compliance is falling. Fraud reporting dropped 34% in Q4 2025, and the number of institutions actively reporting fell from 45 (Q2 2024) to 34 (Q4 2025). [nibss-plc](https://nibss-plc.com.ng/digital-payment-fraud-drops-51-to-n25-85b-lagos-accounts-for-63/) [allafrica](https://allafrica.com/stories/202601230595.html)
2. **Regulation is the "why now":**
   - The CBN circular "Issuance of Baseline Standards for Automated Anti-Money Laundering (AML) Solution for Financial Institutions in Nigeria" is dated March 10, 2026. [thecable](https://www.thecable.ng/cbn-directs-banks-to-deploy-automated-anti-money-laundering-systems-within-18-months/)
   - It requires automated monitoring that assesses "activity in the context of the full customer profile." [insight7](https://insight7.io/cbn-aml-rules-what-should-banks-cx-teams-automate/)
   - Full compliance is due in 18 months for deposit money banks (about September 2027) and 24 months for other financial institutions (about March 2028). Roadmaps were due within three months (about June 10, 2026). [youverify](https://youverify.co/en/blogs/cbn-kyc-aml-requirements-2026) [acelera](https://www.acelera.law/publications/cbn-issues-baseline-standards-for-automated-aml-solutions-a-new-compliance-paradigm-for-financial-institutions)
   - PSV 2028, launched June 1, 2026, sets a target of fraud losses "less than 0.001 per cent of all transactions" through NIN/BVN integration and "AI fraud detection." [thisdaylive](https://www.thisdaylive.com/2026/06/02/cardoso-unveils-payments-system-vision-2028-targets-95-financial-inclusion/) Governor Cardoso announced it as a commitment. Based on what we could retrieve, it reads as a policy target, not a rule with a sanction attached.
3. **Banks are not defenceless:**
   - Access, GTCO and UBA lost a combined ₦2.13B in 2025 out of ₦10.29B in attempted fraud, a 20.66% realisation rate (TechCabal, May 11, 2026, from audited statements). [techcabal](https://techcabal.com/2026/05/11/three-of-nigerias-biggest-banks-lost-1-56-million-to-fraud-in-2025/)
   - The same three spent ₦280.90B on technology in 2025. [techcabal](https://techcabal.com/2026/05/11/three-of-nigerias-biggest-banks-lost-1-56-million-to-fraud-in-2025/)
   - Tier-1 banks are not Fable's first market. Microfinance banks, smaller PSPs and wallets are.
4. **Competitor reality:** feature names are converging across wallets (both OPay and PalmPay ship "Night Guard" and "Large Transaction Shield"). [thecable](https://www.thecable.ng/large-transaction-shield-nightguard-innovative-ways-opay-is-protecting-customers-from-fraud/) [guardian](https://guardian.ng/news/nibss-fraud-chief-urges-stronger-security-tools-for-digital-payments/) The customer-facing layer is mostly user-set thresholds, face verification, account lock codes and recipient blacklists. The ML layer (OPay's Anti-Scam Shield) exists but is not publicly benchmarked.
5. **The CBN Fintech Report 2025 stat (87.5% of fintechs use AI for fraud detection) is real but thin.** [nairametrics](https://nairametrics.com/2026/02/03/cbn-survey-87-5-of-nigerian-fintechs-use-ai-for-fraud-detection/) Every reported percentage is a multiple of 12.5% (87.5, 62.5, 37.5, 12.5), which implies a small respondent base (consistent with 8 respondents or a small multiple of 8). [ecofinagency](https://www.ecofinagency.com/news-finances/0302-52525-nearly-90-of-nigerian-fintechs-use-ai-for-fraud-detection-cbn-says) The sample size is not stated in the coverage we saw. Do not present it as an industry census.

## Part A: Competitor and Market Deep Dive

### A1. OPay

**Scale and claims (company statements, not independently audited):**
- CTO Dotun Adekunle said in 2026, "We do over 100 million transactions every day" (TheCable). [thecable](https://www.thecable.ng/opay-introduces-security-features-to-combat-digital-fraud/)
- At the July 16, 2026 Lagos media parley, OPay claimed:
  - 99.9% of transactions completed successfully [vanguardngr](https://www.vanguardngr.com/2026/07/opay-leads-nigerias-fight-against-digital-fraud/)
  - average processing under 1 second [vanguardngr](https://www.vanguardngr.com/2026/07/opay-leads-nigerias-fight-against-digital-fraud/)
  - "zero scheduled downtime" [thesun](https://thesun.ng/opay-leads-nigerias-fight-against-digital-fraud/)
  - "over 1,000 application programming interfaces (APIs)" [thecable](https://www.thecable.ng/opay-introduces-security-features-to-combat-digital-fraud/)
  - downtime "less than one hour in a whole year" [thecable](https://www.thecable.ng/opay-introduces-security-features-to-combat-digital-fraud/)
- The Sun's coverage said "hundreds of engineers" work behind every payment. [thesun](https://thesun.ng/opay-leads-nigerias-fight-against-digital-fraud/) No precise engineering headcount is published.

**Fraud and security stack (as described by OPay and press):**

| Feature | What is evidenced | Source / date |
|---|---|---|
| Anti-Scam Shield | "Uses machine learning and behavioural analytics to detect suspicious transfer patterns and block them before funds exit the network." Tribune adds that it "actively analyse[s] recipient data in real time, utilising machine learning to detect known fraudulent accounts." [allafrica](https://allafrica.com/stories/202607230554.html) [tribuneonlineng](https://tribuneonlineng.com/why-we-are-fighting-digital-fraud-for-nigerians-empowering-entrepreneurs-opay/) So it is a combination: ML pattern detection plus known-bad recipient lists. | Vanguard / allAfrica, July 2026; Tribune 2026 |
| Ponzi/investment-scam intelligence | "We also have an intelligence that researches Ponzi schemes and flags customers' transactions if they try to make a payment to such accounts" (Adekunle). [thecable](https://www.thecable.ng/opay-introduces-security-features-to-combat-digital-fraud/) | TheCable |
| Scam Alert | Checks recipients against a regularly updated list of flagged accounts, and can block or prompt verification. One expert warned some users misuse it to report people out of revenge. | Summary research run; source link not captured |
| Night Guard | Requires facial verification for unusual high-value transfers late at night. [innovation-village](https://innovation-village.com/inside-opays-1b-tech-upgrade-sub-second-payments-and-ai-fraud-protection/) [vanguardngr](https://www.vanguardngr.com/2026/07/opay-leads-nigerias-fight-against-digital-fraud/) | Vanguard, July 2026 |
| Large Transaction Shield | Launched around November 2024. Users set single, daily or monthly limits. Transfers above the limit need facial verification. Launch coverage cited a single-transaction limit range of ₦100,000 to ₦300,000. [techpoint](https://techpoint.africa/general/opay-introduces-large-transaction-shield-to-guard-against-financial-fraud/) [thecable](https://www.thecable.ng/large-transaction-shield-nightguard-innovative-ways-opay-is-protecting-customers-from-fraud/) [techcrayon](https://techcrayon.com/2024/11/06/financial-security-opay-introduces-transaction-shield/) | Techpoint Africa; TechCrayon, Nov 6, 2024 |
| Emergency Lock | Named by Adekunle as part of the suite. [thecable](https://www.thecable.ng/opay-introduces-security-features-to-combat-digital-fraud/) | TheCable |
| Risk-based step-up | "Additional verification appears only when the risk profile changes." Adekunle: "Your face is the final lock on risky transactions, invisible when things are normal, immovable…" [thesun](https://thesun.ng/opay-leads-nigerias-fight-against-digital-fraud/) | The Sun, 2026 |
| Compliance monitoring | CCO Chukwudinma Okafor: "AML/CFT/CPF and anti-fraud rules have been deployed to ensure automated real-time monitoring." He describes BVN, NIN, biometric verification and combined automated and human monitoring. He says OPay "periodically analyses transaction patterns" and "proactively updates compliance systems." [guardian](https://guardian.ng/interview/how-opay-tackles-fraud-money-laundering-protects-customers/) [brandiconimage](https://www.brandiconimage.com/2026/10/opay-fintechs-must-strengthen.html) [headtopics](https://ng.headtopics.com/news/opay-cco-on-evolving-compliance-challenges-and-fraud-88456632) | The Guardian Nigeria interview, 2026 |

**What is not evidenced:**
- No published fraud-blocked figures, money-saved figures or false-positive rates.
- No disclosure of in-house versus vendor components (Okafor says only "world-class technology"). [guardian](https://guardian.ng/interview/how-opay-tackles-fraud-money-laundering-protects-customers/)
- "Large Transaction Double Check" and a dedicated "USSD Lock" under those exact names did not appear in the sources we retrieved, so treat them as unverified.
- The "$1B tech upgrade" appears as a headline on Innovation Village ("Inside OPay's $1B Tech Upgrade"). [innovation-village](https://innovation-village.com/inside-opays-1b-tech-upgrade-sub-second-payments-and-ai-fraud-protection/) We could not confirm what the $1B refers to (capex, cumulative investment or valuation) from a primary source. Do not repeat it without qualification.

**Complaints:** FIJ has repeatedly reported slow refund and dispute resolution at OPay. Examples:
- An Ibadan woman was still waiting for ₦65,000 of a ₦90,000 erroneous transfer 20 months on, despite presenting a court order (FIJ, Sept 14, 2026). [fij](https://fij.ng/article/despite-court-order-opay-keeps-ibadan-woman-waiting-20-months-for-n65000-refund/)
- An Aba businesswoman was told to wait 3–5 working days for a ₦32,400 failed-POS refund and had nothing four weeks later (FIJ, Aug 26, 2026). [fij](https://fij.ng/article/opay-told-abia-businesswoman-to-wait-5-days-for-n32400-refund-4-weeks-on-she-got-nothing/)

Many FIJ stories involve erroneous transfers where the recipient refuses to return funds. [fij](https://fij.ng/article/opay-customer-emmanuel-oparaocha-received-n49500-in-erroneous-transfer-now-hes-too-shy-to-talk/) This is a recovery problem that pre-transfer friction (Fable's Ghost) could partly prevent.

**Regulatory history:** on April 29, 2024, the CBN directed OPay, Moniepoint, Kuda and PalmPay (Guardian adds Paga) to stop onboarding new customers amid a KYC audit and illicit FX/crypto concerns. [techcabal](https://techcabal.com/2024/04/29/exclusive-cbn-directs-four-fintechs-to-stop-onboarding/) [channelstv](https://www.channelstv.com/2024/04/30/cbn-stops-opay-moniepoint-others-from-onboarding-new-customers/) OPay and Kuda resumed onboarding in June 2024 (TechCabal; Channels; TheCable). [guardian](https://guardian.ng/business-services/cbn-lifts-new-account-restriction-on-opay-kuda-others/) [pulse](https://www.pulse.ng/story/how-kyc-issues-led-to-recent-cbn-ban-on-4-fintechs-2024072703385988573) [Wikipedia](https://en.wikipedia.org/wiki/Opay) In October 2023, Fidelity Bank had blocked transfers to the same four fintechs over KYC-linked fraud concerns. [telegraph](https://telegraph.ng/news/2024/04/30/panic-as-cbn-bans-opay-palmpay-others-new-accounts/) [techcabal](https://techcabal.com/2024/04/29/exclusive-cbn-directs-four-fintechs-to-stop-onboarding/)

**Fair assessment:** OPay is the strongest evidence that ML-based behavioural fraud detection works at Nigerian scale, and Fable should say so. OPay's customer-facing controls (thresholds plus face) verify identity, so they do not stop a victim who is being coached to pay. OPay says its ML layer targets that gap. Its tooling is proprietary and serves only OPay users.

### A2. Moniepoint

- **MFA:** since September 2024, fingerprint, face or TOTP is required for transfers above ₦500,000 (personal) and ₦5,000,000 (business). [fintechmagazine](https://fintechmagazine.africa/2024/09/25/moniepoint-introduces-multi-factor-authentication-to-enhance-payment-security/) [finnaija](https://finnaija.ng/moniepoint) Moniepoint's support site describes MFA as "mandated by the Central Bank of Nigeria." [moniepoint](https://support.moniepoint.com/topics/account-login-and-security-228)
- **USSD:** *5573# was launched in 2024. *5573*911# blocks the account or stops debits, including from someone else's phone if yours is stolen. [moniepoint](https://support.moniepoint.com/topics/account-login-and-security-228) [techtrackafrica](https://www.techtrackafrica.com/moniepoint-mfb-unveils-new-feature-to-combat-fraud-and-enhance-convenience/) [finnaija](https://finnaija.ng/moniepoint)
- **Fraud desk:** the fraud desk can be reached on 02018889990. Moniepoint says it "will never initiate a chat with you." [moniepoint](https://moniepoint.com/blog/protect-your-money-from-fraud-in-nigeria)
- **What is not evidenced:** we found no public description of Moniepoint's ML or behavioural detection, no published fraud results, and nothing retrievable on trust.moniepoint.com in this pass. Say "not publicly documented," not "doesn't exist."
- **Regulatory:** Moniepoint was included in the April 2024 CBN onboarding pause. [blueprint](https://blueprint.ng/cbn-stops-opay-palmpay-2-others-from-onboarding-new-customers/) [techcabal](https://techcabal.com/2024/04/29/exclusive-cbn-directs-four-fintechs-to-stop-onboarding/)
- **Market note:** Moniepoint is an early adopter of NIBSS's new National Payment Stack (NPS). [nibss-plc](https://nibss-plc.com.ng/nibss-new-payment-system-records-26-5m-transactions-worth-n1-4trn)

### A3. PalmPay

- **Transaction Guard (2026):** users set single, daily or monthly limits, and transactions above them need facial verification. Head of Marketing Femi Hanson called it "an extra layer of protection" (Nigeria Communications Week, Aug 3, 2026). [nigeriacommunicationsweek](https://nigeriacommunicationsweek.com.ng/2026/08/03/palmpays-transaction-guard-gives-users-more-control-as-fraud-tactics-evolve) [brandtimes](https://www.brandtimes.com.ng/as-fraud-tactics-evolve-palmpays-transaction-guard-gives-users-more-control/)
- **Upgraded Security Centre (Sept 30–Oct 1, 2026, under the "PalmPay Dey For You" campaign):** it brings together:
  - a real-time Security Check
  - Large Transaction Shield
  - Night Guard
  - USSD account and card lock
  - "in-flow alerts for suspected fraud recipients, duplicate transfers and new-device logins" [businessday](https://businessday.ng/technology/article/palmpay-upgrades-security-center-as-digital-fraud-risks-evolve/)
- **NIBSS commentary:** Tosin Obadimu, Head of the Fraud Management Department at NIBSS, described these features and said integrated controls "could strengthen verification before high-risk transactions" (BusinessDay, Guardian, Daily Trust, Oct 1, 2026; ThisDay, Oct 5, 2026). COO Samuel Oluyemi said customer protection techniques must keep evolving. [thisdaylive](https://www.thisdaylive.com/2026/10/05/nibss-fraud-desk-highlights-palmpay-security-measures-amid-evolving-fraud-risks/) [businessamlive](https://businessamlive.com/nibss-highlights-role-of-enhanced-security-tools-in-digital-payments/) Note the context: a NIBSS official commenting inside a vendor's consumer campaign is promotional framing, not an independent evaluation.
- **Earlier measures (Nairametrics, August 2025):** biometric authentication, phone-binding, AI-powered anomaly detection with real-time monitoring, and two-factor authentication. For flagged transfers, PalmPay freezes only the disputed amount if the balance covers it. [nairametrics](https://nairametrics.com/2025/08/27/inside-palmpays-fight-against-fraud-lessons-for-nigerias-digital-payments-industry/) This came from the summary research run and was not re-retrieved in the sourced pass.
- **What is not evidenced:** no published AI anomaly-detection metrics.
- **Fable takeaway:** PalmPay's "in-flow alerts for suspected fraud recipients" are the closest thing in market to Fable's mid-flow intervention. Position Ghost as that idea, available to institutions that cannot build their own.

### A4. Kuda, Paystack, Flutterwave, Interswitch and others

**Flutterwave** (all figures are reported, not confirmed by the company):
- **February 2023:** Techpoint reported ₦2,949,557,867 moved illegally and a freeze order on 107 accounts at 27 banks. Flutterwave denied the report, and a Lagos court later ordered the accounts unfrozen. [techpoint](https://techpoint.africa/2023/03/05/hackers-have-stolen-2-9-billion-from-flutterwave/) [techcabal](https://techcabal.com/2023/03/10/hundreds-of-accounts-frozen-during-flutterwave-hack-allegation/) [techpoint](https://techpoint.africa/news/unfreeze-accounts-connection-2-9-billion-flutterwave-hack/)
- **October 2023:** about ₦19B was moved through unauthorised POS-merchant transactions. TechCabal put total 2023 losses at "over ₦22 billion ($14 million) in three separate events." [techcabal](https://techcabal.com/2024/05/17/techcabal-daily-nigeria-to-set-up-shop-in-silicon-valley/) [techcabal](https://techcabal.com/2024/05/16/exclusive-flutterwave-loses-%E2%82%A611-billion-in-security-breach/)
- **April 2024:** TechCabal's exclusive (May 16, 2024) reported ₦11B moved over four days to accounts at five institutions. One insider put it at ₦20B or more. Flutterwave acknowledged "unauthorised activities inconsistent with usual customer behaviour" but said "no customer funds were lost or compromised." [techcabal](https://techcabal.com/2024/05/16/exclusive-flutterwave-loses-%E2%82%A611-billion-in-security-breach/) [techcabal](https://techcabal.com/2024/05/17/techcabal-daily-nigeria-to-set-up-shop-in-silicon-valley/)
- **Lesson:** even well-funded processors suffer large, fast account-to-account losses. Detection speed matters.

**Kuda:** included in the April 2024 CBN pause. [blueprint](https://blueprint.ng/cbn-stops-opay-palmpay-2-others-from-onboarding-new-customers/) [techcabal](https://techcabal.com/2024/04/29/exclusive-cbn-directs-four-fintechs-to-stop-onboarding/) Its fraud tooling is not publicly documented in what we retrieved.

**Paystack and Interswitch:** we did not retrieve primary documentation of their fraud tooling in this pass, so treat them as unknown. Paystack sat on panels at the 2026 fraud-architecture report launch (per Lawyard), which shows it engages on the topic. [lawyard](https://www.lawyard.org/news/nigerias-financial-sector-faces-critical-18-months-as-ai-driven-fraud-evolves/)

**VigiPay (Lagos):** selected ThetaRay's AI AML transaction monitoring (Business Wire, April 27, 2023). [businesswire](https://www.businesswire.com/news/home/20230427005157/en) This proves global AI vendors already sell to small Nigerian fintechs.

**EFCC, January 2026:** at an Abuja briefing on January 22, 2026, EFCC spokesman Wilson Uwujaren said "cryptocurrency transactions amounting to ₦162 billion passed through a new generation bank without any form of due diligence" and that "a single customer operated 960 accounts in another bank." Six fintechs and several microfinance banks were also implicated, and only ₦33.62M had been recovered (WeeTracker; ThisDay, Jan 23, 2026). This is evidence that MFBs and small fintechs are the weak links.

### A5. Traditional banks

**2025 fraud data, audited (TechCabal, May 11, 2026):**

| Bank | Incidents | Amount targeted | Actual loss | Loss rate |
|---|---|---|---|---|
| UBA | 26,400 | ₦4.56B | ₦621.57M | 13.6% |
| Access | 5,981 | ₦3.17B | ₦1.24B | 39.1% |
| GTCO | 15,469 | ₦2.58B | ₦269.44M | 10.4% |
| **Total** | **47,850** | **₦10.29B (reported)** | **₦2.13B** | **20.66%** |

- **Verdict on the ₦2.13B combined figure:** accurate. It is ₦2.13B, about $1.56M at TechCabal's conversion. [techcabal](https://techcabal.com/2026/05/11/three-of-nigerias-biggest-banks-lost-1-56-million-to-fraud-in-2025/)
- Average loss per incident was ₦44,454, up from ₦40,488. [techcabal](https://techcabal.com/2026/05/11/three-of-nigerias-biggest-banks-lost-1-56-million-to-fraud-in-2025/)
- At UBA, 99.91% of cases were electronic, and fraudulent transfers made up nearly 36% of actual losses. [businessday](https://businessday.ng/technology/article/how-tech-spend-helps-four-banks-block-n14-5bn-fraud-losses-in-2025/)
- GTCO's actual losses rose 69% despite fewer cases (BusinessDay). [businessday](https://businessday.ng/technology/article/how-tech-spend-helps-four-banks-block-n14-5bn-fraud-losses-in-2025/)
- The CBN fined Access ₦138M in 2025 for inadequate KYC linked to fraud. [techcabal](https://techcabal.com/2026/05/11/three-of-nigerias-biggest-banks-lost-1-56-million-to-fraud-in-2025/)
- Losses were 0.003% of the three banks' combined ₦71.06T deposits. [techcabal](https://techcabal.com/2026/05/11/three-of-nigerias-biggest-banks-lost-1-56-million-to-fraud-in-2025/)
- Including Wema, BusinessDay ("How tech spend helps four banks block N14.5bn fraud losses in 2025") reports that Access, GTCO, UBA and Wema "faced combined attempted fraud of roughly N17.5 billion in 2025" and blocked about ₦14.5B of it.

**Earlier history:**
- Access cut losses from ₦6.15B (2023) to ₦1.64B (2024) after a record ₦193.5B tech spend. About 80% of its operational IT cost is licensing (TechCabal, April 18, 2025). [techcabal](https://techcabal.com/2025/04/18/access-holdings-spends-big-on-tech/)
- Zenith's losses jumped from ₦383.4M to ₦5.26B in 2024. [allafrica](https://allafrica.com/stories/202505190203.html)
- A separate report cited a ₦15.42B fine on a "major commercial bank." The Whistler (March 27, 2025) identifies the bank as Zenith, fined by the CBN for its 2024 financial year according to its audited results. The reported components were ₦14.64B for "infractions from foreign exchange examination," ₦322M for onboarding-document checks and ₦103.25M for "failing to conduct anti-money laundering reviews."

**Vendors:** we could not confirm, from primary sources in this pass, which named vendor (FICO Falcon, Feedzai, SAS, NICE Actimize, BioCatch, Experian) any specific Nigerian bank runs. Do not name bank–vendor pairings in the pitch. What is evidenced:
- FICO Falcon is offered as a hosted service to Middle East and Africa banks through Network International, with instances in the UAE, Saudi Arabia, Egypt and South Africa.
- Enterprise suites from NICE Actimize or SAS can exceed $1M a year fully loaded (vendor-blog estimate, sphinxhq; low reliability). [sphinxhq](https://sphinxhq.com/blog-posts/best-fraud-detection-platforms)

**Implication:** Tier-1 banks spend heavily on licensed platforms. Fable's price point and simplicity suit institutions that cannot.

### A6. Vendors: how they differ from Fable

| Vendor | Core focus | Nigerian rails / presence | Real-time transfer scoring? | Per-customer behavioural baseline? | Notes / fairness |
|---|---|---|---|---|---|
| **YouVerify** (Lagos) | Unified "FRAML" (fraud and AML): KYC/KYB, AML screening, transaction monitoring, case management [youverify](https://doc.youverify.co/introduction) | Nigerian-native; claims coverage of CBN rules [youverify](https://youverify.co/en/solution/transaction-monitoring) | Yes: "submit transactions for real-time risk evaluation"; "140+ signals per session, <300ms to score"; device fingerprinting and "behaviour over time" [youverify](https://doc.youverify.co/introduction) [youverify](https://youverify.co/en) | Partly (device/session behaviour, velocity) | **Closest local competitor.** Claims integration "under 72 hours" and "70% reduction in false positives" (marketing, unverified). Holds SOC 2 Type II and ISO 27001/27018/42001. Raised a $2.5M pre-Series A from Elm (March 2024); 3,500+ businesses. [youverify](https://youverify.co/en/solution/transaction-monitoring) [youverify](https://youverify.co/en) [biometricupdate](https://www.biometricupdate.com/202403/nigerias-youverify-receives-2-5m-in-funding-for-biometrics-aml) |
| **Smile ID, Dojah, Prembly, Seamfix, VerifyMe** | Identity/KYC, liveness, document verification (onboarding) | Nigerian ID rails (BVN/NIN) | Not their core product, based on general market knowledge; not re-verified in this pass | No | Calling them "identity" is broadly fair. Check each for newer fraud modules before stating it on stage. |
| **Mono, Okra** | Open-banking data APIs | Nigerian bank connections | No | No | Could be data partners, not competitors. |
| **ThetaRay** | AI AML transaction monitoring (unsupervised) [businesswire](https://www.businesswire.com/news/home/20230427005157/en) | VigiPay, Lagos (2023) [businesswire](https://www.businesswire.com/news/home/20230427005157/en) | AML-oriented | Anomaly-based | Proves global AI vendors already sell into small Nigerian fintechs. |
| **BioCatch** | Behavioural biometrics; social-engineering/scam and mule detection | Global banks | Session-level | Yes (behavioural) | Claims 16B+ sessions analysed, 3,000+ signals, and "BioCatch Trust" for receiving-account risk. [biocatch](https://www.biocatch.com/) Typing rhythm is BioCatch's home turf. |
| **Feedzai** | ML risk engine across cards and **account-to-account payments**, scams, AML [vyntra](https://vyntra.com/blog/best-fraud-detection-software-for-app-scams/) [validadvantage](https://validadvantage.com/blog/advanced-fraud-solutions-alternatives) | Global | Yes | Yes | **Not** fair to call it "card fraud/Western e-commerce." |
| **NICE Actimize** | Enterprise fraud and AML suite; scams, mule, APP | 1,000+ clients globally [sphinxhq](https://sphinxhq.com/blog-posts/best-fraud-detection-platforms) [niceactimize](https://www.niceactimize.com/) | Yes | Yes | Tier-1 pricing and complexity. |
| **FICO Falcon** | Payment fraud scoring (card heritage, extended to non-card) | Hosted in MEA via Network International [vyntra](https://vyntra.com/blog/best-fraud-detection-software-for-app-scams/) [channeldrive](https://channeldrive.in/bfsi/network-international-picks-fico-to-address-fraud-in-banks/) | Yes | Yes (profiles) | "Card heritage" is fair; "card only" is not. |
| **Sift** | Digital trust and safety, e-commerce/marketplace fraud | Global | Yes (events) | Yes | "Built mainly for online commerce" is broadly fair (general knowledge). |
| **Featurespace, ThreatMark, Sardine** | Behavioural/adaptive ML for banks and fintechs | Global | Yes | Yes | Not re-verified this pass. Featurespace is known for "adaptive behavioural analytics" and is a direct conceptual analogue. |

**NIP/USSD support:** none of the global vendors advertises native NIP/USSD integration in the material we retrieved. That said, integration happens at the bank's transfer API, so rail-specific support matters less than local fraud typologies, pricing and data residency. NIBSS is now rolling out the ISO 20022 National Payment Stack (NPS) to replace NIP: 26.55M transactions worth ₦1.4T across 48 institutions at early rollout. [thesun](https://thesun.ng/nps-records-26-55m-transactions-worth-n1-4trn/) ISO 20022 makes rail-agnostic integration easier for everyone, including foreign vendors. "We support NIP" is therefore a weak moat. "We are tuned to Nigerian social-engineering typologies, priced in naira for MFBs, and live in a pilot within weeks" is a stronger one.

**Pricing:** public prices for these vendors were not retrievable. YouVerify says it prices per verification. [korahq](https://www.korahq.com/blog/best-kyc-verification-providers)

### A7. PaySure / PaySureFy

- **What PaySureFy actually is:** a Nigerian AI-powered escrow and trust platform for online and cross-border transactions. It "does not operate as a digital wallet or bank that directly holds customer funds" and bundles identity verification, AI fraud checks, milestone payments and dispute resolution (WorldEF, July 31, 2026). [worldef](https://worldef.com/2026/07/31/paysurefy-launches-escrow-payment-platform/)
- **The "AI fraud detection piloted with five Lagos MFBs" claim:** we found no evidence for it. The search turned up academic studies titled "Adoption of AI Tools and Fraud Detection in Selected Microfinance Banks in Lagos" and a project on "five (5) selected microfinance banks" in Lagos. [researchgate](https://www.researchgate.net/publication/383264952_Artificial_intelligence_in_fraud_prevention_Exploring_techniques_and_applications_challenges_and_opportunities) [nairaproject](https://nairaproject.com/projects/2939.html) That is a plausible source of the confusion.
- **Founder:** the name Mgbeoji Austin did not appear in what we retrieved.
- **Recommendation:** describe PaySureFy only as an escrow platform with embedded fraud checks, not as an MFB fraud-detection competitor.

### A8. Market sizing

**Evidenced:**
- 325.6M active accounts (August 2025) and 66.8M registered BVNs (September 2025) (NIBSS via Guardian, Dec 22, 2025). [guardian](https://guardian.ng/news/nibss-assures-hitch-free-epayment-systems-amid-n384tr-quarterly-transactions/)
- NIP volume of 11.2B and total e-payment value of ₦1.07 quadrillion, labelled as 2024 on the NIBSS media page. [nibss-plc](https://nibss-plc.com.ng/nigerias-digital-payments-surge-to-n1-07-quadrillion-as-nibss-defines-future) The labelling is ambiguous, so treat this as approximate.
- Q1 2025 NIP value of ₦284.9T, up 22% year on year (Technext, citing NIBSS). [technext24](https://technext24.com/2025/09/01/nip-the-payments-engine-powering-nigeria/)
- The CBN says instant payment transactions rose 120% in two years. [nibss-plc](https://nibss-plc.com.ng/instant-payment-transactions-rise-by-120-in-2yrs-cbn/)
- About ₦384T in quarterly e-payment transactions as of July 2025. [guardian](https://guardian.ng/news/nibss-assures-hitch-free-epayment-systems-amid-n384tr-quarterly-transactions/)
- One fraud-architecture report says Nigeria processes "more than 10 billion real-time transactions annually." [vanguardngr](https://www.vanguardngr.com/2026/07/digital-fraud-losses-drop-in-nigeria-despite-rising-cyber-threats-report/)

**Licence counts:** exact counts of commercial, merchant, microfinance and payment service banks, PSPs, MMOs and switches were not retrieved in this pass. Pull the current CBN "Financial Institutions" list before the pitch. The CBN revoked 46 MFB licences effective July 1, 2026, under Sections 12 and 13 of BOFIA 2020. The revocations were approved by Governor Cardoso and announced by Acting Director of Corporate Communications Hakama Sidi-Ali, citing reasons including "insufficient assets to meet liabilities" and failure to maintain minimum capital, with the NDIC appointed liquidator (Channels TV; TheCable, July 1, 2026). So the MFB count is shrinking and quality-filtered. The survivors face stronger supervision, which is good for Fable.

**What the PSV 2028 target implies (our calculation, with caveats):** ₦25.85B of 2025 losses against roughly ₦1,070T in annual e-payment value is about 0.0024%. Hitting "<0.001%" therefore implies cutting the loss ratio by more than half, depending on the denominator the CBN uses. The CBN also cites ₦134.48B lost to fraud from 2020 to 2025 (per Technext's reading of PSV 2028). [technext24](https://technext24.com/reviews/nigerian-fintechs-ai-fraud-bad-data/)

## Part B: Regulation

### B1. Regulation timeline

| Date | Instrument | Relevance to Fable |
|---|---|---|
| Oct 2023 | Fidelity blocks transfers to four fintechs; CBN issues new KYC rules (Nov 2023) [telegraph](https://telegraph.ng/news/2024/04/30/panic-as-cbn-bans-opay-palmpay-others-new-accounts/) [techcabal](https://techcabal.com/2024/04/29/exclusive-cbn-directs-four-fintechs-to-stop-onboarding/) | Shows identity-first regulation |
| Apr 29–Jun 2024 | CBN pauses onboarding at OPay, Moniepoint, Kuda, PalmPay (and per Guardian, Paga) [guardian](https://guardian.ng/business-services/cbn-lifts-new-account-restriction-on-opay-kuda-others/) [Wikipedia](https://en.wikipedia.org/wiki/Opay) [techcabal](https://techcabal.com/2024/04/29/exclusive-cbn-directs-four-fintechs-to-stop-onboarding/) | KYC/fraud scrutiny of wallets |
| Sep 2024 | Moniepoint MFA live ("mandated by the CBN" per Moniepoint) [moniepoint](https://support.moniepoint.com/topics/account-login-and-security-228) [technext24](https://technext24.com/2024/09/23/moniepoint-multifactor-authentication/) | Step-up auth norms |
| 7 Oct 2024 | UK PSR mandatory APP-scam reimbursement [farrer](https://www.farrer.co.uk/news-and-insights/authorised-push-payment-fraud-and-mandatory-reimbursement/) | Global proof point |
| 30 Oct 2024 | UK SI 2024/1013 in force: PSPs may delay suspicious outbound payments up to D+4 business days [legislation](https://www.legislation.gov.uk/uksi/2024/1013/body/made) [regulationtomorrow](https://www.regulationtomorrow.com/2024/10/the-payment-services-amendment-regulations-2024/) | Legal model for Ghost |
| 20 Mar 2025 / 19 Sep 2025 | NDPC GAID issued / effective; NDPR 2019 ceases to operate [mondaq](https://www.mondaq.com/nigeria/data-protection/1778574/written-policy-broken-practice-the-data-protection-gap) | Fable's data obligations |
| Feb 2, 2026 | CBN Fintech Report 2025 published [ecofinagency](https://www.ecofinagency.com/news-finances/0302-52525-nearly-90-of-nigerian-fintechs-use-ai-for-fraud-detection-cbn-says) | 87.5% stat |
| Jan 2026 | NIBSS 2025 fraud data at NeFF [allafrica](https://allafrica.com/stories/202601230595.html) | Core stats |
| Mar 10, 2026 | CBN Baseline Standards for Automated AML Solutions [acelera](https://www.acelera.law/publications/cbn-issues-baseline-standards-for-automated-aml-solutions-a-new-compliance-paradigm-for-financial-institutions) | Why-now driver |
| ~Jun 10, 2026 | Implementation roadmaps due [youverify](https://youverify.co/en/blogs/cbn-kyc-aml-requirements-2026) | Institutions already planning |
| Jun 1, 2026 | PSV 2028 launched [thisdaylive](https://www.thisdaylive.com/2026/06/02/cardoso-unveils-payments-system-vision-2028-targets-95-financial-inclusion/) | 0.001% target, AI fraud detection |
| Aug 3, 2026 | INTERPOL African Cyberthreat Assessment 2026 [cryptobriefing](https://cryptobriefing.com/ai-fuels-half-cybercrime-africa-interpol/) | AI 55% stat |
| ~Sep 10, 2027 | DMB full compliance deadline | Bank sales window |
| ~Mar 10, 2028 | OFI (MFBs, PSPs, MMOs etc.) full compliance deadline | Fable's core window |

### B2. CBN AML baseline standards (March 10, 2026)

- **Exact title:** "Issuance of Baseline Standards for Automated Anti-Money Laundering (AML) Solution for Financial Institutions in Nigeria" (TheCable). [thecable](https://www.thecable.ng/cbn-directs-banks-to-deploy-automated-anti-money-laundering-systems-within-18-months/) Reference BSD/DIR/PUB/LAB/019/002, per YouVerify (secondary source). [youverify](https://youverify.co/en/blogs/cbn-kyc-aml-requirements-2026) Co-signed by Akinwunmi A. (New Dawn). [newdawnngr](https://www.newdawnngr.com/2026/03/11/cbn-spells-new-deadline-for-banksfintech-on-automated-aml-systems/)
- **Length and scope:** 27 pages covering 12 competency areas (Business Fortune). [bizfortune](https://bizfortune.com/2026/03/business-fortune-pulsar-cbn-automated-anti-money-laundering)
- **Who it covers:** all institutions under CBN purview, including banks, MMOs, IMTOs and PSPs. Sophistication should scale with "size, risk profile, business model, transaction volumes, and complexity" (Channels). [channelstv](https://www.channelstv.com/2026/03/11/cbn-extends-anti-money-laundering-compliance-deadline-for-banks/) [insight7](https://insight7.io/cbn-aml-rules-what-should-banks-cx-teams-automate/)
- **Key text:**
  - Solutions must "strengthen the detection and reporting of suspicious transactions in real time." [thecable](https://www.thecable.ng/cbn-directs-banks-to-deploy-automated-anti-money-laundering-systems-within-18-months/)
  - They must assess "activity in the context of the full customer profile and not monitoring solely on raw transactional data." [insight7](https://insight7.io/cbn-aml-rules-what-should-banks-cx-teams-automate/)
  - "manual AML/CFT/CPF controls are no longer sufficient." [bizfortune](https://bizfortune.com/2026/03/business-fortune-pulsar-cbn-automated-anti-money-laundering)
  - The standards encourage "anomaly detection, behavioural pattern recognition and automated risk scoring" (Techeconomy). [techeconomy](https://techeconomy.ng/cbn-ai-anti-money-laundering-rules-banks-fintechs-nigeria/)
- **Deadlines:** implementation started on the date of issuance. Full compliance is due 18 months later for deposit money banks and 24 months later for other financial institutions. Roadmaps were due within three months. [channelstv](https://www.channelstv.com/2026/03/11/cbn-extends-anti-money-laundering-compliance-deadline-for-banks/) [acelera](https://www.acelera.law/publications/cbn-issues-baseline-standards-for-automated-aml-solutions-a-new-compliance-paradigm-for-financial-institutions)
- **Not verified in what we retrieved:** explicit requirements on explainability, human oversight or annual independent ML model validation. Read the circular PDF before quoting those requirements on stage.
- **Honest fit:** this is an AML standard. Fable is a fraud product without sanctions screening, STR filing or AML case management. Pitch Fable as a component that supplies customer-profile-based real-time anomaly scoring alongside an institution's AML stack. Do not claim it alone makes an institution compliant.

### B3. PSV 2028

- Launched in Abuja on Monday, June 1, 2026 (ThisDay, June 2). [thisdaylive](https://www.thisdaylive.com/2026/06/02/cardoso-unveils-payments-system-vision-2028-targets-95-financial-inclusion/)
- Cardoso: "By 2028, we must commit to reducing fraud losses to less than 0.001 per cent of all transactions. With NIN, BVN, intelligent systems, and AI fraud detection, people's money must be safer in the digital system than under their mattresses." [thisdaylive](https://www.thisdaylive.com/2026/06/02/cardoso-unveils-payments-system-vision-2028-targets-95-financial-inclusion/)
- Other targets: 95% financial inclusion and cash outside banks below 40% of money in circulation. [ground](https://ground.news/article/cbn-unveils-payments-system-vision-2028-stakeholders-seek-lower-transaction-costs)
- **Mandate or aspiration?** Coverage presents it as a target. One outlet's headline says "Mandates AI Integration," [businessremarks](https://businessremarks.com.ng/business/payment-system-cbn-unveils-psv-2028-to-combat-%E2%82%A625-85-billion-digital-fraud-mandates-ai-integration/) but we found no quoted sanction. Use "target" or "goal" on stage.

### B4. Other CBN rules

The following were not verified from primary text in this pass, so treat them as questions to research before claiming anything:
- the Risk-Based Cybersecurity Framework
- the Consumer Protection Regulations and their refund timelines
- outsourcing and third-party guidelines
- any rule on transaction holds
- APP reimbursement

We found no Nigerian equivalent of the UK's legal right to delay a suspicious instant payment. NIBSS runs a mandatory Industry Fraud Desk ("Fraud reporting to the Industry Fraud Desk at NIBSS is a mandatory requirement," Oiwoh), with fraud intelligence sharing and HAWK capacity building. Reports of the size of its fraud watch list conflict. Vanguard (via allAfrica) reports 3,417 individuals on a watch list. Legit.ng reports "CBN, NIBSS Name 13,417 Fraud Suspects on New Portal," and 21st Century Chronicle (via NAN) cites a "persons of interest" database of "more than 13,000 individuals." Verify the figure before quoting it. NIBSS credits BVN/NIN integration with the 2025 decline. [businessday](https://businessday.ng/pro/article/bank-fraud-slumps-first-time-since-2021-as-bvn-nin-pay-off/)

### B5. Data protection (NDPA 2023 and GAID 2025)

- **Framework:** GAID was issued March 20, 2025 and became effective September 19, 2025. From that date, NDPR 2019 and its 2020 framework ceased to operate as operative instruments. [mondaq](https://www.mondaq.com/nigeria/data-protection/1778574/written-policy-broken-practice-the-data-protection-gap) [regulations](https://regulations.ai/regulations/RAI-NG-NA-GAIGNXX-2025)
- **Obligations that apply to Fable as a processor for banks:**
  - Processors must notify the controller of a breach. Controllers must notify the NDPC within 72 hours of awareness (NDPA s.40) and data subjects "immediately" if the risk is high. [multilaw](https://www.multilaw.com/Multilaw/Multilaw/Data_Protection_Laws_Guide/DataProtection_Guide_Nigeria.aspx) [venvera](https://venvera.com/learn/ndpa/requirements-explained)
  - DPIAs are mandatory for high-risk processing, including "systematic and extensive evaluation" and large-scale sensitive data. They must be done before processing, with GAID setting timelines of four months for new sensitive-data software and six months for existing processing. [lawpavilion](https://lawpavilion.com/blog/ndp-act-2023-gaid-2025-a-comprehensive-guide-to-nigerias-new-data-protection-landscape/)
  - Periodic compliance audits, Compliance Audit Returns (due March 31), semi-annual data protection reports, and a DPO where the organisation is of "major importance." [mondaq](https://www.mondaq.com/nigeria/privacy-protection/1606106/the-nigeria-data-protection-commission-issues-the-general-application-and-implementation-directive-2025-gaid) [mondaq](https://www.mondaq.com/nigeria/data-protection/1778574/written-policy-broken-practice-the-data-protection-gap) [legal500](https://www.legal500.com/intelligence/nigeria/privacy/review-of-nigeria-data-protection-act-ndpa-2023-&-gaid-2025-data-privacy-in-nigeria) [venvera](https://venvera.com/learn/ndpa/requirements-explained)
  - Data controllers of major importance in the MDP-UHL tier pay a ₦5,000 fee per data processor they engage. [mondaq](https://www.mondaq.com/nigeria/privacy-protection/1618278/key-highlights-of-the-nigeria-data-protection-act-general-application-and-implementation-directive-2025)
- **Implication:** Fable's behavioural profiling (amounts, timing, devices, coarse location, typing rhythm) is "systematic and extensive evaluation." Typing rhythm may also count as biometric data. Expect every client to require a DPIA, a data processing agreement and audit rights. Fable should complete its own DPIA template before the first pilot, not after.

### B6. Global comparables

- **UK APP reimbursement** (PSR, from October 7, 2024):
  - Faster Payments and CHAPS victims are reimbursed up to £85,000 per claim (cut from a proposed £415,000), within 5 business days of the claim. [freshfields](https://www.freshfields.com/en/our-thinking/briefings/2024/09/authorised-push-payment-fraud-a-new-mandatory-reimbursement-regime-for-uk-psps) [psr](https://www.psr.org.uk/information-for-consumers/app-fraud-reimbursement-protections/)
  - The cost is split 50:50 between sending and receiving firms. [farrer](https://www.farrer.co.uk/news-and-insights/authorised-push-payment-fraud-and-mandatory-reimbursement/)
  - The PSR says the cap fully covers 99.8% of cases by volume and 90% by value. [psr](https://www.psr.org.uk/publications/policy-statements/ps247-faster-payments-app-scams-reimbursement-requirement-confirming-the-maximum-level-of-reimbursement/)
- **UK payment-delay rule:** the Payment Services (Amendment) Regulations 2024 (SI 2024/1013) were made on October 9, 2024 and came **into force October 30, 2024**. [dlapiper](https://www.dlapiper.com/en/insights/publications/2024/10/payment-execution-time-limits-new-psr-rules) [legislation](https://www.legislation.gov.uk/uksi/2024/1013/body/made)
  - A PSP with "reasonable grounds to suspect" fraud can delay an outbound payment up to the end of the 4th business day after receipt. [ocorian](https://www.ocorian.com/knowledge-hub/insights/payment-services-amendment-regulations-2024-balancing-payment-delays-fraud) [fca](https://www.fca.org.uk/publication/finalised-guidance/fg24-6.pdf)
  - It must tell the customer the reason and what is needed to resolve it, and it is liable for resulting charges or interest. [regulationtomorrow](https://www.regulationtomorrow.com/eu/hm-treasury-publishes-draft-si-the-payment-services-amendment-regulations-2024/) [regulationtomorrow](https://www.regulationtomorrow.com/2024/10/the-payment-services-amendment-regulations-2024/)
  - Say "up to 4 business days," not "72 hours."
- **EU PSD3/PSR:** status not re-verified in this pass.
- **India:** the RBI's own Payments Vision 2028 (a different document from Nigeria's) proposes shared fraud liability between sending and beneficiary banks and a "switch on/off" for payment modes. [visionias](https://visionias.in/current-affairs/monthly-magazine/2026-05-22/economy/payments-vision-2028) This is a useful signal that regulators are moving liability toward the receiving side.

## Part C: Fraud Data and Research Basis

### C1. NIBSS figures: verified

All five figures you asked about are verified:
- ₦17.67B in 2023
- ₦52.26B in 2024, including the single ₦31.1B incident [nibss-plc](https://nibss-plc.com.ng/nibss-digital-payment-fraud-drops-51-to-%E2%82%A625-85b-in-2025/)
- ₦25.85B in 2025
- 67,518 cases [nibss-plc](https://nibss-plc.com.ng/digital-payment-fraud-drops-51-to-n25-85b-lagos-accounts-for-63/)
- Lagos at 63.43% [nibss-plc](https://nibss-plc.com.ng/digital-payment-fraud-drops-51-to-n25-85b-lagos-accounts-for-63/)

Other figures from the same release:
- **Case trend:** 123,918 (2021) → 101,669 (2022) → 95,620 (2023) → 70,111 (2024) → 67,518 (2025). [businessday](https://businessday.ng/pro/article/bank-fraud-slumps-first-time-since-2021-as-bvn-nin-pay-off/)
- **Losses before 2023:** ₦12.77B (2021) and ₦14.32B (2022). [businessday](https://businessday.ng/pro/article/bank-fraud-slumps-first-time-since-2021-as-bvn-nin-pay-off/)
- **Joint industry action:** at the 2026 NeFF Technical Kickoff (themed "Shrinking Fraud Losses With ISO 20022 & Identity Management"), NIBSS MD/CEO Premier Oiwoh said "joint industry measures last year prevented about N20 billion in potential losses" (NIBSS press page). ITEdgeNews and Legit.ng attribute this figure to 2024 rather than 2025, so confirm the year before quoting it.
- **Top technique:** social engineering, which Oiwoh described as "particularly insider abuse." [nibss-plc](https://nibss-plc.com.ng/nibss-digital-payment-fraud-drops-51-to-%E2%82%A625-85b-in-2025/) Insider-enabled fraud is outside Fable's customer-side model. Say so.
- **Top channel by value:** internet banking (₦13.37B). [allafrica](https://allafrica.com/stories/202601230595.html)
- **Reporting gaps:** in 2023 only 60 of 163 profiled institutions submitted fraud data (37%) (Technext, April 9, 2026). Attempted fraud cases rose 338% between 2023 and 2024. [technext24](https://technext24.com/2026/04/09/nigeria-fintech-fraud-data-sharing-gap/)
- **Longer trend:** one 2026 report says losses are up about 350% since 2020 while cases fell about 31%. In other words, there are fewer attacks, and each one costs more. [lawyard](https://www.lawyard.org/news/nigerias-financial-sector-faces-critical-18-months-as-ai-driven-fraud-evolves/) [vanguardngr](https://www.vanguardngr.com/2026/07/digital-fraud-losses-drop-in-nigeria-despite-rising-cyber-threats-report/)
- **Interim 2026 data:** none retrieved.

### C2. INTERPOL

- **2026 report:** the African Cyberthreat Assessment Report 2026 was released August 3, 2026. It is 40 pages and covers January to December 2025. [occrp](https://www.occrp.org/en/news/ai-fuels-55-of-african-cybercrimes-as-losses-top-480-million-interpol-warns) [cryptobriefing](https://cryptobriefing.com/ai-fuels-half-cybercrime-africa-interpol/)
  - AI is involved in 55% of reported cybercrimes. [riotimesonline](https://www.riotimesonline.com/ai-cybercrime-africa-interpol-report-2026/)
  - Losses rose from $192M (2024) to $484M. [saharareporters](https://saharareporters.com/2026/08/03/interpol-report-links-ai-over-half-cybercrime-across-africa-losses-hit-484million)
  - 72% of surveyed countries reported scam centres. [saharareporters](https://saharareporters.com/2026/08/03/interpol-report-links-ai-over-half-cybercrime-across-africa-losses-hit-484million)
  - Deepfakes and synthetic identities are "increasingly defeating biometric security measures." [smallwarsjournal](https://smallwarsjournal.com/2026/08/05/interpol-releases-report-on-ai-cybercrime-in-africa/)
  - 17 countries updated cybercrime laws in 2025. [daily](https://daily.dev/posts/ai-fuels-more-than-half-of-cybercrime-in-africa-as-digital-scams-surge-interpol-2npxoj4no)
  - Four operations produced 1,500+ arrests and more than $100M recovered. [daily](https://daily.dev/posts/ai-fuels-more-than-half-of-cybercrime-in-africa-as-digital-scams-surge-interpol-2npxoj4no)
  - Coverage disagrees on the survey base: OCCRP says 26 member countries, most others say 36. [occrp](https://www.occrp.org/en/news/ai-fuels-55-of-african-cybercrimes-as-losses-top-480-million-interpol-warns) [saharareporters](https://saharareporters.com/2026/08/03/interpol-report-links-ai-over-half-cybercrime-across-africa-losses-hit-484million)
- **Pitch-relevant line:** synthetic identities and deepfakes are defeating biometric checks. Face verification alone is not enough.
- **2025 report (the "$3B+ 2019–2025" figure):** not re-verified in this pass. Cite it only after checking the INTERPOL PDF.

### C3. GASA and the Adhere/TechCabal figures

The following figures appear in a 2026 report covered by Vanguard (July 2026) and Lawyard:
- Nigeria "ranks 110th out of 112 countries for fraud protection" [vanguardngr](https://www.vanguardngr.com/2026/07/digital-fraud-losses-drop-in-nigeria-despite-rising-cyber-threats-report/)
- a "cybersecurity workforce gap of about 90 per cent" [vanguardngr](https://www.vanguardngr.com/2026/07/digital-fraud-losses-drop-in-nigeria-despite-rising-cyber-threats-report/)
- AI-enhanced fraud "about 4.5 times more profitable" [vanguardngr](https://www.vanguardngr.com/2026/07/digital-fraud-losses-drop-in-nigeria-despite-rising-cyber-threats-report/)
- global fraud losses of $442B in 2025 [vanguardngr](https://www.vanguardngr.com/2026/07/digital-fraud-losses-drop-in-nigeria-despite-rising-cyber-threats-report/)

Lawyard identifies the report as "Reckoning: Regulating Financial Services in the Age of AI." [lawyard](https://www.lawyard.org/news/nigerias-financial-sector-faces-critical-18-months-as-ai-driven-fraud-evolves/) We could not trace the underlying primary sources (the ranking index, the workforce survey or the 4.5x study). Attribute them to that report, not as independent facts. GASA Africa figures were not retrieved.

### C4. Social engineering and APP share

- **Best Nigerian proxy:** social engineering was 47% of volume and about 69% of value (₦17.84B of ₦25.85B) in 2025. [allafrica](https://allafrica.com/stories/202601230595.html)
- **SIM swap and WhatsApp impersonation:** no specific statistics retrieved.
- **Impersonation:** PalmPay's campaign focuses on it, and Moniepoint's guidance ("will never initiate a chat") addresses it. [moniepoint](https://moniepoint.com/blog/protect-your-money-from-fraud-in-nigeria) [dailytrust](https://dailytrust.com/digital-security-tools-key-to-fraud-prevention-nibss-official/) Both confirm it is a prevalent pattern.

### C5. CBN Fintech Report 2025

Published February 2, 2026 under the Policy Insight Series. Based on a nationwide survey, a June 2025 closed-door workshop and the October 2025 Fintech Roundtable. [nairametrics](https://nairametrics.com/2026/02/03/cbn-survey-87-5-of-nigerian-fintechs-use-ai-for-fraud-detection/) The AI use cases reported:

| AI use case | % of respondents |
|---|---|
| Fraud detection | 87.5% |
| Chatbots / customer service | 62.5% |
| Credit scoring / risk modelling | 37.5% |
| Onboarding / KYC | 37.5% |
| No AI use | 12.5% |

Separately, 87.5% said compliance costs significantly constrain innovation. [cbn](https://www.cbn.gov.ng/Out/2026/CCD/CBN_FINTECH_REPORT_.pdf)

The sample size is not disclosed in the coverage we saw, and the 12.5% increments suggest a small respondent base. The report also notes that Nigeria lacks enough AI/ML engineers trained in financial fraud detection (Technext's reading). [mexc](https://www.mexc.com/news/648996)

### C6. Build vs buy and talent

- The PYMNTS "51% outsource" US figure and Nigerian salary data were not retrieved. Do not cite them unverified.
- **What is evidenced:**
  - About 80% of Access Holdings' operational IT cost is licensing, [techcabal](https://techcabal.com/2025/04/18/access-holdings-spends-big-on-tech/) so even top banks mostly buy.
  - The CBN found that 87.5% of fintechs feel compliance costs constrain innovation. [cbn](https://www.cbn.gov.ng/Out/2026/CCD/CBN_FINTECH_REPORT_.pdf)
  - A 2026 report cites a 90% cybersecurity workforce gap [vanguardngr](https://www.vanguardngr.com/2026/07/digital-fraud-losses-drop-in-nigeria-despite-rising-cyber-threats-report/) (attribution caveat in C3).
  - YouVerify, ThetaRay and FICO via Network International all sell into this market, which shows buying is normal.

### C7. False positives

From Javelin Strategy & Research, "Overcoming False Positives" (September 2015; US data from 2014; sponsored by Riskified):
- About $118B in legitimate transactions were falsely declined, against $9B in card fraud. [barclaycard](https://www.barclaycard.co.uk/content/dam/barclaycard/documents/business/news-and-insights/Riskified-Javelin-Whitepaper-2015.pdf) The "13x" figure is derived from these numbers (118/9 ≈ 13.1). It is not Javelin's phrase.
- 15% of cardholders had a false decline in a year. [barclaycard](https://www.barclaycard.co.uk/content/dam/barclaycard/documents/business/news-and-insights/Riskified-Javelin-Whitepaper-2015.pdf)
- After a false decline, 32% stopped shopping with the merchant and 26% reduced their spending there. [barclaycard](https://www.barclaycard.co.uk/content/dam/barclaycard/documents/business/news-and-insights/Riskified-Javelin-Whitepaper-2015.pdf)

Present this as dated, US-only, card-context evidence that friction has real costs. It supports Fable's choice of a cooling window with self-release over a hard block. The UK delay rule shows regulators accept short, explained delays, with the PSP liable for resulting charges. [legislation](https://www.legislation.gov.uk/uksi/2024/1013/body/made) [regulationtomorrow](https://www.regulationtomorrow.com/2024/10/the-payment-services-amendment-regulations-2024/)

### C8. Technical credibility

These points come from general ML and security practice, not new sources.

**Isolation forest:**
- It is a reasonable, well-established unsupervised anomaly detector (Liu, Ting and Zhou, 2008). It is fast, needs no labels and suits cold-start deployment.
- **Limitations:**
  - It scores "rare," not "fraudulent." Social-engineering transfers by the real customer can look normal on the sender's own device and typing features.
  - It is sensitive to feature engineering and contamination settings.
  - Training one forest per customer on thin histories is statistically weak.
- **Mitigations:**
  - Use population or segment models with per-customer features (deviation from that customer's baseline) rather than literally one forest per customer.
  - Add recipient-side risk (new beneficiary, account age, mule signals) and session context.
  - Use rules for known typologies.
  - Move to supervised models once labelled outcomes exist.
  - Monitor drift and run champion/challenger tests.
- **90-day baseline:** a common, defensible window, but not a formal standard. Fall back to segment baselines for new customers.

**PIN storage:**
- OWASP currently recommends Argon2id (m=19 MiB, t=2, p=1) first; scrypt; bcrypt (work factor of at least 10) for legacy only; and PBKDF2-HMAC-SHA256 at 600,000 iterations where FIPS is required. [owasp](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html)
- 200,000 is below that.
- More fundamentally, a 4-digit PIN has only 10,000 possibilities, so any hash can be brute-forced offline if leaked. Protection comes from a secret pepper or HSM, rate limiting and not storing PINs at all.
- **Recommendation:** Fable should not store bank PINs. Let the bank's core or HSM verify them, and have Fable consume only a pass/fail signal.

**LLMs off the critical path:** this is correct design. LLMs are non-deterministic, can hallucinate reasons and are exposed to prompt injection through attacker-controlled text such as transfer narrations and beneficiary names. Keep the LLM explanation strictly generated from the deterministic engine's reason codes, and sanitise narration fields before they reach the LLM.

**Explainability:** the CBN warns that AI-driven fraud and compliance decisions need stronger governance and supervision (Technext's reading of the CBN report). [technext24](https://technext24.com/reviews/nigerian-fintechs-ai-fraud-bad-data/) The deterministic engine plus reason codes is Fable's answer.

## Part D: Verification of Existing Pitch Answers

| # | Claim | Verdict | Correct fact / source | Suggested wording |
|---|---|---|---|---|
| Q1a | "₦25.85B in Q1 2025 alone, up 600%" | **Inaccurate** | ₦25.85B is the full-year 2025 figure, **down 51%** from ₦52.26B (NIBSS, Jan 2026). In Q1 2025, FITC reported cases down 33.8% but amounts up 240%+. [nibss-plc](https://nibss-plc.com.ng/digital-payment-fraud-drops-51-to-n25-85b-lagos-accounts-for-63/) [techcabal](https://techcabal.com/2025/09/19/uba-halves-fraud-losses-reports-335bn-profit/) | "Nigeria lost ₦25.85 billion to payment fraud in 2025, and ₦17.84 billion of that was social engineering, where the real customer is talked into sending the money." |
| Q1b | "INTERPOL: Sub-Saharan losses exceeded $2.9B, fintechs primary entry point" | **Unverifiable / unsupported** | Not found. INTERPOL 2026: losses rose from $192M to $484M; AI in 55% of cases; mobile money and social media are key vectors. [occrp](https://www.occrp.org/en/news/ai-fuels-55-of-african-cybercrimes-as-losses-top-480-million-interpol-warns) [saharareporters](https://saharareporters.com/2026/08/03/interpol-report-links-ai-over-half-cybercrime-across-africa-losses-hit-484million) | "INTERPOL's 2026 Africa assessment found AI involved in 55% of reported cybercrime, with losses more than doubling to $484 million." |
| Q1c | "55% of African cybercrime involves AI" | **Accurate** (INTERPOL, Aug 3, 2026) [occrp](https://www.occrp.org/en/news/ai-fuels-55-of-african-cybercrimes-as-losses-top-480-million-interpol-warns) | Say "reported cases," based on a survey of member countries. | As above. |
| Q1 core | "Fraud is a conversation problem" | **Supported** | 47% of volume and about 69% of value is social engineering. [allafrica](https://allafrica.com/stories/202601230595.html) | Keep it. Add: "Face ID proves it's you, not that you meant it." |
| Q2 | Minimal data; 200k-round PINs; tenant isolation; deterministic engine; NDPR/NDPA status | **Partly outdated** | NDPR is superseded for operational purposes by NDPA 2023 and GAID (effective Sept 19, 2025). 200k is below OWASP's 600k. Typing rhythm is not "minimal." [owasp](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html) | "We align to the NDPA 2023 and GAID 2025. Our DPIA is scoped and will be completed before any live data. We don't want to hold PINs at all: verification stays with the bank." |
| Q3 | "Most existing systems check identity (KYC, BVN, PIN) rather than behaviour" | **Overstated** | OPay runs ML and behavioural analytics; YouVerify does behavioural and session scoring; Tier-1 banks license monitoring platforms. [allafrica](https://allafrica.com/stories/202607230554.html) [youverify](https://youverify.co/en) | "Most customer-facing controls are identity checks and fixed thresholds. The big wallets add proprietary behavioural ML for their own users. Most MFBs and smaller PSPs don't have that." |
| Q4 | Smile ID/Dojah = identity; Sift/Feedzai = card/Western e-commerce | **Half right** | Identity framing is fair. Feedzai covers A2A, scams and AML. Omits YouVerify, BioCatch and ThetaRay. | "Identity vendors secure onboarding. Global platforms like Feedzai and BioCatch are excellent but priced and integrated for tier-1 banks. YouVerify is the closest local player and is compliance-led. We focus on mid-flow social-engineering intervention for smaller institutions." |
| Q5 | Pricing; read-only historical pilot standard | **Reasonable** | ₦100,000 a month for 50,000 transactions is ₦2 per transaction (about $70–75 a month at TechCabal's implied 2026 rate of about ₦1,365/$). Historical "shadow mode" pilots are common practice, though not proven from a source here. | "We start in read-only shadow mode on your historical data, so there is no risk to live payments, and you see what we would have caught." |
| Q6 | Foreign vendors don't know the market; locals focused on identity because regulation demanded it | **Plausible, partly evidenced** | CBN regulation was KYC-first: the Nov 2023 KYC rules and the April 2024 onboarding pause. [pulse](https://www.pulse.ng/story/how-kyc-issues-led-to-recent-cbn-ban-on-4-fintechs-2024072703385988573) [telegraph](https://telegraph.ng/news/2024/04/30/panic-as-cbn-bans-opay-palmpay-others-new-accounts/) [techcabal](https://techcabal.com/2024/04/29/exclusive-cbn-directs-four-fintechs-to-stop-onboarding/) The new CBN standard now pushes behavioural monitoring. [techeconomy](https://techeconomy.ng/cbn-ai-anti-money-laundering-rules-banks-fintechs-nigeria/) | Keep it. Cite the March 2026 circular as the shift. |
| Q7 | Isolation forest; calibrated on NIBSS/CBN stats; LLM off critical path | **Accurate, needs a caveat** | Calibration on aggregates is not training on labels. | "Today it's an unsupervised model calibrated to published fraud patterns. In each pilot we retrain on that institution's confirmed fraud outcomes." |
| Q8/Q9 | Copilot → Shield → Ghost sequential | Internal | Flag: Ghost holds must happen before NIP/NPS submission. | Add "the hold happens before the money leaves the bank." |
| Q10 | Roadmap and onboarding | **Needs evidence** | No published Nigerian vendor onboarding benchmark was found. Expect security review, DPIA, DPA and penetration test. | "We expect a 3–6 month path from pilot to production," labelled as an estimate. |
| Q11 | Banks can build; OPay etc. have it | See E-section answer | | |
| Q12 | When Fable is wrong | See E-section answer | | |

## Part E: Model Answers and Other Likely Questions

**Q11: "Can't banks build this? Don't OPay, Moniepoint and PalmPay already have it?"**

"Yes, and they deserve credit. OPay runs machine-learning scam detection across more than 100 million transactions a day. [thecable](https://www.thecable.ng/opay-introduces-security-features-to-combat-digital-fraud/) [allafrica](https://allafrica.com/stories/202607230554.html) PalmPay's new Security Centre flags suspected fraud recipients mid-transfer. [businessday](https://businessday.ng/technology/article/palmpay-upgrades-security-center-as-digital-fraud-risks-evolve/) Moniepoint requires biometrics above ₦500,000. [fintechmagazine](https://fintechmagazine.africa/2024/09/25/moniepoint-introduces-multi-factor-authentication-to-enhance-payment-security/) But those tools protect only their own customers, and they were built by hundreds of engineers. Nigeria's long tail can't do that: hundreds of microfinance banks, smaller PSPs and wallets. The CBN's March 2026 standard now requires every one of them to run automated, real-time monitoring against the full customer profile. Non-bank institutions must comply in full by around March 2028. [insight7](https://insight7.io/cbn-aml-rules-what-should-banks-cx-teams-automate/) [acelera](https://www.acelera.law/publications/cbn-issues-baseline-standards-for-automated-aml-solutions-a-new-compliance-paradigm-for-financial-institutions) Even top banks buy rather than build: about 80% of Access Holdings' IT operating cost is licensing. [techcabal](https://techcabal.com/2025/04/18/access-holdings-spends-big-on-tech/) We are the affordable, plug-in version for everyone else, starting at ₦100,000 a month."

**Q12: "What happens when Fable gets it wrong?"**

"Two failure modes.
- **False positives.** Ghost doesn't decline. It pauses, explains why in plain English, and lets the customer release the transfer after a quick confirmation. Trusted recipients such as salary or family payees can be whitelisted, and holds are capped. Hard declines are costly: Javelin found that a third of falsely declined customers stopped shopping with the merchant. [barclaycard](https://www.barclaycard.co.uk/content/dam/barclaycard/documents/business/news-and-insights/Riskified-Javelin-Whitepaper-2015.pdf) That's why we pause instead of block. The UK now lets banks delay suspicious payments up to four business days as long as they tell the customer why, which shows regulators accept short, explained holds. [regulationtomorrow](https://www.regulationtomorrow.com/2024/10/the-payment-services-amendment-regulations-2024/)
- **False negatives.** We are one layer, not the only layer. The bank keeps its existing controls and the final decision.

On liability, we're decision support. The contract allocates it, and every decision is logged with reason codes for disputes and audits."

**Other likely questions:**

1. **"Why trust an early-stage team?"**
   - Read-only pilot, so there's zero live-payment risk.
   - Deterministic, auditable engine.
   - Independent penetration test and DPIA before any live deployment.
2. **"Traction?"** Be honest: no paying customers. Offer pilot letters of intent as the next milestone. Name the target segment: MFBs facing the ~March 2028 deadline.
3. **"How do you get labelled data?"**
   - Each pilot's historical confirmed fraud cases and chargeback/dispute outcomes.
   - Analyst feedback from the console.
   - Later, NIBSS Fraud Desk typologies.
   - No cross-tenant pooling without consent: Nexus is opt-in and future.
4. **"Data residency?"**
   - Deploy in Nigerian data centres or the client's cloud tenancy.
   - The NDPA governs cross-border transfers.
   - Offer an on-premise option for banks.
5. **"Unit economics?"**
   - ₦2 per scored transaction at entry tier.
   - Value anchor: the average loss per fraud incident at Access, GTCO and UBA was ₦44,454 in 2025. [techcabal](https://techcabal.com/2026/05/11/three-of-nigerias-biggest-banks-lost-1-56-million-to-fraud-in-2025/) Preventing about two incidents a month covers the subscription.
6. **"Why now?"** The March 2026 CBN baseline standards, the PSV 2028 0.001% target, the NPS/ISO 20022 migration, [nibss-plc](https://nibss-plc.com.ng/nibss-new-payment-system-records-26-5m-transactions-worth-n1-4trn) and INTERPOL's finding that AI is involved in 55% of reported cybercrime.
7. **"What about insider fraud?"** Be honest. NIBSS names insider abuse as a leading technique, [nibss-plc](https://nibss-plc.com.ng/nibss-digital-payment-fraud-drops-51-to-%E2%82%A625-85b-in-2025/) and Fable's customer baselines don't target it. Watch and Sentinel are the roadmap answer.
8. **"Expansion?"**
   - Ghana and Kenya (M-Pesa) share mobile-money social-engineering patterns.
   - INTERPOL flags mobile-money fraud in East Africa and BEC/romance scams in West Africa. [daily](https://daily.dev/posts/ai-fuels-more-than-half-of-cybercrime-in-africa-as-digital-scams-surge-interpol-2npxoj4no)
   - South Africa has mature competition.
   - Sequence: Nigeria first.
9. **"Moat?"**
   - Not the algorithm.
   - Local typology tuning, naira pricing for small institutions, fast integration, and per-institution labelled outcomes that compound over time.
   - An eventual opt-in consortium signal (Nexus), which NIBSS's data-sharing gap shows the market lacks. [technext24](https://technext24.com/2026/04/09/nigeria-fintech-fraud-data-sharing-gap/)
10. **"Isn't behavioural biometrics invasive?"**
    - Typing rhythm is used only as a risk signal and is never stored raw.
    - A DPIA is required.
    - Customers are told and can opt out of that feature.

## Recommendations

1. Replace the Q1 statistics today: use NIBSS 2025 and INTERPOL 2026 figures as worded above.
2. Upgrade PIN handling. Ideally stop storing PINs; at minimum use Argon2id or PBKDF2 at 600k+ with a pepper.
3. Reframe Ghost as a pre-submission, customer-releasable pause, and present the UK SI 2024/1013 as precedent rather than a Nigerian legal basis.
4. Prepare a slide on YouVerify. Lagos audiences will know it.
5. Position against the CBN standard as "the fraud-scoring component," not "AML compliance in a box."
6. Read the CBN circular PDF and PSV 2028 document directly before quoting explainability or model-validation clauses.

## Caveats

- Several company claims (OPay's 100M transactions a day, 99.9% success, "hundreds of engineers"; YouVerify's 70% false-positive reduction) are self-reported marketing and have not been audited.
- The "$1B" OPay figure, the "five Lagos MFB" PaySure pilot, bank–vendor pairings, licence counts, the PYMNTS 51% figure, salary data, GASA Africa figures and INTERPOL 2025 figures were not verified in this pass. Treat them as unknown rather than false.
- Flutterwave loss amounts are insider-sourced press reports; the company denied that customer funds were lost. [techpoint](https://techpoint.africa/2024/05/16/flutterwaves-11-billion-breach/)
- The Javelin false-decline data is from 2015, US-only and vendor-sponsored. [barclaycard](https://www.barclaycard.co.uk/content/dam/barclaycard/documents/business/news-and-insights/Riskified-Javelin-Whitepaper-2015.pdf)
- The PSV 2028 ratio calculation is ours and depends on which denominator the CBN uses.