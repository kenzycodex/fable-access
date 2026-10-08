import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
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
        className="relative overflow-hidden bg-base px-[var(--gutter)] pb-[var(--section-space-m)] text-white lg:min-h-[680px]"
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

          {/* Same cut-corner tiles, lavender and purple, as the stat band on the
              home page, so pricing reads as part of one system. The cut is a
              fixed size rather than a percentage, so tall and short cards get the
              same corner. clip-path also clips box-shadow, so the glow lives on a
              wrapper's drop-shadow filter instead. */}
          <div className="grid grid-cols-1 gap-[var(--grid-gap)] md:grid-cols-2 lg:grid-cols-3 lg:items-stretch">
            {serviceTiers.map((tier, i) => {
              const featured = Boolean(tier.featured);
              const ink = featured ? "text-white" : "text-[#4C1D95]";
              const soft = featured ? "text-white/80" : "text-[#4C1D95]/75";
              return (
                <Reveal
                  key={tier.title}
                  delay={i * 100}
                  className={`h-full ${featured ? "drop-shadow-[0_24px_40px_rgba(139,92,246,0.35)]" : ""}`}
                >
                  <article
                    className={`relative flex h-full flex-col p-[var(--spacing-m)] ${ink} ${
                      featured ? "bg-gradient-to-br from-[#8B5CF6] to-[#6D28D9]" : "bg-[#E0D9F6]"
                    }`}
                    style={{
                      clipPath:
                        "polygon(0 0, calc(100% - 44px) 0, 100% 44px, 100% 100%, 44px 100%, 0 calc(100% - 44px))",
                    }}
                  >
                    <div className="flex items-center justify-between">
                      <span
                        className={`flex size-12 items-center justify-center rounded-[14px] font-heading text-m font-bold ${
                          featured ? "bg-white/20 text-white" : "bg-white/70 text-[#6D28D9]"
                        }`}
                        aria-hidden="true"
                      >
                        {tier.num}
                      </span>
                      <span
                        className={`mr-9 rounded-pill px-3 py-1 text-2xs font-bold uppercase tracking-wider ${
                          featured ? "bg-white/20 text-white" : "bg-white/70 text-[#4C1D95]"
                        }`}
                      >
                        {tier.eyebrow}
                      </span>
                    </div>

                    <h3 className="mt-[var(--spacing-s)] text-h4">{tier.title}</h3>
                    <p className={`mt-2 text-s leading-relaxed ${soft}`}>
                      {tier.body.charAt(0).toUpperCase() + tier.body.slice(1)}
                    </p>

                    <div className={`my-[var(--spacing-s)] border-y py-[var(--spacing-xs)] ${featured ? "border-white/25" : "border-[#4C1D95]/15"}`}>
                      <p className={`font-heading text-h5 font-bold ${featured ? "text-white" : "text-[#6D28D9]"}`}>{tier.priceBasis}</p>
                      <p className={`text-xs ${soft}`}>{tier.priceNote}</p>
                    </div>

                    <ul className="flex flex-1 flex-col gap-3">
                      {tier.items.map((item) => (
                        <li key={item} className="flex items-start gap-2.5 text-s">
                          <CheckCircleIcon className={`mt-0.5 size-[18px] shrink-0 ${featured ? "text-white" : "text-[#6D28D9]"}`} />
                          <span>{item}</span>
                        </li>
                      ))}
                    </ul>

                    <Link
                      href={demoCta.href}
                      className={`mt-[var(--spacing-m)] inline-flex items-center justify-center self-start rounded-pill px-7 py-3 text-s font-bold uppercase transition-colors ${
                        featured
                          ? "bg-white text-[#5B21B6] hover:bg-[#EDE9FE]"
                          : "bg-[#6D28D9] text-white hover:bg-[#5B21B6]"
                      }`}
                    >
                      {tier.num === 1 ? "Try it in the demo" : "See it in action"}
                    </Link>
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
