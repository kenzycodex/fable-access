import Image from "next/image";
import Link from "next/link";
import type { ReactNode } from "react";

/** The sign-in screens' input and button styles, shared so all three match. */
export const authInput =
  "w-full rounded border border-white/[0.08] bg-white/[0.02] px-3 py-3 text-[14px] text-white outline-none transition-all placeholder:text-gray-500 hover:bg-white/[0.04] focus:border-[#7C3AED] focus:ring-1 focus:ring-[#7C3AED]";

export const authButton =
  "flex w-full items-center justify-center gap-2 rounded bg-[#7C3AED] py-3 text-[15px] font-medium text-white shadow-lg shadow-[#7C3AED]/20 transition-all hover:bg-[#6d28d9] disabled:opacity-70";

export function AuthSpinner() {
  return <span className="size-4 animate-spin rounded-full border-2 border-white/40 border-t-white" />;
}

/**
 * The frame around the console's sign-in screens: the brand image on the left
 * on wide screens, and the form on plain black on the right. Always dark,
 * whatever the theme, so it reads as one piece with the image.
 */
export function AuthShell({
  title,
  description,
  children,
  wide = false,
}: {
  title?: string;
  description?: string;
  children: ReactNode;
  /** Room for two columns, for steps with more to show (an authenticator QR code). */
  wide?: boolean;
}) {
  return (
    <div data-surface="app" className="min-h-dvh w-full bg-black">
      <div className="animate-card-entrance grid min-h-dvh w-full bg-black lg:grid-cols-2">
        <div className="relative hidden h-full w-full overflow-hidden bg-[#1E1145] lg:block">
          <Image src="/images/brand/login-bg.jpg" alt="" fill priority sizes="50vw" className="object-cover" />
        </div>

        <div className={`relative z-10 flex flex-col justify-center bg-black px-6 py-8 sm:px-12 ${wide ? "lg:px-10" : "lg:px-16"}`}>
          <div className={`mx-auto flex w-full flex-col items-center ${wide ? "max-w-[540px]" : "max-w-[340px]"}`}>
            <div className={`flex justify-center ${wide ? "mb-6" : title ? "mb-8" : "mb-10"}`}>
              <Link href="/" aria-label="Fable home" className="relative flex w-fit items-center">
                <Image
                  src="/images/brand/fable-logo-white.png"
                  alt="Fable"
                  width={1671}
                  height={547}
                  priority
                  className="h-14 w-auto drop-shadow-md"
                />
              </Link>
            </div>

            {title && (
              <div className={`w-full text-center ${wide ? "mb-6" : "mb-8"}`}>
                <h1 className={`font-bold text-white ${wide ? "mb-1.5 whitespace-nowrap text-[clamp(1.35rem,6.2vw,2.1rem)]" : "mb-2 text-xl"}`}>{title}</h1>
                {description && <p className={wide ? "text-[13px] leading-relaxed text-gray-400" : "text-sm text-gray-400"}>{description}</p>}
              </div>
            )}

            <div className="w-full">{children}</div>
          </div>
        </div>
      </div>
    </div>
  );
}

/** A status box in the sign-in screens' own style. */
/**
 * A finished step on the sign-in screens: a check, a heading, one plain line,
 * and what to do next. It replaces the form rather than sitting above it, and
 * only the check carries the success colour, so the screen keeps the brand's
 * look instead of turning green.
 */
export function AuthSuccess({
  title,
  children,
  action,
}: {
  title: string;
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div role="status" className="flex w-full flex-col items-center text-center animate-fade-in-up">
      <span className="mb-6 flex size-14 items-center justify-center rounded-full bg-emerald-500/10 ring-1 ring-emerald-400/25">
        <svg viewBox="0 0 24 24" fill="none" aria-hidden className="size-7 text-emerald-400">
          <path d="M5 12.5l4.5 4.5L19 7.5" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </span>
      <h1 className="mb-2 text-xl font-bold text-white">{title}</h1>
      <p className="text-sm leading-relaxed text-gray-400">{children}</p>
      {action && <div className="mt-8 flex w-full flex-col items-center gap-4">{action}</div>}
    </div>
  );
}

/** An error on a sign-in form. Success uses AuthSuccess, which replaces the form. */
export function AuthNotice({ children }: { tone: "danger"; children: ReactNode }) {
  return (
    <div role="alert" className="w-full rounded border border-red-500/30 bg-red-500/10 px-3 py-2.5 text-[13px] text-red-400">
      {children}
    </div>
  );
}
