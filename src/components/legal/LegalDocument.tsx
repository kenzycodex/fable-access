import Link from "next/link";
import { Breadcrumb } from "@/components/ui/Breadcrumb";
import { Container, Section } from "@/components/ui/Section";
import type { LegalBlock, LegalDocument as LegalDocumentData } from "@/data/legal";

// Renders a Privacy Notice or Terms of Service from data. Server component:
// there is no interactivity beyond in-page anchors, so nothing here ships JS.

function Block({ block }: { block: LegalBlock }) {
  switch (block.type) {
    case "p":
      return <p className="text-m leading-relaxed text-black/80">{block.text}</p>;

    case "list":
      return (
        <ul className="flex list-disc flex-col gap-2.5 pl-6 text-m leading-relaxed text-black/80 marker:text-secondary">
          {block.items.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      );

    case "note":
      return (
        <div className="rounded-[var(--radius-s)] border-l-4 border-secondary bg-tertiary px-5 py-4 text-s leading-relaxed text-black/80">
          {block.text}
        </div>
      );

    case "table":
      return (
        <div className="overflow-x-auto rounded-[var(--radius-s)] border border-black/10">
          <table className="w-full min-w-[520px] border-collapse text-left text-s">
            <thead className="bg-light">
              <tr>
                {block.head.map((h) => (
                  <th key={h} className="border-b border-black/10 px-4 py-3 font-bold text-black">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {block.rows.map((row) => (
                <tr key={row[0]} className="align-top">
                  {row.map((cell, i) => (
                    <td
                      key={i}
                      className={`border-b border-black/5 px-4 py-3 leading-relaxed text-black/75 ${
                        i === 0 ? "font-semibold text-black" : ""
                      }`}
                    >
                      {cell}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
  }
}

export function LegalDocumentView({
  doc,
  crumb,
  sibling,
}: {
  doc: LegalDocumentData;
  crumb: string;
  sibling: { label: string; href: string };
}) {
  return (
    <>
      <section
        className="bg-base px-[var(--gutter)] pb-[var(--section-space-s)] text-white"
        style={{ paddingTop: "calc(var(--header-height, 90px) + var(--spacing-m))" }}
      >
        <Container>
          <Breadcrumb items={[{ label: "Home", href: "/" }, { label: crumb }]} className="mb-[var(--spacing-m)] text-white" />
          <h1>{doc.title}</h1>
          <p className="mt-[var(--spacing-s)] max-w-[760px] text-l text-white/85">{doc.summary}</p>
          <p className="mt-[var(--spacing-s)] text-xs text-white/60">
            Effective {doc.effective} · Version {doc.version} ·{" "}
            <Link href={sibling.href} className="underline underline-offset-2 hover:text-secondary">
              {sibling.label}
            </Link>
          </p>
        </Container>
      </section>

      <Section space="m">
        <Container>
          <div className="grid grid-cols-1 gap-[var(--spacing-l)] lg:grid-cols-[260px_minmax(0,1fr)] lg:gap-[var(--spacing-xl)]">
            <nav aria-label={`${doc.title} contents`} className="lg:sticky lg:top-[calc(var(--header-height,90px)+24px)] lg:self-start">
              <p className="mb-3 text-xs font-bold uppercase tracking-wider text-black/50">On this page</p>
              <ol className="flex flex-col gap-1 border-l border-black/10">
                {doc.sections.map((section) => (
                  <li key={section.id}>
                    <a
                      href={`#${section.id}`}
                      className="-ml-px block border-l-2 border-transparent py-1.5 pl-4 text-s text-black/65 transition-colors hover:border-secondary hover:text-black"
                    >
                      {section.title}
                    </a>
                  </li>
                ))}
              </ol>
            </nav>

            <article className="flex max-w-[860px] flex-col gap-[var(--spacing-l)]">
              {doc.sections.map((section) => (
                <section
                  key={section.id}
                  id={section.id}
                  className="flex scroll-mt-[calc(var(--header-height,90px)+24px)] flex-col gap-[var(--spacing-xs)]"
                >
                  <h2 className="text-h5">{section.title}</h2>
                  {section.blocks.map((block, i) => (
                    <Block key={i} block={block} />
                  ))}
                </section>
              ))}
            </article>
          </div>
        </Container>
      </Section>
    </>
  );
}
