import fs from "node:fs/promises";
import path from "node:path";
import type { Metadata } from "next";
import { DocsShell, type DocSection } from "@/components/docs/DocsShell";

export const metadata: Metadata = {
  title: "Documentation | Fable",
  description:
    "How Fable scores transfers, contains risky ones, and binds money-moving decisions to a real person.",
};

const DOCS_DIR = path.join(process.cwd(), "src", "content", "docs");

/** Turn a heading into a stable anchor. Mirrors the slugging the renderer
 * applies, so sidebar links and rendered headings always agree. */
export function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\w\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-");
}

/** Read the docs at build time. Filenames are numbered so ordering is explicit
 * rather than alphabetical-by-accident. */
async function loadDocs(): Promise<DocSection[]> {
  const files = (await fs.readdir(DOCS_DIR)).filter((f) => f.endsWith(".md")).sort();

  return Promise.all(
    files.map(async (file) => {
      const raw = await fs.readFile(path.join(DOCS_DIR, file), "utf8");
      const title = raw.match(/^#\s+(.+)$/m)?.[1] ?? file.replace(/\.md$/, "");
      // Sub-headings become the in-page nav for that section.
      const headings = [...raw.matchAll(/^##\s+(.+)$/gm)].map((m) => ({
        title: m[1],
        slug: slugify(m[1]),
      }));
      return {
        id: slugify(title),
        title,
        body: raw,
        headings,
      };
    }),
  );
}

export default async function DocsPage() {
  return <DocsShell sections={await loadDocs()} />;
}
