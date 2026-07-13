import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { Breadcrumb } from "@/components/ui/Breadcrumb";
import { Container, Section } from "@/components/ui/Section";
import { Reveal } from "@/components/ui/Reveal";
import { StickySubNav } from "@/components/sections/StickySubNav";
import { IconCardGrid } from "@/components/sections/IconCardGrid";
import { IndustryTabs } from "@/components/sections/IndustryTabs";
import { ZigZagBlock } from "@/components/sections/ZigZagBlock";
import { CtaBanner } from "@/components/sections/CtaBanner";
import { dashboardCta, demoCta } from "@/data/nav";
import {
  ecosystemBlocks,
  ecosystemIntro,
  industryTabs,
  overviewCards,
  provenScience,
  technologyIntro,
  whyFableSubNav,
} from "@/data/why-fable";

export const metadata: Metadata = {
  title: "Why Fable",
  description:
    "Built for African finance from the ground up: Nigerian scam patterns, NIP response codes, and CBN regulatory grounding no foreign fraud model has.",
};

export default function WhyFablePage() {
  return (
    <>
      {/* Hero -- standard white hero; the header spacer handles clearance, so
          only the source's small --space-m sits above the breadcrumb. */}
      <section className="relative bg-white px-[var(--gutter)] pb-[var(--section-space-m)] pt-[var(--spacing-m)] text-black">
        <div className="pointer-events-none absolute right-0 top-0 hidden w-full max-w-[400px] justify-end lg:flex">
          <Image
            src="/images/why-fable/banner-platform.webp"
            alt=""
            aria-hidden="true"
            width={1154}
            height={1400}
            priority
            className="h-auto w-[88%]"
          />
        </div>
        <Container>
          <Breadcrumb items={[{ label: "Home", href: "/" }, { label: "Why Fable" }]} className="mb-[var(--spacing-l)]" />
          <div className="w-full lg:w-[65%]">
            <h1>
              Security That <span className="font-marker">Disappears</span>
            </h1>
            <p className="mt-[var(--spacing-m)] max-w-[650px] text-l text-black/80">
              Security that disappears when you&rsquo;re safe. Shows up hard when you&rsquo;re not. That&rsquo;s the
              whole idea.
            </p>
            <div className="mt-[var(--spacing-l)]">
              <Link
                href={demoCta.href}
                className="group relative isolate inline-flex shrink-0 items-center justify-center overflow-hidden whitespace-nowrap rounded-pill border-3 border-secondary bg-secondary px-7 py-3.5 text-s font-bold uppercase text-black"
              >
                <span
                  aria-hidden="true"
                  className="absolute inset-0 -z-10 origin-left scale-x-0 bg-black transition-transform duration-300 ease-out group-hover:scale-x-100"
                />
                <span className="relative z-10 transition-colors duration-300 group-hover:text-white">
                  {demoCta.label}
                </span>
              </Link>
            </div>
          </div>
        </Container>
      </section>

      <StickySubNav items={whyFableSubNav} />

      {/* Overview */}
      <Section id="overview" className="relative overflow-hidden bg-tertiary">
        <Container className="relative z-[1]">
          <div className="flex flex-col items-start gap-[var(--spacing-xl)] lg:flex-row">
            <Reveal className="flex w-full flex-col gap-[var(--spacing-m)] lg:w-[45%]">
              <h2>
                Why Banks Choose <span className="font-marker">Fable</span>
              </h2>
              <p className="text-l text-black/80">
                Most security systems treat safety and personalization as a trade-off. Fable rejects that.
                Personalization is the security engine: the more it understands a user&rsquo;s real habits, the
                sharper it gets at spotting the one transaction that doesn&rsquo;t fit.
              </p>
            </Reveal>
            <div className="w-full lg:w-[55%]">
              <IconCardGrid cards={overviewCards} columns={2} cta="Learn more" />
            </div>
          </div>
        </Container>
      </Section>

      {/* Who We Serve */}
      <Section id="who-we-serve" className="bg-black text-white">
        <Container>
          <Reveal className="mb-[var(--spacing-xl)] flex flex-col gap-[var(--spacing-s)]">
            <h2>
              Built for Every Rail Money <span className="font-marker text-accent">Moves On</span>
            </h2>
            <p className="max-w-[720px] text-l text-white/85">
              Banks, fintechs, wallets, payment gateways, and crypto platforms plug in once via a single API call.
              Under the hood, the same agent pipeline protects every rail.
            </p>
          </Reveal>
          <Reveal>
            <IndustryTabs tabs={industryTabs} />
          </Reveal>
        </Container>
      </Section>

      {/* Technology section: the actual pitch, not a patent count (Fable is
          pre-launch and has none). */}
      <Section id="technology">
        <Container>
          <Reveal className="mb-[var(--spacing-xl)] flex flex-col gap-[var(--spacing-m)]">
            <h2>A Family of Agents, One API</h2>
            <p className="max-w-[1100px] text-l text-black/80">{technologyIntro}</p>
          </Reveal>
          <ZigZagBlock
            title={provenScience.title}
            body={provenScience.body}
            image={provenScience.image}
            imageSide="left"
            cta={{ label: demoCta.label, href: demoCta.href }}
          />
        </Container>
      </Section>

      {/* The Gap: why compliance tools don't solve this, and what does */}
      <Section id="ecosystem" className="bg-black text-white">
        <Container>
          <Reveal className="mb-[var(--spacing-xxl)] flex flex-col items-start gap-[var(--spacing-m)] lg:flex-row lg:items-center lg:justify-between">
            <div className="flex max-w-[720px] flex-col gap-[var(--spacing-m)]">
              <h2>
                Compliance Tools Weren&rsquo;t
                <br />
                Built for This
              </h2>
              <p className="text-l text-white/85">{ecosystemIntro.body}</p>
            </div>
          </Reveal>

          <div className="flex flex-col gap-[var(--section-space-m)]">
            {ecosystemBlocks.map((block) => (
              <div key={block.title} id={block.id}>
                <ZigZagBlock
                  title={block.title}
                  body={block.body}
                  image={block.image}
                  imageSide={block.imageSide}
                  cta={block.cta}
                  tone="dark"
                />
              </div>
            ))}
          </div>
        </Container>
      </Section>

      <CtaBanner
        title="Talk to Fable"
        subtitle="See how Shield, Copilot, and Ghost work together on your own transaction data."
        cta={{ label: dashboardCta.label, href: dashboardCta.href }}
      />
    </>
  );
}
