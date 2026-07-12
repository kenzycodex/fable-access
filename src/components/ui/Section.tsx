import type { ReactNode } from "react";

type SectionSpace = "xs" | "s" | "m" | "l" | "xl" | "xxl";

interface SectionProps {
  id?: string;
  children: ReactNode;
  className?: string;
  space?: SectionSpace;
  /** Override just the bottom space, independent of `space` (top). */
  spaceBottom?: SectionSpace;
  topOnly?: boolean;
  bottomOnly?: boolean;
}

export function Section({
  id,
  children,
  className = "",
  space = "m",
  spaceBottom,
  topOnly = false,
  bottomOnly = false,
}: SectionProps) {
  const spaceVar = `var(--section-space-${space})`;
  const style = {
    paddingTop: bottomOnly ? undefined : spaceVar,
    paddingBottom: topOnly ? undefined : `var(--section-space-${spaceBottom ?? space})`,
  };

  return (
    <section
      id={id}
      className={`px-[var(--gutter)] ${className}`.trim()}
      style={style}
    >
      {children}
    </section>
  );
}

export function Container({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={`mx-auto w-full max-w-[var(--container-width)] ${className}`.trim()}>
      {children}
    </div>
  );
}
