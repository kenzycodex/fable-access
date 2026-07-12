export interface ServiceTier {
  num: number;
  title: string;
  /** Lead-in bold phrase + rest of the description. */
  bodyLead: string;
  body: string;
  items: string[];
  /** Design accents from the source's colored-border cards. */
  border: string;
  circle: string;
  bg: string;
}

export const servicesIntro = {
  title: "Three Agents, Priced the Way You'd Expect",
  body: "Copilot is the base layer, always on, included with every institution. Shield and Ghost are add-ons priced against the volume they actually protect: how many transfers get scored, and how many get held.",
};

export const serviceTiers: ServiceTier[] = [
  {
    num: 1,
    title: "COPILOT",
    bodyLead: "Copilot",
    body: "is always on: per-user behavioral baselining, included at no extra cost with every institution.",
    items: [
      "Per-user behavioral baseline from day one",
      "Zero-friction clearance for matched transfers",
      "Included with every plan, no separate line item",
    ],
    border: "border-primary",
    circle: "bg-primary text-white",
    bg: "bg-primary/10",
  },
  {
    num: 2,
    title: "SHIELD",
    bodyLead: "Shield",
    body: "adds real-time scam and deepfake defense on top of Copilot, priced per transaction scored.",
    items: [
      "Six-signal real-time scoring",
      "Plain-language decision explanations",
      "Sub-200ms response budget, every call",
    ],
    border: "border-neutral",
    circle: "bg-neutral text-black",
    bg: "bg-neutral/10",
  },
  {
    num: 3,
    title: "GHOST",
    bodyLead: "Ghost",
    body: "adds a disposable holding account and cooling window for any transfer a user overrides.",
    items: [
      "Cooling-window holding account",
      "Recoverable funds on overridden blocks",
      "Configurable hold duration per institution",
    ],
    border: "border-accent",
    circle: "bg-accent text-black",
    bg: "",
  },
];

export const pricingNote =
  "Copilot + Shield starts at ₦100,000/month flat, up to 50,000 transactions. Ghost is priced separately based on hold volume. Talk to us for a quote built around your institution.";
