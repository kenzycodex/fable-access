export interface ServiceTier {
  num: number;
  title: string;
  /** Small label above the title: what kind of line item this is. */
  eyebrow: string;
  /** Lead-in bold phrase + rest of the description. */
  bodyLead: string;
  body: string;
  /** What the price is measured against, shown as the card's headline figure. */
  priceBasis: string;
  priceNote: string;
  items: string[];
  /** Dark, elevated card for the agent most institutions buy first. */
  featured?: boolean;
  /** Accent color token (Tailwind color name) for the number badge and top rule. */
  accent: "primary" | "neutral" | "accent";
}

export const servicesIntro = {
  title: "Three Agents, Priced the Way You'd Expect",
  body: "Copilot is the base layer, always on, included with every institution. Shield and Ghost are add-ons priced against the volume they actually protect: how many transfers get scored, and how many get held.",
};

export const serviceTiers: ServiceTier[] = [
  {
    num: 1,
    title: "Copilot",
    eyebrow: "Included",
    priceBasis: "Included",
    priceNote: "with every institution",
    accent: "primary",
    bodyLead: "Copilot",
    body: "is always on: per-user behavioral baselining, included at no extra cost with every institution.",
    items: [
      "Per-user behavioral baseline from day one",
      "Zero-friction clearance for matched transfers",
      "Included with every plan, no separate line item",
    ],
  },
  {
    num: 2,
    title: "Shield",
    eyebrow: "Add-on",
    priceBasis: "Per transfer scored",
    priceNote: "Copilot + Shield from ₦100,000/month",
    accent: "neutral",
    featured: true,
    bodyLead: "Shield",
    body: "adds real-time scam and deepfake defense on top of Copilot, priced per transaction scored.",
    items: [
      "Fourteen-layer real-time scoring",
      "Plain-language decision explanations",
      "Sub-200ms response budget, every call",
    ],
  },
  {
    num: 3,
    title: "Ghost",
    eyebrow: "Add-on",
    priceBasis: "Per transfer held",
    priceNote: "priced on hold volume",
    accent: "accent",
    bodyLead: "Ghost",
    body: "adds a disposable holding account and cooling window for any transfer a user overrides.",
    items: [
      "Cooling-window holding account",
      "Recoverable funds on overridden blocks",
      "Configurable hold duration per institution",
    ],
  },
];

export const pricingNote =
  "Copilot + Shield starts at ₦100,000/month flat, up to 50,000 transactions. Ghost is priced separately based on hold volume. Talk to us for a quote built around your institution.";
