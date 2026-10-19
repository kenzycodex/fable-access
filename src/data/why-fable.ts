import type { IconCard } from "@/components/sections/IconCardGrid";
import { dashboardCta } from "@/data/nav";

export const whyFableSubNav = [
  { label: "Overview", href: "#overview" },
  { label: "Who We Serve", href: "#who-we-serve" },
  { label: "Technology", href: "#technology" },
  { label: "The Gap", href: "#ecosystem" },
];

// Overview 4-card grid: what actually makes Fable different.
export const overviewCards: IconCard[] = [
  {
    image: { src: "/images/why-fable/meaningful-results.webp", alt: "Personalization is the security engine", width: 80, height: 80 },
    title: "Personalization Is the Security Engine",
    body: "The more Fable understands a user's real habits, the more confidently it lets them through without friction, and the sharper it gets at spotting the one transaction that doesn't fit.",
  },
  {
    image: { src: "/images/why-fable/experts.webp", alt: "Built for African finance", width: 80, height: 80 },
    title: "Built for African Finance, From the Ground Up",
    body: "Nigerian scam scripts, Pidgin language patterns, and NIP response codes, not a Western fraud model with the currency symbol swapped.",
  },
  {
    image: { src: "/images/why-fable/scale.webp", alt: "Radical transparency", width: 80, height: 80 },
    title: "Radical Transparency, by Design",
    body: "Every intervention comes with plain-language reasoning, and users can open a single “what Fable knows about me” panel to see the habits each transfer is compared against.",
  },
  {
    image: { src: "/images/why-fable/pioneering-new-solutions.webp", alt: "Network effects", width: 80, height: 80 },
    title: "Smarter With Every Institution That Joins",
    body: "Every confirmed outcome sharpens that customer's own baseline, so the system gets more precise the longer it runs. Cross-institution intelligence is on the roadmap, not shipped: today each bank's data stays strictly its own.",
  },
];

// "Who We Serve" tabbed widget: the institutions Fable is built for, each
// with one honest line on where it fits. The tab images stay in their
// original slots until replacements are made.
export interface IndustryCaseStudy {
  name: string;
  blurb: string;
  href: string;
}

export interface IndustryTab {
  label: string;
  panelTitle: string;
  icon: { src: string; alt: string; width: number; height: number };
  body: string;
  learnMoreHref: string;
  caseStudies: IndustryCaseStudy[];
}

export const industryTabs: IndustryTab[] = [
  {
    label: "Microfinance Banks",
    panelTitle: "Microfinance Banks",
    icon: { src: "/images/why-fable/ind-finance.webp", alt: "", width: 80, height: 76 },
    body: "Many microfinance customers are new to mobile transfers, so Fable scores a first transfer on its amount and channel until a customer has history of their own, and asks for a PIN or holds the transfer instead of refusing it outright.",
    learnMoreHref: "#technology",
    caseStudies: [],
  },
  {
    label: "Wallets & Mobile Money",
    panelTitle: "Digital Wallets and Mobile Money Operators",
    icon: { src: "/images/why-fable/ind-commerce.png", alt: "", width: 80, height: 80 },
    body: "When a wallet user is talked into sending money, Ghost holds the transfer for a cooling window so they can still cancel it; the operator keeps the funds during the hold and sends or returns them when Fable's webhook says so.",
    learnMoreHref: "#technology",
    caseStudies: [],
  },
  {
    label: "Payment Service Providers",
    panelTitle: "Payment Service Providers",
    icon: { src: "/images/why-fable/ind-marketplaces.png", alt: "", width: 80, height: 80 },
    body: "One API call before a payout leaves returns pass, flag or block with the reasons in plain language, so a PSP can put a behavioural check in front of transfers without building its own scoring model.",
    learnMoreHref: "#technology",
    caseStudies: [],
  },
  {
    label: "Fintech Lenders",
    panelTitle: "Fintech Lenders",
    icon: { src: "/images/why-fable/ind-software.png", alt: "", width: 80, height: 76 },
    body: "Withdrawals and disbursements can be scored like any transfer, so money heading to an account the customer has never paid, from a device they have never used, is checked before it leaves.",
    learnMoreHref: "#technology",
    caseStudies: [],
  },
  {
    label: "Commercial Banks",
    panelTitle: "Commercial Banks",
    icon: { src: "/images/why-fable/ind-travel.png", alt: "", width: 80, height: 80 },
    body: "Banks on NIP call Fable before a transfer is sent; each customer is compared with their own history of who they pay, how much and from where, and every decision is kept with its reasons for review in the console.",
    learnMoreHref: "#technology",
    caseStudies: [],
  },
  {
    label: "Not on This List?",
    panelTitle: "Other Institutions That Move Naira",
    icon: { src: "/images/why-fable/ind-gambling.png", alt: "", width: 80, height: 80 },
    body: "If you send naira on behalf of customers and want a check before the money leaves, you can open a sandbox bank, add test customers and run transfers through the same scoring Fable uses live, before any contract.",
    learnMoreHref: "#technology",
    caseStudies: [],
  },
];

