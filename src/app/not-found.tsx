import type { Metadata } from "next";
import Image from "next/image";
import { Button } from "@/components/ui/Button";
import { Container } from "@/components/ui/Section";

export const metadata: Metadata = {
  title: "Page Not Found",
};

export default function NotFound() {
  return (
    <section
      className="flex min-h-dvh items-center bg-gradient-to-b from-base to-black px-[var(--gutter)] pb-[var(--section-space-m)] text-white"
      style={{ paddingTop: "calc(var(--header-height, 90px) + var(--section-space-m))" }}
    >
      <Container>
        <div className="grid grid-cols-1 items-center gap-[var(--spacing-l)] lg:grid-cols-2">
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

          {/* Fable's ghost, lost with a map and a compass. Transparent, so it
              sits straight on the gradient; the slow float is decoration only
              and is switched off for anyone who prefers reduced motion. */}
          <div className="relative mx-auto w-full max-w-[300px] sm:max-w-[420px] lg:max-w-[560px] lg:justify-self-end">
            <Image
              src="/images/brand/404-ghost.png"
              alt="A friendly Fable ghost holding a map and compass, looking lost"
              width={1254}
              height={1254}
              priority
              sizes="(min-width: 1024px) 560px, (min-width: 640px) 420px, 300px"
              className="animate-float-orb h-auto w-full drop-shadow-[0_30px_60px_rgba(123,96,253,0.35)]"
            />
          </div>
        </div>
      </Container>
    </section>
  );
}
