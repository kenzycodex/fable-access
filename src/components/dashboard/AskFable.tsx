"use client";

import { usePathname } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  ArrowClockwise,
  ArrowDown,
  ArrowsIn,
  ArrowsOut,
  Check,
  Copy,
  NotePencil,
  PaperPlaneRight,
  Sparkle,
  Stop,
  X,
} from "@phosphor-icons/react";
import { assistantStarters, streamAssistant, type AssistantTurn } from "@/lib/fable/api";
import { useFableStore } from "@/lib/fable/store";

interface Turn {
  id: string;
  role: "user" | "assistant";
  content: string;
  status?: "streaming" | "done" | "stopped" | "error";
  engine?: string;
  /** Why the answer came from the figures alone, when a limit was the reason. */
  notice?: string | null;
  /** Follow-ups the server drew from this institution's own figures. */
  suggestions?: string[];
}

interface Saved {
  turns: Turn[];
  shown: string[];
}

const MAX_CHARS = 1000;
const FALLBACK_STARTERS = [
  "What should my team review first?",
  "How does this week compare with last week?",
  "How much fraud have we prevented?",
  "What does Fable need before we go live?",
];

/** Which console page is in view, so starters lead with what's on screen. */
function pageOf(pathname: string): string {
  const part = pathname.replace(/^\/dashboard\/?/, "").split("/")[0];
  if (!part) return "overview";
  if (part === "alerts") return "review";
  if (part === "report") return "compliance";
  return part;
}

const newId = () => Math.random().toString(36).slice(2, 10);

function load(key: string): Saved {
  try {
    const raw = sessionStorage.getItem(key);
    if (raw) {
      const saved = JSON.parse(raw) as Saved;
      // An answer cut off by a reload can't resume, so it reads as stopped.
      return {
        turns: saved.turns.map((t) => (t.status === "streaming" ? { ...t, status: "stopped" } : t)),
        shown: saved.shown ?? [],
      };
    }
  } catch {
    // Storage blocked or corrupt: start fresh.
  }
  return { turns: [], shown: [] };
}

/**
 * Ask Fable: the console's analyst assistant. Answers stream from
 * /v1/assistant/chat/stream and are grounded in the signed-in institution's
 * figures only (a model when one is configured, the figures alone otherwise).
 */
