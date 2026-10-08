"use client";

import { useEffect, useRef, useState } from "react";
import { PaperPlaneRight, Sparkle, X } from "@phosphor-icons/react";
import { assistantChat } from "@/lib/fable/api";
import { useFableStore } from "@/lib/fable/store";

interface Turn {
  role: "user" | "assistant";
  content: string;
  engine?: string;
  /** Follow-ups the backend derived from this institution's own data. */
  suggestions?: string[];
}

const SUGGESTIONS = [
  "What's my biggest scam threat?",
  "How much fraud has Fable prevented?",
  "Which channel is riskiest?",
];

/** Floating "Ask Fable" analyst assistant, grounded in the institution's live
 * numbers via the FastAPI /v1/assistant/chat endpoint (an LLM when a key is
 * set, a deterministic data-driven answer otherwise). */
export function AskFable() {
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [turns, setTurns] = useState<Turn[]>([]);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Scope every question to the signed-in institution, so the assistant can
  // never ground an answer in another tenant's numbers.
  const store = useFableStore();
  const institution = store?.session.institutionId ?? null;

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [turns, busy, open]);

  async function send(text: string) {
    const message = text.trim();
    if (!message || busy) return;
    const history = turns.map((t) => ({ role: t.role, content: t.content }));
    setTurns((prev) => [...prev, { role: "user", content: message }]);
    setInput("");
    setBusy(true);
    try {
      const res = await assistantChat(message, history, institution);
      setTurns((prev) => [
        ...prev,
        { role: "assistant", content: res.reply, engine: res.engine, suggestions: res.suggestions },
      ]);
    } catch {
      setTurns((prev) => [
        ...prev,
        { role: "assistant", content: "I could not reach the Fable engine just now. Make sure the API is running." },
      ]);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={`fixed bottom-5 right-5 z-40 flex h-12 items-center gap-2 rounded-full bg-brand px-5 text-[13px] font-semibold text-white shadow-[0_14px_30px_-10px_rgba(124,58,237,0.8)] transition-all duration-300 ${
          open ? "pointer-events-none translate-y-4 scale-95 opacity-0" : "pointer-events-auto translate-y-0 scale-100 opacity-100 hover:brightness-110"
        }`}
      >
        <Sparkle size={18} weight="fill" />
        Ask Fable
      </button>

      <div
        className={`fixed bottom-5 right-5 z-40 flex h-[540px] max-h-[calc(100dvh-2.5rem)] w-[min(92vw,390px)] origin-bottom-right flex-col overflow-hidden rounded-[22px] border border-d-border bg-d-surface shadow-[0_30px_70px_-20px_rgba(20,10,60,0.45)] transition-all duration-300 ${
          open ? "pointer-events-auto translate-y-0 scale-100 opacity-100" : "pointer-events-none translate-y-4 scale-90 opacity-0"
        }`}
      >
        <div className="flex items-center justify-between border-b border-d-border px-4 py-3.5">
          <div className="flex items-center gap-3">
            <span className="flex size-9 items-center justify-center rounded-xl bg-brand text-white">
              <Sparkle size={17} weight="fill" />
            </span>
            <div>
              <p className="text-[14px] font-semibold text-d-text">Ask Fable</p>
              <p className="text-[11px] text-d-muted">Answers from your live data</p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setOpen(false)}
            aria-label="Close"
            className="flex size-9 items-center justify-center rounded-xl text-d-muted transition-colors hover:bg-d-surface-2 hover:text-d-text"
          >
            <X size={18} />
          </button>
        </div>

        <div ref={scrollRef} className="flex-1 space-y-4 overflow-y-auto px-4 py-4">
          {turns.length === 0 && (
            <div className="flex flex-col items-center px-4 pb-2 pt-6 text-center">
              <span className="mb-4 flex size-12 items-center justify-center rounded-2xl bg-brand/10 text-brand">
                <Sparkle size={24} weight="fill" />
              </span>
              <h3 className="mb-1 text-[16px] font-semibold text-d-text">What would you like to know?</h3>
              <p className="max-w-[260px] text-[13px] leading-relaxed text-d-muted">
                Ask about your fraud activity, scam patterns or a specific decision.
              </p>
              <div className="mt-5 flex flex-wrap justify-center gap-2">
                {SUGGESTIONS.map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => send(s)}
                    className="rounded-full bg-d-surface-2 px-3.5 py-2 text-[12px] font-medium text-d-muted transition-colors hover:bg-brand/10 hover:text-brand"
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          )}

          {turns.map((t, i) => {
            // Only the newest answer offers follow-ups; older ones would
            // stack stale chips up the transcript.
            const isLatestAnswer = t.role === "assistant" && i === turns.length - 1;
            return (
              <div key={i} className="flex flex-col gap-2">
                <div className={`flex ${t.role === "user" ? "justify-end" : "justify-start"}`}>
                  <div
                    className={`max-w-[88%] whitespace-pre-wrap rounded-2xl px-4 py-2.5 text-[13px] leading-relaxed ${
                      t.role === "user" ? "rounded-br-md bg-brand text-white" : "rounded-bl-md bg-d-surface-2 text-d-text"
                    }`}
                  >
                    {t.content}
                    {t.engine && t.engine !== "deterministic" && (
                      <span className="mt-1.5 block text-[10px] font-semibold uppercase tracking-wider text-emerald-600 dark:text-emerald-400">
                        via {t.engine}
                      </span>
                    )}
                  </div>
                </div>

                {isLatestAnswer && !busy && (t.suggestions?.length ?? 0) > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {t.suggestions!.map((q) => (
                      <button
                        key={q}
                        type="button"
                        onClick={() => send(q)}
                        className="rounded-full bg-brand/10 px-3 py-1.5 text-left text-[12px] font-medium text-brand transition-colors hover:bg-brand/20"
                      >
                        {q}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            );
          })}

          {busy && (
            <div className="flex justify-start">
              <div className="flex gap-1 rounded-2xl rounded-bl-md bg-d-surface-2 px-4 py-3.5">
                {[0, 150, 300].map((d) => (
                  <span key={d} className="size-1.5 animate-bounce rounded-full bg-d-faint" style={{ animationDelay: `${d}ms` }} />
                ))}
              </div>
            </div>
          )}
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            send(input);
          }}
          className="flex items-end gap-2 border-t border-d-border p-3"
        >
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send(input);
              }
            }}
            placeholder="Ask about your data"
            aria-label="Ask about your data"
            rows={1}
            className="max-h-32 min-h-[44px] w-full resize-none rounded-xl border border-d-border bg-d-surface-2 px-4 py-3 text-[13px] text-d-text outline-none transition-shadow placeholder:text-d-faint focus:border-brand/50 focus:ring-4 focus:ring-brand/10"
          />
          <button
            type="submit"
            disabled={busy || !input.trim()}
            aria-label="Send"
            className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-brand text-white transition-all hover:brightness-110 disabled:opacity-40"
          >
            <PaperPlaneRight size={17} weight="fill" />
          </button>
        </form>
      </div>
    </>
  );
}
