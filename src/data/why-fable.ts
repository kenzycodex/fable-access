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
    body: "Every intervention comes with plain-language reasoning. Users can open a single “what Fable knows about me” panel and toggle signals on or off.",
  },
  {
    image: { src: "/images/why-fable/pioneering-new-solutions.webp", alt: "Network effects", width: 80, height: 80 },
    title: "Smarter With Every Institution That Joins",
    body: "A fraud pattern flagged at one partner bank protects every other connected institution within minutes. The shared intelligence graph compounds over time.",
  },
];

// "Who We Serve" tabbed widget: the actual client layer described in the
// architecture. Banks, fintechs, wallets, payment gateways, crypto/Web3.
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
    label: "Banks",
    panelTitle: "Banks & Digital Banks",
    icon: { src: "/images/why-fable/ind-finance.webp", alt: "", width: 80, height: 76 },
    body: "Direct and indirect NIP participants plug Shield into the transfer flow before funds move, and Watch runs passive monitoring between sessions, without slowing down the 10-second NIP clearing window.",
    learnMoreHref: "#technology",
    caseStudies: [],
  },
  {
    label: "Fintechs",
    panelTitle: "Fintech Platforms",
    icon: { src: "/images/why-fable/ind-commerce.png", alt: "", width: 80, height: 80 },
    body: "Copilot builds a behavioral baseline per user from day one, so safe transfers clear with zero friction while the platform scales without scaling its fraud team headcount.",
    learnMoreHref: "#technology",
    caseStudies: [],
  },
  {
    label: "Wallets",
    panelTitle: "Digital Wallets",
    icon: { src: "/images/why-fable/ind-marketplaces.png", alt: "", width: 80, height: 80 },
    body: "Ghost gives wallet users a cooling window on any transaction that gets flagged. Money is held, not lost, even when a scam has already fully convinced them.",
    learnMoreHref: "#technology",
    caseStudies: [],
  },
  {
    label: "Payment Gateways",
    panelTitle: "Payment Gateways",
    icon: { src: "/images/why-fable/ind-software.png", alt: "", width: 80, height: 76 },
    body: "One API call routes context, device, and behavioral signals through the full agent pipeline in under 200ms, fast enough to sit in front of every transaction, not just the risky ones.",
    learnMoreHref: "#technology",
    caseStudies: [],
  },
  {
    label: "Crypto & Web3",
    panelTitle: "Crypto & Web3 Platforms",
    icon: { src: "/images/why-fable/ind-travel.png", alt: "", width: 80, height: 80 },
    body: "The same behavioral and device intelligence that protects a NIP transfer extends to on-chain activity as the platform grows: one shared fraud graph across rails.",
    learnMoreHref: "#technology",
    caseStudies: [],
  },
  {
    label: "Remittance & MTOs",
    panelTitle: "Remittance & Money Transfer Operators",
    icon: { src: "/images/why-fable/ind-gambling.png", alt: "", width: 80, height: 80 },
    body: "Cross-border payouts are where a sudden change of destination country or beneficiary is the whole signal. Shield reads location and device context on the payout leg, and Ghost holds the transfer while it is still recallable rather than after settlement.",
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
  body: "Copilot builds a behavioral baseline per user: who they pay, when, how much, which devices. When a transfer matches it, friction disappears. When it breaks the pattern, Shield takes over: real-time scam and deepfake defense, scored and explained in plain language. If a user overrides a block anyway, Ghost routes the transfer into a disposable account with a cooling window, so even a fully-tricked user loses nothing.",
  href: dashboardCta.href,
  image: { src: "/images/why-fable/phone-in-hand.webp", alt: "Reviewing a flagged transaction on a phone", width: 581, height: 463 },
};

export const technologyStats = [
  { value: "₦25.85bn", label: "Lost to fraud in Q1 2025 alone (NIBSS)" },
  { value: "603%", label: "Jump in fraud losses, Q1 2025 vs Q1 2024 (FITC)" },
  { value: "37%", label: "Of institutions don't even report their fraud (NIBSS 2023)" },
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
    title: "Every Connected Institution Makes the Network Smarter",
    body: "A device fingerprint seen committing fraud at one bank gets flagged at a connected fintech in minutes, not weeks. Privacy-preserving: only hashed signals are shared, never raw personal data.",
    image: { src: "/images/why-fable/laptop.webp", alt: "Reviewing shared fraud intelligence", width: 632, height: 483 },
    imageSide: "left" as const,
    cta: { label: "Talk to us", href: dashboardCta.href },
  },
  {
    id: "moat",
    title: "Localization Foreign Fraud Tools Don't Have",
    body: "Nigerian scam scripts, Pidgin urgency patterns, NIP response codes, USSD and POS channel risk. A fraud model built for American e-commerce doesn't recognize any of it. Fable was built for this market from the first line of code.",
    image: { src: "/images/why-fable/business-operations.webp", alt: "Reviewing localized fraud pattern data", width: 1068, height: 876 },
    imageSide: "right" as const,
    cta: { label: "Get in touch", href: dashboardCta.href },
  },
];