export function AskFable() {
  const store = useFableStore();
  const institution = store?.session.institutionId ?? "";
  const storageKey = `fable_ask_${institution}`;
  const pathname = usePathname();
  const page = pageOf(pathname);

  const [open, setOpen] = useState(false);
  const [wide, setWide] = useState(false);
  const [input, setInput] = useState("");
  const [turns, setTurns] = useState<Turn[]>([]);
  const [shown, setShown] = useState<string[]>([]);
  const [starters, setStarters] = useState<string[] | null>(null);
  const [atBottom, setAtBottom] = useState(true);
  const [loadedKey, setLoadedKey] = useState<string | null>(null);

  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const busy = turns.some((t) => t.status === "streaming");

  // The conversation lasts as long as the tab, per institution.
  if (institution && loadedKey !== storageKey) {
    const saved = load(storageKey);
    setLoadedKey(storageKey);
    setTurns(saved.turns);
    setShown(saved.shown);
  }
  useEffect(() => {
    if (!institution || loadedKey !== storageKey) return;
    try {
      sessionStorage.setItem(storageKey, JSON.stringify({ turns: turns.slice(-30), shown: shown.slice(-60) }));
    } catch {
      // Storage full or blocked: the chat still works, it just won't survive a reload.
    }
  }, [turns, shown, storageKey, institution, loadedKey]);

  // Opening questions for the page in view, fetched when the panel opens empty.
  useEffect(() => {
    if (!open || turns.length) return;
    let live = true;
    assistantStarters(page)
      .then((r) => live && setStarters(r.questions.length ? r.questions : FALLBACK_STARTERS))
      .catch(() => live && setStarters(FALLBACK_STARTERS));
    return () => {
      live = false;
    };
  }, [open, page, turns.length]);

  // Ctrl/Cmd+J toggles the panel; Escape closes it.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "j") {
        e.preventDefault();
        setOpen((v) => !v);
      } else if (e.key === "Escape" && open) {
        setOpen(false);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 150);
  }, [open]);

  // Follow the answer as it streams, unless the reader has scrolled up.
  useEffect(() => {
    if (atBottom) scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [turns, atBottom, open]);

  // Grow the box with what's typed, up to a limit.
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }, [input]);

  const ask = useCallback(
    async (text: string, base: Turn[] = turns) => {
      const message = text.trim().slice(0, MAX_CHARS);
      if (!message || busy) return;
      const history: AssistantTurn[] = base
        .filter((t) => t.content && t.status !== "error")
        .map((t) => ({ role: t.role, content: t.content }));
      const answerId = newId();
      setTurns([...base, { id: newId(), role: "user", content: message }, { id: answerId, role: "assistant", content: "", status: "streaming" }]);
      setInput("");
      setAtBottom(true);

      const patch = (fn: (t: Turn) => Turn) => setTurns((prev) => prev.map((t) => (t.id === answerId ? fn(t) : t)));
      const controller = new AbortController();
      abortRef.current = controller;
      try {
        await streamAssistant({ message, history, shown }, (event) => {
          if (event.type === "delta") patch((t) => ({ ...t, content: t.content + event.text }));
          else if (event.type === "done") {
            patch((t) => ({ ...t, status: "done", engine: event.engine, notice: event.notice, suggestions: event.suggestions }));
            setShown((prev) => [...prev, ...event.suggestions]);
          } else patch((t) => ({ ...t, status: "error", content: t.content || event.message }));
        }, controller.signal);
        patch((t) => (t.status === "streaming" ? { ...t, status: "done" } : t));
      } catch (err) {
        if (controller.signal.aborted) patch((t) => ({ ...t, status: "stopped" }));
        else
          patch((t) => ({
            ...t,
            status: "error",
            content: t.content || (err instanceof Error ? err.message : "Fable couldn't answer just now."),
          }));
      } finally {
        abortRef.current = null;
      }
    },
    [busy, shown, turns],
  );

  /** Ask the last question again, replacing the answer it got. */
  function retry() {
    const lastUser = turns.findLastIndex((t) => t.role === "user");
    if (lastUser < 0) return;
    ask(turns[lastUser].content, turns.slice(0, lastUser));
  }

  function newChat() {
    abortRef.current?.abort();
    setTurns([]);
    setShown([]);
    setInput("");
    inputRef.current?.focus();
  }

  const lastAnswer = turns.findLast((t) => t.role === "assistant");

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Ask Fable"
        title="Ask Fable (Ctrl+J)"
        className={`fixed bottom-[max(1.25rem,env(safe-area-inset-bottom))] right-4 z-40 flex size-14 items-center justify-center gap-2 rounded-full bg-brand text-[13px] font-semibold text-white shadow-[0_14px_30px_-10px_rgba(124,58,237,0.8)] transition-all duration-300 print:hidden sm:right-5 sm:h-12 sm:w-auto sm:px-5 ${
          open ? "pointer-events-none translate-y-4 scale-95 opacity-0" : "pointer-events-auto hover:brightness-110"
        }`}
      >
        <Sparkle size={20} weight="fill" />
        <span className="hidden sm:inline">Ask Fable</span>
      </button>

      <section
        role="dialog"
        aria-label="Ask Fable"
        aria-hidden={!open}
        className={`fixed inset-0 z-50 flex flex-col overflow-hidden bg-d-surface transition-all duration-300 print:hidden sm:inset-auto sm:bottom-5 sm:right-5 sm:max-h-[calc(100dvh-2.5rem)] sm:origin-bottom-right sm:rounded-[22px] sm:border sm:border-d-border sm:shadow-[0_30px_70px_-20px_rgba(20,10,60,0.45)] ${
          wide ? "sm:h-[min(760px,calc(100dvh-2.5rem))] sm:w-[min(720px,calc(100vw-2.5rem))]" : "sm:h-[600px] sm:w-[410px]"
        } ${open ? "pointer-events-auto translate-y-0 opacity-100 sm:scale-100" : "pointer-events-none translate-y-6 opacity-0 sm:scale-95"}`}
      >
        <header className="flex items-center gap-3 border-b border-d-border px-4 pb-3 pt-[max(0.875rem,env(safe-area-inset-top))]">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-brand text-white">
            <Sparkle size={17} weight="fill" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-[14px] font-semibold text-d-text">Ask Fable</p>
            <p className="truncate text-[11px] text-d-muted">Answers from your institution&apos;s data only</p>
          </div>
          {turns.length > 0 && <HeaderButton label="New chat" onClick={newChat}><NotePencil size={18} /></HeaderButton>}
          <span className="hidden sm:block">
            <HeaderButton label={wide ? "Shrink" : "Expand"} onClick={() => setWide((v) => !v)}>
              {wide ? <ArrowsIn size={18} /> : <ArrowsOut size={18} />}
            </HeaderButton>
          </span>
          <HeaderButton label="Close" onClick={() => setOpen(false)}><X size={18} /></HeaderButton>
        </header>

        <div
          ref={scrollRef}
          onScroll={(e) => {
            const el = e.currentTarget;
            setAtBottom(el.scrollHeight - el.scrollTop - el.clientHeight < 48);
          }}
          aria-live="polite"
          className="relative flex-1 overflow-y-auto overscroll-contain px-4 py-4"
        >
          {turns.length === 0 ? (
            <div className="mx-auto flex max-w-[480px] flex-col items-center px-2 pb-2 pt-6 text-center">
              <span className="mb-4 flex size-12 items-center justify-center rounded-2xl bg-brand/10 text-brand">
                <Sparkle size={24} weight="fill" />
              </span>
              <h3 className="mb-1 text-[16px] font-semibold text-d-text">What would you like to know?</h3>
              <p className="max-w-[300px] text-[13px] leading-relaxed text-d-muted">
                Ask about your fraud activity, the review queue, scam patterns or a specific decision.
              </p>
              <div className="mt-6 grid w-full gap-2">
                {(starters ?? []).map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => ask(s)}
                    className="flex items-center gap-3 rounded-xl border border-d-border px-3.5 py-3 text-left text-[13px] font-medium text-d-text transition-colors hover:border-brand/40 hover:bg-brand/[0.05]"
                  >
                    <Sparkle size={14} className="shrink-0 text-brand" />
                    {s}
                  </button>
                ))}
                {!starters && [0, 1, 2].map((i) => <div key={i} className="h-11 animate-pulse rounded-xl bg-d-surface-2" />)}
              </div>
            </div>
          ) : (
            <div className={`mx-auto flex flex-col gap-4 ${wide ? "max-w-[620px]" : ""}`}>
              {turns.map((t) =>
                t.role === "user" ? (
                  <div key={t.id} className="flex justify-end">
                    <div className="max-w-[85%] whitespace-pre-wrap break-words rounded-2xl rounded-br-md bg-brand px-4 py-2.5 text-[13px] leading-relaxed text-white">
                      {t.content}
                    </div>
                  </div>
                ) : (
                  <Answer
                    key={t.id}
                    turn={t}
                    latest={t.id === lastAnswer?.id}
                    onRetry={retry}
                    onAsk={(q) => ask(q)}
                  />
                ),
              )}
            </div>
          )}
          {!atBottom && busy && (
            <button
              type="button"
              onClick={() => setAtBottom(true)}
              className="sticky bottom-0 mx-auto flex w-fit items-center gap-1 rounded-full border border-d-border bg-d-surface px-3 py-1.5 text-[12px] font-semibold text-d-text shadow"
            >
              <ArrowDown size={12} /> Latest
            </button>
          )}
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            ask(input);
          }}
          className="border-t border-d-border px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3"
        >
          <div className={`mx-auto flex items-end gap-2 ${wide ? "max-w-[620px]" : ""}`}>
            <textarea
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value.slice(0, MAX_CHARS))}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  ask(input);
                }
              }}
              placeholder="Ask about your data"
              aria-label="Ask about your data"
              rows={1}
              className="min-h-[44px] w-full resize-none rounded-xl border border-d-border bg-d-surface-2 px-4 py-3 text-[14px] text-d-text outline-none transition-shadow placeholder:text-d-faint focus:border-brand/50 focus:ring-4 focus:ring-brand/10 sm:text-[13px]"
            />
            {busy ? (
              <button
                type="button"
                onClick={() => abortRef.current?.abort()}
                aria-label="Stop answering"
                className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-d-text text-d-surface transition-all hover:opacity-90"
              >
                <Stop size={16} weight="fill" />
              </button>
            ) : (
              <button
                type="submit"
                disabled={!input.trim()}
                aria-label="Send"
                className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-brand text-white transition-all hover:brightness-110 disabled:opacity-40"
              >
                <PaperPlaneRight size={17} weight="fill" />
              </button>
            )}
          </div>
          <p className={`mx-auto mt-1.5 flex justify-between gap-2 px-1 text-[10.5px] text-d-faint ${wide ? "max-w-[620px]" : ""}`}>
            <span>Check figures before acting on them.</span>
            {input.length > MAX_CHARS * 0.8 && <span className="tabular-nums">{input.length}/{MAX_CHARS}</span>}
          </p>
        </form>
      </section>
    </>
  );
}

