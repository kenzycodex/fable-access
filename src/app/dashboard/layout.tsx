import type { Metadata } from "next";

export const metadata: Metadata = {
  title: {
    default: "Institution Dashboard",
    template: "%s | Fable Console",
  },
  description: "The Fable institution console: transactions, Watch alerts, intelligence, and compliance.",
};

// Thin wrapper so both the login screen and the authenticated app share the
// dashboard's page metadata. Visual chrome lives in the (app) group's layout.
// The data-surface attribute flips the root font-size back to the native 16px
// base (see globals.css) so standard Tailwind sizing renders full-size here.
export default function DashboardRootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <div data-surface="app" className="contents">
      {children}
    </div>
  );
}
