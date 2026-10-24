import Link from "next/link";
import { primaryNav } from "@/data/nav";

export function Nav({ transparent = false }: { transparent?: boolean }) {
  return (
    <ul className="hidden items-center gap-[var(--spacing-l)] lg:flex">
      {primaryNav.map((item) => {
        const className = `whitespace-nowrap text-s font-semibold transition-colors hover:text-secondary ${
          transparent ? "text-white" : "text-black"
        }`;
        return (
          <li key={item.label}>
            {item.external ? (
              <a href={item.href} target="_blank" rel="noopener noreferrer" className={className}>
                {item.label}
              </a>
            ) : (
              <Link href={item.href} className={className}>
                {item.label}
              </Link>
            )}
          </li>
        );
      })}
    </ul>
  );
}
