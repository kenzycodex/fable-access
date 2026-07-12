"use client";

import { useEffect, useState } from "react";

const STORAGE_KEY = "fable-cookie-consent";

type Consent = "accepted" | "rejected";

export function CookieConsent() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const existing = window.localStorage.getItem(STORAGE_KEY);
    if (!existing) setVisible(true);
  }, []);

  function respond(consent: Consent) {
    window.localStorage.setItem(STORAGE_KEY, consent);
    setVisible(false);
  }

  return (
    <div
      role="dialog"
      aria-label="Cookie consent"
      aria-hidden={!visible}
      className={`fixed inset-x-0 bottom-0 z-[2147483647] flex flex-col items-start gap-[var(--spacing-m)] border-t border-secondary/30 bg-base px-[var(--gutter)] py-[var(--spacing-m)] text-white shadow-[0_-4px_24px_rgba(0,0,0,0.4)] transition-transform duration-500 ease-out sm:flex-row sm:items-center sm:justify-between ${
        visible ? "translate-y-0" : "translate-y-full"
      }`}
    >
      <p className="max-w-[640px] text-s text-white/85">
        Fable uses cookies to keep the site secure and understand how it&rsquo;s used. We never sell your data.{" "}
        <a href="/privacy" className="underline decoration-secondary underline-offset-2 hover:text-secondary">
          Learn more
        </a>
        .
      </p>
      <div className="flex shrink-0 items-center gap-[var(--spacing-s)]">
        <button
          type="button"
          onClick={() => respond("rejected")}
          className="rounded-pill border-2 border-white/30 px-6 py-3 text-s font-bold uppercase text-white transition-colors hover:border-white"
        >
          Reject
        </button>
        <button
          type="button"
          onClick={() => respond("accepted")}
          className="rounded-pill bg-secondary px-6 py-3 text-s font-bold uppercase text-black transition-colors hover:bg-secondary-d-1 hover:text-white"
        >
          Accept
        </button>
      </div>
    </div>
  );
}
