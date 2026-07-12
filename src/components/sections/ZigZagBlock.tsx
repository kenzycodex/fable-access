import Image from "next/image";
import type { ReactNode } from "react";
import { Reveal } from "@/components/ui/Reveal";
import { Button } from "@/components/ui/Button";
import { TestimonialCard } from "./TestimonialCard";

interface ZigZagCta {
  label: string;
  href: string;
  external?: boolean;
}

interface ZigZagTestimonial {
  quote: string;
  name: string;
  role: string;
  logo?: { src: string; alt: string; width: number; height: number };
}

interface ZigZagBlockProps {
  image: { src: string; alt: string; width: number; height: number };
  imageSide?: "left" | "right";
  eyebrow?: string;
  title: ReactNode;
  body: ReactNode;
  cta?: ZigZagCta;
  testimonial?: ZigZagTestimonial;
  /** "dark" for blocks sitting on a black/navy section (white text). */
  tone?: "light" | "dark";
}

export function ZigZagBlock({
  image,
  imageSide = "right",
  eyebrow,
  title,
  body,
  cta,
  testimonial,
  tone = "light",
}: ZigZagBlockProps) {
  const imageCol = (
    <Reveal className={`order-1 ${imageSide === "right" ? "lg:order-2" : "lg:order-1"}`}>
      <Image
        src={image.src}
        alt={image.alt}
        width={image.width}
        height={image.height}
        className="h-auto w-full rounded-[var(--radius)]"
      />
    </Reveal>
  );

  const textCol = (
    <Reveal className={`order-2 ${imageSide === "right" ? "lg:order-1" : "lg:order-2"}`}>
      <div className="flex flex-col gap-[var(--spacing-s)]">
        {eyebrow && <p className="text-s font-bold uppercase text-primary">{eyebrow}</p>}
        <h3 className="max-w-[90%]">{title}</h3>
        <div className={`text-l ${tone === "dark" ? "text-white/85" : "text-black/80"}`}>{body}</div>
        {cta && (
          <div className="mt-[var(--spacing-s)]">
            {/* Source renders these as pink-outline pills (.btn--outline) */}
            <Button
              href={cta.href}
              variant="outline"
              tone="secondary"
              external={cta.external}
              className={tone === "light" ? "!text-black" : ""}
            >
              {cta.label}
            </Button>
          </div>
        )}
        {testimonial && (
          <div className="mt-[var(--spacing-m)]">
            <TestimonialCard {...testimonial} tone={tone} />
          </div>
        )}
      </div>
    </Reveal>
  );

  return (
    <div className="grid grid-cols-1 items-center gap-[var(--spacing-l)] lg:grid-cols-2 lg:gap-[var(--spacing-xl)]">
      {textCol}
      {imageCol}
    </div>
  );
}
