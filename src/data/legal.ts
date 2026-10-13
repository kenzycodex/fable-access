// Legal copy for the Privacy Notice and the Terms of Service.
//
// Kept as data, not JSX, so the wording can be reviewed and amended without
// touching layout, and so both documents render through one component.
//
// Everything stated here describes what the platform does today. Where a
// capability is planned but not built (SMS codes, Watch, a KYC provider,
// Gemini document analysis) the text says so rather than implying it exists,
// and these documents must be updated before any of those ship.

export type LegalBlock =
  | { type: "p"; text: string }
  | { type: "list"; items: string[] }
  | { type: "note"; text: string }
  | { type: "table"; head: string[]; rows: string[][] };

export interface LegalSection {
  id: string;
  title: string;
  blocks: LegalBlock[];
}

export interface LegalDocument {
  title: string;
  summary: string;
  effective: string;
  version: string;
  sections: LegalSection[];
}

export const legalContact = {
  privacy: "privacy@fable.ng",
  legal: "legal@fable.ng",
  security: "security@fable.ng",
};

const EFFECTIVE = "8 October 2026";
const VERSION = "1.0";

const p = (text: string): LegalBlock => ({ type: "p", text });
const list = (...items: string[]): LegalBlock => ({ type: "list", items });
const note = (text: string): LegalBlock => ({ type: "note", text });
const table = (head: string[], ...rows: string[][]): LegalBlock => ({ type: "table", head, rows });

// ---------------------------------------------------------------------------
// Privacy Notice
// ---------------------------------------------------------------------------

