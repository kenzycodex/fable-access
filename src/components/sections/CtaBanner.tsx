import { Button } from "@/components/ui/Button";
import { Container } from "@/components/ui/Section";
import { Reveal } from "@/components/ui/Reveal";

interface CtaBannerProps {
  title: string;
  subtitle?: string;
  cta: { label: string; href: string; external?: boolean };
}

/**
 * Full-bleed closing CTA used at the bottom of the marketing pages: a purple band
 * with the heading, a line of copy and one button, all centred.
 */
export function CtaBanner({ title, subtitle, cta }: CtaBannerProps) {
  return (
    <section className="bg-primary px-[var(--gutter)]">
      <Container>
        <Reveal className="mx-auto flex w-full max-w-[720px] flex-col items-center gap-[var(--spacing-s)] py-[var(--section-space-s)] text-center text-white">
          <h2 className="text-light">{title}</h2>
          {subtitle && <p className="max-w-[560px] text-m text-white">{subtitle}</p>}
          <Button href={cta.href} tone="white" external={cta.external} className="!px-7 !py-3.5">
            {cta.label}
          </Button>
        </Reveal>
      </Container>
    </section>
  );
}