function HeaderButton({ label, onClick, children }: { label: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className="flex size-9 shrink-0 items-center justify-center rounded-xl text-d-muted transition-colors hover:bg-d-surface-2 hover:text-d-text"
    >
      {children}
    </button>
  );
}

/** One answer: the text as it streams, then copy, retry and follow-ups. */
function Answer({ turn, latest, onRetry, onAsk }: { turn: Turn; latest: boolean; onRetry: () => void; onAsk: (q: string) => void }) {
  const [copied, setCopied] = useState(false);
  const streaming = turn.status === "streaming";
  const failed = turn.status === "error";

  return (
    <div className="flex flex-col items-start gap-2">
      <div
        className={`max-w-[92%] rounded-2xl rounded-bl-md px-4 py-2.5 text-[13px] leading-relaxed ${
          failed ? "bg-red-500/10 text-red-700 dark:text-red-300" : "bg-d-surface-2 text-d-text"
        }`}
      >
        {turn.content ? (
          <div className="ask-md break-words">
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              // Answers are plain prose: no images, tables, headings or links.
              allowedElements={["p", "strong", "em", "ul", "ol", "li", "code", "br", "del"]}
              unwrapDisallowed
            >
              {turn.content}
            </ReactMarkdown>
            {streaming && <span className="ml-0.5 inline-block h-3.5 w-1.5 translate-y-0.5 animate-pulse rounded-sm bg-brand" />}
          </div>
        ) : (
          <span className="flex gap-1 py-1" aria-label="Fable is thinking">
            {[0, 150, 300].map((d) => (
              <span key={d} className="size-1.5 animate-bounce rounded-full bg-d-faint" style={{ animationDelay: `${d}ms` }} />
            ))}
          </span>
        )}
        {turn.status === "stopped" && <p className="mt-1.5 text-[11px] italic text-d-muted">Stopped</p>}
        {turn.notice && !streaming && (
          <p className="mt-2 border-t border-d-border pt-2 text-[11px] leading-relaxed text-d-muted">{turn.notice}</p>
        )}
      </div>

      {!streaming && turn.content && (
        <div className="flex items-center gap-1 pl-1 text-[11px] text-d-faint">
          {!failed && (
            <>
              <span className="mr-1">{turn.engine === "openai" || turn.engine === "anthropic" ? "AI answer" : "From your figures"}</span>
              <button
                type="button"
                onClick={() => navigator.clipboard.writeText(turn.content).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); })}
                aria-label="Copy answer"
                title="Copy"
                className="flex size-7 items-center justify-center rounded-lg hover:bg-d-surface-2 hover:text-d-text"
              >
                {copied ? <Check size={13} /> : <Copy size={13} />}
              </button>
            </>
          )}
          {latest && (
            <button
              type="button"
              onClick={onRetry}
              aria-label="Ask again"
              title="Ask again"
              className={`flex h-7 items-center gap-1 rounded-lg px-1.5 hover:bg-d-surface-2 hover:text-d-text ${failed ? "font-semibold text-d-text" : ""}`}
            >
              <ArrowClockwise size={13} /> {failed && "Try again"}
            </button>
          )}
        </div>
      )}

      {latest && !streaming && !!turn.suggestions?.length && (
        <div className="flex flex-wrap gap-1.5">
          {turn.suggestions.map((q) => (
            <button
              key={q}
              type="button"
              onClick={() => onAsk(q)}
              className="rounded-full border border-brand/25 bg-brand/[0.06] px-3 py-1.5 text-left text-[12px] font-medium text-brand transition-colors hover:bg-brand/15"
            >
              {q}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
