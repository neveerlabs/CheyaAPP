import {
  isValidElement,
  memo,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import ReactMarkdown from "react-markdown";
import type { Root } from "mdast";
import { visit } from "unist-util-visit";
import type { Plugin } from "unified";
import remarkGfm from "remark-gfm";
import { Check, Copy } from "lucide-react";
import { speechWordRanges } from "../lib/speech-text";

type WordRect = {
  top: number;
  left: number;
  width: number;
  height: number;
  text: string;
  font: string;
  letterSpacing: string;
  lineHeight: string;
};

function wordRangeAt(root: HTMLElement, wordIndex: number): Range | null {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const parent = node.parentElement;
      return parent?.closest("button,header,[aria-hidden='true']")
        ? NodeFilter.FILTER_REJECT
        : NodeFilter.FILTER_ACCEPT;
    },
  });
  const textNodes: Text[] = [];
  let currentNode: Node | null;
  while ((currentNode = walker.nextNode())) textNodes.push(currentNode as Text);

  const normalizedText: string[] = [];
  const positions: Array<{ node: Text; offset: number }> = [];
  let previousWasWhitespace = true;
  let previousBlock: Element | null = null;
  for (const textNode of textNodes) {
    const block = textNode.parentElement?.closest(
      "p,h1,h2,h3,h4,h5,h6,li,td,th,blockquote,pre",
    ) ?? root;
    if (previousBlock && block !== previousBlock && !previousWasWhitespace) {
      normalizedText.push(" ");
      positions.push({ node: textNode, offset: 0 });
      previousWasWhitespace = true;
    }
    for (let offset = 0; offset < textNode.length; offset += 1) {
      const character = textNode.data[offset];
      if (/\s/.test(character)) {
        if (!previousWasWhitespace) {
          normalizedText.push(" ");
          positions.push({ node: textNode, offset });
        }
        previousWasWhitespace = true;
      } else {
        normalizedText.push(character);
        positions.push({ node: textNode, offset });
        previousWasWhitespace = false;
      }
    }
    previousBlock = block;
  }

  const text = normalizedText.join("");
  const words = speechWordRanges(text);
  const word = words[wordIndex];
  if (!word || !positions[word.start] || !positions[word.end - 1]) return null;

  const range = document.createRange();
  range.setStart(positions[word.start].node, positions[word.start].offset);
  range.setEnd(positions[word.end - 1].node, positions[word.end - 1].offset + 1);
  return range;
}

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
  /\/\*[\s\S]*?\*\/|\/\/[^\n]*|--[^\n]*|#[^\n]*|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`|\b\d+(?:\.\d+)?\b|[A-Za-z_$@][\w$@-]*|(?:===|!==|>>>|<<=|>>=|=>|==|!=|<=|>=|&&|\|\||\?\?|::|\+\+|--|\+=|-=|\*=|\/=|%=|<<|>>>|>>|[+\-*\/%=<>!&|^~?])|[()[\]{}.,;:]|\S/g;

