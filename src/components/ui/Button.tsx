import Link from "next/link";
import type { ReactNode } from "react";
import { ArrowRightIcon } from "@/components/icons";

type Tone = "primary" | "secondary" | "white" | "black";
type Variant = "solid" | "outline" | "plain";

interface ButtonProps {
  href: string;
  children: ReactNode;
  variant?: Variant;
  tone?: Tone;
  external?: boolean;
  showArrow?: boolean;
  className?: string;
}

const toneClasses: Record<Variant, Record<Tone, string>> = {
  solid: {
    primary: "bg-primary text-white hover:bg-primary-d-1",
    secondary: "bg-secondary text-black hover:bg-secondary-d-1 hover:text-white",
    white: "bg-white text-black hover:bg-light",
    black: "bg-black text-white hover:bg-base",
  },
  outline: {
    primary: "border-3 border-primary text-primary hover:bg-primary hover:text-white",
    secondary: "border-3 border-secondary text-white hover:bg-secondary hover:text-black",
    white: "border-3 border-white text-white hover:bg-white hover:text-black",
    black: "border-3 border-black text-black hover:bg-black hover:text-white",
  },
  plain: {
    primary: "text-primary hover:text-secondary",
    secondary: "text-secondary hover:text-primary",
    white: "text-white hover:text-secondary",
    black: "text-black hover:text-secondary",
  },
};

const pillBase =
  "inline-flex shrink-0 items-center gap-2 whitespace-nowrap rounded-pill py-[calc(var(--spacing-xs)+2px)] px-[calc(var(--spacing-xs)+5px)] text-s font-bold uppercase tracking-wide";

export function Button({
  href,
  children,
  variant = "solid",
  tone = "secondary",
  external = false,
  showArrow = false,
  className = "",
}: ButtonProps) {
  const content = (
    <>
      {children}
      {showArrow && <ArrowRightIcon className="size-[14px]" />}
    </>
  );

  const linkProps = external ? { target: "_blank" as const, rel: "noopener noreferrer" } : {};

  // Confirmed reference/site hover: a fill sweeps in from the left on hover
  // and slides back out on mouse leave. Solid pink/white buttons sweep black;
  // outline pills sweep their accent color (matching the home page's
  // "View all resources" / footer "Contact us" pattern) with the text
  // staying its resting color throughout.
  const solidSweep: Partial<Record<Tone, { base: string; hoverText: string }>> = {
    secondary: { base: "border-3 border-secondary bg-secondary text-black", hoverText: "group-hover:text-white" },
    white: { base: "border-3 border-white bg-white text-black", hoverText: "group-hover:text-white" },
  };
  const outlineSweep: Partial<Record<Tone, { base: string; fill: string }>> = {
    secondary: { base: "border-3 border-secondary text-white", fill: "bg-secondary" },
    primary: { base: "border-3 border-primary text-white", fill: "bg-primary" },
    white: { base: "border-3 border-white text-white", fill: "bg-white" },
  };

  if (variant === "solid" && solidSweep[tone]) {
    const { base: toneBase, hoverText } = solidSweep[tone]!;
    const classes = `group relative isolate overflow-hidden ${toneBase} ${pillBase} ${className}`.trim();
    const inner = (
      <>
        <span
          aria-hidden="true"
          className="absolute inset-0 -z-10 origin-left scale-x-0 bg-black transition-transform duration-300 ease-out group-hover:scale-x-100"
        />
        <span className={`relative z-10 inline-flex items-center gap-2 transition-colors duration-300 ${hoverText}`}>
          {content}
        </span>
      </>
    );
    return external ? (
      <a href={href} {...linkProps} className={classes}>
        {inner}
      </a>
    ) : (
      <Link href={href} className={classes}>
        {inner}
      </Link>
    );
  }

  if (variant === "outline" && outlineSweep[tone]) {
    const { base: toneBase, fill } = outlineSweep[tone]!;
    const classes = `group relative isolate overflow-hidden ${toneBase} ${pillBase} ${className}`.trim();
    const inner = (
      <>
        <span
          aria-hidden="true"
          className={`absolute inset-0 -z-10 origin-left scale-x-0 ${fill} transition-transform duration-300 ease-out group-hover:scale-x-100`}
        />
        <span className="relative z-10 inline-flex items-center gap-2">{content}</span>
      </>
    );
    return external ? (
      <a href={href} {...linkProps} className={classes}>
        {inner}
      </a>
    ) : (
      <Link href={href} className={classes}>
        {inner}
      </Link>
    );
  }

  const base = variant === "plain" ? "inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap text-s font-bold uppercase tracking-wide transition-colors" : `${pillBase} transition-colors`;
  const classes = `${base} ${toneClasses[variant][tone]} ${className}`.trim();

  if (external) {
    return (
      <a href={href} {...linkProps} className={classes}>
        {content}
      </a>
    );
  }

  return (
    <Link href={href} className={classes}>
      {content}
    </Link>
  );
}
