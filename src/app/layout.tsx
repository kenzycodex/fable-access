import type { Metadata } from "next";
import { inter, permanentMarker, titillium } from "./fonts";
import "./globals.css";
import { Toaster } from "sonner";
import { ThemeProvider } from "@/components/ThemeProvider";

export const metadata: Metadata = {
  metadataBase: new URL("https://fable.ng"),
  title: {
    default: "Fable | Behavioural Fraud Risk for Nigerian Transfers",
    template: "%s | Fable",
  },
  description:
    "Fable is a behavioural risk layer for Nigerian banks, wallets, payment service providers and lenders. It compares each transfer with the customer's own habits, lets the ones that fit go straight through, and checks or holds the one that doesn't before money leaves the account.",
  openGraph: {
    type: "website",
    siteName: "Fable",
    locale: "en_US",
    title: "Fable | Behavioural Fraud Risk for Nigerian Transfers",
    description:
      "Fable scores each transfer against the customer's own habits before it is sent, and holds the risky one where the customer can still cancel it. Built for Nigerian banks, wallets, PSPs and lenders.",
    url: "https://fable.ng/",
  },
  twitter: {
    card: "summary_large_image",
    title: "Fable | Behavioural Fraud Risk for Nigerian Transfers",
    description:
      "Fable scores each transfer against the customer's own habits before it is sent, and holds the risky one where the customer can still cancel it. Built for Nigerian banks, wallets, PSPs and lenders.",
  },
};

// Previous GTM/OneTrust/Qualified account IDs lived here -- removed on
// rebrand since they routed Fable's traffic into legacy analytics, cookie
// consent, and live-chat accounts (and Qualified rejecting localhost as an
// unauthorized domain was the "invalid_request" unhandled rejection seen in
// dev). Re-add with Fable's own IDs once those accounts exist.

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${inter.variable} ${titillium.variable} ${permanentMarker.variable}`} suppressHydrationWarning>
      <body className="flex min-h-full flex-col antialiased">
        <Toaster theme="dark" richColors position="top-center" />
        <ThemeProvider attribute="class" defaultTheme="light" disableTransitionOnChange>
          {children}
        </ThemeProvider>
      </body>
    </html>
  );
}