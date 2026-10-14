"use client";

import type { ReactNode } from "react";
import { LockKey, Prohibit, UserPlus, WarningCircle } from "@phosphor-icons/react";
import { ButtonLink, Card, Screen } from "@/components/app-kit";
import { PageSpinner } from "@/components/demo/Spinner";
import { useInstitution } from "@/components/demo/InstitutionProvider";

/**
 * What the sandbox shows before it can show a customer's account.
 *
 * The sandbox is the bank's own test app. It opens for that bank's signed-in
 * team, with the test customers they added, and nothing else: no built-in
 * people, no sample history.
 */
export function SandboxGate({ children }: { children: ReactNode }) {
  const { roster, name, href } = useInstitution();

  if (roster === "ready") return <>{children}</>;
  if (roster === "loading") return <PageSpinner minh="70vh" />;

  const here = typeof window === "undefined" ? href() : window.location.pathname;
  const signIn = `/dashboard/login?next=${encodeURIComponent(here)}`;

  const screens: Record<Exclude<typeof roster, "ready" | "loading">, { icon: ReactNode; title: string; body: string; action?: ReactNode }> = {
    "signed-out": {
      icon: <LockKey size={26} weight="duotone" />,
      title: "Sign in to open the sandbox",
      body: `The sandbox is ${name}'s test app. It opens for your team once you're signed in to the console.`,
      action: <ButtonLink href={signIn}>Sign in to the console</ButtonLink>,
    },
    "other-bank": {
      icon: <LockKey size={26} weight="duotone" />,
      title: "This is another bank's sandbox",
      body: "You're signed in to a different institution. Sign in as a member of this one to open its sandbox.",
      action: <ButtonLink href={signIn} variant="secondary">Switch account</ButtonLink>,
    },
    live: {
      icon: <Prohibit size={26} weight="duotone" />,
      title: "The sandbox is off",
      body: `${name} is live, so transfers come from its own app and servers. The sandbox only runs while an institution is in sandbox mode.`,
      action: <ButtonLink href="/dashboard" variant="secondary">Open the console</ButtonLink>,
    },
    empty: {
      icon: <UserPlus size={26} weight="duotone" />,
      title: "No test customers yet",
      body: "Add test customers in the console, or import them with their past transfers, then come back to try a transfer as one of them.",
      action: <ButtonLink href="/dashboard/customers">Add test customers</ButtonLink>,
    },
    unavailable: {
      icon: <WarningCircle size={26} weight="duotone" />,
      title: "The sandbox can't reach Fable",
      body: "We couldn't load this bank's test customers. Check your connection and try again in a moment.",
    },
  };
  const s = screens[roster];

  return (
    <Screen className="flex min-h-[calc(100dvh-10rem)] items-center justify-center">
      <Card className="w-full max-w-[440px] animate-fade-in-up text-center">
        <div className="flex flex-col items-center gap-3 py-4">
          <span className="flex size-14 items-center justify-center rounded-2xl bg-brand/10 text-brand">{s.icon}</span>
          <h1 className="mt-1 text-[18px] font-bold text-d-text">{s.title}</h1>
          <p className="max-w-[340px] text-[13px] leading-relaxed text-d-muted">{s.body}</p>
          {s.action && <div className="mt-3">{s.action}</div>}
        </div>
      </Card>
    </Screen>
  );
}
