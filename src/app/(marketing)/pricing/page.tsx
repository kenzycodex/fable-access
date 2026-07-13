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
          <div className="w-full lg:w-[62%]">
            <h1>
              Simple Pricing for <span className="font-marker text-accent">Serious</span> Money Movement
            </h1>
            <p className="mt-[var(--spacing-m)] max-w-[650px] text-l text-white/85">
              Fable is pre-launch, so there&rsquo;s no public price list yet, just an entry point and two add-ons
              priced against the volume they protect.
            </p>
            <div className="mt-[var(--spacing-l)]">
              <Button href={demoCta.href} tone="secondary">
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

          <div className="grid grid-cols-1 gap-x-[var(--grid-gap)] gap-y-[72px] pt-[27px] md:grid-cols-2 lg:grid-cols-3">
            {serviceTiers.map((tier, i) => (
              <Reveal key={tier.title} delay={i * 100} className="h-full">
                <div
                  className={`flex h-full flex-col gap-[var(--spacing-s)] rounded-[var(--radius)] border-2 p-[var(--spacing-m)] ${tier.border} ${tier.bg}`}
                >
                  <div
                    className={`-mt-[calc(var(--spacing-m)+25px)] flex size-[50px] shrink-0 items-center justify-center self-center rounded-full text-m font-bold ${tier.circle}`}
                  >
                    {tier.num}
                  </div>
                  <p className="font-heading text-h4 font-bold uppercase">{tier.title}</p>
                  <p className="text-m text-black/85">
                    <strong>{tier.bodyLead}</strong> {tier.body}
                  </p>
                  <div className="mt-[var(--spacing-xs)] flex flex-col gap-[var(--spacing-xs)]">
                    <ul className="flex flex-col gap-[var(--spacing-xs)]">
                      {tier.items.map((item) => (
                        <li key={item} className="flex items-start gap-2 text-s">
                          <CheckCircleIcon className="mt-0.5 size-[18px] shrink-0 text-primary" />
                          {item}
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
              </Reveal>
            ))}
          </div>

          <Reveal className="mt-[var(--section-space-s)] max-w-[720px] text-m text-black/70">
            <p>{pricingNote}</p>
          </Reveal>
        </Container>
      </Section>
    </>
  );
}