function highlightCode(source: string, language: string): ReactNode[] {
  const keywords = languageKeywords[language] ?? languageKeywords.javascript;
  const output: ReactNode[] = [];
  let lastIndex = 0;

  for (const match of source.matchAll(tokenPattern)) {
    const token = match[0];
    const index = match.index;
    if (index > lastIndex) output.push(source.slice(lastIndex, index));

    let color = "text-[#e6edf3]";
    let emphasis = "";
    if (language === "json" && /^"/.test(token)) {
      if (/^\s*:/.test(source.slice(index + token.length))) {
        color = "text-[#8bd5ff]";
        emphasis = " font-semibold";
      } else {
        color = "text-[#a6e3a1]";
      }
    } else if (language === "json" && /^(?:true|false|null)$/.test(token)) {
      color = "text-[#ffad80]";
    } else if (
      token.startsWith("//") ||
      token.startsWith("/*") ||
      token.startsWith("--") ||
      token.startsWith("#")
    ) {
      color = "text-[#a6b0bf]";
    } else if (/^["'`]/.test(token)) {
      color = "text-[#a6e3ff]";
    } else if (/^\d/.test(token)) {
      color = language === "json" ? "text-[#ffd580]" : "text-[#8bd5ff]";
    } else if (keywords.has(token) || keywords.has(token.toLowerCase())) {
      color = "text-[#ff8f9c]";
    } else if (/^[A-Z]/.test(token)) {
      color = "text-[#ffbd7a]";
    } else if (/^[A-Za-z_$]/.test(token)) {
      color = "text-[#d6b4ff]";
    } else if (/^(?:===|!==|>>>|<<=|>>=|=>|==|!=|<=|>=|&&|\|\||\?\?|::|\+\+|--|\+=|-=|\*=|\/=|%=|<<|>>|[+\-*\/%=<>!&|^~?])$/.test(token)) {
      color = "text-[#68d8e8] font-semibold";
    } else if (/^[()[\]{}.,;:]$/.test(token)) {
      color = "text-[#ffd580] font-semibold";
    }
    output.push(
      <span key={`${index}-${token}`} className={`${color}${emphasis}`}>
        {token}
      </span>,
    );
    lastIndex = index + token.length;
  }

  if (lastIndex < source.length) output.push(source.slice(lastIndex));
  return output;
}

function previewDocument(source: string): string {
  const contentSecurityPolicy =
    "default-src 'none'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; media-src data: blob:; connect-src 'none'; script-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'";
  const policy = `<meta http-equiv="Content-Security-Policy" content="${contentSecurityPolicy}">`;
  return `<!doctype html><html><head>${policy}<meta name="viewport" content="width=device-width, initial-scale=1"></head><body>${source}</body></html>`;
}

function containsPlainHtml(content: string): boolean {
  const htmlPattern =
    /<\s*(?:!doctype\b|\/?(?:a|article|aside|b|body|br|button|canvas|caption|code|col|div|dl|dt|dd|em|fieldset|figcaption|figure|footer|form|h[1-6]|head|header|hr|html|i|iframe|img|input|label|li|link|main|meta|nav|ol|option|p|pre|script|section|select|small|span|strong|style|sub|sup|svg|table|tbody|td|textarea|tfoot|th|thead|title|tr|u|ul))\b[^<>]*>/i;
  const markdownPattern =
    /(^|\n)\s{0,3}(?:#{1,6}\s|>|\*{1,3}\s|_{1,3}\s|[-+]\s|\d+\.\s|```|~~~)|\[[^\]]+\]\([^)]+\)|\*\*[^*]+\*\*|__[^_]+__/;
  if (!htmlPattern.test(content) || markdownPattern.test(content)) return false;

  const outsideCode = content
    .replace(/```[\s\S]*?(?:```|$)|~~~[\s\S]*?(?:~~~|$)/g, "")
    .replace(/`+[^`\n]*`+/g, "");
  return htmlPattern.test(outsideCode);
}

function HtmlPreview({ document }: { document: string }) {
  return (
    <iframe
      title="HTML message preview"
      sandbox=""
      referrerPolicy="no-referrer"
      srcDoc={document}
      className="my-2 h-56 w-full rounded-lg border border-white/20 bg-white"
    />
  );
}

function getFencedCodeRanges(source: string): Array<{ start: number; end: number }> {
  const lines = source.split("\n");
  const ranges: Array<{ start: number; end: number }> = [];
  let offset = 0;
  let openFence: { character: string; length: number; start: number } | null = null;

  for (const [lineIndex, line] of lines.entries()) {
    const fence = line.match(/^ {0,3}(`{3,}|~{3,})/);
    if (!openFence && fence) {
      openFence = {
        character: fence[1][0],
        length: fence[1].length,
        start: offset + line.length + (lineIndex < lines.length - 1 ? 1 : 0),
      };
    } else if (openFence && fence && fence[1][0] === openFence.character) {
      const closingFence = line.match(/^ {0,3}(`+|~+)\s*$/)?.[1];
      if (closingFence && closingFence.length >= openFence.length) {
        if (offset > openFence.start) ranges.push({ start: openFence.start, end: offset });
        openFence = null;
      }
    }
    offset += line.length + 1;
  }

  if (openFence && source.length > openFence.start) {
    ranges.push({ start: openFence.start, end: source.length });
  }
  return ranges;
}

function CodeBlock({ code, language }: { code: string; language: string }) {
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState("");
  const displayCode = code.replace(/\r\n/g, "\n").replace(/^\n/, "").replace(/\n$/, "");
  const lines = displayCode.split("\n");

  async function copyCode() {
    try {
      await navigator.clipboard.writeText(displayCode);
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
      <div className="max-h-[216px] overflow-auto">
        <div className="flex min-w-max py-2 font-mono">
          <div
            aria-hidden="true"
            className="sticky left-0 top-0 z-10 shrink-0 border-r border-white/10 bg-[#171a21] px-1 text-right text-[#6e7681] select-none"
          >
            {lines.map((_, index) => (
              <div key={index} className="h-5">
                {index + 1}
              </div>
            ))}
          </div>
          <pre className="m-0 whitespace-pre pl-2 pr-3 text-left text-[12px] leading-5">
            <code>
              {lines.map((line, index) => (
                <span key={index} className="block h-5 whitespace-pre">
                  {highlightCode(line, language)}
                </span>
              ))}
            </code>
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
      className="break-all text-[#278fca] underline underline-offset-2"
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
  table: ({ children }: { children?: ReactNode }) => (
    <div className="my-3 max-w-full overflow-x-auto rounded-xl border border-[#e5e6e9]">
      <table className="min-w-full border-collapse text-left text-[13px] leading-5">
        {children}
      </table>
    </div>
  ),
  thead: ({ children }: { children?: ReactNode }) => (
    <thead className="bg-[#f4f5f7] text-[#282a30]">{children}</thead>
  ),
  th: ({ children }: { children?: ReactNode }) => (
    <th className="border-b border-r border-[#e5e6e9] px-3 py-2 font-semibold last:border-r-0">
      {children}
    </th>
  ),
  td: ({ children }: { children?: ReactNode }) => (
    <td className="border-b border-r border-[#eceef1] px-3 py-2 align-top last:border-r-0">
      {children}
    </td>
  ),
  tr: ({ children }: { children?: ReactNode }) => (
    <tr className="last:[&>td]:border-b-0">{children}</tr>
  ),
};

export const AssistantMarkdown = memo(function AssistantMarkdown({
  content,
  userMessage = false,
  animate = false,
  activeSpeechWordIndex = null,
  onTypewriterProgress,
  onTypewriterComplete,
}: {
  content: string;
  userMessage?: boolean;
  animate?: boolean;
  activeSpeechWordIndex?: number | null;
  onTypewriterProgress?: () => void;
  onTypewriterComplete?: () => void;
}) {
  const [renderedContent, setRenderedContent] = useState(animate ? "" : content);
  const [wordRects, setWordRects] = useState<WordRect[]>([]);
  const contentRef = useRef<HTMLDivElement>(null);
  const progressCallback = useRef(onTypewriterProgress);
  const completeCallback = useRef(onTypewriterComplete);
  const htmlDocument =
    (!animate || renderedContent === content) && containsPlainHtml(renderedContent)
      ? previewDocument(renderedContent)
      : null;

  useEffect(() => {
    progressCallback.current = onTypewriterProgress;
    completeCallback.current = onTypewriterComplete;
  }, [onTypewriterComplete, onTypewriterProgress]);

  useEffect(() => {
    if (!animate) {
      setRenderedContent(content);
      return;
    }

    const characters = Array.from(content);
    const codeRanges = getFencedCodeRanges(content);
    let index = 0;
    setRenderedContent("");
    let timer = 0;
    const typeNextChunk = () => {
      const codeRange = codeRanges.find((range) => index >= range.start && index < range.end);
      const nextCodeRange = codeRanges.find((range) => range.start > index);
      const chunkSize = codeRange ? 40 : 2;
      const segmentEnd = codeRange?.end ?? nextCodeRange?.start ?? characters.length;
      index = Math.min(index + chunkSize, segmentEnd, characters.length);
      setRenderedContent(characters.slice(0, index).join(""));
      progressCallback.current?.();
      if (index === characters.length) {
        completeCallback.current?.();
        return;
      }
      timer = window.setTimeout(typeNextChunk, 30);
    };
    timer = window.setTimeout(typeNextChunk, 30);

    return () => window.clearTimeout(timer);
  }, [animate, content]);

  useLayoutEffect(() => {
    const root = contentRef.current;
    if (!root || activeSpeechWordIndex === null) {
      setWordRects([]);
      return;
    }

    const updateWordRects = () => {
      const range = wordRangeAt(root, activeSpeechWordIndex);
      if (!range) {
        setWordRects([]);
        return;
      }
      const rootRect = root.getBoundingClientRect();
      const wordElement = range.startContainer.parentElement;
      const wordStyle = wordElement ? window.getComputedStyle(wordElement) : null;
      const wordText = range.toString();
      const nextRects: WordRect[] = Array.from(range.getClientRects())
        .filter((rect) => rect.width > 0 && rect.height > 0)
        .map((rect) => ({
          top: rect.top - rootRect.top + root.scrollTop,
          left: rect.left - rootRect.left + root.scrollLeft,
          width: rect.width,
          height: rect.height,
          text: wordText,
          font: wordStyle?.font ?? "",
          letterSpacing: wordStyle?.letterSpacing ?? "normal",
          lineHeight: wordStyle?.lineHeight ?? "normal",
        }));
      setWordRects(nextRects);
      range.detach();
    };

    updateWordRects();
    window.addEventListener("resize", updateWordRects);
    window.addEventListener("scroll", updateWordRects, true);
    const resizeObserver = new ResizeObserver(updateWordRects);
    resizeObserver.observe(root);
    return () => {
      window.removeEventListener("resize", updateWordRects);
      window.removeEventListener("scroll", updateWordRects, true);
      resizeObserver.disconnect();
    };
  }, [activeSpeechWordIndex, renderedContent]);

  return (
    <div
      ref={contentRef}
      className={
        userMessage
          ? "relative min-w-0 text-white [&_p:first-child]:mt-0 [&_p]:my-0 [&_p]:leading-[1.35] [&_ul]:my-1 [&_ol]:my-1 [&_h1]:text-white [&_h2]:text-white [&_h3]:text-white [&_blockquote]:border-white/40 [&_blockquote]:text-white/80"
          : "relative min-w-0 [&_p:first-child]:mt-0"
      }
    >
      {htmlDocument ? (
        <HtmlPreview document={htmlDocument} />
      ) : (
        <ReactMarkdown remarkPlugins={[remarkGfm, remarkUnderline]} components={markdownComponents}>
          {renderedContent}
        </ReactMarkdown>
      )}
      {!htmlDocument && wordRects.map((rect, index) => (
        <span
          key={`${rect.top}:${rect.left}:${index}:${rect.text}`}
          aria-hidden="true"
          className="tts-word-selection"
          style={{
            top: rect.top,
            left: rect.left,
            width: rect.width,
            height: rect.height,
            font: rect.font,
            letterSpacing: rect.letterSpacing,
            lineHeight: rect.lineHeight,
          }}
        >
          {rect.text}
        </span>
      ))}
    </div>
  );
});
