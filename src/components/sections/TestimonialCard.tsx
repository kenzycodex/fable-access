import Image from "next/image";

interface TestimonialCardProps {
  quote: string;
  name: string;
  role: string;
  logo?: { src: string; alt: string; width: number; height: number };
  tone?: "light" | "dark";
}

export function TestimonialCard({ quote, name, role, logo, tone = "light" }: TestimonialCardProps) {
  return (
    <div
      className={`flex w-full items-start gap-[var(--spacing-xs)] border-t pt-[var(--spacing-l)] ${
        tone === "dark" ? "border-white text-white" : "border-black text-black"
      }`}
    >
      <Image
        src="/images/home/quotation-mark.svg"
        alt=""
        aria-hidden="true"
        width={40}
        height={40}
        className="w-[40px] shrink-0"
      />
      <div className="flex w-full flex-col gap-[var(--spacing-s)]">
        <p className="text-h4 font-semibold leading-[1.25]">{quote}</p>
        <div className="flex flex-wrap items-center gap-[var(--spacing-s)]">
          <div>
            <p className="text-l font-semibold">{name}</p>
            <p className="mt-0.5 text-s font-normal">{role}</p>
          </div>
          {logo && (
            <Image src={logo.src} alt={logo.alt} width={logo.width} height={logo.height} className="h-auto w-[100px]" />
          )}
        </div>
      </div>
    </div>
  );
}
