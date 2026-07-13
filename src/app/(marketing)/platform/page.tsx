import type { Metadata } from "next";
import Image from "next/image";
import { Breadcrumb } from "@/components/ui/Breadcrumb";
import { Button } from "@/components/ui/Button";
import { Container, Section } from "@/components/ui/Section";
import { Reveal } from "@/components/ui/Reveal";
import { StickySubNav } from "@/components/sections/StickySubNav";
import { ZigZagBlock } from "@/components/sections/ZigZagBlock";
import { IconCardGrid } from "@/components/sections/IconCardGrid";
import { StatCallout } from "@/components/sections/StatBand";
import { demoCta } from "@/data/nav";
import {
  agentCards,
  apiRequestExample,
  apiResponseExample,
  latencyStats,
  pipelineIntro,
  tfoSubNav,
} from "@/data/trust-fraud-operations";

export const metadata: Metadata = {
  title: "Platform",
  description: "Inside the Fable agent pipeline: Copilot, Shield, Ghost, and Watch, and the API shape behind them.",
};

export default function PlatformPage() {
  return (
    <>
      {/* Hero (dark) */}
      <section
        className="relative overflow-hidden bg-gradient-to-b from-base to-black px-[var(--gutter)] pb-[var(--section-space-l)] text-white"
        style={{ paddingTop: "calc(var(--header-height, 90px) + var(--section-space-m))" }}
      >
        <div className="pointer-events-none absolute bottom-0 right-[var(--gutter)] hidden w-[35%] max-w-[534px] lg:block">
          <Image
            src="/images/solutions/hero-banner.webp"
            alt=""
            aria-hidden="true"
            width={534}
            height={577}
            priority
            className="h-auto w-full"
          />
        </div>
        <Container className="relative z-[1]">
          <Breadcrumb items={[{ label: "Home", href: "/" }, { label: "Platform" }]} className="mb-[var(--spacing-l)] text-white" />
          <div className="flex flex-col items-start gap-[var(--spacing-m)] lg:w-[75%]">
            <h1>
              <span className="font-marker text-accent">Inside</span> the Agent
              <br className="hidden lg:block" />
              Pipeline
            </h1>
            <p className="text-l text-white/85">
              Copilot, Shield, Ghost, and Watch, in the order a transfer actually meets them, plus the API shape and
              latency budget behind them.
            </p>
            <div className="flex w-full flex-wrap items-center gap-[var(--content-gap)]">
              <Button href={demoCta.href} tone="secondary" className="!px-12">
                {demoCta.label}
              </Button>
            </div>
          </div>
        </Container>
      </section>

      <StickySubNav items={tfoSubNav} />

      {/* Pipeline */}
      <Section id="pipeline">
        <Container>
          <ZigZagBlock
            title={pipelineIntro.title}
            body={pipelineIntro.body}
            image={pipelineIntro.image}
            imageSide="right"
          />
        </Container>
      </Section>

      {/* Agents */}
      <Section id="agents" className="bg-tertiary">
        <Container>
          <Reveal className="mb-[var(--spacing-xl)] flex flex-col gap-[var(--spacing-m)]">
            <h2><span className="font-marker text-accent">Four</span> Agents, Each With One Job</h2>
          </Reveal>
          <IconCardGrid cards={agentCards} columns={4} />
        </Container>
      </Section>

      {/* API shape */}
      <Section id="api">
        <Container>
          <Reveal className="mb-[var(--spacing-xl)] flex flex-col gap-[var(--spacing-m)] lg:max-w-[720px]">
            <h2><span className="font-marker text-accent">One</span> API Call, in Front of Every Transfer</h2>
            <p className="text-l text-black/80">
              Banks, fintechs, wallets, and gateways integrate with a single scoring endpoint. Context, device, and
              behavioral signals go in; a decision, a risk score, and a plain-language reason come back.
            </p>
          </Reveal>
          <div className="grid grid-cols-1 gap-[var(--grid-gap)] lg:grid-cols-2">
            <pre className="overflow-x-auto rounded-[var(--radius)] bg-black p-[var(--spacing-m)] text-xs text-white/90">
              <code>{apiRequestExample}</code>
            </pre>
            <pre className="overflow-x-auto rounded-[var(--radius)] bg-black p-[var(--spacing-m)] text-xs text-white/90">
              <code>{apiResponseExample}</code>
            </pre>
          </div>
        </Container>
      </Section>

      {/* Latency */}
      <Section id="latency" className="bg-tertiary">
        <Container>
          <div className="grid grid-cols-1 items-center gap-[var(--spacing-xl)] lg:grid-cols-2">
            <Reveal className="flex flex-col gap-[var(--spacing-m)]">
              <h2><span className="font-marker text-accent">Fast</span> Enough to Sit in Front of Every Transfer</h2>
              <p className="text-l text-black/80">
                Not just the risky ones. The full pipeline has to clear before the transfer does, so it&rsquo;s built
                to a hard latency budget, not a best-effort one.
              </p>
            </Reveal>
            <div className="grid grid-cols-1 gap-[var(--spacing-l)] sm:grid-cols-2">
              {latencyStats.map((stat) => (
                <StatCallout key={stat.label} value={stat.value} label={stat.label} />
              ))}
            </div>
          </div>
        </Container>
      </Section>

      {/* Circular CTA */}
      <Section className="overflow-hidden bg-white">
        <Container>
          <Reveal className="flex flex-col justify-between gap-[var(--spacing-l)] rounded-[var(--radius-l)] bg-tertiary p-[var(--space-xl)] lg:flex-row lg:items-center lg:rounded-[900px] lg:px-[var(--section-space-l)] lg:py-[var(--section-space-s)]">
            <div className="flex flex-col items-start gap-[var(--spacing-m)] lg:w-[65%]">
              <h3>
                <span className="font-marker">Start</span> Your Fraud Risk Assessment
              </h3>
              <p className="text-m text-black/80">
                See where your transfer flow is exposed. Get started with a free, 1:1 risk assessment for your
                institution.
              </p>
              <Button href={demoCta.href} tone="secondary" className="lg:hidden">
                Get Started
              </Button>
            </div>

            <div className="relative mx-auto w-[264px] shrink-0 p-[40px] lg:mx-0">
              <div className="relative">
                <svg
                  aria-hidden="true"
                  viewBox="0 0 180 180"
                  className="absolute left-1/2 top-1/2 z-10 h-[122%] w-[122%] -translate-x-1/2 -translate-y-1/2 -rotate-[35deg]"
                >
                  <circle
                    cx="90"
                    cy="90"
                    r="86"
                    fill="none"
                    stroke="var(--color-secondary)"
                    strokeWidth="3.5"
                    strokeLinecap="round"
                    strokeDasharray="500 40"
                  />
                </svg>
                <Image
                  src="/images/solutions/yellow-shadow.svg"
                  alt=""
                  aria-hidden="true"
                  width={462}
                  height={364}
                  className="pointer-events-none absolute right-0 top-0 z-0 h-[calc(100%+80px)] w-[164%] max-w-none"
                />
                <Image
                  src="/images/solutions/assessment-circle.png"
                  alt=""
                  aria-hidden="true"
                  width={568}
                  height={568}
                  className="relative z-20 h-auto w-full"
                />
                <div className="absolute bottom-[42px] left-[-70px] z-30 hidden lg:block">
                  <Button href={demoCta.href} tone="secondary">
                    Get Started
                  </Button>
                </div>
              </div>
            </div>
          </Reveal>
        </Container>
      </Section>
    </>
  );
}
