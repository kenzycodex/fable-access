"use client";

import { useEffect, useRef, useState } from "react";
import { PaperPlaneRight, Sparkle, X } from "@phosphor-icons/react";
import { assistantChat } from "@/lib/fable/api";

interface Turn {
  role: "user" | "assistant";
  content: string;
  engine?: string;
}

const SUGGESTIONS = [
  "What's my biggest scam threat?",
  "How much fraud has Fable prevented?",
  "Which channel is riskiest?",
];

/** Floating "Ask Fable" analyst assistant — grounded in the institution's live
 * numbers via the FastAPI /v1/assistant/chat endpoint (GPT-4o when a key is
 * set, a deterministic data-driven answer otherwise). */
export function AskFable() {
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [welcomeVisible, setWelcomeVisible] = useState(true);
  const [turns, setTurns] = useState<Turn[]>([]);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [turns, busy, open]);

  async function send(text: string) {
    const message = text.trim();
    if (!message || busy) return;
    const history = turns.filter((t) => t.role === "user" || t.role === "assistant").map((t) => ({ role: t.role, content: t.content }));
    setTurns((prev) => [...prev, { role: "user", content: message }]);
    setInput("");
    setBusy(true);
    try {
      const res = await assistantChat(message, history);
      setTurns((prev) => [...prev, { role: "assistant", content: res.reply, engine: res.engine }]);
    } catch {
      setTurns((prev) => [
        ...prev,
        { role: "assistant", content: "I couldn't reach the Fable engine just now. Make sure the API is running." },
      ]);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      {/* Launcher */}
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={`fixed bottom-6 right-6 z-40 flex items-center gap-2 rounded-full bg-gradient-to-r from-[#7C3AED] to-[#9333ea] px-5 py-3.5 text-[13px] font-bold text-white shadow-[0_12px_30px_-8px_rgba(124,58,237,0.7)] transition-all duration-300 ${
          open ? "translate-y-4 scale-95 opacity-0 pointer-events-none" : "translate-y-0 scale-100 opacity-100 pointer-events-auto hover:scale-105"
        }`}
      >
          <Sparkle size={18} weight="fill" />
          Ask Fable
      </button>

      {/* Panel */}
      <div 
        className={`fixed bottom-6 right-6 z-40 flex h-[520px] w-[min(92vw,380px)] flex-col overflow-hidden rounded-2xl border border-gray-200 dark:border-white/10 bg-white dark:bg-black shadow-xl dark:shadow-[0_30px_80px_-20px_rgba(0,0,0,0.7)] transition-all duration-300 origin-bottom-right ${
          open ? "scale-100 opacity-100 translate-y-0 pointer-events-auto" : "scale-90 opacity-0 translate-y-4 pointer-events-none"
        }`}
      >
          {/* Header */}
          <div className="flex items-center justify-between border-b border-gray-100 dark:border-white/10 bg-gray-50 dark:bg-black px-4 py-3">
            <div className="flex items-center gap-2.5">
              <span className="flex size-8 items-center justify-center rounded-lg bg-gradient-to-br from-[#7C3AED] to-[#4c1d95]">
                <Sparkle size={16} weight="fill" className="text-white" />
              </span>
              <div className="flex flex-col">
                <span className="text-[13px] font-bold text-gray-900 dark:text-white">Fable Copilot</span>
                <span className="text-[10px] text-gray-500 dark:text-white/40">Grounded in your live data</span>
              </div>
            </div>
            <button type="button" onClick={() => setOpen(false)} aria-label="Close" className="text-gray-400 hover:text-gray-900 dark:text-white/40 dark:hover:text-white transition-colors">
              <X size={18} />
            </button>
          </div>

          {/* Messages */}
          <div ref={scrollRef} className="flex-1 space-y-4 overflow-y-auto px-4 py-4">
            {welcomeVisible && (
              <div className="flex flex-col items-center justify-center pt-8 pb-4 text-center">
                <div className="mb-4 flex size-12 items-center justify-center rounded-2xl bg-gradient-to-br from-[#7C3AED] to-[#4c1d95] shadow-lg shadow-[#7C3AED]/20">
                  <Sparkle size={24} weight="fill" className="text-white" />
                </div>
                <h3 className="mb-1 text-[16px] font-bold text-gray-900 dark:text-white">Welcome to Fable Copilot</h3>
                <p className="text-[13px] text-gray-500 dark:text-white/50 max-w-[240px]">
                  I'm your AI analyst. Ask me about your fraud activity, scam patterns, or a specific decision.
                </p>
              </div>
            )}
            {turns.map((t, i) => (
              <div key={i} className={`flex ${t.role === "user" ? "justify-end" : "justify-start"} animate-card-entrance`}>
                <div
                  className={`max-w-[85%] rounded-2xl px-3.5 py-2.5 text-[13px] leading-relaxed ${
                    t.role === "user"
                      ? "bg-[#7C3AED] text-white"
                      : "border border-gray-200 dark:border-white/[0.06] bg-gray-50 dark:bg-white/[0.04] text-gray-800 dark:text-white/85"
                  }`}
                >
                  {t.content}
                  {t.engine && t.engine !== "deterministic" && (
                    <span className="mt-1 block text-[9px] font-bold uppercase tracking-wider text-emerald-500 dark:text-[#00f5a0]">
                      via {t.engine}
                    </span>
                  )}
                </div>
              </div>
            ))}
            {busy && (
              <div className="flex justify-start animate-fade-in-up">
                <div className="flex gap-1 rounded-2xl border border-gray-200 dark:border-white/[0.06] bg-gray-50 dark:bg-white/[0.04] px-4 py-3">
                  {[0, 150, 300].map((d) => (
                    <span key={d} className="size-1.5 animate-bounce rounded-full bg-gray-400 dark:bg-white/40" style={{ animationDelay: `${d}ms` }} />
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Suggestions */}
          {turns.length <= 1 && (
            <div className="flex flex-wrap gap-1.5 px-4 pb-2">
              {SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => {
                    setWelcomeVisible(false);
                    send(s);
                  }}
                  className="rounded-full border border-gray-200 dark:border-white/10 bg-gray-50 dark:bg-white/[0.03] px-2.5 py-1 text-[11px] text-gray-600 dark:text-white/60 transition-colors hover:border-[#7C3AED]/40 hover:text-gray-900 dark:hover:text-white"
                >
                  {s}
                </button>
              ))}
            </div>
          )}

          {/* Input */}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              setWelcomeVisible(false);
              send(input);
            }}
            className="flex items-end gap-2 border-t border-gray-100 dark:border-white/10 bg-gray-50 dark:bg-black p-3"
          >
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  setWelcomeVisible(false);
                  send(input);
                }
              }}
              placeholder="Ask Copilot..."
              className="max-h-32 min-h-[40px] w-full resize-none rounded-xl border border-gray-200 dark:border-white/10 bg-white dark:bg-white/[0.04] px-4 py-2.5 text-[13px] text-gray-900 dark:text-white placeholder:text-gray-400 dark:placeholder:text-white/30 focus:border-[#7C3AED]/50 focus:outline-none focus:ring-1 focus:ring-[#7C3AED]/50 transition-all"
              rows={1}
            />
            <button
              type="submit"
              disabled={busy || !input.trim()}
              className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-[#7C3AED] text-white transition-opacity hover:opacity-90 disabled:opacity-40"
            >
              <PaperPlaneRight size={16} weight="fill" />
            </button>
          </form>
        </div>
    </>
  );
}
