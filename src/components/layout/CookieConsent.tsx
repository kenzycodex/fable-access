"use client";

import { useEffect, useState } from "react";
import Image from "next/image";

const STORAGE_KEY = "fable-cookie-consent";

type Consent = "accepted" | "rejected";

export function CookieConsent() {
  const [visible, setVisible] = useState(false);
  const [showPreferences, setShowPreferences] = useState(false);

  useEffect(() => {
    const existing = window.localStorage.getItem(STORAGE_KEY);
    if (!existing) {
      setVisible(true);
    }
  }, []);

  function respond(consent: Consent) {
    window.localStorage.setItem(STORAGE_KEY, consent);
    setVisible(false);
  }

  function handleAcceptAll() {
    window.localStorage.setItem(STORAGE_KEY, "accepted");
    setShowPreferences(false);
    setVisible(false);
  }

  function handleRejectAll() {
    window.localStorage.setItem(STORAGE_KEY, "rejected");
    setShowPreferences(false);
    setVisible(false);
  }

  return (
    <>
      {/* Bottom Cookie Banner */}
      <div
        role="dialog"
        aria-label="Cookie consent"
        aria-hidden={!visible}
        className={`fixed inset-x-0 bottom-0 z-[2147483646] flex flex-col items-start gap-[var(--spacing-m)] border-t border-secondary/30 bg-base px-[var(--gutter)] py-[var(--spacing-m)] text-white shadow-[0_-4px_24px_rgba(0,0,0,0.4)] transition-transform duration-500 ease-out sm:flex-row sm:items-center sm:justify-between ${
          visible ? "translate-y-0" : "translate-y-full"
        }`}
      >
        <p className="max-w-[640px] text-s text-white/85">
          Fable uses cookies to keep the site secure and understand how it&rsquo;s used. We never sell your data.{" "}
          <button
            type="button"
            onClick={() => setShowPreferences(true)}
            className="underline decoration-secondary underline-offset-2 hover:text-secondary font-semibold bg-transparent border-none p-0 cursor-pointer"
          >
            Learn more
          </button>
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

      {/* Preferences Modal */}
      {showPreferences && (
        <div 
          className="fixed inset-0 z-[2147483647] flex items-center justify-center p-4 bg-black/85 backdrop-blur-sm"
          onClick={() => setShowPreferences(false)}
        >
          <div 
            className="relative w-full max-w-[540px] bg-[#0c041c] border border-white/10 rounded-[20px] shadow-[0_20px_50px_rgba(0,0,0,0.6)] flex flex-col text-white font-sans overflow-hidden animate-fade-in-up"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal Header */}
            <div className="flex items-center justify-between px-8 pt-8 pb-4">
              <Image
                src="/images/brand/fable-logo-white.png"
                alt="Fable"
                width={1671}
                height={547}
                priority
                className="h-8 w-auto object-contain"
              />
              <button
                type="button"
                onClick={() => setShowPreferences(false)}
                className="text-white/60 hover:text-white hover:bg-white/10 p-2 rounded-full transition-colors focus:outline-none"
                aria-label="Close"
              >
                <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {/* Modal Body */}
            <div className="px-8 pb-6">
              <h2 className="text-h4 font-bold text-white mb-4">Cookie Preferences</h2>
              <p className="text-s text-white/70 mb-6 leading-relaxed">
                Fable only uses essential cookies to keep your session secure, prevent fraud, and understand basic site usage. We do not use advertising, targeting, or third-party marketing trackers, and we never sell your data. By accepting, you consent to our use of these essential cookies. You can choose to reject them if you prefer, although some security or login functionalities may be affected.
              </p>

              <div className="flex flex-col sm:flex-row gap-3">
                <button
                  type="button"
                  onClick={handleAcceptAll}
                  className="flex-1 bg-secondary hover:bg-secondary-d-1 text-black hover:text-white font-bold py-4 px-6 rounded-pill transition-colors text-s uppercase tracking-wider text-center"
                >
                  Accept All
                </button>
                <button
                  type="button"
                  onClick={handleRejectAll}
                  className="flex-1 border border-white/20 hover:border-white hover:bg-white/5 text-white font-bold py-4 px-6 rounded-pill transition-colors text-s uppercase tracking-wider text-center"
                >
                  Reject All
                </button>
              </div>
            </div>

            {/* Modal Footer */}
            <div className="px-8 py-4 border-t border-white/5 bg-[#070114] flex justify-end">
              <div className="text-[10px] text-white/40 font-mono tracking-wider">
                Powered by <span className="text-secondary font-bold">Fable Shield</span>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
