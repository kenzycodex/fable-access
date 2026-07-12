import Image from "next/image";
import type { ReactNode } from "react";
import { Breadcrumb } from "@/components/ui/Breadcrumb";
import { Button } from "@/components/ui/Button";
import { Container } from "@/components/ui/Section";

export type HeroTone = "gradient" | "black" | "blue" | "white";

interface HeroCta {
  label: string;
  href: string;
  tone?: "primary" | "secondary" | "white" | "black";
  variant?: "solid" | "outline";
  external?: boolean;
}

interface HeroProps {
  tone?: HeroTone;
  breadcrumb?: { label: string; href?: string }[];
  eyebrow?: ReactNode;
  title: ReactNode;
  subtitle?: ReactNode;
  ctas?: HeroCta[];
  image?: { src: string; alt: string; width: number; height: number };
  children?: ReactNode;
}

const toneClasses: Record<HeroTone, string> = {
  gradient: "bg-gradient-to-b from-base to-black text-white",
  black: "bg-black text-white",
  blue: "bg-base text-white",
  white: "bg-white text-black",
};

export function Hero({ tone = "white", breadcrumb, eyebrow, title, subtitle, ctas, image, children }: HeroProps) {
  return (
    <section className={`${toneClasses[tone]} px-[var(--gutter)] pb-[var(--section-space-m)] pt-[var(--section-space-l)]`}>
      <Container>
        <div className="grid grid-cols-1 items-center gap-[var(--spacing-xl)] lg:grid-cols-2">
          <div className="flex flex-col items-start gap-[var(--spacing-m)]">
            {breadcrumb && (
              <Breadcrumb items={breadcrumb} className={tone === "white" ? "opacity-60" : "text-white/70"} />
            )}
            {eyebrow}
            <h1>{title}</h1>
            {subtitle && <p className="text-l">{subtitle}</p>}
            {ctas && ctas.length > 0 && (
              <div className="flex flex-wrap items-center gap-[var(--content-gap)]">
                {ctas.map((cta) => (
                  <Button
                    key={cta.label}
                    href={cta.href}
                    tone={cta.tone ?? (tone === "white" ? "secondary" : "white")}
                    variant={cta.variant ?? "solid"}
                    external={cta.external}
                  >
                    {cta.label}
                  </Button>
                ))}
              </div>
            )}
          </div>

          {image && (
            <div className="relative w-full">
              <Image
                src={image.src}
                alt={image.alt}
                width={image.width}
                height={image.height}
                priority
                className="h-auto w-full"
              />
            </div>
          )}
        </div>
        {children}
      </Container>
    </section>
  );
}
