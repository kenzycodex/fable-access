import type { Metadata } from "next";
import { LegalDocumentView } from "@/components/legal/LegalDocument";
import { termsOfService } from "@/data/legal";

export const metadata: Metadata = {
  title: "Terms of Service",
  description:
    "The terms for using Fable, including acceptable use, data roles, intellectual property and ownership, liability and governing law.",
};

export default function TermsPage() {
  return <LegalDocumentView doc={termsOfService} crumb="Terms" sibling={{ label: "Read the Privacy Notice", href: "/privacy" }} />;
}
