import type { ReactNode } from "react";

/**
 * Small dependency-free syntax highlighter for the API examples.
 *
 * It only understands the three shapes the site actually shows: JSON bodies,
 * shell (curl) commands and a bare HTTP request line followed by a JSON body.
 * A general highlighter would be hundreds of kilobytes for three grammars, and
 * the output is static, so a few ordered regexes are enough.
 *
 * Colors are fixed rather than themed. Code always sits on a dark surface, in
 * both the marketing site and the docs, so the palette never has to flip.
 */

type TokenKind =
  | "key"
  | "string"
  | "number"
  | "literal"
  | "punct"
  | "comment"
  | "command"
  | "flag"
  | "url"
  | "method"
  | "path"
  | "header"
  | "plain";

const TOKEN_CLASS: Record<TokenKind, string> = {
  key: "text-[#c4a6ff]",
  string: "text-[#00f5a0]",
  number: "text-[#ffb547]",
  literal: "text-[#ff7ab2]",
  punct: "text-white/50",
  comment: "text-white/40 italic",
  command: "text-[#ff7ab2] font-semibold",
  flag: "text-[#a795fe]",
  url: "text-[#7dd3fc]",
  method: "text-[#ff7ab2] font-semibold",
  path: "text-[#7dd3fc]",
  header: "text-[#a795fe]",
  plain: "text-white/90",
};

interface Rule {
  kind: TokenKind;
  re: RegExp;
}

// Every rule is sticky so the scanner only ever matches at the cursor. Order
// matters: the first rule that matches wins, so specific shapes go first.
const JSON_RULES: Rule[] = [
  { kind: "key", re: /"(?:[^"\\]|\\.)*"(?=\s*:)/y },
  { kind: "string", re: /"(?:[^"\\]|\\.)*"/y },
  { kind: "number", re: /-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/y },
  { kind: "literal", re: /\b(?:true|false|null)\b/y },
  { kind: "punct", re: /[{}[\],:]/y },
];

const SHELL_RULES: Rule[] = [
  { kind: "comment", re: /#[^\n]*/y },
  { kind: "string", re: /'(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"/y },
  { kind: "command", re: /\bcurl\b/y },
  { kind: "flag", re: /(?<=\s)--?[A-Za-z][\w-]*/y },
  { kind: "url", re: /https?:\/\/[^\s'"\\]+/y },
  { kind: "punct", re: /\\(?=\n)/y },
];

const HTTP_RULES: Rule[] = [
  { kind: "method", re: /^(?:GET|POST|PUT|PATCH|DELETE)(?=\s)/my },
  { kind: "path", re: /(?<=^(?:GET|POST|PUT|PATCH|DELETE) )\S+/my },
  { kind: "header", re: /^[A-Za-z-]+(?=:)/my },
  { kind: "string", re: /(?<=: ).*/y },
];

function scan(code: string, rules: Rule[], keyPrefix: string): ReactNode[] {
  const out: ReactNode[] = [];
  let plain = "";
  let i = 0;
  let n = 0;

  const flush = () => {
    if (plain) {
      out.push(plain);
      plain = "";
    }
  };

  while (i < code.length) {
    let matched = false;
    for (const { kind, re } of rules) {
      re.lastIndex = i;
      const m = re.exec(code);
      if (m && m[0].length > 0) {
        flush();
        out.push(
          <span key={`${keyPrefix}${n++}`} className={TOKEN_CLASS[kind]}>
            {m[0]}
          </span>,
        );
        i += m[0].length;
        matched = true;
        break;
      }
    }
    if (!matched) {
      plain += code[i];
      i += 1;
    }
  }
  flush();
  return out;
}

export function highlight(code: string, lang: string): ReactNode {
  const language = lang.toLowerCase();

  if (language === "json") return scan(code, JSON_RULES, "j");

  if (language === "bash" || language === "sh" || language === "shell") {
    return scan(code, SHELL_RULES, "s");
  }

  if (language === "http") {
    // A request line, optional headers, then a JSON body starting at the first
    // line that opens an object or array.
    const lines = code.split("\n");
    const bodyAt = lines.findIndex((line) => /^\s*[{[]/.test(line));
    if (bodyAt === -1) return scan(code, HTTP_RULES, "h");
    const head = lines.slice(0, bodyAt).join("\n");
    const body = lines.slice(bodyAt).join("\n");
    return (
      <>
        {scan(head, HTTP_RULES, "h")}
        {"\n"}
        {scan(body, JSON_RULES, "b")}
      </>
    );
  }

  return code;
}

interface CodeBlockProps {
  code: string;
  lang?: string;
  /** Small caption in the top-left, e.g. "Request". */
  label?: string;
  className?: string;
}

export function CodeBlock({ code, lang = "json", label, className = "" }: CodeBlockProps) {
  return (
    <figure
      className={`overflow-hidden rounded-[var(--radius-m)] border border-white/10 bg-[#0e0e13] ${className}`.trim()}
    >
      {label && (
        <figcaption className="flex items-center justify-between border-b border-white/10 px-5 py-2.5 text-2xs font-semibold uppercase tracking-wider text-white/50">
          <span>{label}</span>
          <span className="font-mono normal-case tracking-normal text-white/30">{lang}</span>
        </figcaption>
      )}
      <pre className="overflow-x-auto p-5 text-xs leading-relaxed">
        <code className="font-mono">{highlight(code.replace(/\n$/, ""), lang)}</code>
      </pre>
    </figure>
  );
}
