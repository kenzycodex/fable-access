export const homeStats = [
  { value: "₦25.82bn", label: "Lost to fraud", description: "In Q1 2025 alone.\nReported by NIBSS." },
  { value: "200ms", label: "Decision budget", description: "Scores every transfer.\nInside the transfer flow." },
  { value: "10s", label: "Clearing window", description: "The strict NIP window.\nFable decides well inside it." },
  { value: "3", label: "Agents", description: "Copilot, Shield and Ghost.\nOne pipeline, in order." },
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
    body: "New recipient, odd hour, urgent narration, risky channel. Shield scores every transfer against sixteen signals and explains the call in plain language, within a 200ms decision budget.",
    image: { src: "/images/solutions/empower-team.webp", alt: "Reviewing a flagged transfer", width: 1024, height: 831 },
    imageSide: "right" as const,
    cta: { label: "See the pipeline", href: "/why-fable#technology" },
  },
  {
    title: "Ghost Buys Back the Money, Even After the User Says Yes",
    body: "If a user still wants a blocked transfer sent, Ghost holds it for a cooling window instead. The customer can cancel and keep the money, or release it only with stronger proof it's them. Your bank holds the funds during the window; Fable tells it when to send or return them.",
    image: { src: "/images/why-fable/business-operations.webp", alt: "Reviewing a held transfer", width: 1068, height: 876 },
    imageSide: "left" as const,
    cta: { label: "See the pipeline", href: "/why-fable#technology" },
  },
];

// "One Pipeline, Every Transfer": the actual agent pipeline a transfer
// meets inside Fable, in order. Each step gets a one-liner.
export const pipelineSteps = [
  { label: "Copilot", desc: "Builds a behavioral baseline per user — clears safe transfers instantly.", icon: "/images/journey/login.svg" },
  { label: "Shield", desc: "Scores every transfer against sixteen signals, within a 200ms decision budget.", icon: "/images/journey/transaction.svg" },
  { label: "Ghost", desc: "Holds an overridden block for a cooling window, so it can still be cancelled.", icon: "/images/journey/post-transaction.svg" },
];
