"use client";

import { useEffect, useState } from "react";
import Image from "next/image";

const STORAGE_KEY = "fable-cookie-consent";

type Consent = "accepted" | "rejected";

const Toggle = ({ checked, onChange, disabled = false }: { checked: boolean; onChange?: () => void; disabled?: boolean }) => (
  <button
    type="button"
    disabled={disabled}
    onClick={onChange}
    className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
      checked ? "bg-secondary" : "bg-white/10"
    } ${disabled ? "opacity-50 cursor-not-allowed" : ""}`}
  >
    <span
      className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow-md ring-0 transition duration-200 ease-in-out ${
        checked ? "translate-x-5" : "translate-x-0"
      }`}
    />
  </button>
);

export function CookieConsent() {
  const [visible, setVisible] = useState(false);
  const [showPreferences, setShowPreferences] = useState(false);
  const [expandedCategory, setExpandedCategory] = useState<string | null>(null);
  
  const [consents, setConsents] = useState({
    necessary: true,
    performance: false,
    functional: false,
    targeting: false,
  });

  useEffect(() => {
    const existing = window.localStorage.getItem(STORAGE_KEY);
    if (!existing) {
      setVisible(true);
    } else {
      try {
        if (existing === "accepted") {
          setConsents({ necessary: true, performance: true, functional: true, targeting: true });
        } else if (existing === "rejected") {
          setConsents({ necessary: true, performance: false, functional: false, targeting: false });
        } else {
          const parsed = JSON.parse(existing);
          setConsents({
            necessary: true,
            performance: !!parsed.performance,
            functional: !!parsed.functional,
            targeting: !!parsed.targeting,
          });
        }
      } catch {
        // Fallback if parsing fails
      }
    }
  }, []);

  function respond(consent: Consent) {
    window.localStorage.setItem(STORAGE_KEY, consent);
    if (consent === "accepted") {
      setConsents({ necessary: true, performance: true, functional: true, targeting: true });
    } else {
      setConsents({ necessary: true, performance: false, functional: false, targeting: false });
    }
    setVisible(false);
  }

  function handleAllowAll() {
    window.localStorage.setItem(STORAGE_KEY, "accepted");
    setConsents({ necessary: true, performance: true, functional: true, targeting: true });
    setShowPreferences(false);
    setVisible(false);
  }

  function handleRejectAll() {
    window.localStorage.setItem(STORAGE_KEY, "rejected");
    setConsents({ necessary: true, performance: false, functional: false, targeting: false });
    setShowPreferences(false);
    setVisible(false);
  }

  function handleConfirmChoices() {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(consents));
    setShowPreferences(false);
    setVisible(false);
  }

  const categories = [
    {
      id: "necessary",
      title: "Strictly Necessary Cookies",
      description: "These cookies are necessary for the website to function and cannot be switched off in our systems. They are usually only set in response to actions made by you which amount to a request for services, such as setting your privacy preferences, logging in or filling in forms. You can set your browser to block or alert you about these cookies, but some parts of the site will not then work.",
      alwaysActive: true,
    },
    {
      id: "performance",
      title: "Performance Cookies",
      description: "These cookies allow us to count visits and traffic sources so we can measure and improve the performance of our site. They help us to know which pages are the most and least popular and see how visitors move around the site. All information these cookies collect is aggregated and therefore anonymous.",
      alwaysActive: false,
    },
    {
      id: "functional",
      title: "Functional Cookies",
      description: "These cookies enable the website to provide enhanced functionality and personalisation. They may be set by us or by third party providers whose services we have added to our pages. If you do not allow these cookies then some or all of these services may not function properly.",
      alwaysActive: false,
    },
    {
      id: "targeting",
      title: "Targeting Cookies",
      description: "These cookies may be set through our site by our advertising partners. They may be used by those companies to build a profile of your interests and show you relevant adverts on other sites. They do not store directly personal information, but are based on uniquely identifying your browser and internet device.",
      alwaysActive: false,
    }
  ];

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
            className="relative w-full max-w-[640px] max-h-[85vh] bg-[#0c041c] border border-white/10 rounded-[20px] shadow-[0_20px_50px_rgba(0,0,0,0.6)] flex flex-col text-white font-sans overflow-hidden animate-fade-in-up"
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
            <div className="flex-1 overflow-y-auto px-8 pb-6 scrollbar-thin">
              <h2 className="text-h4 font-bold text-white mb-4">Privacy Preference Centre</h2>
              <p className="text-s text-white/70 mb-6 leading-relaxed">
                When you visit any website, it may store or retrieve information on your browser, mostly in the form of cookies. This information might be about you, your preferences or your device and is mostly used to make the site work as you expect it to. The information does not usually directly identify you, but it can give you a more personalised web experience. Because we respect your right to privacy, you can choose not to allow some types of cookies. Click on the different category headings to find out more and change our default settings. However, blocking some types of cookies may impact your experience of the site and the services we are able to offer.
              </p>

              <button
                type="button"
                onClick={handleAllowAll}
                className="w-full bg-secondary hover:bg-secondary-d-1 text-black font-bold py-4 px-6 rounded-pill transition-colors text-s uppercase tracking-wider mb-6 flex items-center justify-center"
              >
                Allow All
              </button>

              {/* Categories list */}
              <div className="space-y-1">
                {categories.map((cat) => {
                  const isExpanded = expandedCategory === cat.id;
                  return (
                    <div key={cat.id} className="border-b border-white/10 py-4 last:border-b-0">
                      <div
                        className="flex items-center justify-between cursor-pointer"
                        onClick={() => setExpandedCategory(isExpanded ? null : cat.id)}
                      >
                        <div className="flex items-center gap-3">
                          <svg
                            className={`w-4 h-4 text-white/60 transition-transform duration-200 ${isExpanded ? "rotate-90" : ""}`}
                            fill="none"
                            viewBox="0 0 24 24"
                            stroke="currentColor"
                            strokeWidth={2.5}
                          >
                            <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                          </svg>
                          <span className="text-s font-semibold text-white/90 select-none">{cat.title}</span>
                        </div>
                        {cat.alwaysActive ? (
                          <span className="text-xs font-bold text-accent tracking-wider uppercase select-none px-2 py-1 bg-accent/10 rounded-sm">Always Active</span>
                        ) : (
                          <div onClick={(e) => e.stopPropagation()}>
                            <Toggle
                              checked={consents[cat.id as keyof typeof consents]}
                              onChange={() =>
                                setConsents((prev) => ({
                                  ...prev,
                                  [cat.id]: !prev[cat.id as keyof typeof consents],
                                }))
                              }
                            />
                          </div>
                        )}
                      </div>
                      <div
                        className={`transition-all duration-300 ease-in-out overflow-hidden ${
                          isExpanded ? "max-h-[300px] mt-3 opacity-100" : "max-h-0 opacity-0"
                        }`}
                      >
                        <p className="text-xs text-white/60 pl-7 leading-relaxed">
                          {cat.description}
                        </p>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Modal Footer */}
            <div className="px-8 py-6 border-t border-white/10 bg-[#070114] flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={handleRejectAll}
                  className="border border-white/20 hover:border-white hover:bg-white/5 text-white font-bold py-3 px-6 rounded-pill transition-colors text-xs uppercase tracking-wider"
                >
                  Reject All
                </button>
                <button
                  type="button"
                  onClick={handleConfirmChoices}
                  className="bg-secondary hover:bg-secondary-d-1 text-black font-bold py-3 px-6 rounded-pill transition-colors text-xs uppercase tracking-wider"
                >
                  Confirm My Choices
                </button>
              </div>
              <div className="text-[10px] text-white/40 font-mono tracking-wider text-right">
                Powered by <span className="text-secondary font-bold">Fable Shield</span>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

