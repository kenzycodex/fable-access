import Image from "next/image";
import Link from "next/link";
import { Button } from "@/components/ui/Button";
import { Container, Section } from "@/components/ui/Section";
import { Reveal } from "@/components/ui/Reveal";
import { HeroBadge } from "@/components/marketing/HeroBadge";
import { StatGrid } from "@/components/sections/StatBand";
import { ZigZagBlock } from "@/components/sections/ZigZagBlock";
import { demoCta } from "@/data/nav";
import { fableAgentBlocks, homeStats, pipelineSteps } from "@/data/home";

export default function HomePage() {
  return (
    <>
      {/* Hero */}
      <section
        className="relative overflow-hidden bg-gradient-to-b from-base to-black px-[var(--gutter)] pb-[var(--section-space-s)] text-white lg:flex lg:min-h-[660px] lg:items-center"
        style={{ paddingTop: "calc(var(--header-height, 90px) + var(--spacing-m))" }}
      >
        {/* TEMPORARY: pricing-page hero image, replacing the blob pattern. Revert with git. */}
        <div className="pointer-events-none absolute right-[-24px] top-0 hidden w-full max-w-[504px] text-right lg:block">
          <Image
            src="/images/services/hero-services.png"
            alt=""
            aria-hidden="true"
            width={1134}
            height={1390}
            loading="eager"
            className="ml-auto h-auto w-full"
          />
        </div>
        <Container className="relative z-[1] w-full">
          <div className="flex flex-col items-start gap-[var(--spacing-m)] lg:w-[62%]">
            <div className="flex flex-col items-start gap-[var(--spacing-m)]">
              {/* Fable-style floating badge */}
              <Reveal delay={0}>
                <HeroBadge />
              </Reveal>

              <Reveal delay={100}>
                <h1>
                  Catch the Scam Before It Clears.
                  <br />
                  <span className="font-marker text-accent">Three</span> Agents.
                </h1>
              </Reveal>
              <Reveal delay={200}>
                <p className="text-l max-w-[620px] text-white/85">
                  Copilot learns how your users actually move money. Shield stops the transfer that doesn&rsquo;t fit.
                  Ghost gives even a fully-scammed user a way back. Each decision is made well inside NIP&rsquo;s 10 seconds.
                </p>
              </Reveal>
              <Reveal delay={300}>
                <Button href={demoCta.href} tone="secondary" className="mt-2">
                  {demoCta.label}
                </Button>
              </Reveal>
            </div>
          </div>
        </Container>
      </section>

      {/* Stats */}
      <Section className="bg-gradient-to-b from-black to-base text-white">
        <Container>
          <div className="flex flex-col gap-[var(--content-gap)] pb-[var(--spacing-xl)] lg:flex-row lg:items-start lg:justify-between">
            <Reveal delay={0}>
              <h2 className="lg:max-w-[540px] leading-[1.1]">
                Built for a Market Losing <span className="font-marker text-accent">Billions</span> <span className="whitespace-nowrap">a Year</span>
              </h2>
            </Reveal>
            <Reveal delay={150}>
              <p className="hidden md:block text-m max-w-[640px] text-white/80 pt-2">
                Nigerian financial institutions reported ₦25.85bn lost to fraud in 2025, more than half of it
                through internet banking. Fable is built to sit directly inside the transfer flow itself.
                It scores every transfer against sixteen signals within a 200 millisecond decision budget, measured on every
                call, so a suspicious transfer can be stopped without slowing down your legitimate users.
              </p>
              <p className="md:hidden text-m text-white/80 pt-2">
                Nigerian institutions reported ₦25.85bn lost to fraud in 2025. Fable sits inside the transfer flow and decides within a 200ms budget, so legitimate users are not slowed down.
              </p>
            </Reveal>
          </div>
          <StatGrid stats={homeStats} />
        </Container>
      </Section>

      {/* How Fable Works */}
      <Section className="bg-tertiary">
        <Container>
          <Reveal>
            <h2 className="mb-[var(--spacing-xl)]">
              How <span className="font-marker">Fable</span> Works
            </h2>
          </Reveal>
          <div className="flex flex-col gap-[var(--section-space-m)]">
            {fableAgentBlocks.map((block) => (
              <ZigZagBlock key={block.title} {...block} />
            ))}
          </div>
        </Container>
      </Section>

      {/* One Pipeline, Every Transfer */}
      <Section space="m" className="bg-black text-white">
        <Container>
          <Reveal className="mb-[var(--spacing-xxl)] flex flex-col items-start gap-[var(--spacing-m)] lg:flex-row lg:items-center lg:justify-between">
            <h2>
              <span className="font-marker text-accent">One</span> Pipeline,
              <br />
              Every Transfer
            </h2>
            <Link
              href="/platform"
              className="group relative isolate inline-flex shrink-0 items-center overflow-hidden whitespace-nowrap rounded-pill border-2 border-secondary px-7 py-3.5 text-s font-bold uppercase text-white"
            >
              <span
                aria-hidden="true"
                className="absolute inset-0 -z-10 origin-left scale-x-0 bg-secondary transition-transform duration-300 ease-out group-hover:scale-x-100"
              />
              <span className="relative z-10">Explore the Fable platform</span>
            </Link>
          </Reveal>

          <div className="grid w-full grid-cols-1 gap-[20px] sm:grid-cols-3">
            {pipelineSteps.map((step, i) => (
              <Reveal key={step.label} delay={i * 80}>
                <div className="flex flex-col items-start gap-[16px] rounded-[var(--radius)] border-2 border-white p-[var(--spacing-s)]">
                  <div className="relative h-12 w-12 shrink-0">
                    <Image src={step.icon} alt="" aria-hidden="true" fill className="object-contain object-left" />
                  </div>
                  <p className="font-heading text-xs font-bold uppercase">{step.label}</p>
                  <p className="text-2xs text-white/60 leading-snug">{step.desc}</p>
                </div>
              </Reveal>
            ))}
          </div>
        </Container>
      </Section>

      {/* Full-bleed CTA */}
      <section className="bg-gradient-to-br from-[#5B21B6] via-[#7C3AED] to-[#6D28D9] px-[var(--gutter)]">
        <Container>
          <Reveal className="mx-auto flex w-full max-w-[560px] flex-col items-center gap-[var(--spacing-s)] py-[var(--section-space-l)] text-center text-white">
            <h2 className="text-light">Try it yourself.</h2>
            <p className="max-w-[420px] text-m text-white">
              Run a transfer through Copilot, Shield and Ghost in your institution&apos;s sandbox. Sign in with your
              console account, or ask us for one. Balances are simulated and no real money moves.
            </p>
            <Button href={demoCta.href} tone="white" className="!px-7 !py-3.5">
              {demoCta.label}
            </Button>
          </Reveal>
        </Container>
      </section>
    </>
  );
}
