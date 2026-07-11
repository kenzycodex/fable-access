import type { Metadata } from "next";
import { Button } from "@/components/ui/Button";
import { Container } from "@/components/ui/Section";

export const metadata: Metadata = {
  title: "Page Not Found",
};

export default function NotFound() {
  return (
    <section
      className="flex items-center bg-gradient-to-b from-base to-black px-[var(--gutter)] text-white"
      style={{ minHeight: "70vh", paddingTop: "calc(var(--header-height, 90px) + var(--section-space-m))" }}
    >
      <Container>
        <div className="flex max-w-[640px] flex-col items-start gap-[var(--spacing-m)]">
          <p className="font-heading text-h1 font-bold leading-none text-accent">404</p>
          <h1>
            This page took an <span className="font-marker text-accent">unexpected</span> turn.
          </h1>
          <p className="text-l text-white/85">
            The page you&rsquo;re looking for doesn&rsquo;t exist or may have moved. Let&rsquo;s get you back on track.
          </p>
          <Button href="/" tone="secondary" className="mt-2">
            Back to Home
          </Button>
        </div>
      </Container>
    </section>
  );
}
