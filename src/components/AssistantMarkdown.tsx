import { isValidElement, useState, type ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import type { Root } from "mdast";
import { visit } from "unist-util-visit";
import type { Plugin } from "unified";
import remarkGfm from "remark-gfm";
import { Check, Copy } from "lucide-react";

const remarkUnderline: Plugin<[], Root> = () => (tree, file) => {
  const source = String(file.value ?? "");
  visit(tree, "emphasis", (node) => {
    const offset = node.position?.start.offset;
    if (offset !== undefined && source[offset] === "_") {
      node.data = { ...node.data, hName: "u" };
    }
  });
};

const languageKeywords: Record<string, Set<string>> = {
  bash: new Set([
    "case", "do", "done", "elif", "else", "esac", "fi", "for", "function", "if", "in", "then",
    "while",
  ]),
  css: new Set(["@media", "@import", "@keyframes", "important"]),
  html: new Set(["doctype"]),
  javascript: new Set([
    "async", "await", "break", "case", "catch", "class", "const", "continue", "default", "else",
    "export", "extends", "false", "finally", "for", "from", "function", "if", "import", "in",
    "let", "new", "null", "of", "return", "static", "super", "switch", "this", "throw", "true",
    "try", "typeof", "undefined", "var", "while",
  ]),
  json: new Set(["false", "null", "true"]),
  python: new Set([
    "and", "as", "assert", "async", "await", "class", "def", "elif", "else", "except", "False",
    "finally", "for", "from", "if", "import", "in", "is", "lambda", "None", "not", "or", "pass",
    "raise", "return", "True", "try", "while", "with", "yield",
  ]),
  sql: new Set([
    "alter", "and", "as", "by", "case", "create", "delete", "distinct", "drop", "else", "end",
    "from", "group", "having", "in", "insert", "into", "is", "join", "left", "limit", "not",
    "null", "on", "or", "order", "outer", "primary", "references", "select", "set", "table",
    "then", "union", "update", "values", "when", "where",
  ]),
  typescript: new Set([
    "async", "await", "break", "case", "catch", "class", "const", "continue", "default", "else",
    "export", "extends", "false", "finally", "for", "from", "function", "if", "implements",
    "import", "in", "interface", "let", "new", "null", "of", "private", "protected", "public",
    "readonly", "return", "static", "super", "switch", "this", "throw", "true", "try", "type",
    "typeof", "undefined", "var", "while",
  ]),
};

const tokenPattern =
  /\/\*[\s\S]*?\*\/|\/\/[^\n]*|--[^\n]*|#[^\n]*|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`|\b\d+(?:\.\d+)?\b|[A-Za-z_$@][\w$@-]*/g;

function highlightCode(source: string, language: string): ReactNode[] {
  const keywords = languageKeywords[language] ?? languageKeywords.javascript;
  const output: ReactNode[] = [];
  let lastIndex = 0;

  for (const match of source.matchAll(tokenPattern)) {
    const token = match[0];
    const index = match.index;
    if (index > lastIndex) output.push(source.slice(lastIndex, index));

    let color = "text-[#e6edf3]";
    if (
      token.startsWith("//") ||
      token.startsWith("/*") ||
      token.startsWith("--") ||
      token.startsWith("#")
    ) {
      color = "text-[#8b949e]";
    } else if (/^["'`]/.test(token)) {
      color = "text-[#a5d6ff]";
    } else if (/^\d/.test(token)) {
      color = "text-[#79c0ff]";
    } else if (keywords.has(token) || keywords.has(token.toLowerCase())) {
      color = "text-[#ff7b72]";
    } else if (/^[A-Z]/.test(token)) {
      color = "text-[#ffa657]";
    } else if (/^[A-Za-z_$]/.test(token)) {
      color = "text-[#d2a8ff]";
    }
    output.push(
      <span key={`${index}-${token}`} className={color}>
        {token}
      </span>,
    );
    lastIndex = index + token.length;
  }

  if (lastIndex < source.length) output.push(source.slice(lastIndex));
  return output;
}

function CodeBlock({ code, language }: { code: string; language: string }) {
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState("");
  const lines = code.replace(/\n$/, "").split("\n");

  async function copyCode() {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setCopyError("");
      window.setTimeout(() => setCopied(false), 1600);
    } catch (error) {
      console.error("Could not copy code block:", error);
      setCopyError(error instanceof Error ? error.message : "Clipboard access was denied.");
    }
  }

  return (
    <div className="my-3 max-w-full overflow-hidden rounded-xl bg-[#171a21] text-[12px] leading-5">
      <header className="flex h-7 items-center justify-between border-b border-white/10 px-2.5 text-[10px] text-[#9ba3af]">
        <span>{language || "code"}</span>
        <button
          type="button"
          aria-label={copied ? "Code copied" : "Copy code"}
          onClick={() => void copyCode()}
          className="flex size-6 items-center justify-center rounded hover:bg-white/10"
        >
          {copied ? (
            <Check aria-hidden="true" className="size-3.5 text-emerald-400" />
          ) : (
            <Copy aria-hidden="true" className="size-3.5" />
          )}
        </button>
      </header>
      <div className="overflow-x-auto">
        <div className="flex min-w-max py-2 font-mono">
          <div
            aria-hidden="true"
            className="sticky left-0 z-10 shrink-0 border-r border-white/10 bg-[#171a21] px-2.5 text-right text-[#6e7681] select-none"
          >
            {lines.map((_, index) => (
              <div key={index} className="h-5">
                {index + 1}
              </div>
            ))}
          </div>
          <pre className="m-0 px-3 text-[12px] leading-5">
            <code>{highlightCode(code, language)}</code>
          </pre>
        </div>
      </div>
      {copyError && (
        <p role="alert" className="border-t border-white/10 px-2.5 py-1 text-[10px] text-red-300">
          Could not copy code: {copyError}
        </p>
      )}
    </div>
  );
}

const markdownComponents = {
  a: ({ href, children }: { href?: string; children?: ReactNode }) => (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="text-[#278fca] underline underline-offset-2"
    >
      {children}
    </a>
  ),
  blockquote: ({ children }: { children?: ReactNode }) => (
    <blockquote className="my-3 border-l-2 border-[#d8dbe0] pl-3 text-[#656871]">{children}</blockquote>
  ),
  code: ({
    className,
    children,
  }: {
    className?: string;
    children?: ReactNode;
  }) => (
    <code
      className={
        className
          ? `${className} font-mono`
          : "rounded bg-[#f0f1f3] px-1.5 py-0.5 font-mono text-[0.9em] text-[#b33a57]"
      }
    >
      {children}
    </code>
  ),
  h1: ({ children }: { children?: ReactNode }) => (
    <h1 className="mb-2 mt-4 text-xl font-semibold text-[#23252a]">{children}</h1>
  ),
  h2: ({ children }: { children?: ReactNode }) => (
    <h2 className="mb-2 mt-4 text-lg font-semibold text-[#23252a]">{children}</h2>
  ),
  h3: ({ children }: { children?: ReactNode }) => (
    <h3 className="mb-1 mt-3 text-base font-semibold text-[#23252a]">{children}</h3>
  ),
  li: ({ children }: { children?: ReactNode }) => <li className="pl-1">{children}</li>,
  ol: ({ children }: { children?: ReactNode }) => (
    <ol className="my-2 list-decimal space-y-1 pl-6">{children}</ol>
  ),
  p: ({ children }: { children?: ReactNode }) => (
    <p className="my-2 whitespace-pre-wrap leading-6 last:mb-0">{children}</p>
  ),
  pre: ({ children }: { children?: ReactNode }) => {
    if (!isValidElement<{ className?: string; children?: ReactNode }>(children)) {
      return <pre className="my-3 overflow-x-auto">{children}</pre>;
    }
    const code = typeof children.props.children === "string" ? children.props.children : "";
    const language = children.props.className?.match(/language-([\w-]+)/)?.[1] ?? "";
    return <CodeBlock code={code} language={language} />;
  },
  ul: ({ children }: { children?: ReactNode }) => (
    <ul className="my-2 list-disc space-y-1 pl-6">{children}</ul>
  ),
};

export function AssistantMarkdown({
  content,
  userMessage = false,
}: {
  content: string;
  userMessage?: boolean;
}) {
  return (
    <div
      className={
        userMessage
          ? "text-white [&_p:first-child]:mt-0 [&_h1]:text-white [&_h2]:text-white [&_h3]:text-white [&_blockquote]:border-white/40 [&_blockquote]:text-white/80"
          : "[&_p:first-child]:mt-0"
      }
    >
      <ReactMarkdown remarkPlugins={[remarkGfm, remarkUnderline]} components={markdownComponents}>
        {content}
      </ReactMarkdown>
    </div>
  );
}
