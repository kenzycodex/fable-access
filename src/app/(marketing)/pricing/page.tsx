import type { Metadata } from "next";
import Image from "next/image";
import { Breadcrumb } from "@/components/ui/Breadcrumb";
import { Button } from "@/components/ui/Button";
import { Container, Section } from "@/components/ui/Section";
import { Reveal } from "@/components/ui/Reveal";
import { CheckCircleIcon } from "@/components/icons";
import { demoCta } from "@/data/nav";
import { pricingNote, servicesIntro, serviceTiers } from "@/data/services";

export const metadata: Metadata = {
  title: "Pricing",
  description: "Copilot, Shield, and Ghost, priced against the volume they actually protect.",
};

export default function PricingPage() {
  return (
    <>
      {/* Hero (navy) */}
      <section
        className="relative overflow-hidden bg-base px-[var(--gutter)] pb-[var(--section-space-m)] text-white"
        style={{ paddingTop: "calc(var(--header-height, 90px) + var(--spacing-m))" }}
      >
        <div className="pointer-events-none absolute right-[-24px] top-0 hidden w-full max-w-[504px] text-right lg:block">
          <Image
            src="/images/services/hero-services.png"
            alt=""
            aria-hidden="true"
            width={1134}
            height={1390}
            priority
            className="ml-auto h-auto w-full"
          />
        </div>
        <Container className="relative z-[1]">
          <Breadcrumb items={[{ label: "Home", href: "/" }, { label: "Pricing" }]} className="mb-[var(--spacing-l)] text-white" />
          <div className="flex flex-col items-start gap-[var(--spacing-m)] lg:w-[75%]">
            {/* Slightly smaller than the global h1 so "Serious Money Movement" stops short of the hero image. */}
            <h1 className="lg:text-[clamp(3.6rem,4.6vw,5.6rem)]">
              Simple Pricing for
              <br className="hidden lg:block" />
              <span className="font-marker text-accent">Serious</span> Money Movement
            </h1>
            <p className="text-l text-white/85">
              Fable is pre-launch, so there&rsquo;s no public price list yet,
              <br className="hidden lg:block" />
              just an entry point and two add-ons priced against the volume they protect.
            </p>
            <div className="flex w-full flex-wrap items-center gap-[var(--content-gap)]">
              <Button href={demoCta.href} tone="secondary" className="!px-12">
                {demoCta.label}
              </Button>
            </div>
          </div>
        </Container>
      </section>

      {/* Service tiers */}
      <Section>
        <Container>
          <Reveal className="mb-[var(--section-space-s)] flex flex-col gap-[var(--content-gap-s)]">
            <h2>{servicesIntro.title}</h2>
            <p className="text-m text-black/80">{servicesIntro.body}</p>
          </Reveal>

          <div className="grid grid-cols-1 gap-[var(--grid-gap)] md:grid-cols-2 lg:grid-cols-3 lg:items-stretch">
            {serviceTiers.map((tier, i) => {
              const dark = Boolean(tier.featured);
              const accentBg = { primary: "bg-primary", neutral: "bg-neutral", accent: "bg-accent" }[tier.accent];
              const accentText = { primary: "text-primary", neutral: "text-neutral", accent: "text-accent" }[tier.accent];
              return (
                <Reveal key={tier.title} delay={i * 100} className="h-full">
                  <article
                    className={`relative flex h-full flex-col overflow-hidden rounded-[var(--radius-m)] border p-[var(--spacing-m)] transition-all duration-300 hover:-translate-y-1 ${
                      dark
                        ? "border-white/10 bg-base text-white shadow-[0_24px_60px_-20px_rgba(123,96,253,0.55)]"
                        : "border-black/10 bg-white text-black shadow-[0_12px_40px_-24px_rgba(10,1,23,0.35)] hover:shadow-[0_24px_50px_-24px_rgba(10,1,23,0.45)]"
                    }`}
                  >
                    {/* Accent rule across the top edge */}
                    <span aria-hidden="true" className={`absolute inset-x-0 top-0 h-1.5 ${accentBg}`} />
                    {dark && (
                      <span
                        aria-hidden="true"
                        className="pointer-events-none absolute -right-24 -top-24 size-64 rounded-full bg-secondary/30 blur-3xl"
                      />
                    )}

                    <div className="relative flex items-center justify-between">
                      <span
                        className={`inline-flex items-center gap-2 rounded-pill px-3 py-1 text-2xs font-bold uppercase tracking-wider ${
                          dark ? "bg-white/10 text-white" : "bg-light text-black/70"
                        }`}
                      >
                        <span className={`size-1.5 rounded-full ${accentBg}`} />
                        {tier.eyebrow}
                      </span>
                      <span
                        className={`flex size-9 items-center justify-center rounded-full text-s font-bold text-black ${accentBg}`}
                        aria-hidden="true"
                      >
                        {tier.num}
                      </span>
                    </div>

                    <h3 className="relative mt-[var(--spacing-s)] text-h4">{tier.title}</h3>
                    <p className={`relative mt-2 text-s leading-relaxed ${dark ? "text-white/75" : "text-black/70"}`}>
                      {tier.body.charAt(0).toUpperCase() + tier.body.slice(1)}
                    </p>

                    <div className={`relative my-[var(--spacing-s)] border-y py-[var(--spacing-xs)] ${dark ? "border-white/10" : "border-black/10"}`}>
                      <p className={`font-heading text-h5 font-bold ${dark ? accentText : "text-black"}`}>{tier.priceBasis}</p>
                      <p className={`text-xs ${dark ? "text-white/60" : "text-black/55"}`}>{tier.priceNote}</p>
                    </div>

                    <ul className="relative flex flex-1 flex-col gap-3">
                      {tier.items.map((item) => (
                        <li key={item} className="flex items-start gap-2.5 text-s">
                          <CheckCircleIcon className={`mt-0.5 size-[18px] shrink-0 ${dark ? "text-accent" : "text-primary"}`} />
                          <span className={dark ? "text-white/90" : "text-black/80"}>{item}</span>
                        </li>
                      ))}
                    </ul>

                    <div className="relative mt-[var(--spacing-m)]">
                      <Button href={demoCta.href} tone={dark ? "secondary" : "black"} variant={dark ? "solid" : "outline"} className="w-full justify-center">
                        {tier.num === 1 ? "Try it in the demo" : "See it in action"}
                      </Button>
                    </div>
                  </article>
                </Reveal>
              );
            })}
          </div>

          <Reveal className="mt-[var(--section-space-s)] max-w-[720px] text-m text-black/70">
            <p>{pricingNote}</p>
          </Reveal>
        </Container>
      </Section>
    </>
  );
}
