"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ArrowLeft, List, X } from "@phosphor-icons/react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

export interface DocSection {
  id: string;
  title: string;
  body: string;
  headings: { title: string; slug: string }[];
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\w\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-");
}

/**
 * Documentation shell: persistent contents rail, one scrolling column, and a
 * heading that highlights itself as you pass it.
 *
 * All sections render on one page rather than as separate routes. The set is
 * small and heavily cross-referenced, so a single page keeps browser search
 * working across the whole thing and makes every link an in-page jump.
 */
export function DocsShell({ sections }: { sections: DocSection[] }) {
  const [active, setActive] = useState(sections[0]?.id ?? "");
  const [navOpen, setNavOpen] = useState(false);

  useEffect(() => {
    // rootMargin pins the "current" heading near the top of the viewport;
    // without it a heading counts as visible while still at the bottom.
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
        if (visible?.target.id) setActive(visible.target.id);
      },
      { rootMargin: "-80px 0px -70% 0px", threshold: 0 },
    );

    document.querySelectorAll("[data-doc-anchor]").forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, [sections]);

  return (
    <div className="min-h-dvh bg-white text-gray-900 dark:bg-[#08080b] dark:text-white">
      {/* Top bar */}
      <header className="sticky top-0 z-40 border-b border-gray-200 bg-white/90 backdrop-blur-xl dark:border-white/[0.06] dark:bg-[#08080b]/90">
        <div className="mx-auto flex max-w-6xl items-center gap-3 px-5 py-3.5">
          <Link
            href="/"
            className="flex items-center gap-2 text-[13px] font-semibold text-gray-500 transition-colors hover:text-gray-900 dark:text-white/45 dark:hover:text-white"
          >
            <ArrowLeft size={15} weight="bold" />
            Fable
          </Link>
          <span className="text-gray-300 dark:text-white/15">/</span>
          <span className="text-[13px] font-bold">Documentation</span>

          <button
            type="button"
            onClick={() => setNavOpen(!navOpen)}
            aria-label="Contents"
            className="ml-auto flex size-9 items-center justify-center rounded-lg border border-gray-200 text-gray-500 lg:hidden dark:border-white/[0.08] dark:text-white/50"
          >
            {navOpen ? <X size={16} /> : <List size={16} />}
          </button>
        </div>
      </header>

      <div className="mx-auto flex max-w-6xl gap-10 px-5">
        {/* Contents */}
        <aside
          className={`${
            navOpen ? "block" : "hidden"
          } fixed inset-x-0 top-[57px] z-30 max-h-[70dvh] overflow-y-auto border-b border-gray-200 bg-white p-5 dark:border-white/[0.06] dark:bg-[#08080b] lg:sticky lg:top-[57px] lg:block lg:h-[calc(100dvh-57px)] lg:w-60 lg:shrink-0 lg:border-0 lg:bg-transparent lg:p-0 lg:pt-8 dark:lg:bg-transparent`}
        >
          <nav className="flex flex-col gap-0.5">
            {sections.map((section) => (
              <div key={section.id} className="flex flex-col">
                <a
                  href={`#${section.id}`}
                  onClick={() => setNavOpen(false)}
                  className={`rounded-lg px-3 py-2 text-[13px] font-semibold transition-colors ${
                    active === section.id
                      ? "bg-[#7C3AED]/10 text-[#7C3AED]"
                      : "text-gray-600 hover:bg-gray-100 dark:text-white/50 dark:hover:bg-white/[0.04]"
                  }`}
                >
                  {section.title}
                </a>
                {active === section.id && section.headings.length > 0 && (
                  <div className="ml-3 flex flex-col gap-0.5 border-l border-gray-200 pl-3 dark:border-white/[0.08]">
                    {section.headings.map((h) => (
                      <a
                        key={h.slug}
                        href={`#${h.slug}`}
                        onClick={() => setNavOpen(false)}
                        className="rounded px-2 py-1 text-[12px] text-gray-500 transition-colors hover:text-gray-900 dark:text-white/35 dark:hover:text-white/70"
                      >
                        {h.title}
                      </a>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </nav>
        </aside>

        {/* Content */}
        <main className="min-w-0 flex-1 py-10">
          {sections.map((section) => (
            <section key={section.id} id={section.id} data-doc-anchor className="scroll-mt-20">
              <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                components={{
                  h1: ({ children }) => (
                    <h1 className="mb-6 mt-14 border-b border-gray-200 pb-3 text-[30px] font-bold tracking-tight first:mt-0 dark:border-white/[0.06]">
                      {children}
                    </h1>
                  ),
                  h2: ({ children }) => {
                    const text = String(children);
                    return (
                      <h2
                        id={slugify(text)}
                        data-doc-anchor
                        className="mb-3 mt-10 scroll-mt-20 text-[20px] font-bold tracking-tight"
                      >
                        {text}
                      </h2>
                    );
                  },
                  h3: ({ children }) => (
                    <h3 className="mb-2 mt-7 text-[15px] font-bold">{children}</h3>
                  ),
                  p: ({ children }) => (
                    <p className="mb-4 text-[14px] leading-[1.75] text-gray-700 dark:text-white/65">
                      {children}
                    </p>
                  ),
                  ul: ({ children }) => (
                    <ul className="mb-4 ml-5 list-disc space-y-1.5 text-[14px] leading-[1.7] text-gray-700 dark:text-white/65">
                      {children}
                    </ul>
                  ),
                  ol: ({ children }) => (
                    <ol className="mb-4 ml-5 list-decimal space-y-1.5 text-[14px] leading-[1.7] text-gray-700 dark:text-white/65">
                      {children}
                    </ol>
                  ),
                  strong: ({ children }) => (
                    <strong className="font-semibold text-gray-900 dark:text-white">{children}</strong>
                  ),
                  a: ({ href, children }) => (
                    <a href={href} className="font-medium text-[#7C3AED] underline underline-offset-2">
                      {children}
                    </a>
                  ),
                  // Fenced blocks arrive as <pre><code>; the inline case is
                  // styled as a chip instead.
                  code: ({ className, children }) =>
                    className?.includes("language-") ? (
                      <code className="block font-mono text-[12.5px] leading-relaxed">{children}</code>
                    ) : (
                      <code className="rounded bg-gray-100 px-1.5 py-0.5 font-mono text-[12.5px] text-[#7C3AED] dark:bg-white/[0.07]">
                        {children}
                      </code>
                    ),
                  pre: ({ children }) => (
                    <pre className="mb-5 overflow-x-auto rounded-xl border border-gray-200 bg-gray-50 p-4 dark:border-white/[0.06] dark:bg-[#0e0e13]">
                      {children}
                    </pre>
                  ),
                  // Tables carry most of the reference material, so they get
                  // their own scroll container rather than widening the page.
                  table: ({ children }) => (
                    <div className="mb-5 overflow-x-auto rounded-xl border border-gray-200 dark:border-white/[0.06]">
                      <table className="w-full border-collapse text-[13px]">{children}</table>
                    </div>
                  ),
                  thead: ({ children }) => (
                    <thead className="bg-gray-50 dark:bg-white/[0.03]">{children}</thead>
                  ),
                  th: ({ children }) => (
                    <th className="border-b border-gray-200 px-3.5 py-2.5 text-left font-bold dark:border-white/[0.06]">
                      {children}
                    </th>
                  ),
                  td: ({ children }) => (
                    <td className="border-b border-gray-100 px-3.5 py-2.5 align-top text-gray-700 last:border-0 dark:border-white/[0.04] dark:text-white/65">
                      {children}
                    </td>
                  ),
                  blockquote: ({ children }) => (
                    <blockquote className="mb-5 border-l-2 border-[#7C3AED]/40 bg-[#7C3AED]/[0.04] py-2 pl-4 text-[13px] text-gray-600 dark:text-white/55">
                      {children}
                    </blockquote>
                  ),
                }}
              >
                {section.body}
              </ReactMarkdown>
            </section>
          ))}

          <footer className="mt-16 border-t border-gray-200 pt-6 text-[12px] text-gray-400 dark:border-white/[0.06] dark:text-white/25">
            Interactive OpenAPI spec at <code className="font-mono">/docs</code> on the API host.
          </footer>
        </main>
      </div>
    </div>
  );
}
