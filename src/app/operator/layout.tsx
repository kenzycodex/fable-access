import type { Metadata } from "next";

export const metadata: Metadata = {
  title: {
    default: "Operator",
    template: "%s | Fable Operator",
  },
  description: "The Fable operator platform: institutions, Ask Fable, integrations and audit.",
  robots: { index: false, follow: false },
};

// The data-surface attribute flips the root font-size back to the native 16px
// base (see globals.css), as the console's root layout does. Without it every
// rem-based size in the operator platform rendered at 62.5%: cramped padding,
// short controls and thin cards beside full-size text.
export default function OperatorRootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <div data-surface="app" className="contents">
      {children}
    </div>
  );
}