export const privacyNotice: LegalDocument = {
  title: "Privacy Notice",
  summary:
    "How Fable collects, uses, shares and protects personal data, for the people who visit our site, the staff of institutions who use the console, and the customers of those institutions whose transfers we score.",
  effective: EFFECTIVE,
  version: VERSION,
  sections: [
    {
      id: "who-we-are",
      title: "1. Who we are and what this covers",
      blocks: [
        p("Fable (\"Fable\", \"we\", \"us\") builds AI security and intelligence infrastructure for banks, fintechs, wallets and payment gateways in Africa. Our platform scores transfers for fraud risk, explains the result in plain language, holds risky transfers in a recoverable cooling window, and gives the institution a console to see what happened."),
        p("This notice covers three groups of people. Which of our roles applies to you depends on which group you are in."),
        table(
          ["You are", "Our role", "What that means"],
          ["A visitor to our website", "Data controller", "We decide why and how your data is used."],
          ["Staff of an institution using the Fable Console or API", "Data controller for your account and login data", "We run your account. The institution you work for decides what your access is."],
          ["A customer of an institution that uses Fable", "Data processor, acting for that institution", "Your bank or fintech is the controller and decides why your data is used. We process it only to score and protect your transfers, on its instructions."],
        ),
        note("If you are a customer of an institution and want to exercise a right over your data, contact that institution first. It is responsible for your relationship with it. We will help it respond, and we will act on your request directly where the law requires."),
      ],
    },
    {
      id: "law",
      title: "2. The law we follow",
      blocks: [
        p("We handle personal data in line with the Nigeria Data Protection Act 2023 (the \"NDPA\"), the regulations and directives of the Nigeria Data Protection Commission (the \"NDPC\"), and, for the institutions we serve, the rules of the Central Bank of Nigeria that apply to them. Where we serve customers elsewhere in Africa, we also respect the data protection law of that country."),
      ],
    },
    {
      id: "what-we-collect",
      title: "3. What we collect",
      blocks: [
        p("We collect only what the product needs to do its job. The table lists each category, where it comes from, and why we hold it."),
        table(
          ["Category", "What it includes", "Why we use it"],
          ["Website visit data", "Pages visited, browser type, device type, approximate region, your cookie choice", "Keep the site secure and understand how it is used"],
          ["Console account data", "Work email, a hashed password, the institution you belong to, sign-in and password-reset activity", "Let you sign in and keep your institution's data separate from everyone else's"],
          ["Institution and contact data", "Institution name and type, contact and support emails, branding (logo, colours, vanity URL), API keys, provisioning details", "Set up and run an institution's tenant, and send you credentials"],
          ["Customer identifiers", "A customer ID assigned by the institution, which institution they belong to, when they were enrolled", "Tie scores and history to the right customer"],
          ["Transfer details", "Amount, currency, recipient account number, recipient bank, the recipient's account-holder name as returned by the bank lookup, narration (the note written on the transfer), channel (app, USSD, POS, ATM, internet, QR, branch), time, and the outcome", "Score the transfer for fraud, build a behavioural baseline, show the institution what happened"],
          ["Device data", "A device fingerprint made from technical traits (platform, operating system, browser, screen size, graphics renderer, language, timezone, touch support, hardware details, network type, battery level where the browser exposes it), and the IP address", "Recognise a customer's usual device and spot an unfamiliar one"],
          ["Location data", "GPS coordinates if you allow your browser to share them, otherwise a city-level estimate from your IP address, plus the place name derived from them", "Spot a transfer from an unusual city or country"],
          ["Behavioural signals", "Typing speed, whether account details were pasted, time to first input and to submit, session length, how the customer signed in (biometric, PIN or password), pointer and scroll patterns", "Tell a customer acting normally from someone rushed, coached or controlled"],
          ["Security factors", "A hashed transaction PIN with failed-attempt counters, passkey public keys and signature counters, hashed one-time codes, and the email address or phone number the customer registers to receive codes", "Make sure the right person approves a risky transfer or releases held money"],
          ["Account and ledger data", "Balance and every movement (top-up, debit, reversal, release) with references", "Keep balances correct and explainable"],
          ["Notifications and audit records", "Alerts sent to a customer and whether they were delivered, plus an audit trail of containment and security events", "Tell customers what happened, and give the institution a compliance record"],
          ["Messages to our assistant", "Questions an institution's analysts type into the Copilot assistant", "Answer them"],
        ),
        note("We do not ask for, and the product is not designed to hold, a card number, card PIN, BVN or NIN. Passkeys never send us the private key: only the public key and a counter are stored."),
      ],
    },
    {
      id: "how-we-use",
      title: "4. How we use it, and our legal basis",
      blocks: [
        list(
          "To score each transfer and return a decision (pass, flag or block) with a plain-language reason. Basis: performance of our contract with the institution, and the legitimate interest of customers and institutions in preventing fraud.",
          "To learn each customer's normal behaviour so that safe transfers pass with no friction. Basis: the same.",
          "To hold a risky transfer in a cooling window, notify the customer, and require proof before money is released. Basis: contract, and protecting the customer's vital interests in their money.",
          "To run the Console, authenticate staff, keep each institution's data separate, and provide support. Basis: contract.",
          "To keep the service secure, prevent abuse, rate-limit, and investigate incidents. Basis: legitimate interest and legal obligation.",
          "To meet legal and regulatory obligations, including responding to lawful requests. Basis: legal obligation.",
          "To improve accuracy and reliability, for example by measuring decision latency or learning from confirmed outcomes. Basis: legitimate interest. We do this inside the institution's own data and do not mix one institution's customers into another's baseline.",
        ),
        p("We do not sell personal data. We do not use it for advertising, and we do not use customer transfer data to build marketing profiles."),
      ],
    },
    {
      id: "automated-decisions",
      title: "5. Automated decisions about transfers",
      blocks: [
        p("Shield makes an automated risk decision about a transfer. It can pass it, ask for extra verification, or block it. This can affect a customer, so you should know how it works."),
        list(
          "It is a risk signal, not a verdict of wrongdoing. It says a transfer looks unlike the customer's normal behaviour, not that the customer did anything wrong.",
          "Every flag and block comes with a plain-English reason. Nothing is a black box.",
          "A blocked transfer is not lost. The customer can cancel, or send it anyway and have it held in a cooling window, where cancelling returns the money at once.",
          "The institution, not Fable, makes the final decision about its customer's account and can review any decision in its console.",
          "A customer can ask the institution to have a decision reviewed by a person. See your rights below.",
        ),
      ],
    },
    {
      id: "ai",
      title: "6. Artificial intelligence providers",
      blocks: [
        p("The fraud score itself is computed by Fable's own scoring engine on our servers, using statistical methods such as an anomaly-detection model. It is not sent to an outside AI service."),
        p("Two features can use outside AI providers, Anthropic and OpenAI, and only when we have configured a key for them:"),
        table(
          ["Feature", "What the provider receives", "What it does not receive"],
          ["Plain-language explanation of a flag or block", "The action taken, the amount, and the descriptions of the signals that fired", "Names, account numbers, bank names, narrations, device or location data"],
          ["Copilot analyst assistant in the Console", "The analyst's question, recent chat turns, and the institution's own aggregate figures (such as counts and totals by pattern or channel)", "Another institution's data, individual customers' identifiers, or credentials"],
        ),
        p("If no provider is configured, or one is slow or unavailable, we fall back to a built-in template and the decision is unaffected. We do not allow these providers to train their models on data we send, to the extent their terms for API use permit us to opt out, and we review those terms when they change."),
        note("We intend to add document and image analysis for deepfake checks. We will update this notice, and tell institutions, before that or any new provider handles personal data."),
      ],
    },
    {
      id: "sharing",
      title: "7. Who we share data with",
      blocks: [
        p("We share personal data only with the people below, and only as far as each needs it."),
        table(
          ["Recipient", "Purpose", "Data involved"],
          ["The institution you bank or work with", "It is the controller and owns the relationship", "Everything we hold about its customers and staff"],
          ["Vercel", "Hosts our website and console front end", "Website and console traffic, and your session cookie"],
          ["Our cloud or VPS host (currently DigitalOcean)", "Runs the API and stores the database", "All platform data, stored on the server"],
          ["Paystack", "Resolves a recipient's name from an account number and bank code", "The recipient account number and bank code"],
          ["Anthropic and OpenAI", "Write the plain-language explanation and answer assistant questions (section 6)", "The limited data described above"],
          ["IP-location and map services (Google Maps Geocoding, ipapi.co, OpenStreetMap Nominatim, BigDataCloud)", "Turn an IP address or GPS coordinates into a street address, city or place name", "The IP address or coordinates, sent from the customer's browser or our server"],
          ["Our email provider (SMTP)", "Sends sign-in credentials, password resets and one-time codes", "The recipient's email address and the message"],
          ["An error-monitoring service, if enabled", "Helps us find and fix faults", "Technical error details, scrubbed of personal data where we can"],
          ["Regulators, courts and law enforcement", "Where the law requires or a valid order compels it", "Only what is lawfully demanded"],
        ),
        p("If Fable is ever merged with or acquired by another company, personal data may transfer to it, under the commitments in this notice. We will tell affected institutions first."),
        note("Some of these providers are based outside Nigeria, so your data may be transferred abroad. See section 8."),
      ],
    },
    {
      id: "transfers",
      title: "8. Transfers outside Nigeria",
      blocks: [
        p("Several of our providers, including Vercel, Anthropic, OpenAI and the location and map services, operate outside Nigeria, and our servers may sit outside Nigeria too. Where we transfer personal data abroad, we rely on the safeguards the NDPA allows, such as the recipient's country or organisation offering adequate protection, contractual protections, or another lawful basis, and we limit what is sent to the minimum needed."),
        p("The browser-side location lookups are a particular case: when a customer's GPS coordinates or IP address are sent to a location or map service to find a place name, that data leaves the customer's browser for that provider. Institutions should reflect this in their own privacy notices to customers, and can disable GPS collection on their side."),
      ],
    },
    {
      id: "retention",
      title: "9. How long we keep it",
      blocks: [
        table(
          ["Data", "How long"],
          ["One-time codes and step-up challenges", "Minutes. They expire after 10 minutes and are single-use"],
          ["Password-reset links", "Short-lived and single-use"],
          ["Console session", "Until it expires (hours), or you sign out"],
          ["Customer, transfer, device, location, ledger and audit data", "While the institution's agreement is active and for the period the institution and the law need it for fraud, dispute and audit purposes"],
          ["Institution and staff account data", "While the account is active"],
          ["Website visit data", "Up to 13 months"],
        ),
        p("When an institution ends its agreement, it can ask us to return or delete its data. We will do so within 90 days of a confirmed request, except for what we must keep to meet a legal obligation, and then only for as long as that obligation lasts. Backups are overwritten on their normal cycle."),
        note("The platform does not yet run automated deletion on a schedule. Deletion is carried out on request and on termination. We will update this notice when scheduled deletion is in place."),
      ],
    },
    {
      id: "security",
      title: "10. How we protect it",
      blocks: [
        list(
          "Each institution's data is separated. The institution a request belongs to is taken from a signed credential, never from a value the caller supplies.",
          "Passwords and PINs are stored as salted hashes, with rate limits and lock-outs on repeated failures.",
          "One-time codes are stored hashed, expire quickly, are single-use, and are compared in constant time.",
          "Passkeys use WebAuthn. The private key stays on the customer's device.",
          "Proof that a customer completed a verification is bound to one user, one purpose and one transfer, so it cannot be reused for another.",
          "Requests are rate limited, API keys are required where enabled, and the connection is encrypted in transit over HTTPS.",
          "Shield is built to fail safe: if scoring ever errors, it returns a cautious result, not a pass.",
        ),
        p("No system is perfectly secure. If a breach affecting personal data occurs, we will notify the affected institutions without undue delay, and the NDPC and individuals where the law requires, within the time the NDPA sets."),
        p("To report a vulnerability, write to " + legalContact.security + ". Please give us reasonable time to fix a problem before you disclose it."),
      ],
    },
    {
      id: "cookies",
      title: "11. Cookies and similar storage",
      blocks: [
        p("We use a small amount of browser storage, all of it to make the product work. We use no advertising or third-party marketing trackers."),
        table(
          ["Name", "Type", "Purpose", "Lifetime"],
          ["fable_auth", "Cookie", "Holds the signed console session so the dashboard can tell you are signed in. It is set when you sign in and is strictly necessary", "Until the session expires or you sign out"],
          ["fable-cookie-consent", "Local storage", "Remembers whether you accepted or rejected cookies", "Until you clear it"],
          ["Console and demo state", "Local and session storage", "Your signed-in session, saved preferences, a cached copy of a customer's baseline, and a queue of transfers waiting to sync if you are offline", "Until you clear it or sign out"],
          ["Dismissed banners", "Local storage", "Remembers that you closed an announcement", "Until you clear it"],
        ),
        p("You can clear this storage in your browser at any time. Rejecting cookies on the website does not turn off the session cookie, because the console cannot work without it."),
      ],
    },
    {
      id: "rights",
      title: "12. Your rights",
      blocks: [
        p("Under the NDPA you have the right to:"),
        list(
          "be told what we do with your data (this notice);",
          "access the personal data we hold about you and receive a copy;",
          "have inaccurate data corrected and incomplete data completed;",
          "have your data erased where we have no lawful reason to keep it;",
          "restrict or object to certain processing, including processing for our legitimate interests;",
          "receive your data in a portable format;",
          "not be subject to a decision based only on automated processing that significantly affects you, and to ask for human review of one;",
          "withdraw consent where we rely on it, without affecting what we did before; and",
          "complain to the Nigeria Data Protection Commission.",
        ),
        p("Customers of an institution should contact that institution first. To contact us, email " + legalContact.privacy + ". We may ask you to prove who you are, and we will reply within the time the law allows. We will not charge for an ordinary request."),
        p("Customers can also see what Fable has learned about them. The platform includes a transparency view of a customer's baseline, and institutions can surface it to them."),
      ],
    },
    {
      id: "children",
      title: "13. Children",
      blocks: [
        p("Fable is built for institutions and the adult customers of banks and fintechs. We do not knowingly collect data directly from anyone under 18. An institution that serves minors must ensure it has the lawful consent the NDPA requires."),
      ],
    },
    {
      id: "changes",
      title: "14. Changes to this notice",
      blocks: [
        p("We will update this notice when our practices change, and change the effective date above. For a material change, such as a new provider handling personal data, we will give institutions reasonable notice by email or in the Console before it takes effect."),
      ],
    },
    {
      id: "contact",
      title: "15. Contact",
      blocks: [
        p("Privacy questions and requests: " + legalContact.privacy),
        p("Security reports: " + legalContact.security),
        p("You also have the right to complain to the Nigeria Data Protection Commission (ndpc.gov.ng)."),
      ],
    },
  ],
};

