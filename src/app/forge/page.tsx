import type { Metadata } from "next";
import ForgeDemo from "./ForgeDemo";

export const metadata: Metadata = {
  title: "Fable on Xtradot Bank",
  description: "Fable scoring real transfers against the Xtradot Bank sandbox: pass, check, hold, and a lost answer that is never resent.",
  robots: { index: false, follow: false },
};

export default function ForgePage() {
  return <ForgeDemo />;
}
