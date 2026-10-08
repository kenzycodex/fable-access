import type { Metadata } from "next";
import { LegalDocumentView } from "@/components/legal/LegalDocument";
import { privacyNotice } from "@/data/legal";

export const metadata: Metadata = {
  title: "Privacy Notice",
  description:
    "How Fable collects, uses, shares and protects personal data across the website, the console and the transfers it scores.",
};

export default function PrivacyPage() {
  return <LegalDocumentView doc={privacyNotice} crumb="Privacy" sibling={{ label: "Read the Terms of Service", href: "/terms" }} />;
}