// ---------------------------------------------------------------------------
// Terms of Service
// ---------------------------------------------------------------------------

export const termsOfService: LegalDocument = {
  title: "Terms of Service",
  summary:
    "The agreement between Fable and the institutions and people who use our website, the Fable Console, the API and the demo bank, including who owns what.",
  effective: EFFECTIVE,
  version: VERSION,
  sections: [
    {
      id: "agreement",
      title: "1. Agreement",
      blocks: [
        p("These Terms are a binding agreement between Fable (\"Fable\", \"we\", \"us\") and you. \"You\" means the institution, business or person that accesses or uses our website, the Fable Console, our API and SDKs, or the demo bank (together, the \"Service\"). If you accept these Terms for an institution, you confirm you have authority to bind it."),
        p("By accessing the Service, creating an account, using an API key, or clicking to accept, you agree to these Terms and to our Privacy Notice. If you do not agree, do not use the Service."),
        p("If you have signed a separate written agreement with us, that agreement governs where it conflicts with these Terms."),
      ],
    },
    {
      id: "service",
      title: "2. What the Service is",
      blocks: [
        p("Fable provides fraud-prevention and intelligence software for financial institutions. It has three working components:"),
        list(
          "Copilot learns each customer's normal behaviour so that safe transfers pass without friction, and answers an institution's analysts' questions from its own data.",
          "Shield scores a transfer, returns a decision of pass, flag or block with the signals behind it, and writes a plain-language explanation.",
          "Ghost holds a transfer that a customer chooses to send despite a block in a cooling window, notifies the customer, and releases or returns the money only on the right proof.",
        ),
        p("The Service also includes the Fable Console for institution staff, step-up verification (PIN, passkeys and emailed codes), and a demo bank used to try the product. A passive monitoring agent called Watch is planned and is not part of the Service today."),
        note("Fable is software. We are not a bank, payment service provider, payment processor or licensed financial institution. We do not hold customer funds, issue accounts, or move money between banks. The institution remains the regulated party and is responsible for its own licences and compliance."),
      ],
    },
    {
      id: "decisions",
      title: "3. Risk decisions are signals, not guarantees",
      blocks: [
        p("Fraud scoring is probabilistic. Shield can and will sometimes flag a genuine transfer and pass a fraudulent one. We do not guarantee that it will detect, stop or recover from any particular fraud, or that any loss will be avoided."),
        list(
          "The institution decides what to do with each result and is responsible for every decision about its customers' accounts and transfers.",
          "You must keep your own controls, monitoring and compliance processes in place. Fable adds to them and does not replace them.",
          "You are responsible for how you present decisions and explanations to your customers, and for having a way for them to challenge a decision and ask for human review.",
          "Scores, thresholds and signal weights are our tuned defaults, informed by published industry fraud patterns, and are not a trained guarantee of performance.",
        ),
      ],
    },
    {
      id: "accounts",
      title: "4. Accounts, credentials and API keys",
      blocks: [
        list(
          "You must give accurate information and keep it current.",
          "Console accounts are for named individuals at the institution. Do not share a login.",
          "You are responsible for everything done with your credentials and API keys. Keep them secret, store them securely, and never put a live key in client-side code, a public repository or a screenshot.",
          "Tell us at once at " + legalContact.security + " if you suspect a credential has been exposed. We may revoke or rotate it.",
          "Provisioning of a new institution is carried out by Fable. We may refuse or end it at our discretion.",
        ),
      ],
    },
    {
      id: "acceptable-use",
      title: "5. Acceptable use",
      blocks: [
        p("You agree not to, and not to help anyone else to:"),
        list(
          "use the Service unlawfully, to commit or assist fraud, or to harm or discriminate against customers unfairly;",
          "access another institution's data, or try to get around the separation between institutions;",
          "probe, scan or test the Service for weaknesses, or attack it, without our written permission, other than good-faith reporting under our security contact;",
          "overload the Service, evade rate limits, or use automated means to scrape it;",
          "submit data you have no right to submit, or data that is unlawful, or that contains malware;",
          "use the Service to build or train a competing product, or to copy how our scoring works;",
          "send a customer's real personal data into the demo bank or any sandbox, or use real credentials there;",
          "present the Service as your own, or imply that we endorse you.",
        ),
      ],
    },
    {
      id: "demo",
      title: "6. The demo bank and sandbox",
      blocks: [
        p("The demo bank and sandbox are for evaluation. The balances and transfers in them are simulated: no real money moves, and a \"held\" or \"released\" amount is a record in our system, not a movement of funds. A recipient's name may be looked up from a real account number through a third-party service, so use test data and do not enter real customers' details."),
        p("Demo content, accounts and data may be reset or removed at any time, with or without notice. Do not rely on the demo for production decisions."),
      ],
    },
    {
      id: "your-data",
      title: "7. Your data and our roles",
      blocks: [
        p("As between you and us, you keep ownership of the data you and your customers send to the Service (\"Customer Data\"). You give us a limited licence to host, process and analyse Customer Data only as needed to provide, secure, support and improve the Service for you, and as the Privacy Notice and the law allow."),
        list(
          "For personal data of your customers, you are the controller and we are your processor. You are responsible for having a lawful basis, giving customers the notices they are due, and honouring their rights.",
          "You promise you are entitled to send us the data you do, and that doing so does not breach the law or any agreement.",
          "We will process personal data only on your documented instructions and these Terms, keep it confidential, apply appropriate security, help you respond to data subject requests and incidents, and tell you without undue delay of a breach affecting it.",
          "You approve the sub-processors listed in the Privacy Notice. We will give notice of a new one that handles your personal data, and you may object on reasonable grounds.",
          "We may use data that has been aggregated and fully de-identified, so that it cannot identify you, an institution or a person, to measure and improve the Service.",
        ),
      ],
    },
    {
      id: "intellectual-property",
      title: "8. Intellectual property and ownership",
      blocks: [
        p("The Service, and everything in it, belongs to Fable and its authors and is protected by copyright and other laws. That includes the source code, scoring engine, signal logic, thresholds and weights, the scam-pattern library and intelligence data, models, step-up and containment designs, documentation, user interface and visual design, and the Fable name, logos and branding (\"Fable Materials\"). All rights not expressly granted to you are reserved."),
        p("Subject to these Terms and any fees, we grant you a limited, revocable, non-exclusive, non-transferable, non-sublicensable right to use the Service for your own internal business purposes during your term."),
        p("You must not, and must not let anyone else:"),
        list(
          "copy, fork, republish or redistribute any Fable Materials, or any part of the Service or its source code;",
          "modify, translate or create derivative works from them, or reuse any part of them in another product, service, project, business or competition or event submission;",
          "reverse engineer, decompile or try to extract the source code, models, weights, thresholds or scam-pattern data, except where the law lets you despite this restriction;",
          "host, resell, sublicense, rent or offer the Service, or a work derived from it, to anyone else;",
          "remove or change any copyright, ownership or attribution notice, or use the Fable name or branding without our written permission.",
        ),
        p("Where source code is visible in a public repository, it is shared for review and evaluation only. Visibility is not a licence. The repository's LICENSE file governs it, and these Terms add to it."),
        p("If you give us feedback or suggestions, you allow us to use them freely without paying or crediting you. This does not give us any right to your Customer Data."),
        note("Reporting infringement or misuse: if you believe someone is copying or using Fable Materials without permission, or you believe content on the Service infringes your rights, write to " + legalContact.legal + " with details and a way to reach you. We will look into it and act where appropriate, including by taking down content, suspending accounts and pursuing remedies."),
      ],
    },
    {
      id: "confidentiality",
      title: "9. Confidentiality",
      blocks: [
        p("Each of us may receive non-public information from the other. Each side will use the other's confidential information only for the purposes of the Service, protect it with at least reasonable care, and share it only with people who need it and are bound to keep it secret. This does not cover information that is public through no fault of the receiver, was already lawfully known, or must be disclosed by law, in which case the receiver will tell the other side first where it lawfully can."),
        p("API keys, credentials, non-public documentation, scoring behaviour and our security posture are our confidential information."),
      ],
    },
    {
      id: "third-parties",
      title: "10. Third-party services",
      blocks: [
        p("The Service works with third-party services for hosting, email, account-name lookup, location lookup and AI-written text. We are not responsible for them. Their availability and behaviour can affect the Service, and their own terms may apply to you where you use them directly. We design the Service so that, when an AI or lookup provider is unavailable, scoring continues, and only the wording or a name lookup is affected."),
      ],
    },
    {
      id: "fees",
      title: "11. Fees and pre-launch status",
      blocks: [
        p("Fable is in a pre-launch stage. Pricing is agreed in writing with each institution, or shown on our pricing page as an entry point and add-ons priced against the volume protected. Unless we agree otherwise in writing, fees are exclusive of taxes, which you pay, and invoices are due as stated on them. We will give notice before a price change takes effect."),
        p("Features, limits and availability may change as the product develops, and some functions described on our website are planned and not yet live."),
      ],
    },
    {
      id: "availability",
      title: "12. Availability and support",
      blocks: [
        p("We work to keep the Service available and fast, with a decision budget of 200 milliseconds for a scored transfer, but we do not promise uninterrupted or error-free operation, and the budget is a design target, not a guarantee. We may carry out maintenance, and the Service may be affected by events outside our control. Any service levels or support commitments apply only if set out in a signed agreement."),
        p("Because the frontend can fall back to a local scoring engine if the API cannot be reached, a working screen is not proof that the backend is up. Monitor the API's health endpoint yourself if you depend on it."),
      ],
    },
    {
      id: "warranty",
      title: "13. Disclaimers",
      blocks: [
        p("To the fullest extent the law allows, the Service is provided \"as is\" and \"as available\". We give no warranty, express or implied, including of merchantability, fitness for a particular purpose, accuracy, non-infringement, or that the Service will meet your needs, detect any fraud, or be free of errors or interruption. We do not give legal, financial, compliance or regulatory advice."),
      ],
    },
    {
      id: "liability",
      title: "14. Limit of liability",
      blocks: [
        p("To the fullest extent the law allows:"),
        list(
          "Fable is not liable for indirect, incidental, special, consequential or punitive loss, or for loss of profit, revenue, goodwill or data, or for fraud losses or customer compensation, even if told they were possible;",
          "our total liability for all claims arising from the Service is limited to the fees you paid us for the Service in the 12 months before the event giving rise to the claim, or ₦100,000 if you have paid us nothing.",
        ),
        p("Nothing in these Terms limits liability that cannot lawfully be limited, including for fraud or fraudulent misrepresentation, or death or personal injury caused by negligence."),
      ],
    },
    {
      id: "indemnity",
      title: "15. Indemnity",
      blocks: [
        p("You will defend and compensate Fable and its team against claims, losses and costs (including reasonable legal fees) arising from your breach of these Terms, your unlawful use of the Service, your Customer Data or your lack of a lawful basis to send it, your decisions about your customers, or your infringement of another's rights. We will tell you promptly of a claim and give reasonable help, and you may not settle a claim in a way that admits fault on our behalf without our consent."),
      ],
    },
    {
      id: "suspension",
      title: "16. Suspension and termination",
      blocks: [
        list(
          "You may stop using the Service at any time. To close an institution account, write to us.",
          "We may suspend or end your access immediately if you breach these Terms, if your use threatens the security or integrity of the Service or other institutions, if we are required to by law, or on 30 days' notice for any reason.",
          "On termination, your right to use the Service and Fable Materials ends, and you must stop using them. We will return or delete your Customer Data as set out in the Privacy Notice.",
          "Sections that by their nature should continue (including ownership, confidentiality, disclaimers, liability, indemnity and governing law) continue after termination.",
        ),
      ],
    },
    {
      id: "changes",
      title: "17. Changes to these Terms",
      blocks: [
        p("We may update these Terms. We will change the effective date, and for a material change we will give institutions reasonable notice by email or in the Console. If you keep using the Service after a change takes effect, you accept it. If you do not agree, stop using the Service."),
      ],
    },
    {
      id: "law",
      title: "18. Governing law and disputes",
      blocks: [
        p("These Terms are governed by the laws of the Federal Republic of Nigeria. We ask that you first raise any dispute with us in writing and give us 30 days to try to resolve it by good-faith discussion."),
        p("If it is not resolved, the dispute will be finally settled by arbitration under the Arbitration and Mediation Act 2023, by a sole arbitrator, seated in Lagos, in English. Either side may go to court for urgent relief to protect its intellectual property or confidential information, and nothing here stops a regulator exercising its powers."),
      ],
    },
    {
      id: "general",
      title: "19. General",
      blocks: [
        list(
          "These Terms, the Privacy Notice and any signed order form are the whole agreement on the Service, and replace earlier discussions about it.",
          "If a part is found unenforceable, the rest stays in force.",
          "A failure to enforce a right is not a waiver of it.",
          "You may not assign these Terms without our written consent. We may assign them to an affiliate or a successor to our business.",
          "Neither side is liable for delay or failure caused by events beyond its reasonable control.",
          "You are an independent contractor, not our partner, agent or employee.",
          "Notices to us go to " + legalContact.legal + ". Notices to you go to the email address on your account.",
        ),
      ],
    },
    {
      id: "contact",
      title: "20. Contact",
      blocks: [
        p("Legal and intellectual property: " + legalContact.legal),
        p("Privacy: " + legalContact.privacy),
        p("Security: " + legalContact.security),
      ],
    },
  ],
};
