export const homeStats = [
  { value: "₦25.82bn", label: "Lost to fraud", description: "In Q1 2025 alone.\nReported by NIBSS." },
  { value: "200ms", label: "Decision budget", description: "Scores every flagged transfer.\nInside the transfer flow." },
  { value: "10s", label: "Clearing window", description: "The strict NIP window.\nMoney never becomes bottleneck." },
  { value: "4", label: "AI Agents", description: "Work seamlessly together.\nWithout adding friction." },
];

// "How Fable Works" zig-zag: the three agents a transfer actually meets,
// in order. No testimonials, Fable has no customers yet.
export const fableAgentBlocks = [
  {
    title: "Copilot Learns Before It Ever Has to Act",
    body: "From day one, Copilot builds a behavioral baseline per user: who they pay, when, how much, and from which devices. A transfer that matches the pattern clears with zero added friction.",
    image: { src: "/images/why-fable/phone-in-hand.webp", alt: "Reviewing a wallet balance on a phone", width: 581, height: 463 },
    imageSide: "left" as const,
    cta: { label: "See the pipeline", href: "/why-fable#technology" },
  },
  {
    title: "Shield Steps in When Something Doesn't Fit",
    body: "New recipient, odd hour, urgent narration, wrong channel. Shield scores every flagged transfer across six signal layers and explains the call in plain language, inside a 200ms budget.",
    image: { src: "/images/solutions/empower-team.webp", alt: "Reviewing a flagged transfer", width: 1024, height: 831 },
    imageSide: "right" as const,
    cta: { label: "See the pipeline", href: "/why-fable#technology" },
  },
  {
    title: "Ghost Buys Back the Money, Even After the User Says Yes",
    body: "If a user overrides a block anyway, Ghost routes the transfer into a disposable holding account with a cooling window, so a fully-scammed user still doesn't lose the money outright.",
    image: { src: "/images/why-fable/business-operations.webp", alt: "Reviewing a held transfer", width: 1068, height: 876 },
    imageSide: "left" as const,
    cta: { label: "See the pipeline", href: "/why-fable#technology" },
  },
];

// "One Pipeline, Every Transfer": the actual agent pipeline a transfer
// meets inside Fable, in order. Each step gets a one-liner.
export const pipelineSteps = [
  { label: "Copilot", desc: "Builds a behavioral baseline per user — clears safe transfers instantly.", icon: "/images/journey/login.svg" },
  { label: "Shield", desc: "Scores flagged transfers across six signal layers in under 200ms.", icon: "/images/journey/transaction.svg" },
  { label: "Ghost", desc: "Holds risky transfers in a cooling window so money never leaves.", icon: "/images/journey/post-transaction.svg" },
  { label: "Watch", desc: "Monitors between sessions and alerts on emerging risk patterns.", icon: "/images/journey/signup.svg" },
];
