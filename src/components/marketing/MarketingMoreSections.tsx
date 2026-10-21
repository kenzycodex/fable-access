import { CodeBlock } from "@/components/ui/CodeBlock";
import { Container, Section } from "@/components/ui/Section";
import { Reveal } from "@/components/ui/Reveal";
import { IconCardGrid } from "@/components/sections/IconCardGrid";
import { IndustryTabs } from "@/components/sections/IndustryTabs";
import { ZigZagBlock } from "@/components/sections/ZigZagBlock";
import { StatCallout } from "@/components/sections/StatBand";
import { demoCta } from "@/data/nav";
import {
  ecosystemBlocks,
  ecosystemIntro,
  industryTabs,
  overviewCards,
  provenScience,
  technologyIntro,
} from "@/data/why-fable";
import {
  agentCards,
  apiRequestExample,
  apiResponseExample,
  latencyStats,
} from "@/data/trust-fraud-operations";

export function WhyFableSections() {
  return (
    <>
      <Section id="why-details" className="bg-white">
        <Container>
          <div className="flex flex-col items-start gap-[var(--spacing-xl)] lg:flex-row">
            <Reveal className="flex w-full flex-col gap-[var(--spacing-m)] lg:w-[45%]">
              <h2>Why Banks Choose <span className="font-marker">Fable</span></h2>
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

      <Section id="who-we-serve" className="bg-black text-white">
        <Container>
          <Reveal className="mb-[var(--spacing-xl)] flex flex-col gap-[var(--spacing-s)]">
            <h2>Built for Every Rail Money <span className="font-marker text-accent">Moves On</span></h2>
            <p className="max-w-[720px] text-l text-white/85">
              Banks, fintechs, wallets and payment gateways score each transfer with one API call, and run a short
              verification flow for the ones Shield flags. Today Fable protects naira transfers.
            </p>
          </Reveal>
          <Reveal><IndustryTabs tabs={industryTabs} /></Reveal>
        </Container>
      </Section>

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

      <Section id="ecosystem" className="bg-black text-white">
        <Container>
          <Reveal className="mb-[var(--spacing-xxl)] flex flex-col items-start gap-[var(--spacing-m)]">
            <div className="flex max-w-[720px] flex-col gap-[var(--spacing-m)]">
              <h2>Compliance Tools Weren&rsquo;t<br />Built for This</h2>
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
                  cta={{ label: demoCta.label, href: demoCta.href }}
                  tone="dark"
                />
              </div>
            ))}
          </div>
        </Container>
      </Section>
    </>
  );
}

export function PlatformSections() {
  return (
    <>
      <Section id="agents" className="bg-tertiary">
        <Container>
          <Reveal className="mb-[var(--spacing-xl)] flex flex-col gap-[var(--spacing-m)]">
            <h2><span className="font-marker text-accent">Three</span> Agents, Each With One Job</h2>
          </Reveal>
          <IconCardGrid cards={agentCards} columns={3} />
        </Container>
      </Section>

      <Section id="api">
        <Container>
          <Reveal className="mb-[var(--spacing-xl)] flex flex-col gap-[var(--spacing-m)] lg:max-w-[720px]">
            <h2><span className="font-marker text-accent">One</span> API Call, in Front of Every Transfer</h2>
            <p className="text-l text-black/80">
              Banks, wallets, payment service providers and lenders integrate with a single scoring endpoint. Context, device, and
              behavioral signals go in; a decision, a risk score, and a plain-language reason come back.
            </p>
          </Reveal>
          <div className="grid grid-cols-1 gap-[var(--grid-gap)] lg:grid-cols-2">
            <CodeBlock label="Request" lang="http" code={apiRequestExample} />
            <CodeBlock label="Response" lang="json" code={apiResponseExample} />
          </div>
        </Container>
      </Section>

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
              {latencyStats.map((stat) => <StatCallout key={stat.label} value={stat.value} label={stat.label} />)}
            </div>
          </div>
        </Container>
      </Section>
    </>
  );
}
