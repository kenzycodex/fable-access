import Image from "next/image";
import Link from "next/link";
import { Reveal } from "@/components/ui/Reveal";
import { ArrowRightIcon } from "@/components/icons";

export interface IconCard {
  image?: { src: string; alt: string; width: number; height: number };
  title: string;
  body?: string;
  href?: string;
  external?: boolean;
  cta?: string;
}

interface IconCardGridProps {
  cards: IconCard[];
  columns?: 2 | 3 | 4;
  /** Default CTA label for cards that don't set their own. */
  cta?: string;
  /** "cover" fills the card top (award badges); "icon" is a small top-left glyph. */
  imageStyle?: "icon" | "cover";
}

const columnClasses: Record<number, string> = {
  2: "sm:grid-cols-2",
  3: "sm:grid-cols-2 lg:grid-cols-3",
  4: "sm:grid-cols-2 lg:grid-cols-4",
};

export function IconCardGrid({ cards, columns = 4, cta = "Learn more", imageStyle = "icon" }: IconCardGridProps) {
  return (
    <div className={`grid grid-cols-1 gap-[var(--grid-gap)] ${columnClasses[columns]}`}>
      {cards.map((card, i) => {
        const className =
          "group flex h-full min-h-[260px] flex-col gap-[var(--content-gap-xs)] overflow-hidden rounded-[var(--radius)] border-2 border-black bg-white p-[var(--spacing-m)] no-underline shadow-[0_1px_3px_rgba(0,0,0,0.12),0_1px_2px_rgba(0,0,0,0.24)] transition-shadow duration-300 hover:shadow-[0_3px_6px_rgba(0,0,0,0.16),0_3px_6px_rgba(0,0,0,0.23)]";
        const label = card.cta ?? cta;
        const content = (
          <>
            {card.image && (
              <Image
                src={card.image.src}
                alt={card.image.alt}
                width={card.image.width}
                height={card.image.height}
                className={imageStyle === "cover" ? "mb-[var(--spacing-xs)] h-auto w-1/2" : "h-12 w-12 object-contain object-left"}
              />
            )}
            <p className="font-heading text-h4 font-semibold capitalize leading-snug text-black">{card.title}</p>
            {card.body && <p className="text-s text-black/80">{card.body}</p>}
            {card.href && (
              <span className="mt-auto inline-flex items-center gap-1 pt-[var(--spacing-s)] text-s font-bold uppercase text-black transition-colors group-hover:text-secondary">
                {label}
                <ArrowRightIcon className="size-[14px] text-secondary" />
              </span>
            )}
          </>
        );

        return (
          <Reveal key={card.title} delay={i * 80} className="h-full">
            {card.href ? (
              card.external ? (
                <a href={card.href} target="_blank" rel="noopener noreferrer" className={className}>
                  {content}
                </a>
              ) : (
                <Link href={card.href} className={className}>
                  {content}
                </Link>
              )
            ) : (
              <div className={className}>{content}</div>
            )}
          </Reveal>
        );
      })}
    </div>
  );
}
