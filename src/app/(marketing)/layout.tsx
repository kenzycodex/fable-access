import { CookieConsent } from "@/components/layout/CookieConsent";
import { Footer } from "@/components/layout/Footer";
import { Header } from "@/components/layout/Header";

// The marketing site shell. The demo bank (/demo) and institution dashboard
// (/dashboard) live outside this group and bring their own app shells, so the
// scrolling Header/Footer only wrap the marketing pages.
export default function MarketingLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <>
      <Header />
      <main className="flex-1 bg-white">{children}</main>
      <Footer />
      <CookieConsent />
    </>
  );
}
