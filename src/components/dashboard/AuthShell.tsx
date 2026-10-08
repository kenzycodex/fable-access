import Image from "next/image";
import Link from "next/link";
import type { ReactNode } from "react";

/**
 * The frame around the console's sign-in screens: the brand image on the left on
 * wide screens, and a centred card on the console palette on the right. Follows
 * the light or dark theme like the rest of the console.
 */
export function AuthShell({
  title,
  description,
  children,
  footer,
}: {
  title: string;
  description?: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <div data-surface="app" className="console-shell min-h-dvh w-full bg-d-bg text-d-text">
      <div className="grid min-h-dvh w-full lg:grid-cols-2">
        <div className="relative hidden overflow-hidden bg-[#1E1145] lg:block">
          <Image src="/images/brand/login-bg.jpg" alt="" fill priority className="object-cover" />
        </div>

        <div className="flex flex-col items-center justify-center px-5 py-10 sm:px-10">
          <div className="w-full max-w-[400px]">
            <Link href="/" aria-label="Fable home" className="mb-8 inline-flex">
              <Image
                src="/images/brand/fable-logo.png"
                alt="Fable"
                width={1671}
                height={547}
                priority
                className="block h-10 w-auto dark:hidden"
              />
              <Image
                src="/images/brand/fable-logo-white.png"
                alt="Fable"
                width={1671}
                height={547}
                priority
                className="hidden h-10 w-auto dark:block"
              />
            </Link>

            <div className="demo-card rounded-[24px] border border-d-border bg-d-surface p-6 sm:p-8">
              <h1 className="text-[24px] font-bold tracking-tight text-d-text">{title}</h1>
              {description && <p className="mt-1.5 text-[14px] leading-relaxed text-d-muted">{description}</p>}
              <div className="mt-6">{children}</div>
            </div>

            {footer && <div className="mt-6 text-center text-[13px] text-d-muted">{footer}</div>}
          </div>
        </div>
      </div>
    </div>
  );
}
