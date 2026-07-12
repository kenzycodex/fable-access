import Link from "next/link";

interface Crumb {
  label: string;
  href?: string;
}

/**
 * Matches the source's .breadcrumbs: text-xs items, 5px gap, and the
 * current page in bold secondary pink. Link/separator color inherits so
 * dark heroes can pass a white text color via className.
 */
export function Breadcrumb({ items, className = "" }: { items: Crumb[]; className?: string }) {
  return (
    <nav aria-label="Breadcrumb" className={`text-xs ${className}`.trim()}>
      <ol className="flex flex-wrap items-center gap-[5px]">
        {items.map((item, i) => (
          <li key={item.label} className="flex items-center gap-[5px]">
            {item.href ? (
              <Link href={item.href} className="transition-colors hover:text-secondary">
                {item.label}
              </Link>
            ) : (
              <span aria-current="page" className="font-bold text-secondary">
                {item.label}
              </span>
            )}
            {i < items.length - 1 && <span aria-hidden="true">/</span>}
          </li>
        ))}
      </ol>
    </nav>
  );
}
