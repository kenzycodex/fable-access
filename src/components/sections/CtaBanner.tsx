import Image from "next/image";
import { Button } from "@/components/ui/Button";
import { Container } from "@/components/ui/Section";
import { Reveal } from "@/components/ui/Reveal";

interface CtaBannerProps {
  title: string;
  subtitle?: string;
  cta: { label: string; href: string; external?: boolean };
}

/**
 * Full-bleed closing CTA used at the bottom of every marketing page
 * (`.full-bg-cta` in the source): pink background, copy on the right,
 * and the Fable illustration absolutely positioned bottom-left,
 * deliberately bleeding up into the section above at desktop widths.
 */
export function CtaBanner({ title, subtitle, cta }: CtaBannerProps) {
  return (
    <section className="bg-primary px-[var(--gutter)]">
      <Container>
        <div className="relative flex flex-col lg:flex-row lg:flex-wrap lg:justify-between">
          <Reveal className="ml-auto flex w-full flex-col items-start gap-[var(--spacing-s)] py-[var(--spacing-xl)] text-white lg:w-[40%] lg:py-[var(--section-space-s)]">
            <h2 className="text-light">{title}</h2>
            {subtitle && <p className="max-w-[380px] text-m text-white">{subtitle}</p>}
            <Button href={cta.href} tone="white" external={cta.external} className="!px-7 !py-3.5">
              {cta.label}
            </Button>
          </Reveal>
          {/* The picture is narrower than the old wide graphic to keep the same bleed
              up into the section above. It is transparent, and trimmed at the
              bottom so the artwork sits right on the banner's lower edge. */}
          <Reveal className="static mx-auto w-full max-w-[300px] pb-0 sm:max-w-[360px] lg:absolute lg:bottom-0 lg:left-0 lg:mx-0 lg:w-[42%] lg:max-w-none">
            <Image
              src="/images/home/talk-to-fable.png"
              alt="A customer sending ₦85,000 on her phone, with Fable's Copilot, Shield and Ghost around her and the transfer marked protected"
              width={1254}
              height={1124}
              sizes="(min-width: 1024px) 42vw, 360px"
              className="h-auto w-full"
            />
          </Reveal>
        </div>
      </Container>
    </section>
  );
}
