import type { Metadata } from "next";
import { inter, permanentMarker, titillium } from "./fonts";
import "./globals.css";
import { Toaster } from "sonner";
import { ThemeProvider } from "@/components/ThemeProvider";

export const metadata: Metadata = {
  metadataBase: new URL("https://fable.ng"),
  title: {
    default: "Fable | AI Security & Fraud Intelligence for African Finance",
    template: "%s | Fable",
  },
  description:
    "Fable is the AI security and intelligence infrastructure layer built for African banks and fintechs. It knows each user's genuine habits deeply enough to approve safe transfers instantly and catch the one suspicious transaction before money leaves the account.",
  openGraph: {
    type: "website",
    siteName: "Fable",
    locale: "en_US",
    title: "AI Security & Fraud Intelligence Infrastructure for African Finance | Fable",
    description:
      "Security that disappears when you're safe. Shows up hard when you're not. Fable is the AI fraud intelligence layer built for African banks and fintechs.",
    url: "https://fable.ng/",
  },
  twitter: {
    card: "summary_large_image",
    title: "AI Security & Fraud Intelligence Infrastructure for African Finance | Fable",
    description:
      "Security that disappears when you're safe. Shows up hard when you're not. Fable is the AI fraud intelligence layer built for African banks and fintechs.",
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