// "Technology" section: the actual pitch. Every bank's fraud system kicks
// in after the user hits send, by then the scammer already won. Fable is
// the layer that sits between the user and the transaction instead.
export const technologyIntro =
  "Scams don't happen inside a banking app. They happen on WhatsApp, phone calls, and SMS in the five minutes before, social engineering that convinces the user to authorize the transfer themselves. Fable is a family of specialized AI agents that sit between the user and the transaction, so the one transfer that doesn't fit gets caught before the money moves.";

export const provenScience = {
  title: "Copilot Learns. Shield Defends. Ghost Contains.",
  body: "Copilot builds a behavioral baseline per user: who they pay, when, how much, which devices. When a transfer matches it, friction disappears. When it breaks the pattern, Shield takes over: real-time scam defence, scored and explained in plain language. If a user still wants a blocked transfer sent, Ghost holds it for a cooling window, so even a fully-tricked user has time to cancel.",
  href: dashboardCta.href,
  image: { src: "/images/why-fable/phone-in-hand.webp", alt: "Reviewing a flagged transaction on a phone", width: 581, height: 463 },
};

export const technologyStats = [
  { value: "₦25.85bn", label: "Lost to fraud by Nigerian financial institutions in 2025 (NIBSS)" },
  { value: "₦13.37bn", label: "Of it through internet banking, from about 4,500 cases (NIBSS, 2025)" },
  { value: "63%", label: "Of institutions did not report their fraud cases to NIBSS (NIBSS, 2023)" },
];

// "The Gap" section: why the tools institutions already use don't solve
// this, and why Fable's architecture closes it.
export const ecosystemIntro = {
  title: "Compliance Tools Weren't Built for This",
  body: "KYC and AML platforms verify who a user is once, at onboarding. They were never built to catch a real user, fully verified, being talked into authorizing their own loss five minutes after opening WhatsApp. That's a behavioral problem, not an identity problem, and it needs a behavioral defense.",
};

export const ecosystemBlocks = [
  {
    id: undefined,
    title: "Built to Get Smarter as Institutions Join",
    body: "Designed so a device fingerprint seen committing fraud at one bank could be flagged at a connected fintech in minutes. Not built yet: today we enforce strict tenant isolation, and only hashed signals would ever be shared.",
    image: { src: "/images/why-fable/laptop.webp", alt: "Reviewing shared fraud intelligence", width: 632, height: 483 },
    imageSide: "left" as const,
    cta: { label: "Talk to us", href: dashboardCta.href },
  },
  {
    id: "moat",
    title: "Built Around How Nigerians Move Money",
    body: "Pidgin and English scam narrations, NIP response codes, and channel risk weights for USSD, POS, mobile app and internet banking informed by NIBSS fraud data. Fable starts from the scams Nigerian customers actually meet: someone on WhatsApp or the phone talking them into sending the money themselves.",
    image: { src: "/images/why-fable/shield-hero.png", alt: "A customer sending ₦85,000 on her phone, with Shield, Copilot and Ghost labelled around her and the transfer marked protected", width: 1254, height: 1124 },
    imageSide: "right" as const,
    cta: { label: "Get in touch", href: dashboardCta.href },
  },
];
